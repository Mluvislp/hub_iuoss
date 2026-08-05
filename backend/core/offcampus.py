"""
Nghiệp vụ "Khai báo thông tin ngoại trú".

Sinh viên khai lại địa chỉ thường trú + tạm trú theo danh mục hành chính 2025,
đồng thời được đề xuất sửa CCCD / email cá nhân / số điện thoại.

Tất cả ghi thẳng, không qua duyệt — đó là mục đích của tính năng (SV tự sửa
dữ liệu cho dễ). Mỗi lần sửa thông tin cá nhân ghi một dòng nhật ký `cũ → mới`
vào hub_profile_change_requests.
"""

from django.db import transaction
from django.utils import timezone

from students.models import ProfileChangeRequest, StudentAddress

from . import address_service as addr
from . import profile_changes as pc
from .address_validators import StreetError, street_warnings
from .documents import _match_province, _match_ward, _ADMIN_KEYWORDS

PERMANENT = StudentAddress.TYPE_CURRENT
TEMPORARY = StudentAddress.TYPE_TEMPORARY


def _suggest_from_legacy(address):
    """Gợi ý tỉnh/phường từ dòng địa chỉ cũ. CHỈ để prefill, không tự lưu.

    Thực đo trên dữ liệu nền: đoán được tỉnh ~72%, phường ~20% (cơ cấu 2025 đã
    sáp nhập/đổi tên hầu hết xã). Nên đây là gợi ý, không phải kết luận.
    """
    if address is None:
        return {"province_code": "", "ward_code": "", "street": ""}

    if address.effective_from:      # đã chuẩn hóa → dùng thẳng mã đã có
        return {
            "province_code": address.province_code or "",
            "ward_code": address.ward_code or "",
            "street": address.full_address or "",
        }

    province = _match_province(address.province)
    ward = _match_ward(address.ward, province.code) if province else None

    # full_address cũ nhiều khi chứa cả phường/quận/tỉnh — đổ vào ô "địa chỉ
    # chi tiết" là người dùng bị chặn ngay bởi luật chống nhân đôi đơn vị.
    full = (address.full_address or "").strip()
    street = "" if any(k in full.lower() for k in _ADMIN_KEYWORDS) else full

    return {
        "province_code": province.code if province else "",
        "ward_code": ward.code if ward else "",
        "street": street,
    }


def _address_block(student, address_type):
    current = addr.get_current(student, address_type)
    return {
        "state": addr.get_state(current),
        "display": addr.format_address(current),
        "legacy_display": (
            addr.format_address(current)
            if current is not None and not current.effective_from else ""
        ),
        "declared_on": current.effective_from.isoformat()
        if current is not None and current.effective_from else None,
        "prefill": _suggest_from_legacy(current),
    }


def is_declared(student):
    """Đã khai lần nào chưa — căn cứ vào dòng thường trú có effective_from."""
    current = addr.get_current(student, PERMANENT)
    return current is not None and current.effective_from is not None


def lock_state(student):
    """(bị khóa, ngày đã khai). Mỗi SV chỉ khai MỘT lần; muốn khai lại phải được
    nhân viên cấp vé mở lại trên Dashboard.

    Vé lưu ngay trong hub_profile_change_requests với target riêng, không cần
    thêm bảng/cột. Vé còn hiệu lực = status 'approved'; dùng xong chuyển
    'cancelled' nên form tự khóa lại — không phải so mốc thời gian.
    """
    declared = is_declared(student)
    if not declared:
        return False, None
    if pc.active_reopen(student):
        return False, addr.get_current(student, PERMANENT).effective_from
    return True, addr.get_current(student, PERMANENT).effective_from


def build_prefill(student):
    """Toàn bộ dữ liệu dựng form."""
    permanent = _address_block(student, PERMANENT)
    temporary = _address_block(student, TEMPORARY)

    temp_current = addr.get_current(student, TEMPORARY)
    in_hcmc = None
    if temp_current is not None and temp_current.effective_from:
        in_hcmc = temp_current.province_code == addr.HCMC_PROVINCE_CODE

    locked, declared_on = lock_state(student)
    reopen = pc.active_reopen(student)
    asked = pc.active_reopen_request(student)

    return {
        "locked": locked,
        "declared_on": declared_on.isoformat() if declared_on else None,
        "reopened": reopen is not None,
        "reopen_requested": asked is not None,
        "reopen_requested_at": timezone.localtime(asked.created_at).strftime("%d/%m/%Y")
        if asked else None,
        "student": {
            "full_name": student.full_name or "",
            "student_code": student.current_student_code or "",
            "department": student.current_department.name_vi if student.current_department else "",
            "university_email": pc.current_university_email(student),
        },
        "fields": pc.read_profile(student),
        "permanent": permanent,
        "temporary": temporary,
        "temporary_in_hcmc": in_hcmc,
        "hcmc_province_code": addr.HCMC_PROVINCE_CODE,
    }


class DeclarationError(ValueError):
    """Lỗi nghiệp vụ kèm map lỗi theo từng ô, để frontend tô đúng chỗ."""

    def __init__(self, errors):
        self.errors = errors
        super().__init__("; ".join(f"{k}: {v}" for k, v in errors.items()))


class DeclarationLocked(ValueError):
    """Đã khai rồi và chưa được nhân viên mở lại."""


def request_reopen(student, reason=""):
    """SV xin mở lại biểu mẫu. Chỉ có ý nghĩa khi form đang khóa."""
    locked, _ = lock_state(student)
    if not locked:
        raise ValueError("Biểu mẫu của bạn đang mở, có thể khai lại ngay.")
    request, created = pc.request_reopen(student, reason)
    return {
        "ok": True,
        "created": created,
        "requested_at": timezone.localtime(request.created_at).strftime("%d/%m/%Y"),
    }


@transaction.atomic
def submit(student, data):
    """Ghi một lần khai báo. Trả về dict tóm tắt kết quả.

    Toàn bộ nằm trong một transaction: sai một ô là không ghi gì cả, tránh
    trạng thái nửa vời (đã ghi thường trú nhưng tạm trú lỗi).
    """
    locked, declared_on = lock_state(student)
    if locked:
        raise DeclarationLocked(
            "Bạn đã khai báo ngày "
            + (declared_on.strftime("%d/%m/%Y") if declared_on else "trước đó")
            + ". Mỗi sinh viên chỉ khai một lần — cần sửa vui lòng liên hệ "
            "phòng CTSV để được mở lại."
        )

    errors = {}
    group_key = pc.new_group_key()
    temp_warnings = []

    # ── 1. Thông tin cá nhân (chỉ xử lý ô nào SV thực sự gửi lên) ────────────
    field_results = {}
    # CCCD gồm 3 phần đi cùng một dòng hồ sơ nên gom thành một giá trị.
    citizen = data.get("citizen_id")
    if isinstance(citizen, str):
        citizen = {"number": citizen}
    citizen = citizen or {}
    if (citizen.get("number") or "").strip():
        citizen = {
            "number": citizen.get("number") or "",
            "issue_place": citizen.get("issue_place") or "",
            "issue_date": citizen.get("issue_date") or "",
        }
    else:
        citizen = None

    for target, key, raw in (
        ("student.citizen_id", "citizen_id", citizen),
        ("contact.personal_email", "personal_email",
         (data.get("personal_email") or "").strip()),
        ("contact.mobile_phone", "mobile_phone",
         (data.get("mobile_phone") or "").strip()),
    ):
        if not raw:
            continue
        try:
            request, applied = pc.submit_change(
                student, target, raw,
                source=ProfileChangeRequest.SOURCE_OFFCAMPUS,
                group_key=group_key,
            )
            if request is not None:
                field_results[key] = "applied" if applied else "pending"
        except pc.ChangeError as exc:
            errors[key] = str(exc)

    # ── 2. Địa chỉ thường trú ───────────────────────────────────────────────
    permanent = data.get("permanent") or {}
    perm_warnings = street_warnings(permanent.get("street") or "")
    try:
        addr.save_address(
            student, PERMANENT,
            province_code=permanent.get("province_code"),
            ward_code=permanent.get("ward_code"),
            street=permanent.get("street"),
        )
    except StreetError as exc:
        errors["permanent_street"] = str(exc)
    except addr.AddressError as exc:
        errors["permanent_location"] = str(exc)

    # ── 3. Địa chỉ tạm trú ──────────────────────────────────────────────────
    in_hcmc = data.get("temporary_in_hcmc")
    if in_hcmc is None:
        errors["temporary_in_hcmc"] = "Vui lòng chọn có hoặc không."
    else:
        temporary = data.get("temporary") or {}
        # Nhánh "Có": ép mã tỉnh ở server, không tin giá trị client gửi lên.
        province_code = (
            addr.HCMC_PROVINCE_CODE if in_hcmc else temporary.get("province_code")
        )
        temp_warnings = street_warnings(temporary.get("street") or "")
        try:
            addr.save_address(
                student, TEMPORARY,
                province_code=province_code,
                ward_code=temporary.get("ward_code"),
                street=temporary.get("street"),
            )
        except StreetError as exc:
            errors["temporary_street"] = str(exc)
        except addr.AddressError as exc:
            errors["temporary_location"] = str(exc)

    if errors:
        raise DeclarationError(errors)

    # Ghi xong mới tiêu vé — sai ở bất kỳ ô nào thì transaction rollback và vé
    # vẫn còn nguyên để SV nhập lại.
    pc.consume_reopen(student)

    return {
        "ok": True,
        "group_key": group_key,
        "fields": field_results,
        "warnings": {
            "permanent_street": perm_warnings,
            "temporary_street": temp_warnings if in_hcmc is not None else [],
        },
    }
