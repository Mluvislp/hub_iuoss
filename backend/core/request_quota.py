"""Hạn mức xin giấy tờ: mỗi loại giấy 1 lần / 1 học kỳ.

Luật (người dùng chốt 01/10/2026):
  - Mỗi loại giấy chỉ xin được MỘT lần trong học kỳ hiện tại.
  - Yêu cầu bị TỪ CHỐI không tính lượt ⇒ xin lại được.
  - Bảng điểm rèn luyện (`conduct_score`) tính riêng theo TỪNG HỌC KỲ CỦA BẢNG ĐIỂM:
    trong một học kỳ, mỗi học kỳ bảng điểm xin được 1 lần.
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
    return {
        "request_id": req.id,
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
                code = ((r.payload or {}).get("purpose") or {}).get("code")
                if code:
                    sems.setdefault(str(code), _blocking_info(r, term))
            out[t] = {"blocked": False, "reason": "", "blocking": None, "blocked_semesters": sems}
            continue
        if mine:
            info = _blocking_info(mine[0], term)
            out[t] = {"blocked": True, "reason": block_message(t, info), "blocking": info}
        else:
            out[t] = {"blocked": False, "reason": "", "blocking": None}
    return {"term": {"key": term["key"], "label": term["label"]}, "contact_email": CONTACT_EMAIL, "types": out}


def block_message(request_type, info, semester_label=None):
    what = (f"Bảng điểm rèn luyện {semester_label.lower()}" if semester_label
            else "Loại giấy này")
    return (f"{what} đã được xin trong {info['term'].lower()} (yêu cầu #{info['request_id']}, "
            f"{info['status_label'].lower()}). Mỗi loại giấy chỉ được xin 1 lần trong một học kỳ; "
            f"được xin lại khi yêu cầu trước bị từ chối. Trường hợp cần xin cấp thêm, đề nghị liên hệ "
            f"Phòng Công tác Sinh viên qua email {CONTACT_EMAIL}.")


def check(student_id, request_type, semester_code=None, semester_label=None):
    """Chuỗi lý do bị chặn, hoặc None nếu được tạo."""
    if not student_id:
        return None
    data = availability(student_id, [request_type])["types"][request_type]
    if request_type == CONDUCT_TYPE:
        info = data["blocked_semesters"].get(str(semester_code or ""))
        return block_message(request_type, info, semester_label or "") if info else None
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
