"""
Registry field hồ sơ mà sinh viên được đề xuất sửa từ Hub — PHÍA GỬI.

Phần duyệt (approve/reject) nằm ở Dashboard: `students/profile_changes.py`.
Bản này cố ý chỉ có chiều gửi, Hub không được tự duyệt bất cứ thứ gì.

Ba field hiện tại (CCCD, email cá nhân, SĐT) KHÔNG cần duyệt: SV sửa là ghi thẳng.
Bản ghi trong hub_profile_change_requests khi đó đóng vai trò NHẬT KÝ — lưu
old_value → new_value cho mọi lần sửa, vì Hub không ghi AuditLog nên đó là dấu
vết duy nhất. Cơ chế duyệt (approval=True) vẫn còn cho field thêm sau này.

⚠️ Luật validate phải khớp bản Dashboard. Sửa một bên thì sửa luôn bên kia.
"""

import json
import re
import uuid
from datetime import date, datetime

from django.db import transaction
from django.utils import timezone

from students.models import (
    ProfileChangeRequest, StudentContactPoint, StudentIdentityDocument,
)

CCCD_RE = re.compile(r"^\d{12}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[a-zA-Z]{2,}$")
PHONE_RE = re.compile(r"^0(3|5|7|8|9)\d{8}$")

SCHOOL_EMAIL_DOMAINS = ("student.hcmiu.edu.vn", "hcmiu.edu.vn")


class ChangeError(ValueError):
    """Lỗi hiển thị thẳng cho sinh viên."""


# ── Đọc giá trị hiện tại ──────────────────────────────────────────────────────

def _cccd_row(student):
    return (
        StudentIdentityDocument.objects
        .filter(student=student, document_type=StudentIdentityDocument.TYPE_CCCD,
                is_current=True)
        .order_by("-id").first()
    )


def _fmt_date(value):
    return value.strftime("%d/%m/%Y") if value else ""


def _parse_date(text, label):
    text = (text or "").strip()
    if not text:
        return None
    try:
        return datetime.strptime(text, "%d/%m/%Y").date()
    except ValueError:
        raise ChangeError(f"{label} phải theo dạng dd/mm/yyyy.")


def _current_cccd(student):
    """CCCD là target CÓ CẤU TRÚC: số thẻ + nơi cấp + ngày cấp nằm chung một
    dòng nên phải đi cùng nhau, tách thành 3 target riêng sẽ sinh 3 dòng lịch sử
    cho một lần sửa."""
    doc = _cccd_row(student)
    if doc is None:
        return {"number": "", "issue_place": "", "issue_date": ""}
    return {
        "number": (doc.document_number or "").strip(),
        "issue_place": (doc.issue_place or "").strip(),
        "issue_date": _fmt_date(doc.issue_date),
    }


def _current_contact(student, contact_type):
    row = (
        StudentContactPoint.objects
        .filter(student=student, contact_type=contact_type, is_current=True)
        .order_by("-id").first()
    )
    return (row.contact_value or "").strip() if row else ""


def current_university_email(student):
    """Email trường cấp — chỉ để hiển thị, SV không sửa được."""
    return _current_contact(student, StudentContactPoint.TYPE_UNIVERSITY_EMAIL)


# ── Chuẩn hóa + kiểm tra ──────────────────────────────────────────────────────

def _clean_cccd(value, student):
    """value là dict {number, issue_place, issue_date} — trả về dict đã chuẩn hóa."""
    if not isinstance(value, dict):
        value = {"number": value}

    text = re.sub(r"[\s.\-]", "", (value.get("number") or "").strip())
    if not CCCD_RE.match(text):
        raise ChangeError("Số CCCD phải gồm đúng 12 chữ số.")
    clash = (
        StudentIdentityDocument.objects
        .filter(document_type=StudentIdentityDocument.TYPE_CCCD, document_number=text)
        .exclude(student=student).order_by().exists()
    )
    if clash:
        # Không nói trùng với ai — tránh dò dữ liệu sinh viên khác.
        raise ChangeError(
            "Số CCCD này đã tồn tại trong hệ thống. Vui lòng kiểm tra lại "
            "hoặc liên hệ phòng CTSV."
        )

    place = " ".join((value.get("issue_place") or "").split())
    if len(place) > 255:
        raise ChangeError("Nơi cấp quá dài (tối đa 255 ký tự).")

    issued = _parse_date(value.get("issue_date"), "Ngày cấp")
    # Cùng luật với validate_issue_date của luồng giấy xác nhận.
    if issued and issued > date.today():
        raise ChangeError("Ngày cấp CCCD không được ở tương lai.")
    if issued and issued.year < 1990:
        raise ChangeError("Ngày cấp CCCD không hợp lệ.")

    return {"number": text, "issue_place": place, "issue_date": _fmt_date(issued)}


def _clean_personal_email(value, student):
    text = (value or "").strip().lower()
    if not EMAIL_RE.match(text):
        raise ChangeError("Email không hợp lệ.")
    if text.rsplit("@", 1)[-1] in SCHOOL_EMAIL_DOMAINS:
        raise ChangeError(
            "Đây là email do trường cấp. Vui lòng nhập email cá nhân (Gmail, Outlook…)."
        )
    if len(text) > 255:
        raise ChangeError("Email quá dài (tối đa 255 ký tự).")
    return text


def _clean_phone(value, student):
    text = re.sub(r"[\s.\-()]", "", (value or "").strip())
    if text.startswith("+84"):
        text = "0" + text[3:]
    elif text.startswith("84") and len(text) == 11:
        text = "0" + text[2:]
    if not PHONE_RE.match(text):
        raise ChangeError(
            "Số điện thoại không hợp lệ — cần 10 chữ số, bắt đầu bằng "
            "03, 05, 07, 08 hoặc 09."
        )
    return text


# ── Ghi vào hồ sơ gốc (chỉ dùng cho trường hợp ghi thẳng) ─────────────────────

def _apply_cccd(student, value):
    """CCCD đổi thì GHI DÒNG MỚI và hạ dòng cũ xuống is_current=False.

    Không sửa đè: số CCCD cũ là giấy tờ đã từng dùng để cấp giấy xác nhận, phải
    tra lại được. Cùng quy ước con trỏ is_current của địa chỉ và thẻ BHYT.
    ⚠️ Logic này khai ở CẢ HAI repo — sửa một bên phải sửa bên kia.
    """
    olds = list(
        StudentIdentityDocument.objects
        .select_for_update()
        .filter(student=student, document_type=StudentIdentityDocument.TYPE_CCCD,
                is_current=True)
        .order_by("-id")
    )
    for row in olds:
        row.is_current = False
        row.save(update_fields=["is_current"])

    return StudentIdentityDocument.objects.create(
        student=student,
        document_type=StudentIdentityDocument.TYPE_CCCD,
        document_number=value["number"],
        issue_place=value.get("issue_place") or None,
        issue_date=_parse_date(value.get("issue_date"), "Ngày cấp"),
        is_current=True,
    )


def _apply_contact(student, contact_type, value):
    row = (
        StudentContactPoint.objects
        .filter(student=student, contact_type=contact_type, is_current=True)
        .order_by("-id").first()
    )
    if row:
        row.contact_value = value
        row.normalized_contact_value = value.lower()
        row.save(update_fields=["contact_value", "normalized_contact_value", "updated_at"])
        return row
    return StudentContactPoint.objects.create(
        student=student,
        contact_type=contact_type,
        contact_value=value,
        normalized_contact_value=value.lower(),
        is_current=True,
    )


# `approval` = True thì phải chờ nhân viên duyệt; False thì ghi thẳng và bản ghi
# chỉ còn vai trò NHẬT KÝ. Ba field hiện tại đều không cần duyệt (chốt
# 2026-08-04); cơ chế duyệt giữ nguyên cho field thêm sau này.
CHANGE_TARGETS = {
    "student.citizen_id": {
        "label": "Số CCCD",
        "approval": False,
        "shape": "json",       # {number, issue_place, issue_date}
        "read": _current_cccd,
        "clean": _clean_cccd,
        "apply": _apply_cccd,
        # CMND 9 số cũ cũng tính là "chưa có CCCD" — cùng cách hiểu với
        # validate_citizen_id trong core/documents.py.
        "is_blank": lambda current: not CCCD_RE.match((current or {}).get("number") or ""),
    },
    "contact.personal_email": {
        "label": "Email cá nhân",
        "approval": False,
        "read": lambda s: _current_contact(s, StudentContactPoint.TYPE_PERSONAL_EMAIL),
        "clean": _clean_personal_email,
        "apply": lambda s, v: _apply_contact(s, StudentContactPoint.TYPE_PERSONAL_EMAIL, v),
        "is_blank": lambda current: not (current or "").strip(),
    },
    "contact.mobile_phone": {
        "label": "Số điện thoại",
        "approval": False,
        "read": lambda s: _current_contact(s, StudentContactPoint.TYPE_MOBILE_PHONE),
        "clean": _clean_phone,
        "apply": lambda s, v: _apply_contact(s, StudentContactPoint.TYPE_MOBILE_PHONE, v),
        "is_blank": lambda current: not (current or "").strip(),
    },
}


# Vé "mở lại form khai báo" do nhân viên cấp. Không phải một đề xuất sửa field
# nên KHÔNG nằm trong CHANGE_TARGETS — sinh viên không thể tự tạo qua API.
#   status='approved'  = vé còn hiệu lực
#   status='cancelled' = vé đã dùng (SV khai lại xong)
TARGET_REOPEN = "declaration.offcampus"


def active_reopen(student):
    return (
        ProfileChangeRequest.objects
        .filter(student=student, target=TARGET_REOPEN,
                status=ProfileChangeRequest.STATUS_APPROVED)
        .order_by("-id").first()
    )


def consume_reopen(student):
    """Đánh dấu vé đã dùng sau khi SV khai lại thành công."""
    return (
        ProfileChangeRequest.objects
        .filter(student=student, target=TARGET_REOPEN,
                status=ProfileChangeRequest.STATUS_APPROVED)
        .update(status=ProfileChangeRequest.STATUS_CANCELLED)
    )


def spec(target):
    try:
        return CHANGE_TARGETS[target]
    except KeyError:
        raise ChangeError(f"Không hỗ trợ sửa trường «{target}».")


def new_group_key():
    return uuid.uuid4().hex


def dump_value(conf, value):
    """Giá trị -> TEXT để lưu. Target có cấu trúc thì serialize JSON; đây là lý
    do cột old_value/new_value là TEXT chứ không phải VARCHAR."""
    if conf.get("shape") == "json":
        return json.dumps(value, ensure_ascii=False)
    return value


def load_value(conf, raw):
    """TEXT trong DB -> giá trị. Dùng khi đọc lại nhật ký để hiển thị."""
    if conf.get("shape") != "json":
        return raw or ""
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        # Dòng nhật ký ghi trước khi target chuyển sang dạng có cấu trúc:
        # giá trị là chuỗi trần. Coi như chỉ có số thẻ, đừng để mất dữ liệu cũ.
        return {"number": raw}
    return parsed if isinstance(parsed, dict) else {"number": raw}


@transaction.atomic
def submit_change(student, target, value, *, source, group_key=None):
    """Trả về (ProfileChangeRequest, applied_ngay) hoặc (None, False) nếu không đổi."""
    conf = spec(target)
    current = conf["read"](student)
    cleaned = conf["clean"](value, student)

    if cleaned == current:
        return None, False

    old_raw = dump_value(conf, current) if current else None
    new_raw = dump_value(conf, cleaned)

    if not conf.get("approval", True) or conf["is_blank"](current):
        conf["apply"](student, cleaned)
        return ProfileChangeRequest.objects.create(
            student=student, target=target, old_value=old_raw,
            new_value=new_raw, source=source, group_key=group_key,
            status=ProfileChangeRequest.STATUS_APPROVED,
            reviewed_at=timezone.now(),   # reviewed_by_id để trống = hệ thống tự duyệt
        ), True

    # Mỗi field chỉ được có một yêu cầu chờ duyệt — giữ bằng code vì MySQL
    # không có partial unique index.
    pending = (
        ProfileChangeRequest.objects
        .select_for_update()
        .filter(student=student, target=target,
                status=ProfileChangeRequest.STATUS_PENDING)
        .order_by("-id").first()
    )
    if pending:
        pending.new_value = new_raw
        pending.old_value = old_raw
        pending.group_key = group_key or pending.group_key
        pending.save(update_fields=["new_value", "old_value", "group_key", "updated_at"])
        return pending, False

    return ProfileChangeRequest.objects.create(
        student=student, target=target, old_value=old_raw,
        new_value=new_raw, source=source, group_key=group_key,
        status=ProfileChangeRequest.STATUS_PENDING,
    ), False


def pending_map(student):
    rows = ProfileChangeRequest.objects.filter(
        student=student, status=ProfileChangeRequest.STATUS_PENDING
    ).order_by("-id")
    return {r.target: r for r in rows}


def read_profile(student):
    """Giá trị hiện tại + yêu cầu đang chờ, cho phần 'thông tin cá nhân'.

    `value` của target vô hướng là chuỗi; của target có cấu trúc là dict —
    frontend đọc theo `shape`.
    """
    pending = pending_map(student)
    out = {}
    for target, conf in CHANGE_TARGETS.items():
        req = pending.get(target)
        out[target] = {
            "label": conf["label"],
            "shape": conf.get("shape", "scalar"),
            "value": conf["read"](student),
            "editable": True,
            "pending_value": load_value(conf, req.new_value) if req else None,
        }
    return out


# ── Sinh viên xin mở lại form ────────────────────────────────────────────────
# Khác TARGET_REOPEN (vé do nhân viên cấp): đây là ĐỀ NGHỊ do SV gửi, nằm chờ ở
# trạng thái pending cho tới khi nhân viên mở lại hoặc từ chối.
TARGET_REOPEN_REQUEST = "declaration.reopen_request"


def active_reopen_request(student):
    return (
        ProfileChangeRequest.objects
        .filter(student=student, target=TARGET_REOPEN_REQUEST,
                status=ProfileChangeRequest.STATUS_PENDING)
        .order_by("-id").first()
    )


@transaction.atomic
def request_reopen(student, reason=""):
    """SV bấm "Yêu cầu chỉnh sửa lại". Idempotent: đã gửi rồi thì cập nhật lý do."""
    existing = active_reopen_request(student)
    if existing:
        if reason:
            existing.review_note = reason.strip()[:255]
            existing.save(update_fields=["review_note", "updated_at"])
        return existing, False
    return ProfileChangeRequest.objects.create(
        student=student,
        target=TARGET_REOPEN_REQUEST,
        old_value=None,
        new_value="request",
        source=ProfileChangeRequest.SOURCE_OFFCAMPUS,
        status=ProfileChangeRequest.STATUS_PENDING,
        review_note=(reason or "").strip()[:255] or None,
    ), True
