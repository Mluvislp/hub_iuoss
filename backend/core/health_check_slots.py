"""Ngày + ca khám tại trường của một đợt (nhánh "Chưa khám" → đăng ký khám).

BẢN SONG SINH, giữ GIỐNG HỆT: dashboard `healthcheck/slots.py` ↔ hub
`backend/core/health_check_slots.py`.

Cấu hình nằm ở cột `health_check_rounds.exam_slots` (JSON), nhân viên nhập trên
Dashboard. Từ 10/11/2026 lịch chia thành nhiều ĐỢT KHÁM, mỗi đợt có ngày, ca và số chỗ riêng:
    {"phases": [
        {"label": "Đợt 1",
         "dates": ["2026-10-27", ...],
         "shifts": [{"label": "Ca sáng thứ nhất", "start": "07:30", "end": "09:30"}, ...],
         "capacity": null | số chỗ tối đa MỖI ca,
         "closed_dates": ["2026-10-27", ...],        ← ngày NGỪNG nhận đăng ký
         "closed_slots": ["2026-10-28 07:30", ...],  ← từng CA ngừng nhận đăng ký
         "tentative": true,                          ← ngày DỰ KIẾN: mọi nhãn ngày thêm "(Ngày dự kiến)"
         "registration": {"opens_at": ..., "closes_at": ...}},   ← chỉ để lưu vết, không xét
        {"label": "Đợt 2", ...}]}
Dạng cũ (một khối `dates/shifts/...` không có `phases`) vẫn đọc được = một đợt khám.

Mỗi ngày của một đợt khám có đủ mọi ca của đợt đó; một ngày chỉ thuộc một đợt khám. Ngày trong
`closed_dates` / ca trong `closed_slots` vẫn là ngày, ca khám (SV đã đăng ký giữ nguyên ca, vẫn thống
kê/xuất file) nhưng Hub không cho chọn thêm. Một ca = ngày + giờ bắt đầu, khóa `"2026-10-27 07:30"`.
SV chỉ đăng ký vào đợt khám MỚI NHẤT (`current_phase`).

Ca SV chọn lưu trong `health_check_responses.evidence["exam_slot"]` dạng ảnh chụp
`{key, date, start, end, label}` — đợt có sửa tên/giờ ca sau đó thì phản hồi cũ vẫn
đọc được đúng ca SV đã đăng ký. Ca thuộc đợt khám nào suy ra từ NGÀY (`phase_of`).
Đợt không cấu hình ca → đăng ký như cũ, không chọn ca.
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


def _phase(raw, taken_dates):
    """Một đợt khám đã chuẩn hoá; None khi thiếu ngày hoặc ca. Ngày đã thuộc đợt trước thì bỏ."""
    if not isinstance(raw, dict):
        return None
    dates = sorted({str(d) for d in raw.get("dates") or [] if _valid_date(d)} - taken_dates)
    shifts = sorted(
        ({"label": str(s.get("label") or "").strip() or f"Ca {s['start']}",
          "start": s["start"], "end": s["end"]}
         for s in raw.get("shifts") or [] if _valid_shift(s)),
        key=lambda s: s["start"],
    )
    if not dates or not shifts:
        return None
    capacity = raw.get("capacity")
    capacity = capacity if isinstance(capacity, int) and not isinstance(capacity, bool) and capacity > 0 else None
    closed = sorted({str(d) for d in raw.get("closed_dates") or [] if str(d) in dates})
    keys = {slot_key(d, s["start"]) for d in dates for s in shifts}
    closed_slots = sorted({str(k) for k in raw.get("closed_slots") or [] if str(k) in keys})
    phase = {"label": str(raw.get("label") or "").strip(), "dates": dates, "shifts": shifts,
             "capacity": capacity, "closed_dates": closed, "closed_slots": closed_slots}
    if raw.get("tentative") is True:
        phase["tentative"] = True
    if isinstance(raw.get("registration"), dict):
        phase["registration"] = raw["registration"]
    return phase


def config(round_):
    """Cấu hình đã chuẩn hoá của đợt; None khi đợt không chia ca.

    `{"phases": [{index, label, dates, shifts, capacity, closed_dates, closed_slots}, ...],
      "dates": mọi ngày khám}` — các đợt khám xếp theo ngày, `index` từ 1.
    """
    raw = getattr(round_, "exam_slots", None) if round_ is not None else None
    if not isinstance(raw, dict):
        return None
    items = raw["phases"] if isinstance(raw.get("phases"), list) else [raw]
    phases, seen = [], set()
    for item in items:
        phase = _phase(item, seen)
        if phase is not None:
            seen.update(phase["dates"])
            phases.append(phase)
    if not phases:
        return None
    phases.sort(key=lambda p: p["dates"][0])
    for i, phase in enumerate(phases, start=1):
        phase["index"] = i
        phase["label"] = phase["label"] or f"Đợt {i}"
    return {"phases": phases, "dates": sorted(seen)}


def dump(phases):
    """Danh sách đợt khám (dạng `config()["phases"]`) → giá trị ghi vào cột `exam_slots`."""
    out = []
    for p in phases:
        item = {k: p[k] for k in ("label", "dates", "shifts", "capacity", "closed_dates", "closed_slots")}
        if p.get("tentative"):
            item["tentative"] = True
        if p.get("registration"):
            item["registration"] = p["registration"]
        out.append(item)
    return {"phases": out} if out else None


def phase_of(cfg, day):
    """Đợt khám chứa ngày `day` (YYYY-MM-DD); None nếu ngày không thuộc đợt nào."""
    if not cfg or not day:
        return None
    return next((p for p in cfg["phases"] if day in p["dates"]), None)


def current_phase(cfg):
    """Đợt khám đang nhận đăng ký = đợt có ngày muộn nhất."""
    return cfg["phases"][-1] if cfg else None


def is_closed(cfg, slot):
    """Ca thuộc ngày đã ngừng nhận đăng ký, hoặc chính ca đó đã ngừng nhận đăng ký."""
    phase = phase_of(cfg, slot.get("date")) if slot else None
    return bool(phase and (slot.get("date") in phase["closed_dates"]
                           or slot.get("key") in phase["closed_slots"]))


def slot_key(day, start):
    return f"{day} {start}"


def date_label(day):
    d = date.fromisoformat(day)
    return f"{WEEKDAYS[d.weekday()]}, {d:%d/%m/%Y}"


TENTATIVE_NOTE = " (Ngày dự kiến)"


def day_label(cfg, day):
    """'Thứ Ba, 17/11/2026' + ' (Ngày dự kiến)' khi ngày thuộc đợt khám đánh dấu dự kiến."""
    phase = phase_of(cfg, day)
    return date_label(day) + (TENTATIVE_NOTE if phase and phase.get("tentative") else "")


def describe_in(cfg, slot):
    """Như `describe` nhưng kèm '(Ngày dự kiến)' theo cấu hình hiện tại của đợt."""
    text = describe(slot)
    phase = phase_of(cfg, slot.get("date")) if slot else None
    return text + (TENTATIVE_NOTE if text and phase and phase.get("tentative") else "")


def iter_slots(cfg, phase=None):
    """Mọi ca (của một đợt khám nếu truyền `phase`), kèm `capacity` + `phase` (index) của đợt."""
    for p in ([phase] if phase else cfg["phases"]):
        for day in p["dates"]:
            for shift in p["shifts"]:
                yield {"key": slot_key(day, shift["start"]), "date": day, **shift,
                       "capacity": p["capacity"], "phase": p["index"]}


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
