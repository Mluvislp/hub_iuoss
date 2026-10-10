"""
Registry các loại giấy xác nhận (document requests) — phía Hub.

Mỗi loại (doc_type) định nghĩa: purpose cố định + hàm dựng payload snapshot.
Contract payload dùng chung với Dashboard (nơi sinh giấy). Hiện có "other".
"""
import re
import unicodedata
from datetime import date, datetime

from core import address_service, cccd_rules
from students.models import Department, StudentIdentityDocument, StudentAddress, VnProvince, VnWard
from students.timeline import (
    admission_start,
    current_academic_year,
    current_semester,
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


def get_current_cccd_row(student):
    """Dòng CCCD ĐANG DÙNG (`is_current=True`), nhiều dòng thì id lớn thắng.

    Không lùi về dòng đã hạ: duyệt đổi CCCD ghi dòng mới và hạ dòng cũ xuống
    `is_current=False` để ẩn đi — đọc lại dòng cũ là in số CCCD đã bị thay.
    Cùng cách chọn với `profile_changes._cccd_row`.
    """
    return (
        StudentIdentityDocument.objects
        .filter(student=student, document_type=StudentIdentityDocument.TYPE_CCCD,
                is_current=True)
        .order_by("-id")
        .first()
    )


def get_current_cccd(student):
    doc = get_current_cccd_row(student)
    return (doc.document_number or "") if doc else ""


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
    """CCCD trên giấy PHẢI là 12 chữ số (`core/cccd_rules.py`).

    - Giữ nguyên số trong hồ sơ (đã đủ 12 số) ⇒ qua.
    - Hồ sơ trống hoặc là CMND cũ ⇒ bắt buộc nhập CCCD mới.
    """
    value = (value or "").strip()
    original = (original or "").strip()
    if value and value == original and CCCD_RE.match(value):
        return
    if not value and not CCCD_RE.match(original):
        raise ValueError(
            "Hồ sơ chưa có CCCD hợp lệ (đang trống hoặc CMND cũ) — "
            "vui lòng nhập số CCCD mới gồm 12 chữ số."
        )
    cccd_rules.check_number(value)


def build_other_payload(student, *, purpose_code, program_name, dob, citizen_id):
    """Dựng payload snapshot cho GXN 'Lý do khác'. Trả (payload, purpose_label).

    Chỉ validate nếu SV THỰC SỰ sửa (khác giá trị gốc) — tránh chặn nộp khi dữ
    liệu gốc trong DB không đúng chuẩn. Riêng CCCD luôn validate.

    Niên khóa / thời gian đào tạo tối đa là NHÓM CỨNG: chỉ nằm trong `snapshot`,
    SV không sửa được. Chúng suy ra từ đợt nhập học + thời gian đào tạo của ngành;
    sai thì phải sửa nguồn (hồ sơ SV hoặc bảng `major_training_durations`).
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
    """Địa chỉ thường trú đang lưu, ghép thô để tham chiếu.

    Theo thứ tự ưu tiên `address_service.PERMANENT_TYPES`: có bản chuẩn hoá
    CURRENT_STD thì lấy bản đó, không có mới lùi về CURRENT.
    """
    addr = None
    for address_type in address_service.PERMANENT_TYPES:
        addr = (
            StudentAddress.objects
            .filter(student=student, address_type=address_type)
            .order_by("-is_current", "-id")
            .first()
        )
        if addr:
            break
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
        raise ValueError("Vui lòng nhập địa chỉ chi tiết.")
    if len(street) > STREET_MAX:
        raise ValueError(f"Địa chỉ chi tiết quá dài (tối đa {STREET_MAX} ký tự).")

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


def _permanent_address_field(student, province_code, ward_code, street):
    """Ô `editable.permanent_address` — dùng chung cho mọi form có địa chỉ thường trú.

    Luôn dựng từ input SV (buộc chọn tỉnh/phường theo cơ cấu 2025); so với bản
    chuẩn hóa CURRENT_STD đang có để biết có đổi không — trùng thì `changed=false`
    để khỏi sinh việc duyệt vô nghĩa. Chưa có bản chuẩn hóa ⇒ luôn chờ duyệt.
    """
    baseline = get_current_std(student)
    proposed_addr = build_address_proposed(province_code, ward_code, street)
    if baseline:
        same = all(
            (baseline.get(k) or "") == (proposed_addr.get(k) or "")
            for k in ("street", "ward_code", "province_code")
        )
        return {
            "original": baseline,
            "proposed": proposed_addr,
            "changed": not same,
            "review": None if same else "pending",
        }
    return {
        "original": get_current_address_raw(student),
        "proposed": proposed_addr,
        "changed": True,
        "review": "pending",
    }


def _address_prefill(student):
    """Địa chỉ thường trú cho form: TÁCH RIÊNG tỉnh / phường / số nhà (mã + tên) để
    hiển thị ba ô độc lập kể cả lúc đang khóa."""
    std = get_current_std(student)
    addr = resolve_address_prefill(student)

    # Tên tỉnh/phường để hiện lúc ô đang khóa. Có bản chuẩn hóa thì lấy thẳng,
    # chưa có thì tra từ mã đoán được (có thể rỗng nếu đoán không ra).
    if std:
        province_name, ward_name = std["province_name"], std["ward_name"]
    else:
        pv = VnProvince.objects.filter(code=addr["province_code"]).first() if addr["province_code"] else None
        wd = VnWard.objects.filter(code=addr["ward_code"], province_code=addr["province_code"]).first() if addr["ward_code"] else None
        province_name, ward_name = (pv.name if pv else ""), (wd.name if wd else "")

    return {
        "address_standardized": std is not None,
        "province_code": addr["province_code"],
        "province_name": province_name,
        "ward_code": addr["ward_code"],
        "ward_name": ward_name,
        "street": addr["street"],
    }


def build_deferment_prefill(student):
    """Prefill form 'Hoãn nghĩa vụ quân sự'.

    Địa chỉ LUÔN sửa được (trước đây có bản chuẩn hóa là khóa vĩnh viễn — SV
    chuyển nhà hoặc nhập sai thì kẹt). Form khóa sẵn ô nào đã có dữ liệu và mở
    ra khi SV bấm "Yêu cầu chỉnh sửa", nhưng không có ô nào bị khóa cứng.

    Địa chỉ trả về TÁCH RIÊNG tỉnh / phường / số nhà (kèm cả mã lẫn tên) để form
    hiển thị ba ô độc lập kể cả lúc đang khóa — không gộp thành một dòng.
    """
    labels = build_timeline_labels(student)
    return {
        "student_name": student.full_name or "",
        "student_id": student.current_student_code or "",
        "department": student.current_department.name_vi if student.current_department else "",
        "cur_status_vi": student.current_status.name_vi if student.current_status else "",
        "dob": format_student_birth_date(student),
        "start_label": labels["start_label"],
        "graduation_label": labels["graduation_label"],
        "max_label": labels["max_label"],
        # Địa chỉ thường trú — ba ô riêng
        **_address_prefill(student),
    }


def build_deferment_payload(student, *, dob, province_code, ward_code, street):
    """Dựng payload snapshot cho GXN hoãn NVQS. Trả (payload, purpose_label).

    Địa chỉ thường trú buộc chọn theo cơ cấu 2025 (tỉnh + phường/xã) + số nhà/đường,
    và LUÔN nhận từ input SV — kể cả khi hồ sơ đã có bản chuẩn hóa. Nếu SV gửi lên
    đúng y bản đang có thì đánh `changed=false` để khỏi tạo việc duyệt vô nghĩa.

    Ba mốc thời gian học (nhập học / ra trường / tối đa) là NHÓM CỨNG: chỉ nằm trong
    `snapshot`, SV không sửa được.
    """
    labels = build_timeline_labels(student)

    dob_field = _editable_field(format_student_birth_date(student), dob)
    if dob_field["changed"]:
        validate_dob(dob_field["proposed"])

    addr_field = _permanent_address_field(student, province_code, ward_code, street)

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
    doc = get_current_cccd_row(student)
    if not doc:
        return "", ""
    issue = doc.issue_date.strftime("%d/%m/%Y") if doc.issue_date else ""
    return (doc.document_number or ""), issue


def _issue_date_ok(value):
    """Ngày cấp trong hồ sơ dùng được không — không ⇒ form mở sẵn ô cho SV nhập lại.
    Cùng định nghĩa với `isValidIssueDate` bên frontend."""
    try:
        validate_issue_date(value)
    except ValueError:
        return False
    return True


def validate_issue_date(value):
    """Ngày cấp CCCD SV nhập mới — luật của `core/cccd_rules.py`."""
    value = (value or "").strip()
    if not value:
        raise ValueError("Vui lòng nhập ngày cấp CCCD.")
    try:
        d = cccd_rules.parse_date(value)
    except ValueError:
        raise ValueError("Ngày cấp CCCD phải theo định dạng dd/mm/yyyy.")
    cccd_rules.check_issue_date(d)


def _cccd_prefill(student):
    """Số CCCD + ngày cấp cho form. `cccd_valid=False` (hồ sơ trống hoặc CMND cũ) ⇒
    form mở sẵn ô và bắt buộc nhập."""
    num, issue = get_current_cccd_doc(student)
    return {
        "cccd_valid": bool(CCCD_RE.match(num)),
        "citizen_id": num,
        "citizen_id_issue_date": issue,
    }


def _cccd_fields(student, citizen_id, citizen_id_issue_date):
    """Hai ô `editable.citizen_id` + `editable.citizen_id_issue_date`.

    SV xin sửa ⇒ `changed` + `review=pending`, chuyên viên duyệt ở Dashboard. Duyệt
    thì Dashboard GHI DÒNG CCCD MỚI và hạ dòng cũ (không sửa đè), số + ngày cấp đi
    chung một lần duyệt. Ngày cấp trong hồ sơ trống/sai ⇒ soi cả khi SV giữ nguyên.
    """
    num, issue = get_current_cccd_doc(student)
    cid_field = _editable_field(num, citizen_id)
    issue_field = _editable_field(issue, citizen_id_issue_date)
    validate_citizen_id(cid_field["proposed"], cid_field["original"])
    if cid_field["changed"] or issue_field["changed"] or not _issue_date_ok(issue):
        validate_issue_date(issue_field["proposed"])
    return cid_field, issue_field


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
    """Prefill form thương binh.

    CCCD + ngày cấp là ô XIN SỬA (khóa sẵn, bấm "Yêu cầu chỉnh sửa" mới mở), cùng
    khuôn ngày sinh / địa chỉ của giấy hoãn NVQS. `cccd_valid=False` (hồ sơ trống
    hoặc CMND cũ) ⇒ form mở sẵn và bắt buộc nhập.
    """
    snap = _thuongbinh_snapshot(student)
    snap.update(_cccd_prefill(student))
    return snap


def build_thuongbinh_payload(student, *, citizen_id, citizen_id_issue_date):
    """Dựng payload thương binh. Trả (payload, purpose_label).

    Các nhãn tiến độ học (năm thứ, học kỳ, năm học, niên khóa, số năm đào tạo) là
    NHÓM CỨNG: chỉ nằm trong `snapshot`, SV không sửa được.
    """
    snap0 = _thuongbinh_snapshot(student)
    cid_field, issue_field = _cccd_fields(student, citizen_id, citizen_id_issue_date)

    purpose_label = "Xác nhận ưu đãi giáo dục (thương binh)"
    payload = {
        "doc_type": "thuong_binh",
        "purpose": {"code": "thuong_binh", "label": purpose_label, "program_name": None},
        "snapshot": snap0,
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
    # Ưu tiên mã ngành CHI TIẾT (kèm chuyên ngành) do Dashboard import vào
    # `students.detailed_major_code`; chưa có thì tạm lùi về mã suy từ MSSV như
    # trước (4 ký tự đầu đối chiếu `majors.code`) để giấy không bị để trống.
    detailed_major = (student.detailed_major_code or "").strip()
    major_code_display = detailed_major or (major.code if major else "")
    return {
        "student_name": student.full_name or "",
        "student_id": student.current_student_code or "",
        "sex": student.sex or "",
        "department": student.current_department.name_vi if student.current_department else "",
        "major_code": major_code_display,
        "cur_status_vi": student.current_status.name_vi if student.current_status else "",
        "course_year": course_year_label(student),
        "current_semester": prog["current_semester"],
        "start_label": labels["start_label"],
        "graduation_label": labels["graduation_label"],
        "course_year_number": nums["course_year_number"],
        "course_month_number": nums["course_month_number"],
        "max_year_number": nums["max_year_number"],
        "max_month_number": nums["max_month_number"],
        "class_code": class_code,     # hồ sơ là nguồn chuẩn; SV chỉ điền khi hồ sơ trống
    }


CLASS_CODE_MAX = 64


def normalize_class_code(value):
    """Mã lớp SV gõ → dạng lưu: bỏ khoảng trắng hai đầu, VIẾT HOA — cùng cách chuẩn
    hóa với đồng bộ lớp bằng file (Dashboard class_sync_service)."""
    return (value or "").strip().upper()


def build_bankloan_prefill(student):
    """Prefill form vay vốn.

    Mã lớp, số CCCD, ngày cấp là ô XIN SỬA (khóa sẵn, bấm "Yêu cầu chỉnh sửa" mới
    mở; trống / không hợp lệ thì mở sẵn) — cùng khuôn form thương binh. Giá trị SV
    đề xuất chỉ vào hồ sơ khi chuyên viên DUYỆT ở Dashboard (từ 26/09/2026; trước
    đó mã lớp + CCCD khóa cứng khi hồ sơ đã có).
    """
    snap = _bankloan_snapshot(student, "")
    snap.pop("class_code", None)
    snap.update({
        "dob": format_student_birth_date(student),
        **_cccd_prefill(student),
        "class_code": (student.class_code or "").strip(),
    })
    return snap


# Hai nhóm ô tích trên giấy vay vốn. Mã GIỐNG HỆT Dashboard `documents/registry.py`
# (FEE_EXEMPTION_CHOICES / ORPHAN_CHOICES) — Dashboard tra mã này ra ô ☑ trên giấy.
# SV chọn ⇒ `payload.student_choices` (giữ nguyên mãi); chuyên viên duyệt / sửa ⇒
# `payload.staff_fields` — giấy in theo giá trị chuyên viên.
BANKLOAN_FEE_EXEMPTION_CHOICES = [
    {"code": "none", "label": "Không miễn giảm"},
    {"code": "reduced", "label": "Giảm học phí"},
    {"code": "exempt", "label": "Miễn học phí"},
]
BANKLOAN_ORPHAN_CHOICES = [
    {"code": "yes", "label": "Mồ côi"},
    {"code": "no", "label": "Không mồ côi"},
]


def _bankloan_student_choices(fee_exemption, orphan):
    fee = (fee_exemption or "").strip()
    orph = (orphan or "").strip()
    if fee not in {c["code"] for c in BANKLOAN_FEE_EXEMPTION_CHOICES}:
        raise ValueError("Vui lòng chọn Thuộc diện (miễn, giảm học phí).")
    if orph not in {c["code"] for c in BANKLOAN_ORPHAN_CHOICES}:
        raise ValueError("Vui lòng chọn Thuộc đối tượng (mồ côi).")
    return {"fee_exemption": fee, "orphan": orph}


def build_bankloan_payload(student, *, dob, citizen_id, citizen_id_issue_date, class_code,
                           fee_exemption, orphan):
    """Dựng payload vay vốn. Trả (payload, purpose_label).

    Các nhãn tiến độ học (niên khóa, học kỳ, mốc nhập học/ra trường, số năm–tháng
    đào tạo) là NHÓM CỨNG: chỉ nằm trong `snapshot`, SV không sửa được.

    Mã lớp / số CCCD / ngày cấp: SV sửa ⇒ `changed` + `review=pending`, chuyên viên
    duyệt ở Dashboard (mã lớp mở chặng mới trong lịch sử lớp; CCCD ghi dòng mới).
    `snapshot.class_code` giữ mã lớp HỒ SƠ lúc tạo; giấy in theo `editable.class_code`.
    """
    profile_class = (student.class_code or "").strip()
    submitted_class = normalize_class_code(class_code)
    if submitted_class == normalize_class_code(profile_class):
        submitted_class = profile_class        # chỉ khác hoa/thường ⇒ coi như không sửa
    class_field = _editable_field(profile_class, submitted_class)
    if not class_field["proposed"]:
        raise ValueError("Vui lòng nhập mã lớp.")
    if len(class_field["proposed"]) > CLASS_CODE_MAX:
        raise ValueError(f"Mã lớp quá dài (tối đa {CLASS_CODE_MAX} ký tự).")

    dob_field = _editable_field(format_student_birth_date(student), dob)
    if dob_field["changed"]:
        validate_dob(dob_field["proposed"])

    cid_field, issue_field = _cccd_fields(student, citizen_id, citizen_id_issue_date)
    student_choices = _bankloan_student_choices(fee_exemption, orphan)

    class_code = profile_class
    snap0 = _bankloan_snapshot(student, class_code)

    purpose_label = "Xác nhận vay vốn ngân hàng"
    payload = {
        "doc_type": "bank_loan",
        "purpose": {"code": "bank_loan", "label": purpose_label, "program_name": None},
        "snapshot": snap0,
        "editable": {
            "dob": dob_field,
            "citizen_id": cid_field,
            "citizen_id_issue_date": issue_field,
            "class_code": class_field,
        },
        "student_choices": student_choices,
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
    """Tên tiếng Anh đầy đủ in lên giấy: "School of Business", "Department of Physics"…

    Mã phụ (MBA, PBA, MIT…) để trống `name_en` ⇒ mượn tên của khoa cùng `name_vi`.
    Không tra ra thì lùi về chữ chung School (Khoa) / Department (Bộ môn)."""
    if department is None:
        return "School"
    name_en = (department.name_en or "").strip()
    if not name_en:
        name_en = (
            Department.objects.filter(name_vi=department.name_vi)
            .exclude(name_en__isnull=True).exclude(name_en="")
            .order_by("id").values_list("name_en", flat=True).first()
            or ""
        ).strip()
    if name_en:
        return name_en
    return "Department" if (department.name_vi or "").strip().startswith("Bộ môn") else "School"


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
    """Mốc nhập học / ra trường là NHÓM CỨNG: chỉ nằm trong `snapshot`."""
    purpose_label, program_name = resolve_english_purpose(purpose_code, program_name)
    dob_field = _editable_field(format_student_birth_date(student), dob)
    if dob_field["changed"]:
        validate_dob(dob_field["proposed"])

    snap0 = _english_snapshot(student)

    payload = {
        "doc_type": "english_form",
        "purpose": {"code": purpose_code, "label": purpose_label, "program_name": program_name},
        "snapshot": snap0,
        "editable": {"dob": dob_field},
    }
    return payload, purpose_label


# ── Bảng điểm rèn luyện (conduct_score) ───────────────────────────────────────
#
# Giấy này Phòng CTSV xuất từ HỆ THỐNG NGOÀI — Dashboard không sinh DOCX/PDF, chỉ
# chuyển trạng thái và trả mã hồ sơ portal. Ngày sinh / CCCD + ngày cấp / địa chỉ
# thường trú là ô XIN SỬA giống các loại khác (duyệt ở Dashboard ⇒ ghi hồ sơ gốc);
# họ tên, MSSV, khoa, khóa học chỉ xem.

# Số năm học lùi lại khi hồ sơ chưa có năm/học kỳ nhập học.
CONDUCT_FALLBACK_YEARS = 4


# Mã lựa chọn: "YYYYS" = một học kỳ (S = 1/2), "YYYYN" = cả năm học YYYY-(YYYY+1).
CONDUCT_YEAR_SUFFIX = "N"

# Hình thức nhận bảng điểm (01/10/2026).
CONDUCT_DELIVERY_CHOICES = [
    {"code": "online", "label": "Bản mềm (bản online)"},
    {"code": "paper", "label": "Bản cứng (giấy)"},
]


def _semester_label(year, semester):
    """Nhãn học kỳ lẻ — chỉ còn dùng để đọc yêu cầu cũ (trước 09/10/2026 SV chọn được HK lẻ)."""
    return f"Học kỳ {semester}, năm học {year}-{year + 1}"


def _year_label(year):
    return f"Cả năm học {year}-{year + 1}"


def conduct_years_label(codes):
    """["2024N", "2025N"] → "Cả năm học 2024-2025, 2025-2026" (cũ trước, mới sau).

    Ghi vào cột `purpose` (VARCHAR 255) và `payload.purpose.label` — Dashboard hiện thẳng chuỗi này.
    """
    years = sorted(int(c[:4]) for c in codes)
    return "Cả năm học " + ", ".join(f"{y}-{y + 1}" for y in years)


def conduct_purpose_codes(purpose):
    """Mã lựa chọn của một yêu cầu: `purpose.codes` (từ 09/10/2026, nhiều năm học) hoặc
    `purpose.code` (yêu cầu cũ: một mã, hoặc nhiều mã nối bằng dấu phẩy)."""
    purpose = purpose or {}
    codes = purpose.get("codes")
    if isinstance(codes, list):
        return [str(c) for c in codes if c]
    return [c.strip() for c in str(purpose.get("code") or "").split(",") if c.strip()]


def conduct_semester_choices(student, today=None):
    """Các NĂM HỌC SV được xin bảng điểm rèn luyện, MỚI NHẤT trước. SV tích được nhiều năm.

    Từ 09/10/2026 (người dùng chốt) chỉ còn "Cả năm học" (mã `YYYYN`), bỏ học kỳ lẻ.

    Một năm học được chọn khi HK2 của năm đó ĐÃ KẾT THÚC — điểm rèn luyện chỉ có sau khi
    học kỳ đóng. Mốc kết thúc theo `current_semester` (HK1 = T9–T1, HK2 = T2–T6, hè = T7–T8):
    đang HK1 hoặc HK2 thì năm học gần nhất là năm học trước; đang hè thì là năm học hiện tại.

    Năm học đầu tiên là năm SV đã học ít nhất HK2: nhập học HK1/HK2 năm YYYY ⇒ từ năm YYYY
    (nhập học HK2 thì bảng điểm năm đầu chỉ có HK2); nhập học HK3 ⇒ từ năm học kế.
    Hồ sơ không có năm nhập học ⇒ lùi `CONDUCT_FALLBACK_YEARS` năm học.
    """
    cur_start, _ = current_academic_year(today)
    last = cur_start if current_semester(today) == 3 else cur_start - 1

    entry_year, _, _, entry_sem = admission_start(student)
    if entry_year:
        first = entry_year + 1 if entry_sem == 3 else entry_year
    else:
        first = last - CONDUCT_FALLBACK_YEARS + 1

    return [{"code": f"{year}{CONDUCT_YEAR_SUFFIX}", "label": _year_label(year), "kind": "year"}
            for year in range(last, first - 1, -1)]


CONDUCT_RANK_LABELS = {
    "EXCELLENT": "Xuất sắc",
    "GOOD": "Tốt",
    "FAIR": "Khá",
    "AVERAGE": "Trung bình",
    "WEAK": "Yếu",
}


def conduct_scores_by_year(student, choices):
    """Điểm rèn luyện HK1/HK2 của các năm học trong `choices` (mã `YYYYN`) → {mã: {...}}.

    Chỉ trả điểm + xếp loại TỪNG học kỳ đúng như Phòng CTSV nhập. KHÔNG tự tính điểm
    hay xếp loại cả năm (người dùng chốt 10/10/2026: con số tự tính có thể lệch bảng
    điểm chính thức). Học kỳ chưa có điểm ⇒ `score` None.
    """
    from students.models import StudentConductScore

    years = sorted({int(c["code"][:4]) for c in choices if str(c.get("code", ""))[:4].isdigit()})
    if not years or student is None:
        return {}
    found = {}
    for s in (StudentConductScore.objects
              .filter(student_id=student.pk, term__academic_year__in=years, term__semester__in=(1, 2))
              .select_related("term")):
        found[(s.term.academic_year, s.term.semester)] = s

    result = {}
    for year in years:
        semesters = []
        for sem in (1, 2):
            s = found.get((year, sem))
            semesters.append({
                "semester": sem,
                "score": s.final_score if s else None,
                "rank": CONDUCT_RANK_LABELS.get(s.conduct_rank, "") if s else "",
            })
        result[f"{year}{CONDUCT_YEAR_SUFFIX}"] = {
            "semesters": semesters,
            "semester_count": sum(1 for x in semesters if x["score"] is not None),
        }
    return result


def resolve_conduct_delivery(code):
    for choice in CONDUCT_DELIVERY_CHOICES:
        if choice["code"] == code:
            return choice
    raise ValueError("Vui lòng chọn hình thức nhận bảng điểm (bản mềm hoặc bản cứng).")


def _conduct_snapshot(student):
    return {
        "student_name": student.full_name or "",
        "student_id": student.current_student_code or "",
        "department": student.current_department.name_vi if student.current_department else "",
        "course_year": course_year_label(student),
    }


def build_conduct_prefill(student):
    return {
        **_conduct_snapshot(student),
        "dob": format_student_birth_date(student),
        **_cccd_prefill(student),
        **_address_prefill(student),
    }


def _conduct_selection(student, semester_codes):
    """Năm học SV tích → (danh sách mã cũ trước, nhãn). Mã phải nằm trong danh sách được chọn."""
    allowed = {c["code"] for c in conduct_semester_choices(student)}
    codes = sorted({str(c).strip() for c in (semester_codes or []) if str(c).strip()})
    if not codes:
        raise ValueError("Vui lòng chọn ít nhất một năm học cấp bảng điểm rèn luyện.")
    if any(c not in allowed for c in codes):
        raise ValueError("Năm học cấp bảng điểm rèn luyện không hợp lệ.")
    return codes, conduct_years_label(codes)


def build_conduct_payload(student, *, semester_codes, delivery, dob, citizen_id,
                          citizen_id_issue_date, province_code, ward_code, street,
                          locked_purpose=None):
    """Bảng điểm rèn luyện — một yêu cầu gồm MỘT HOẶC NHIỀU năm học.

    `purpose` = {code: "2024N,2025N", codes: ["2024N", "2025N"], label: "Cả năm học 2024-2025,
    2025-2026"}: `code`/`label` vẫn là chuỗi để Dashboard và yêu cầu cũ đọc như trước.
    `locked_purpose`: sửa yêu cầu "Chờ bổ sung" — giữ nguyên năm học/học kỳ đã xin (kể cả học
    kỳ lẻ của yêu cầu cũ), không kiểm lại với danh sách hiện tại.
    """
    if locked_purpose:
        purpose = dict(locked_purpose)
        label = purpose.get("label") or ""
    else:
        codes, label = _conduct_selection(student, semester_codes)
        purpose = {"code": ",".join(codes), "codes": codes, "label": label, "program_name": None}
    delivery_choice = resolve_conduct_delivery(delivery)

    dob_field = _editable_field(format_student_birth_date(student), dob)
    if dob_field["changed"]:
        validate_dob(dob_field["proposed"])
    cid_field, issue_field = _cccd_fields(student, citizen_id, citizen_id_issue_date)
    addr_field = _permanent_address_field(student, province_code, ward_code, street)

    payload = {
        "doc_type": "conduct_score",
        "purpose": purpose,
        "delivery": dict(delivery_choice),
        "snapshot": {**_conduct_snapshot(student), "semester": label,
                     "delivery": delivery_choice["label"]},
        "editable": {
            "dob": dob_field,
            "citizen_id": cid_field,
            "citizen_id_issue_date": issue_field,
            "permanent_address": addr_field,
        },
    }
    return payload, label
