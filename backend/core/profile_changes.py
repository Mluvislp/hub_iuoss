"""
Registry field hồ sơ mà sinh viên được đề xuất sửa từ Hub — PHÍA GỬI.

Phần duyệt (approve/reject) nằm ở Dashboard: `students/profile_changes.py`.
Bản này cố ý chỉ có chiều gửi, Hub không được tự duyệt bất cứ thứ gì.

Quy tắc "nhập lần đầu thì ghi thẳng": hồ sơ đang trống → ghi luôn và lưu một bản
ghi status=approved để có lịch sử (Hub không ghi AuditLog nên đây là dấu vết duy
nhất). Hồ sơ đã có giá trị → tạo bản ghi pending chờ nhân viên duyệt.

⚠️ Luật validate phải khớp bản Dashboard. Sửa một bên thì sửa luôn bên kia.
"""

import re
import uuid

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

def _current_cccd(student):
    doc = (
        StudentIdentityDocument.objects
        .filter(student=student, document_type=StudentIdentityDocument.TYPE_CCCD,
                is_current=True)
        .order_by("-id").first()
    )
    return (doc.document_number or "").strip() if doc else ""


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
    text = re.sub(r"[\s.\-]", "", (value or "").strip())
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
    return text


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
    doc = (
        StudentIdentityDocument.objects
        .filter(student=student, document_type=StudentIdentityDocument.TYPE_CCCD,
                is_current=True)
        .order_by("-id").first()
    )
    if doc:
        doc.document_number = value
        doc.save(update_fields=["document_number"])
        return doc
    return StudentIdentityDocument.objects.create(
        student=student,
        document_type=StudentIdentityDocument.TYPE_CCCD,
        document_number=value,
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


CHANGE_TARGETS = {
    "student.citizen_id": {
        "label": "Số CCCD",
        "read": _current_cccd,
        "clean": _clean_cccd,
        "apply": _apply_cccd,
        # CMND 9 số cũ cũng tính là "chưa có CCCD" — cùng cách hiểu với
        # validate_citizen_id trong core/documents.py.
        "is_blank": lambda current: not CCCD_RE.match(current or ""),
    },
    "contact.personal_email": {
        "label": "Email cá nhân",
        "read": lambda s: _current_contact(s, StudentContactPoint.TYPE_PERSONAL_EMAIL),
        "clean": _clean_personal_email,
        "apply": lambda s, v: _apply_contact(s, StudentContactPoint.TYPE_PERSONAL_EMAIL, v),
        "is_blank": lambda current: not (current or "").strip(),
    },
    "contact.mobile_phone": {
        "label": "Số điện thoại",
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


@transaction.atomic
def submit_change(student, target, value, *, source, group_key=None):
    """Trả về (ProfileChangeRequest, applied_ngay) hoặc (None, False) nếu không đổi."""
    conf = spec(target)
    current = conf["read"](student)
    cleaned = conf["clean"](value, student)

    if cleaned == current:
        return None, False

    if conf["is_blank"](current):
        conf["apply"](student, cleaned)
        return ProfileChangeRequest.objects.create(
            student=student, target=target, old_value=current or None,
            new_value=cleaned, source=source, group_key=group_key,
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
        pending.new_value = cleaned
        pending.old_value = current or None
        pending.group_key = group_key or pending.group_key
        pending.save(update_fields=["new_value", "old_value", "group_key", "updated_at"])
        return pending, False

    return ProfileChangeRequest.objects.create(
        student=student, target=target, old_value=current or None,
        new_value=cleaned, source=source, group_key=group_key,
        status=ProfileChangeRequest.STATUS_PENDING,
    ), False


def pending_map(student):
    rows = ProfileChangeRequest.objects.filter(
        student=student, status=ProfileChangeRequest.STATUS_PENDING
    ).order_by("-id")
    return {r.target: r for r in rows}


def read_profile(student):
    """Giá trị hiện tại + yêu cầu đang chờ, cho phần 'thông tin cá nhân'."""
    pending = pending_map(student)
    out = {}
    for target, conf in CHANGE_TARGETS.items():
        req = pending.get(target)
        out[target] = {
            "label": conf["label"],
            "value": conf["read"](student),
            "editable": True,
            "pending_value": req.new_value if req else None,
        }
    return out
