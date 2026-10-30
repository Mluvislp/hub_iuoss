"""Hạn mức xin giấy tờ: mỗi loại giấy 1 lần / 1 học kỳ (GXN "Khác" + GXN tiếng Anh: theo MỤC ĐÍCH).

Luật (người dùng chốt 01/10/2026):
  - Mỗi loại giấy chỉ xin được MỘT lần trong học kỳ hiện tại.
  - Yêu cầu bị TỪ CHỐI không tính lượt ⇒ xin lại được.
  - Bảng điểm rèn luyện (`conduct_score`) KHÔNG có hạn mức (người dùng chốt 10/10/2026 — bỏ
    hẳn luật 1 lần / năm học / học kỳ có từ 01/10). SV xin bao nhiêu lần cũng được; Dashboard
    hiện số lần đã cấp cho SV ở trang chi tiết yêu cầu (`documents/conduct_sheet.student_history`).
  - GXN "Lý do khác" (`other`) và GXN tiếng Anh (`english_form`) tính lượt theo MỤC ĐÍCH
    (`payload.purpose.code`), không chung cả loại (người dùng chốt 12/10/2026): cùng học kỳ SV
    vẫn xin được mục đích khác. Mục "tham gia [Tên chương trình]" là MỘT mục đích (mã `program`)
    dù tên chương trình khác nhau — tên gõ tự do, so chữ thì đổi một ký tự là lách được.
  - Chuyên viên bấm "Mở lại lượt xin" trên Dashboard ⇒ yêu cầu đó được đánh dấu
    `payload.quota_exempt` và KHÔNG tính lượt nữa ⇒ SV xin thêm được đúng một lần.

Học kỳ hiện tại theo luật tháng sẵn có (`students.timeline.current_semester`):
HK1 = T9–T1, HK2 = T2–T6, HK3 (hè) = T7–T8 — bảng `academic_terms` không có ngày.

⚠️ BẢN ĐỐI ỨNG ở Dashboard `documents/quota.py` (hiện trạng thái + nút mở lại) — sửa cả hai.
⚠️ Lọc theo khoảng `created_at` bằng datetime có múi giờ, KHÔNG dùng `__date`: MySQL prod/sandbox
thiếu bảng múi giờ nên `__date` lọc ra 0 dòng.
"""

import datetime
from contextlib import contextmanager

from django.db import connection
from django.utils import timezone

from students.timeline import current_academic_year, current_semester

from .documents import ENGLISH_PURPOSE_MAP, OTHER_PURPOSE_MAP
from .models import ConfirmationRequest

CONTACT_EMAIL = "oss@hcmiu.edu.vn"
CONDUCT_TYPE = "conduct_score"
# Loại giấy không giới hạn số lần xin.
UNLIMITED_TYPES = {CONDUCT_TYPE}
# Loại giấy tính lượt theo mục đích (`payload.purpose.code`) → nhãn mục đích gốc (chưa ghép tên chương trình).
PURPOSE_SCOPED_TYPES = {"other": OTHER_PURPOSE_MAP, "english_form": ENGLISH_PURPOSE_MAP}
# Trạng thái KHÔNG tính lượt.
FREE_STATUSES = {ConfirmationRequest.STATUS_REJECTED}

_STATUS_LABELS = dict(ConfirmationRequest.STATUS_CHOICES)


def current_term(today=None):
    """Học kỳ đang diễn ra: {key 'YYYYS', label, start, end} — start/end là datetime có múi giờ."""
    today = today or timezone.localdate()
    year, _ = current_academic_year(today)
    sem = current_semester(today)
    bounds = {
        1: (datetime.date(year, 9, 1), datetime.date(year + 1, 2, 1)),
        2: (datetime.date(year + 1, 2, 1), datetime.date(year + 1, 7, 1)),
        3: (datetime.date(year + 1, 7, 1), datetime.date(year + 1, 9, 1)),
    }[sem]
    tz = timezone.get_current_timezone()
    start, end = (timezone.make_aware(datetime.datetime.combine(d, datetime.time.min), tz) for d in bounds)
    label = ("Học kỳ hè" if sem == 3 else f"Học kỳ {sem}") + f", năm học {year}-{year + 1}"
    return {"key": f"{year}{sem}", "label": label, "start": start, "end": end}


STAFF_LDAP_PREFIX = "staff:"


def is_exempt(req):
    return bool((req.payload or {}).get("quota_exempt"))


def _counted(student_id, term):
    """Yêu cầu trong học kỳ hiện tại đang chiếm lượt (chưa bị từ chối, chưa được mở lại)."""
    rows = (ConfirmationRequest.objects
            .filter(student_id=student_id, created_at__gte=term["start"], created_at__lt=term["end"])
            .exclude(status__in=FREE_STATUSES)
            # Phòng CTSV tự tạo trên Dashboard (ldap_uid "staff:<tài khoản>") — không phải SV xin,
            # không chiếm lượt của SV (dashboard documents/staff_create.py).
            .exclude(ldap_uid__startswith=STAFF_LDAP_PREFIX)
            .only("id", "request_type", "status", "payload", "created_at")
            .order_by("id"))
    return [r for r in rows if not is_exempt(r)]


def purpose_code(req):
    return ((req.payload or {}).get("purpose") or {}).get("code") or ""


def _blocking_info(req, term):
    purpose = (req.payload or {}).get("purpose") or {}
    return {
        "semester_label": purpose.get("label") or "",
        "request_id": req.id,
        "code": req.code,
        "status": req.status,
        "status_label": _STATUS_LABELS.get(req.status, req.status),
        "created_at": req.created_at,
        "term": term["label"],
    }


def availability(student_id, request_types, today=None):
    """Trạng thái từng loại giấy cho học kỳ hiện tại — dùng cho trang chọn loại + form.

    {type: {"blocked": bool, "reason": str, "blocking": {...} | None}}
    Loại trong `UNLIMITED_TYPES` luôn `blocked=False`. Loại trong `PURPOSE_SCOPED_TYPES` không
    chặn cả loại (`blocked=False`) mà kèm `purposes: {code: {blocked, reason, blocking}}` — chỉ
    liệt kê mục đích đã hết lượt.
    """
    term = current_term(today)
    counted = _counted(student_id, term) if student_id else []
    out = {}
    for t in request_types:
        mine = [r for r in counted if r.request_type == t]
        if t in UNLIMITED_TYPES:
            out[t] = {"blocked": False, "reason": "", "blocking": None}
            continue
        if t in PURPOSE_SCOPED_TYPES:
            purposes = {}
            for r in mine:
                code = purpose_code(r)
                if code and code not in purposes:
                    info = _blocking_info(r, term)
                    purposes[code] = {"blocked": True, "reason": purpose_block_message(t, code, info),
                                      "blocking": info}
            out[t] = {"blocked": False, "reason": "", "blocking": None, "purposes": purposes}
            continue
        if mine:
            info = _blocking_info(mine[0], term)
            out[t] = {"blocked": True, "reason": block_message(t, info), "blocking": info}
        else:
            out[t] = {"blocked": False, "reason": "", "blocking": None}
    return {"term": {"key": term["key"], "label": term["label"]}, "contact_email": CONTACT_EMAIL, "types": out}


def block_message(request_type, info):
    return (f"Loại giấy này đã được xin trong {info['term'].lower()} (mã yêu cầu {info['code']}, "
            f"{info['status_label'].lower()}). Mỗi loại giấy chỉ được xin 1 lần trong một học kỳ; "
            f"được xin lại khi yêu cầu trước bị từ chối. Trường hợp cần xin cấp thêm, đề nghị liên hệ "
            f"Phòng Công tác Sinh viên qua email {CONTACT_EMAIL}.")


def purpose_block_message(request_type, code, info):
    label = PURPOSE_SCOPED_TYPES[request_type].get(code, code).replace(" [Tên chương trình]", " chương trình")
    return (f"Mục đích “{label}” đã được xin trong {info['term'].lower()} (mã yêu cầu {info['code']}, "
            f"{info['status_label'].lower()}). Mỗi mục đích chỉ được xin 1 lần trong một học kỳ; "
            f"có thể chọn mục đích khác, hoặc xin lại khi yêu cầu trước bị từ chối. Trường hợp cần xin "
            f"cấp thêm, đề nghị liên hệ Phòng Công tác Sinh viên qua email {CONTACT_EMAIL}.")


def check(student_id, request_type, purpose=""):
    """Chuỗi lý do bị chặn, hoặc None nếu được tạo. `purpose` = mã mục đích SV chọn (chỉ dùng
    cho loại trong `PURPOSE_SCOPED_TYPES`)."""
    if not student_id or request_type in UNLIMITED_TYPES:
        return None
    data = availability(student_id, [request_type])["types"][request_type]
    if request_type in PURPOSE_SCOPED_TYPES:
        hit = data["purposes"].get(purpose or "")
        return hit["reason"] if hit else None
    return data["reason"] if data["blocked"] else None


@contextmanager
def student_lock(student_id, timeout=10):
    """Khoá theo sinh viên (MySQL GET_LOCK) để hai lần bấm gửi đồng thời không vượt hạn mức."""
    name = f"docreq-quota-{student_id}"
    with connection.cursor() as cur:
        cur.execute("SELECT GET_LOCK(%s, %s)", [name, timeout])
    try:
        yield
    finally:
        with connection.cursor() as cur:
            cur.execute("SELECT RELEASE_LOCK(%s)", [name])
