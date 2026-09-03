"""
Registry các loại giấy xác nhận (document requests) — phía Hub.

Mỗi loại (doc_type) định nghĩa: purpose cố định + hàm dựng payload snapshot.
Contract payload dùng chung với Dashboard (nơi sinh giấy). Hiện có "other".
"""
import re
import unicodedata
from datetime import date, datetime

from students.models import StudentIdentityDocument, StudentAddress, VnProvince, VnWard
from students.timeline import (
    course_year_label,
    max_year_label,
    format_student_birth_date,
    build_timeline_labels,
    build_academic_progress,
    build_course_numbers,
    infer_major_for_student,
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


# ── GXN hoãn nghĩa vụ quân sự (deferment) ─────────────────────────────────────

STREET_MAX = 255


def get_current_address_raw(student):
    """Địa chỉ thường trú đang lưu (address_type=CURRENT), ghép thô để tham chiếu."""
    addr = (
        StudentAddress.objects
        .filter(student=student, address_type=StudentAddress.TYPE_CURRENT)
        .order_by("-is_current", "-id")
        .first()
    )
    if not addr:
        return ""
    parts = [addr.full_address, addr.ward, addr.district, addr.province]
    return ", ".join(p.strip() for p in parts if p and p.strip())


def build_address_proposed(province_code, ward_code, street):
    """Chuẩn hóa địa chỉ mới từ Tỉnh + Phường/xã (bảng chuẩn 2025) + số nhà/đường.

    Raise ValueError nếu thiếu/không hợp lệ. Trả dict
    {street, ward_code, ward_name, province_code, province_name, full}.
    """
    street = (street or "").strip()
    if not street:
        raise ValueError("Vui lòng nhập số nhà, tên đường.")
    if len(street) > STREET_MAX:
        raise ValueError(f"Số nhà/đường quá dài (tối đa {STREET_MAX} ký tự).")

    province = VnProvince.objects.filter(code=(province_code or "").strip(), is_active=True).first()
    if not province:
        raise ValueError("Vui lòng chọn tỉnh/thành hợp lệ.")
    ward = VnWard.objects.filter(
        code=(ward_code or "").strip(), province_code=province.code, is_active=True
    ).first()
    if not ward:
        raise ValueError("Vui lòng chọn phường/xã hợp lệ (thuộc tỉnh đã chọn).")

    return {
        "street": street,
        "ward_code": ward.code,
        "ward_name": ward.name,
        "province_code": province.code,
        "province_name": province.name,
        "full": f"{street}, {ward.name}, {province.name}",
    }


def _strip_accents(s):
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


_ADMIN_PREFIXES = (
    "thanh pho ", "tp. ", "tp ", "tinh ", "phuong ", "xa ", "quan ",
    "huyen ", "thi xa ", "thi tran ", "dac khu ",
)
# Từ khóa cho biết full_address chứa cả đơn vị hành chính (không chỉ địa chỉ chi tiết)
_ADMIN_KEYWORDS = (
    "phường", "xã", "quận", "huyện", "tỉnh", "thành phố", "tp.", "tp ",
    "thị xã", "thị trấn", "đặc khu",
)


def _norm_admin(s):
    """Chuẩn hóa tên đơn vị: bỏ dấu, thường hóa, bỏ tiền tố loại đơn vị."""
    s = _strip_accents((s or "").strip().lower())
    for pre in _ADMIN_PREFIXES:
        if s.startswith(pre):
            return s[len(pre):].strip()
    return s.strip()


def _match_province(name):
    n = _norm_admin(name)
    if not n:
        return None
    for pv in VnProvince.objects.filter(is_active=True):
        if _norm_admin(pv.name) == n:
            return pv
    return None


def _match_ward(name, province_code):
    n = _norm_admin(name)
    if not n:
        return None
    for w in VnWard.objects.filter(province_code=province_code, is_active=True):
        if _norm_admin(w.name) == n:
            return w
    return None


def get_current_std(student):
    """Địa chỉ thường trú đã chuẩn hóa (CURRENT_STD) — trả dict hoặc None."""
    row = (
        StudentAddress.objects
        .filter(student=student, address_type=StudentAddress.TYPE_CURRENT_STD)
        .order_by("-is_current", "-id")
        .first()
    )
    if not row:
        return None
    street = (row.full_address or "").strip()
    ward_name = (row.ward or "").strip()
    province_name = (row.province or "").strip()
    return {
        "street": street,
        "ward_code": (row.ward_code or "").strip(),
        "ward_name": ward_name,
        "province_code": (row.province_code or "").strip(),
        "province_name": province_name,
        "full": ", ".join(x for x in [street, ward_name, province_name] if x),
    }


def resolve_address_prefill(student):
    """Prefill địa chỉ: ưu tiên bản đã chuẩn hóa (CURRENT_STD) → dùng mã trực tiếp.

    Nếu chưa có, đoán từ dữ liệu CURRENT cũ; street chỉ đổ khi full_address chỉ
    chứa địa chỉ chi tiết (không lẫn phường/tỉnh)."""
    std = get_current_std(student)
    if std and std["province_code"] and std["ward_code"]:
        return {
            "province_code": std["province_code"],
            "ward_code": std["ward_code"],
            "street": std["street"],
        }

    addr = (
        StudentAddress.objects
        .filter(student=student, address_type=StudentAddress.TYPE_CURRENT)
        .order_by("-is_current", "-id")
        .first()
    )
    if not addr:
        return {"province_code": "", "ward_code": "", "street": ""}

    province = _match_province(addr.province)
    ward = _match_ward(addr.ward, province.code) if province else None

    full = (addr.full_address or "").strip()
    low = full.lower()
    street = "" if any(k in low for k in _ADMIN_KEYWORDS) else full

    return {
        "province_code": province.code if province else "",
        "ward_code": ward.code if ward else "",
        "street": street,
    }


def build_deferment_prefill(student):
    """Prefill form 'Hoãn nghĩa vụ quân sự'.

    Nếu đã có địa chỉ chuẩn hóa 2 cấp (CURRENT_STD) → khóa, không cho sửa nữa.
    """
    labels = build_timeline_labels(student)
    std = get_current_std(student)
    addr = resolve_address_prefill(student)
    return {
        "student_name": student.full_name or "",
        "student_id": student.current_student_code or "",
        "department": student.current_department.name_vi if student.current_department else "",
        "cur_status_vi": student.current_status.name_vi if student.current_status else "",
        "start_label": labels["start_label"],
        "graduation_label": labels["graduation_label"],
        "max_label": labels["max_label"],
        "dob": format_student_birth_date(student),
        "address_locked": std is not None,
        "address_display": std["full"] if std else "",
        "province_code": addr["province_code"],
        "ward_code": addr["ward_code"],
        "street": addr["street"],
    }


def build_deferment_payload(student, *, dob, province_code, ward_code, street):
    """Dựng payload snapshot cho GXN hoãn NVQS. Trả (payload, purpose_label).

    Địa chỉ thường trú buộc chọn theo cơ cấu 2025 (tỉnh + phường/xã) + số nhà/đường.
    """
    dob_field = _editable_field(format_student_birth_date(student), dob)
    if dob_field["changed"]:
        validate_dob(dob_field["proposed"])

    baseline = get_current_std(student)
    if baseline:
        # Địa chỉ đã ở dạng 2 cấp (CURRENT_STD) → KHÓA, dùng thẳng, bỏ qua input client
        addr_field = {
            "original": baseline,
            "proposed": baseline,
            "changed": False,
            "review": None,
        }
    else:
        # Lần đầu chuẩn hóa → dựng từ input SV, cần duyệt
        proposed_addr = build_address_proposed(province_code, ward_code, street)
        addr_field = {
            "original": get_current_address_raw(student),
            "proposed": proposed_addr,
            "changed": True,
            "review": "pending",
        }

    labels = build_timeline_labels(student)
    purpose_label = "Hoãn nghĩa vụ quân sự"
    payload = {
        "doc_type": "deferment",
        "purpose": {"code": "deferment", "label": purpose_label, "program_name": None},
        "snapshot": {
            "student_name": student.full_name or "",
            "student_id": student.current_student_code or "",
            "department": student.current_department.name_vi if student.current_department else "",
            "cur_status_vi": student.current_status.name_vi if student.current_status else "",
            "start_label": labels["start_label"],
            "graduation_label": labels["graduation_label"],
            "max_label": labels["max_label"],
        },
        "editable": {
            "dob": dob_field,
            "permanent_address": addr_field,
        },
    }
    return payload, purpose_label


# ── GXN thương binh (ưu đãi giáo dục) ─────────────────────────────────────────

def get_current_cccd_doc(student):
    """Trả (số CCCD, ngày cấp dd/mm/yyyy) từ record CCCD hiện hành."""
    doc = (
        StudentIdentityDocument.objects
        .filter(student=student, document_type=StudentIdentityDocument.TYPE_CCCD)
        .order_by("-is_current", "-id")
        .first()
    )
    if not doc:
        return "", ""
    issue = doc.issue_date.strftime("%d/%m/%Y") if doc.issue_date else ""
    return (doc.document_number or ""), issue


def validate_issue_date(value):
    value = (value or "").strip()
    if not value:
        raise ValueError("Vui lòng nhập ngày cấp CCCD.")
    try:
        d = datetime.strptime(value, "%d/%m/%Y").date()
    except ValueError:
        raise ValueError("Ngày cấp CCCD phải theo định dạng dd/mm/yyyy.")
    if d > date.today():
        raise ValueError("Ngày cấp CCCD không được ở tương lai.")


def _thuongbinh_snapshot(student):
    prog = build_academic_progress(student)
    nums = build_course_numbers(student)
    return {
        "student_name": student.full_name or "",
        "student_id": student.current_student_code or "",
        "department": student.current_department.name_vi if student.current_department else "",
        "study_year": prog["study_year"],
        "current_semester": prog["current_semester"],
        "current_academic_year": prog["current_academic_year"],
        "course_year": course_year_label(student),
        "course_year_number": nums["course_year_number"],
        "max_year_number": nums["max_year_number"],
    }


def build_thuongbinh_prefill(student):
    """Prefill form thương binh. CCCD/ngày cấp chỉ cho sửa khi chưa có CCCD 12 số."""
    num, issue = get_current_cccd_doc(student)
    snap = _thuongbinh_snapshot(student)
    snap.update({
        "cccd_locked": bool(CCCD_RE.match(num)),   # đã có CCCD 12 số → khóa
        "citizen_id": num,
        "citizen_id_issue_date": issue,
    })
    return snap


def build_thuongbinh_payload(student, *, citizen_id, citizen_id_issue_date):
    """Dựng payload thương binh. Trả (payload, purpose_label)."""
    num, issue = get_current_cccd_doc(student)
    if CCCD_RE.match(num):
        # Đã có CCCD 12 số → khóa, dùng thẳng
        cid_field = {"original": num, "proposed": num, "changed": False, "review": None}
        issue_field = {"original": issue, "proposed": issue, "changed": False, "review": None}
    else:
        cid_val = (citizen_id or "").strip()
        validate_citizen_id(cid_val, num)          # buộc 12 số
        issue_val = (citizen_id_issue_date or "").strip()
        validate_issue_date(issue_val)
        cid_field = {"original": num, "proposed": cid_val, "changed": True, "review": "pending"}
        issue_field = {"original": issue, "proposed": issue_val, "changed": True, "review": "pending"}

    purpose_label = "Xác nhận ưu đãi giáo dục (thương binh)"
    payload = {
        "doc_type": "thuong_binh",
        "purpose": {"code": "thuong_binh", "label": purpose_label, "program_name": None},
        "snapshot": _thuongbinh_snapshot(student),
        "editable": {
            "citizen_id": cid_field,
            "citizen_id_issue_date": issue_field,
        },
    }
    return payload, purpose_label


# ── GXN vay vốn ngân hàng (bank_loan) ─────────────────────────────────────────

def _bankloan_snapshot(student, class_code):
    labels = build_timeline_labels(student)
    prog = build_academic_progress(student)
    nums = build_course_numbers(student)
    major = infer_major_for_student(student)
    return {
        "student_name": student.full_name or "",
        "student_id": student.current_student_code or "",
        "sex": student.sex or "",
        "department": student.current_department.name_vi if student.current_department else "",
        "major_code": major.code if major else "",
        "cur_status_vi": student.current_status.name_vi if student.current_status else "",
        "course_year": course_year_label(student),
        "current_semester": prog["current_semester"],
        "start_label": labels["start_label"],
        "graduation_label": labels["graduation_label"],
        "course_year_number": nums["course_year_number"],
        "course_month_number": nums["course_month_number"],
        "max_year_number": nums["max_year_number"],
        "max_month_number": nums["max_month_number"],
        "class_code": class_code,     # từ hồ sơ; SV tự điền khi hồ sơ chưa có
    }


def build_bankloan_prefill(student):
    """Prefill form vay vốn. CCCD/ngày cấp khóa khi đã có CCCD 12 số.

    Mã lớp lấy từ hồ sơ (`students.class_code`); chỉ khi hồ sơ trống mới để SV tự
    điền — phần lớn hồ sơ hiện chưa có mã lớp nên ô này vẫn hiện thường xuyên.
    """
    num, issue = get_current_cccd_doc(student)
    snap = _bankloan_snapshot(student, "")
    snap.pop("class_code", None)
    snap.update({
        "dob": format_student_birth_date(student),
        "cccd_locked": bool(CCCD_RE.match(num)),
        "citizen_id": num,
        "citizen_id_issue_date": issue,
        "class_code": (student.class_code or "").strip(),
    })
    return snap


def build_bankloan_payload(student, *, dob, citizen_id, citizen_id_issue_date, class_code):
    """Dựng payload vay vốn. Trả (payload, purpose_label)."""
    # Ưu tiên mã lớp SV gửi lên; hồ sơ là nguồn dự phòng khi form để trống.
    class_code = (class_code or "").strip() or (student.class_code or "").strip()
    if not class_code:
        raise ValueError("Vui lòng nhập mã lớp.")
    if len(class_code) > 64:
        raise ValueError("Mã lớp quá dài (tối đa 64 ký tự).")

    dob_field = _editable_field(format_student_birth_date(student), dob)
    if dob_field["changed"]:
        validate_dob(dob_field["proposed"])

    num, issue = get_current_cccd_doc(student)
    if CCCD_RE.match(num):
        cid_field = {"original": num, "proposed": num, "changed": False, "review": None}
        issue_field = {"original": issue, "proposed": issue, "changed": False, "review": None}
    else:
        cid_val = (citizen_id or "").strip()
        validate_citizen_id(cid_val, num)
        issue_val = (citizen_id_issue_date or "").strip()
        validate_issue_date(issue_val)
        cid_field = {"original": num, "proposed": cid_val, "changed": True, "review": "pending"}
        issue_field = {"original": issue, "proposed": issue_val, "changed": True, "review": "pending"}

    purpose_label = "Xác nhận vay vốn ngân hàng"
    payload = {
        "doc_type": "bank_loan",
        "purpose": {"code": "bank_loan", "label": purpose_label, "program_name": None},
        "snapshot": _bankloan_snapshot(student, class_code),
        "editable": {
            "dob": dob_field,
            "citizen_id": cid_field,
            "citizen_id_issue_date": issue_field,
        },
    }
    return payload, purpose_label


# ── GXN tiếng Anh (english_form) ──────────────────────────────────────────────

ENGLISH_PURPOSE_CHOICES = [
    {"code": "internship",       "label": "Apply for internship"},
    {"code": "visa",             "label": "Apply for visa"},
    {"code": "job",              "label": "Apply for job"},
    {"code": "scholarship",      "label": "Apply for scholarship"},
    {"code": "higher_education", "label": "Apply for higher education"},
    {"code": "study_abroad",     "label": "Apply for studying abroad"},
    {"code": "program",          "label": "Apply for [Tên chương trình]"},
]
ENGLISH_PURPOSE_MAP = {c["code"]: c["label"] for c in ENGLISH_PURPOSE_CHOICES}
ENGLISH_PROGRAM_CODE = "program"
ENGLISH_STATUS = {
    "ACTIVE": "Currently studying",
    "SUSPENDED": "Temporary leave",
    "WITHDRAWN": "Dropped out",
    "GRADUATED": "Graduated",
}


def resolve_english_purpose(purpose_code, program_name):
    if purpose_code not in ENGLISH_PURPOSE_MAP:
        raise ValueError("Mục đích không hợp lệ.")
    if purpose_code == ENGLISH_PROGRAM_CODE:
        program_name = (program_name or "").strip()
        if not program_name:
            raise ValueError("Vui lòng nhập tên chương trình.")
        if len(program_name) > PROGRAM_NAME_MAX:
            raise ValueError(f"Tên chương trình quá dài (tối đa {PROGRAM_NAME_MAX} ký tự).")
        return f"Apply for {program_name}", program_name
    return ENGLISH_PURPOSE_MAP[purpose_code], None


def _english_academic_unit(department):
    """School (Khoa) / Department (Bộ môn) theo tên khoa tiếng Việt."""
    name = ((department.name_vi if department else "") or "").strip()
    return "Department" if name.startswith("Bộ môn") else "School"


def _english_snapshot(student):
    labels = build_timeline_labels(student)
    return {
        "student_name": _strip_accents(student.full_name or ""),   # bỏ dấu, giữ hoa/thường
        "student_id": student.current_student_code or "",
        "cur_status_group": student.current_status.status_group if student.current_status else "",
        "academic_unit_label": _english_academic_unit(student.current_department),
        "start_label": labels["start_label"],
        "graduation_label": labels["graduation_label"],
    }


def build_english_prefill(student):
    snap = _english_snapshot(student)
    return {
        "student_name": snap["student_name"],
        "student_id": snap["student_id"],
        "cur_status_en": ENGLISH_STATUS.get(snap["cur_status_group"], ""),
        "academic_unit_label": snap["academic_unit_label"],
        "start_label": snap["start_label"],
        "graduation_label": snap["graduation_label"],
        "dob": format_student_birth_date(student),
    }


def build_english_payload(student, *, dob, purpose_code, program_name):
    purpose_label, program_name = resolve_english_purpose(purpose_code, program_name)
    dob_field = _editable_field(format_student_birth_date(student), dob)
    if dob_field["changed"]:
        validate_dob(dob_field["proposed"])
    payload = {
        "doc_type": "english_form",
        "purpose": {"code": purpose_code, "label": purpose_label, "program_name": program_name},
        "snapshot": _english_snapshot(student),
        "editable": {"dob": dob_field},
    }
    return payload, purpose_label
