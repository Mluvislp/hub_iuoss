"""Trang "Thông tin cá nhân": SV xem hồ sơ và gửi yêu cầu cập nhật.

Mọi cụm sửa được đều CHỜ DUYỆT (kể cả khai lần đầu) — mỗi cụm thành một dòng
`hub_profile_change_requests` (source = thong_tin_ca_nhan). Nhân viên duyệt ở
Dashboard (students/personal_info_review.py); từ chối thì hồ sơ không đổi, SV
thấy lý do ở đây, sửa và gửi lại thành dòng mới.
"""
from django.db import transaction
from django.db.models import Count

from core import profile_changes as pc
from students.models import ProfileChangeRequest, StudentBankAccount

SOURCE = ProfileChangeRequest.SOURCE_PERSONAL_INFO

# key gửi lên từ frontend → target trong registry. Thứ tự = thứ tự trên trang.
GROUPS = [
    ("personal_email", "contact.personal_email"),
    ("mobile_phone", "contact.mobile_phone"),
    ("citizen_id", "student.citizen_id"),
    ("bank_account", "bank.account"),
    ("father", "family.father"),
    ("mother", "family.mother"),
    ("high_school", "school.high_school"),
]
GROUP_TARGETS = dict(GROUPS)

SEX_LABELS = {"M": "Nam", "MALE": "Nam", "NAM": "Nam", "F": "Nữ", "FEMALE": "Nữ", "NU": "Nữ", "NỮ": "Nữ"}


class SubmitErrors(Exception):
    """{group_key: thông báo} — trả nguyên cho frontend hiện dưới từng cụm."""

    def __init__(self, errors):
        super().__init__("; ".join(errors.values()))
        self.errors = errors


def _sex_label(raw):
    raw = (raw or "").strip()
    return SEX_LABELS.get(raw.upper(), raw)


def _iso(dt):
    return dt.isoformat() if dt else None


def _latest_rows(student):
    """{target: dòng mới nhất của trang này} — để biết cụm đang chờ hay vừa bị từ chối."""
    latest = {}
    rows = (
        ProfileChangeRequest.objects
        .filter(student=student, source=SOURCE, target__in=GROUP_TARGETS.values())
        .order_by("-id")
    )
    for row in rows:
        latest.setdefault(row.target, row)
    return latest


def bank_suggestions(limit=40):
    """Tên ngân hàng đã có trong hồ sơ, phổ biến trước — gợi ý để SV gõ đúng một kiểu."""
    return list(
        StudentBankAccount.objects.exclude(bank_name="")
        .values("bank_name").annotate(n=Count("id"))
        .filter(n__gte=3).order_by("-n", "bank_name")
        .values_list("bank_name", flat=True)[:limit]
    )


def build(student):
    latest = _latest_rows(student)
    groups = []
    for key, target in GROUPS:
        conf = pc.spec(target)
        current = conf["read"](student)
        row = latest.get(target)
        pending = rejection = None
        if row is not None and row.status == ProfileChangeRequest.STATUS_PENDING:
            pending = {"value": pc.load_value(conf, row.new_value),
                       "submitted_at": _iso(row.created_at)}
        elif row is not None and row.status == ProfileChangeRequest.STATUS_REJECTED:
            rejection = {"value": pc.load_value(conf, row.new_value),
                         "note": row.review_note or "",
                         "reviewed_at": _iso(row.reviewed_at)}
        groups.append({
            "key": key,
            "label": conf["label"],
            "value": current,
            "is_blank": bool(conf["is_blank"](current)),
            "pending": pending,
            "rejection": rejection,
        })

    dept = student.current_department
    return {
        "readonly": {
            "full_name": student.full_name or "",
            "student_code": student.current_student_code or "",
            "sex": _sex_label(student.sex),
            "date_of_birth": student.date_of_birth.strftime("%d/%m/%Y") if student.date_of_birth else "",
            "department": (dept.name_vi if dept else "") or "",
            "university_email": pc.current_university_email(student),
        },
        "groups": groups,
        "bank_suggestions": bank_suggestions(),
    }


def _check_extra(key, cleaned):
    """Luật riêng của trang này, chặt hơn registry dùng chung."""
    if key == "citizen_id":
        if not cleaned.get("issue_date"):
            raise pc.ChangeError("Chưa nhập ngày cấp CCCD.")
        if not cleaned.get("issue_place"):
            raise pc.ChangeError("Chưa nhập nơi cấp CCCD.")


def submit(student, groups):
    """`groups` = {group_key: giá trị}. Kiểm hết trước, lỗi cụm nào báo cụm đó;
    không lỗi mới ghi — tất cả trong một transaction, chung một group_key.
    Trả về số cụm đã gửi duyệt."""
    if not isinstance(groups, dict) or not groups:
        raise SubmitErrors({"_": "Chưa có thông tin nào để gửi."})

    latest = _latest_rows(student)
    errors = {}
    for key, value in groups.items():
        target = GROUP_TARGETS.get(key)
        if target is None:
            errors[key] = "Mục không hợp lệ."
            continue
        row = latest.get(target)
        if row is not None and row.status == ProfileChangeRequest.STATUS_PENDING:
            errors[key] = "Mục này đang chờ duyệt."
            continue
        try:
            _check_extra(key, pc.spec(target)["clean"](value, student))
        except pc.ChangeError as exc:
            errors[key] = str(exc)
    if errors:
        raise SubmitErrors(errors)

    sent = 0
    with transaction.atomic():
        group_key = pc.new_group_key()
        for key, value in groups.items():
            row, _ = pc.submit_change(student, GROUP_TARGETS[key], value, source=SOURCE,
                                      group_key=group_key, require_approval=True)
            if row is not None:
                sent += 1
    if not sent:
        raise SubmitErrors({"_": "Thông tin không thay đổi so với hồ sơ."})
    return sent
