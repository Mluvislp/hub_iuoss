"""Hạn mức xin giấy tờ: mỗi loại giấy 1 lần / 1 học kỳ.

Luật (người dùng chốt 01/10/2026):
  - Mỗi loại giấy chỉ xin được MỘT lần trong học kỳ hiện tại.
  - Yêu cầu bị TỪ CHỐI không tính lượt ⇒ xin lại được.
  - Bảng điểm rèn luyện (`conduct_score`) tính riêng theo TỪNG NĂM HỌC CỦA BẢNG ĐIỂM:
    trong một học kỳ, mỗi năm học bảng điểm xin được 1 lần. Từ 09/10/2026 một yêu cầu gồm
    một hoặc nhiều năm học (`documents.conduct_purpose_codes`) — mỗi năm trong đó đều chiếm
    lượt. Yêu cầu cũ chọn học kỳ lẻ chỉ khoá đúng học kỳ đó (`conduct_overlapping_codes`).
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

from .documents import conduct_overlapping_codes, conduct_purpose_codes
from .models import ConfirmationRequest

CONTACT_EMAIL = "oss@hcmiu.edu.vn"
CONDUCT_TYPE = "conduct_score"
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


def is_exempt(req):
    return bool((req.payload or {}).get("quota_exempt"))


def _counted(student_id, term):
    """Yêu cầu trong học kỳ hiện tại đang chiếm lượt (chưa bị từ chối, chưa được mở lại)."""
    rows = (ConfirmationRequest.objects
            .filter(student_id=student_id, created_at__gte=term["start"], created_at__lt=term["end"])
            .exclude(status__in=FREE_STATUSES)
            .only("id", "request_type", "status", "payload", "created_at")
            .order_by("id"))
    return [r for r in rows if not is_exempt(r)]


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

    {type: {"blocked": bool, "reason": str, "blocking": {...} | None,
            "blocked_semesters": {code: {...}}  # chỉ conduct_score}}
    """
    term = current_term(today)
    counted = _counted(student_id, term) if student_id else []
    out = {}
    for t in request_types:
        mine = [r for r in counted if r.request_type == t]
        if t == CONDUCT_TYPE:
            sems = {}
            for r in mine:
                # Mỗi năm học trong yêu cầu đều chiếm lượt; cả năm khoá luôn học kỳ lẻ của năm đó.
                for code in conduct_purpose_codes((r.payload or {}).get("purpose")):
                    for c in sorted(conduct_overlapping_codes(code)):
                        sems.setdefault(c, _blocking_info(r, term))
            out[t] = {"blocked": False, "reason": "", "blocking": None, "blocked_semesters": sems}
            continue
        if mine:
            info = _blocking_info(mine[0], term)
            out[t] = {"blocked": True, "reason": block_message(t, info), "blocking": info}
        else:
            out[t] = {"blocked": False, "reason": "", "blocking": None}
    return {"term": {"key": term["key"], "label": term["label"]}, "contact_email": CONTACT_EMAIL, "types": out}


def block_message(request_type, info, semester_label=None):
    # Bảng điểm RL: nêu lựa chọn ĐÃ xin — có thể khác lựa chọn đang xin (cả năm ↔ học kỳ lẻ).
    used = info.get("semester_label") or semester_label
    what = f"Bảng điểm rèn luyện {used.lower()}" if used else "Loại giấy này"
    overlap = (" Đã xin cả năm học thì không xin lẻ từng học kỳ của năm học đó."
               if semester_label and used and used != semester_label else "")
    return (f"{what} đã được xin trong {info['term'].lower()} (mã yêu cầu {info['code']}, "
            f"{info['status_label'].lower()}). Mỗi loại giấy chỉ được xin 1 lần trong một học kỳ; "
            f"được xin lại khi yêu cầu trước bị từ chối. Trường hợp cần xin cấp thêm, đề nghị liên hệ "
            f"Phòng Công tác Sinh viên qua email {CONTACT_EMAIL}.{overlap}")


def conduct_block_message(hits):
    """hits = [(nhãn năm học đang xin, info yêu cầu chiếm lượt)] — liệt kê mọi năm bị trùng."""
    years = ", ".join(label.replace("Cả năm học ", "") for label, _ in hits)
    refs = "; ".join(dict.fromkeys(f"mã yêu cầu {i['code']}, {i['status_label'].lower()}" for _, i in hits))
    term = hits[0][1]["term"].lower()
    return (f"Bảng điểm rèn luyện năm học {years} đã được xin trong {term} ({refs}). Mỗi năm học "
            f"chỉ được xin 1 lần trong một học kỳ; được xin lại khi yêu cầu trước bị từ chối. Bỏ chọn "
            f"năm học đã xin để gửi các năm còn lại. Trường hợp cần xin cấp thêm, đề nghị liên hệ "
            f"Phòng Công tác Sinh viên qua email {CONTACT_EMAIL}.")


def check(student_id, request_type, semester_codes=None, labels=None):
    """Chuỗi lý do bị chặn, hoặc None nếu được tạo.

    Bảng điểm rèn luyện: `semester_codes` là danh sách năm học đang xin (`labels` = {mã: nhãn});
    trùng bất kỳ năm nào ⇒ chặn cả yêu cầu và nêu đủ các năm trùng.
    """
    if not student_id:
        return None
    data = availability(student_id, [request_type])["types"][request_type]
    if request_type == CONDUCT_TYPE:
        blocked = data["blocked_semesters"]
        labels = labels or {}
        hits = [(labels.get(c, c), blocked[c]) for c in (semester_codes or []) if c in blocked]
        return conduct_block_message(hits) if hits else None
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
