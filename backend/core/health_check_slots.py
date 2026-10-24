"""Ngày + ca khám tại trường của một đợt (nhánh "Chưa khám" → đăng ký khám).

BẢN SONG SINH, giữ GIỐNG HỆT: dashboard `healthcheck/slots.py` ↔ hub
`backend/core/health_check_slots.py`.

Cấu hình nằm ở cột `health_check_rounds.exam_slots` (JSON), nhân viên nhập trên
Dashboard:
    {"dates": ["2026-10-27", ...],
     "shifts": [{"label": "Ca sáng thứ nhất", "start": "07:30", "end": "09:30"}, ...],
     "capacity": null | số chỗ tối đa MỖI ca}
Mỗi ngày có đủ mọi ca. Một ca = ngày + giờ bắt đầu, khóa `"2026-10-27 07:30"`.

Ca SV chọn lưu trong `health_check_responses.evidence["exam_slot"]` dạng ảnh chụp
`{key, date, start, end, label}` — đợt có sửa tên/giờ ca sau đó thì phản hồi cũ vẫn
đọc được đúng ca SV đã đăng ký. Đợt không cấu hình ca → đăng ký như cũ, không chọn ca.
"""
import re
from collections import Counter
from datetime import date, datetime, time

from django.utils import timezone

WEEKDAYS = ["Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy", "Chủ nhật"]
_TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def _valid_date(value):
    try:
        date.fromisoformat(str(value))
        return True
    except ValueError:
        return False


def _valid_shift(shift):
    return (isinstance(shift, dict) and _TIME.match(str(shift.get("start") or ""))
            and _TIME.match(str(shift.get("end") or "")) and shift["start"] < shift["end"])


def config(round_):
    """Cấu hình đã chuẩn hoá của đợt; None khi đợt không chia ca."""
    raw = getattr(round_, "exam_slots", None) if round_ is not None else None
    if not isinstance(raw, dict):
        return None
    dates = sorted({str(d) for d in raw.get("dates") or [] if _valid_date(d)})
    shifts = sorted(
        ({"label": str(s.get("label") or "").strip() or f"Ca {s['start']}",
          "start": s["start"], "end": s["end"]}
         for s in raw.get("shifts") or [] if _valid_shift(s)),
        key=lambda s: s["start"],
    )
    if not dates or not shifts:
        return None
    capacity = raw.get("capacity")
    capacity = capacity if isinstance(capacity, int) and capacity > 0 else None
    return {"dates": dates, "shifts": shifts, "capacity": capacity}


def slot_key(day, start):
    return f"{day} {start}"


def date_label(day):
    d = date.fromisoformat(day)
    return f"{WEEKDAYS[d.weekday()]}, {d:%d/%m/%Y}"


def iter_slots(cfg):
    for day in cfg["dates"]:
        for shift in cfg["shifts"]:
            yield {"key": slot_key(day, shift["start"]), "date": day, **shift}


def find(cfg, key):
    if not cfg or not key:
        return None
    return next((s for s in iter_slots(cfg) if s["key"] == key), None)


def starts_at(slot):
    """Thời điểm bắt đầu ca (aware, theo múi giờ của app)."""
    hh, mm = (int(x) for x in slot["start"].split(":"))
    naive = datetime.combine(date.fromisoformat(slot["date"]), time(hh, mm))
    return timezone.make_aware(naive, timezone.get_current_timezone())


def has_started(slot, now=None):
    return (now or timezone.now()) >= starts_at(slot)


def snapshot(slot):
    return {k: slot[k] for k in ("key", "date", "start", "end", "label")}


def chosen(evidence):
    """Ca SV đã chọn (ảnh chụp lúc đăng ký); None nếu không có."""
    slot = evidence.get("exam_slot") if isinstance(evidence, dict) else None
    return slot if isinstance(slot, dict) and slot.get("key") else None


def describe(slot):
    """'Ca sáng thứ nhất (07:30–09:30) · Thứ Ba, 27/10/2026'."""
    if not slot:
        return ""
    return f"{slot.get('label', '')} ({slot.get('start', '')}–{slot.get('end', '')}) · {date_label(slot['date'])}"


def taken(evidences):
    """Số chỗ đã giữ theo khóa ca, từ danh sách giá trị cột `evidence`."""
    return Counter(s["key"] for s in map(chosen, evidences) if s)
