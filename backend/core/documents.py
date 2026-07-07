"""
Registry các loại giấy xác nhận (document requests) — phía Hub.

Mỗi loại (doc_type) định nghĩa: purpose cố định + hàm dựng payload snapshot.
Contract payload dùng chung với Dashboard (nơi sinh giấy). Hiện có "other".
"""
import re
from datetime import date, datetime

from students.models import StudentIdentityDocument
from students.timeline import (
    course_year_label,
    max_year_label,
    format_student_birth_date,
)

# Mục đích cố định cho "Lý do khác". Mục "program" yêu cầu nhập thêm tên chương trình.
OTHER_PURPOSE_CHOICES = [
    {"code": "metro_ticket",      "label": "Xác minh tài khoản mua vé ưu đãi sinh viên sử dụng Metro số 1"},
    {"code": "visa",              "label": "Bổ sung hồ sơ xin visa cho sinh viên"},
    {"code": "job",               "label": "Bổ sung hồ sơ xin việc cho sinh viên"},
    {"code": "internship",        "label": "Bổ sung hồ sơ xin thực tập cho sinh viên"},
    {"code": "english_exit_exam", "label": "Bổ sung hồ sơ tham gia kỳ thi Tiếng Anh đầu ra"},
    {"code": "family_deduction",  "label": "Bổ sung hồ sơ giảm trừ gia cảnh"},
    {"code": "bank_loan",         "label": "Bổ sung hồ sơ vay vốn ngân hàng theo nhu cầu sinh viên"},
    {"code": "study_abroad",      "label": "Bổ sung hồ sơ du học cho sinh viên"},
    {"code": "party_admission",   "label": "Bổ sung hồ sơ kết nạp Đảng cho sinh viên"},
    {"code": "program",           "label": "Bổ sung hồ sơ tham gia [Tên chương trình]"},
]
OTHER_PURPOSE_MAP = {c["code"]: c["label"] for c in OTHER_PURPOSE_CHOICES}
PROGRAM_PURPOSE_CODE = "program"


def get_current_cccd(student):
    doc = (
        StudentIdentityDocument.objects
        .filter(student=student, document_type=StudentIdentityDocument.TYPE_CCCD)
        .order_by("-is_current", "-id")
        .first()
    )
    return doc.document_number if doc else ""


PROGRAM_NAME_MAX = 200
CCCD_RE = re.compile(r"^\d{12}$")  # CCCD chuẩn = 12 chữ số


def resolve_other_purpose(purpose_code, program_name):
    """Trả (label hiển thị, program_name chuẩn hóa). Raise ValueError nếu sai."""
    if purpose_code not in OTHER_PURPOSE_MAP:
        raise ValueError("Mục đích không hợp lệ.")
    if purpose_code == PROGRAM_PURPOSE_CODE:
        program_name = (program_name or "").strip()
        if not program_name:
            raise ValueError("Vui lòng nhập tên chương trình.")
        if len(program_name) > PROGRAM_NAME_MAX:
            raise ValueError(f"Tên chương trình quá dài (tối đa {PROGRAM_NAME_MAX} ký tự).")
        return f"Bổ sung hồ sơ tham gia {program_name}", program_name
    return OTHER_PURPOSE_MAP[purpose_code], None


def _editable_field(original, submitted):
    original = (original or "").strip()
    submitted = (submitted or "").strip() or original
    changed = submitted != original
    return {
        "original": original,
        "proposed": submitted,
        "changed": changed,
        "review": "pending" if changed else None,
    }


def build_other_prefill(student):
    """Dữ liệu prefill để render form 'Lý do khác' ở frontend."""
    return {
        "student_name": student.full_name or "",
        "student_id": student.current_student_code or "",
        "department": student.current_department.name_vi if student.current_department else "",
        "cur_status_vi": student.current_status.name_vi if student.current_status else "",
        "course_year": course_year_label(student),
        "max_year": max_year_label(student),
        "dob": format_student_birth_date(student),
        "citizen_id": get_current_cccd(student),
    }


def validate_dob(dob):
    """DOB phải dd/mm/yyyy, là ngày hợp lệ, không ở tương lai, năm >= 1940."""
    dob = (dob or "").strip()
    if not dob:
        raise ValueError("Vui lòng nhập ngày sinh.")
    try:
        d = datetime.strptime(dob, "%d/%m/%Y").date()
    except ValueError:
        raise ValueError("Ngày sinh phải theo định dạng dd/mm/yyyy.")
    if d > date.today():
        raise ValueError("Ngày sinh không được ở tương lai.")
    if d.year < 1940:
        raise ValueError("Năm sinh không hợp lệ.")


def validate_citizen_id(value, original=""):
    """CCCD trên giấy PHẢI là 12 chữ số.

    Nếu hồ sơ gốc trống hoặc là CMND cũ (không phải 12 số) thì bắt buộc SV nhập
    CCCD mới 12 số — không chấp nhận giữ nguyên giá trị cũ.
    """
    value = (value or "").strip()
    if CCCD_RE.match(value):
        return
    if not value:
        raise ValueError("Vui lòng nhập số CCCD (12 chữ số).")
    if not CCCD_RE.match((original or "").strip()):
        raise ValueError(
            "Hồ sơ chưa có CCCD hợp lệ (đang trống hoặc CMND cũ) — "
            "vui lòng nhập số CCCD mới gồm 12 chữ số."
        )
    raise ValueError("Số CCCD phải gồm 12 chữ số.")


def build_other_payload(student, *, purpose_code, program_name, dob, citizen_id):
    """Dựng payload snapshot cho GXN 'Lý do khác'. Trả (payload, purpose_label).

    Chỉ validate DOB/CCCD nếu SV THỰC SỰ sửa (khác giá trị gốc) — tránh chặn nộp
    khi dữ liệu gốc trong DB không đúng chuẩn.
    """
    purpose_label, program_name = resolve_other_purpose(purpose_code, program_name)

    dob_field = _editable_field(format_student_birth_date(student), dob)
    cccd_field = _editable_field(get_current_cccd(student), citizen_id)
    if dob_field["changed"]:
        validate_dob(dob_field["proposed"])
    # CCCD luôn validate (kể cả không đổi) — buộc hồ sơ CMND cũ/trống phải nhập CCCD 12 số.
    validate_citizen_id(cccd_field["proposed"], cccd_field["original"])

    payload = {
        "doc_type": "other",
        "purpose": {
            "code": purpose_code,
            "label": purpose_label,
            "program_name": program_name,
        },
        "snapshot": {
            "student_name": student.full_name or "",
            "student_id": student.current_student_code or "",
            "department": student.current_department.name_vi if student.current_department else "",
            "cur_status_group": student.current_status.status_group if student.current_status else "",
            "course_year": course_year_label(student),
            "max_year": max_year_label(student),
        },
        "editable": {
            "dob": dob_field,
            "citizen_id": cccd_field,
        },
    }
    return payload, purpose_label
