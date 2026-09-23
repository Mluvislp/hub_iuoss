"""
Đường ghi DUY NHẤT cho địa chỉ sinh viên (thường trú / tạm trú).

Mô hình: mỗi (student, address_type, sequence_no) có tối đa MỘT dòng
`is_current=True`; khai lại thì tạo dòng mới và hạ dòng cũ xuống lịch sử —
KHÔNG sửa đè dòng cũ. Giống hệt quy ước đã dùng cho thẻ BHYT.

Vì sao phải tập trung một chỗ: bảng này có nhiều đường ghi (form sửa SV bên
Dashboard, form khai báo ngoại trú bên Hub, luồng giấy tờ). Mỗi nơi tự ghi một
kiểu là dữ liệu lệch — đúng cái bẫy đã dính với thẻ BHYT.

Hai cột thời gian dùng lại cột có sẵn, KHÔNG thêm cột mới:
    effective_from = ngày khai (dòng nào có nghĩa là đã được xác nhận lại)
    effective_to   = ngày bị thay thế
Không dùng `updated_at` cho việc này: cột đó có ON UPDATE CURRENT_TIMESTAMP nên
sẽ bị ghi đè đúng lúc dòng bị hạ xuống lịch sử, mất luôn mốc khai.

Trạng thái một địa chỉ suy ra, không cần cột cờ:
    EMPTY    — không có dòng is_current
    LEGACY   — có dòng nhưng effective_from IS NULL (dữ liệu nền trước 2025)
    STANDARD — effective_from có giá trị (đã khai lại theo danh mục 2025)
"""
# ⚠️ FILE NÀY CÓ BẢN SAO Ở REPO KIA — sửa một bên phải sửa luôn bên kia:
#      dashboard_iuoss/students/address_service.py
#      hub_iuoss/backend/core/address_service.py
#    Hai repo không dùng chung codebase (chỉ chung DB) nhưng luật nhập liệu
#    phải giống hệt nhau, lệch là mỗi bên cho qua một kiểu dữ liệu.
#    Bộ test validator được nhân đôi để bắt lệch: chạy cả hai sau khi sửa.

from django.db import transaction
from django.utils import timezone

from students.models import StudentAddress, VnProvince, VnWard

STATE_EMPTY = "EMPTY"
STATE_LEGACY = "LEGACY"
STATE_STANDARD = "STANDARD"

STREET_MAX = 255

# Mã tỉnh TP.HCM trong danh mục 2025 (dùng cho nhánh "tạm trú tại TP.HCM").
HCMC_PROVINCE_CODE = "79"


class AddressError(ValueError):
    """Lỗi nghiệp vụ khi ghi địa chỉ — caller hiển thị trực tiếp cho người dùng."""


# ── Đọc ───────────────────────────────────────────────────────────────────────

def get_current(student, address_type, sequence_no=1):
    """Dòng địa chỉ đang dùng, hoặc None."""
    return (
        StudentAddress.objects
        .filter(
            student=student,
            address_type=address_type,
            sequence_no=sequence_no,
            is_current=True,
        )
        .order_by("-id")
        .first()
    )


# ── Thường trú: thứ tự ưu tiên khi ĐỌC ────────────────────────────────────────
#
# `CURRENT_STD` là bản thường trú đã chuẩn hoá theo cơ cấu hành chính 2025 —
# sinh ra từ luồng giấy tờ, hoặc nạp hàng loạt từ file đã rà tay. Có bản đó thì
# nó là sự thật; không có mới lùi về `CURRENT`, vốn là dữ liệu nền có thể còn
# cấp huyện cũ và thiếu `province_code`/`ward_code`.
#
# CHỈ dùng cho đường ĐỌC. Đường GHI luôn nêu `address_type` tường minh — ghi
# thường trú mà đi qua đây là hạ nhầm dòng của loại khác.
PERMANENT_TYPES = (StudentAddress.TYPE_CURRENT_STD, StudentAddress.TYPE_CURRENT)

# Tạm trú đối xứng với thường trú (thêm 17/09/2026). Trước đó OFFCAMPUS.md chốt
# "không thêm TEMPORARY_STD"; người dùng đảo lại quyết định đó để hai loại địa
# chỉ cùng một mô hình — bản chuẩn hoá nằm ở type riêng, bản nền giữ nguyên.
TEMPORARY_TYPES = (StudentAddress.TYPE_TEMPORARY_STD, StudentAddress.TYPE_TEMPORARY)

# Loại NỀN → loại CHUẨN HOÁ. Đường ghi của form khai báo luôn ghi vào bản chuẩn
# hoá; dòng nền giữ nguyên làm chứng cứ dữ liệu cũ, không xoá.
STANDARD_OF = {
    StudentAddress.TYPE_CURRENT: StudentAddress.TYPE_CURRENT_STD,
    StudentAddress.TYPE_TEMPORARY: StudentAddress.TYPE_TEMPORARY_STD,
}


def read_order(address_type):
    """Thứ tự ưu tiên khi ĐỌC một loại địa chỉ: bản chuẩn hoá trước, bản nền sau.

    Truyền loại nào trong cặp cũng ra cùng một thứ tự — caller không phải nhớ
    mình đang cầm bản nền hay bản chuẩn hoá.
    """
    if address_type in PERMANENT_TYPES:
        return PERMANENT_TYPES
    if address_type in TEMPORARY_TYPES:
        return TEMPORARY_TYPES
    return (address_type,)


def get_effective(student, address_type, sequence_no=1):
    """Dòng đang dùng của một loại địa chỉ, theo `read_order()`."""
    for t in read_order(address_type):
        row = get_current(student, t, sequence_no)
        if row is not None:
            return row
    return None


def pick_effective(by_type, address_type):
    """Như `get_effective` nhưng chọn từ dict {address_type: row} đã gom theo lô.

    Nhớ thêm ĐỦ cả cặp vào bộ lọc `address_type__in` của truy vấn gom.
    """
    for t in read_order(address_type):
        row = by_type.get(t)
        if row is not None:
            return row
    return None


def pick_permanent(by_type):
    """Chọn dòng thường trú từ dict {address_type: row} đã gom theo lô."""
    return pick_effective(by_type, StudentAddress.TYPE_CURRENT)


def get_permanent(student, sequence_no=1):
    """Dòng thường trú đang dùng, theo thứ tự ưu tiên `PERMANENT_TYPES`."""
    return get_effective(student, StudentAddress.TYPE_CURRENT, sequence_no)


def describe_permanent(student, sequence_no=1):
    """`describe()` cho thường trú, có áp thứ tự ưu tiên."""
    address = get_permanent(student, sequence_no)
    return {
        "state": get_state(address),
        "display": format_address(address),
        "address": address,
    }


def get_state(address):
    if address is None:
        return STATE_EMPTY
    return STATE_STANDARD if address.effective_from else STATE_LEGACY


def format_address(address):
    """Chuỗi hiển thị.

    Dòng chuẩn: 'số nhà, Phường X, Tỉnh Y' — KHÔNG ghép `district` vào, cơ cấu
    2025 đã bỏ cấp huyện. Dòng cũ thì hiện nguyên văn cả 4 thành phần vì đó là
    tất cả những gì đang có.
    """
    if address is None:
        return ""
    if address.effective_from:
        parts = [address.full_address, address.ward, address.province]
    else:
        parts = [address.full_address, address.ward, address.district, address.province]
    return ", ".join(p.strip() for p in parts if p and p.strip())


def describe(student, address_type, sequence_no=1):
    """Gói gọn cho template/API: {state, display, address}."""
    address = get_current(student, address_type, sequence_no)
    return {
        "state": get_state(address),
        "display": format_address(address),
        "address": address,
    }


def history(student, address_type, sequence_no=1):
    """Các dòng đã bị thay thế, mới nhất trước."""
    return (
        StudentAddress.objects
        .filter(
            student=student,
            address_type=address_type,
            sequence_no=sequence_no,
            is_current=False,
        )
        .order_by("-effective_to", "-id")
    )


# ── Kiểm tra đầu vào ──────────────────────────────────────────────────────────

def resolve_location(province_code, ward_code):
    """(province_code, ward_code) → (VnProvince, VnWard). Raise AddressError."""
    province = VnProvince.objects.filter(
        code=(province_code or "").strip(), is_active=True
    ).first()
    if not province:
        raise AddressError("Vui lòng chọn tỉnh/thành hợp lệ.")

    # Phường phải thuộc đúng tỉnh đã chọn — nếu không, client có thể gửi cặp
    # mã lệch nhau và ta ghi ra địa chỉ không tồn tại.
    # NB: bên Hub `province_code` là CharField thường; bản Dashboard khai
    # `province` là FK nên dòng lọc này KHÁC nhau giữa hai repo.
    ward = VnWard.objects.filter(
        code=(ward_code or "").strip(),
        province_code=province.code,
        is_active=True,
    ).first()
    if not ward:
        raise AddressError("Vui lòng chọn phường/xã hợp lệ thuộc tỉnh/thành đã chọn.")
    return province, ward


def location_names(province_code, ward_code):
    """Tên đầy đủ (tỉnh, phường) cho cảnh báo mềm — mã sai thì trả None, không
    raise: lỗi mã đã có `save_address()` báo."""
    try:
        province, ward = resolve_location(province_code, ward_code)
    except AddressError:
        return {}
    return {"province_name": province.name, "ward_name": ward.name}


# ── Ghi ───────────────────────────────────────────────────────────────────────

@transaction.atomic
def save_address(student, address_type, *, province_code, ward_code, street,
                 sequence_no=1, on_date=None):
    """Ghi địa chỉ đã chuẩn hóa. Trả về dòng hiện hành sau khi ghi.

    - Idempotent: trùng hệt dòng đang có thì chỉ làm mới ngày khai, không sinh
      dòng lịch sử rác.
    - Chống ghi song song: khóa dòng hiện hành TRƯỚC khi đọc, nên hai request
      cùng lúc phải nối đuôi thay vì cùng tạo ra hai dòng is_current.
    """
    from .address_validators import clean_street  # tránh import vòng

    province, ward = resolve_location(province_code, ward_code)
    street = clean_street(street, province_name=province.name, ward_name=ward.name)
    today = on_date or timezone.localdate()

    # Ghi vào bản NỀN thì bản CHUẨN HOÁ cũ phải nhường chỗ — bản chuẩn hoá đứng
    # trước trong `read_order()`, không hạ nó xuống thì thứ vừa ghi thành vô hình.
    # Ngược lại (ghi thẳng vào bản chuẩn hoá) thì không phải hạ gì: dòng nền vốn
    # đã đứng sau, giữ lại làm chứng cứ dữ liệu cũ.
    standard_type = STANDARD_OF.get(address_type)
    if standard_type:
        StudentAddress.objects.filter(
            student=student,
            address_type=standard_type,
            sequence_no=sequence_no,
            is_current=True,
        ).update(is_current=False, effective_to=today)

    locked = list(
        StudentAddress.objects
        .select_for_update()
        .filter(
            student=student,
            address_type=address_type,
            sequence_no=sequence_no,
            is_current=True,
        )
        .order_by("-id")
    )
    current = locked[0] if locked else None

    unchanged = (
        current is not None
        and current.effective_from is not None
        and current.province_code == province.code
        and current.ward_code == ward.code
        and (current.full_address or "") == street
    )
    if unchanged:
        current.effective_from = today
        current.save(update_fields=["effective_from", "updated_at"])
        return current

    for row in locked:
        row.is_current = False
        row.effective_to = today
        row.save(update_fields=["is_current", "effective_to", "updated_at"])

    return StudentAddress.objects.create(
        student=student,
        address_type=address_type,
        sequence_no=sequence_no,
        full_address=street,
        ward=ward.name,
        district=None,          # cơ cấu 2025 bỏ cấp huyện
        province=province.name,
        ward_code=ward.code,
        province_code=province.code,
        is_current=True,
        effective_from=today,
    )


@transaction.atomic
def declare_empty(student, address_type, *, sequence_no=1, on_date=None):
    """Khai báo "không có địa chỉ loại này".

    Ghi một dòng rỗng nhưng CÓ effective_from — đó là cách phân biệt "đã khai
    là không có" với "chưa khai bao giờ", không cần thêm cột nào.
    """
    today = on_date or timezone.localdate()
    locked = list(
        StudentAddress.objects
        .select_for_update()
        .filter(
            student=student,
            address_type=address_type,
            sequence_no=sequence_no,
            is_current=True,
        )
        .order_by("-id")
    )
    for row in locked:
        row.is_current = False
        row.effective_to = today
        row.save(update_fields=["is_current", "effective_to", "updated_at"])

    return StudentAddress.objects.create(
        student=student,
        address_type=address_type,
        sequence_no=sequence_no,
        full_address=None,
        ward=None,
        district=None,
        province=None,
        ward_code=None,
        province_code=None,
        is_current=True,
        effective_from=today,
    )


def copy_address(student, *, from_type, to_type, sequence_no=1, on_date=None):
    """Sao chép địa chỉ giữa hai loại (vd tạm trú trùng thường trú).

    Sao chép GIÁ TRỊ, không tham chiếu chéo — sau này sửa bên này không kéo theo
    bên kia. Nguồn phải là dòng đã chuẩn hóa.
    """
    source = get_current(student, from_type, sequence_no)
    if source is None or not source.ward_code:
        raise AddressError("Chưa có địa chỉ chuẩn hóa để sao chép.")
    return save_address(
        student, to_type,
        province_code=source.province_code,
        ward_code=source.ward_code,
        street=source.full_address or "",
        sequence_no=sequence_no,
        on_date=on_date,
    )


# ── Giám sát bất biến ─────────────────────────────────────────────────────────

def find_duplicate_current():
    """Các (SV, loại, seq) đang có nhiều hơn một dòng hiện hành.

    Bất biến "1 dòng hiện hành" được giữ bằng code chứ không phải ràng buộc DB,
    nên phải soi được. Kết quả phải luôn rỗng.
    """
    from django.db.models import Count
    return (
        StudentAddress.objects
        .filter(is_current=True)
        .values("student_id", "address_type", "sequence_no")
        .annotate(n=Count("id"))
        .filter(n__gt=1)
        .order_by()
    )
