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
    street = clean_street(street)
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
