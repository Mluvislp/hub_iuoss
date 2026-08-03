"""
Kiểm tra ô "địa chỉ chi tiết" (số nhà / đường / thôn / ấp / khu phố).

Đặt riêng khỏi `address_service` để Hub copy nguyên khối sang được — hai repo
dùng chung một DB nhưng không chung codebase, luật nhập liệu phải giống hệt
nhau, nếu không mỗi bên cho qua một kiểu dữ liệu.

Nguyên tắc: chặn cứng những thứ chắc chắn sai, còn lại chỉ cảnh báo. Chặn nhầm
một địa chỉ hợp lệ thì sinh viên không có đường đi tiếp và sẽ gọi lên văn phòng.
"""
# ⚠️ FILE NÀY CÓ BẢN SAO Ở REPO KIA — sửa một bên phải sửa luôn bên kia:
#      dashboard_iuoss/students/address_validators.py
#      hub_iuoss/backend/core/address_validators.py
#    Hai repo không dùng chung codebase (chỉ chung DB) nhưng luật nhập liệu
#    phải giống hệt nhau, lệch là mỗi bên cho qua một kiểu dữ liệu.
#    Bộ test validator được nhân đôi để bắt lệch: chạy cả hai sau khi sửa.

import re
import unicodedata

STREET_MIN = 5
STREET_MAX = 255

# Đơn vị hành chính đã chọn ở select phía trên — nhập lại vào ô chi tiết là
# nhân đôi. Đây đúng là lỗi đang có trong 12.295 dòng dữ liệu nền.
_ADMIN_HARD = ("phường", "quận", "huyện", "tỉnh", "thành phố", "thị xã", "thị trấn")

# "Xã" chỉ cảnh báo, không chặn: có tên đường thật chứa từ này (Xã Đàn ở Hà Nội).
_ADMIN_SOFT = ("xã",)

# Viết tắt hay gặp — yêu cầu viết đủ chữ.
_ABBREV_RE = re.compile(r"(?<![^\s,./-])(p|q|tp|tt|h|x|kp|đ)\.", re.IGNORECASE)

# Chữ Việt, chữ số, khoảng trắng và vài dấu phân cách thông dụng.
_ALLOWED_RE = re.compile(r"^[0-9A-Za-zÀ-ỹà-ỹĐđ\s,./\-]+$")

_MULTISPACE_RE = re.compile(r"\s+")


class StreetError(ValueError):
    """Lỗi để hiển thị thẳng cho sinh viên."""


def _strip_accents(value):
    return "".join(
        ch for ch in unicodedata.normalize("NFD", value)
        if unicodedata.category(ch) != "Mn"
    )


def normalize_street(value):
    """Gộp khoảng trắng thừa, bỏ khoảng trắng quanh dấu phẩy, trim."""
    text = _MULTISPACE_RE.sub(" ", (value or "").strip())
    text = re.sub(r"\s*,\s*", ", ", text)
    return text.strip(" ,")


def clean_street(value):
    """Chuẩn hóa + kiểm tra. Trả về chuỗi sạch, hoặc raise StreetError."""
    text = normalize_street(value)

    if not text:
        raise StreetError("Vui lòng nhập địa chỉ chi tiết.")
    if len(text) < STREET_MIN:
        raise StreetError(f"Địa chỉ chi tiết quá ngắn (tối thiểu {STREET_MIN} ký tự).")
    if len(text) > STREET_MAX:
        raise StreetError(f"Địa chỉ chi tiết quá dài (tối đa {STREET_MAX} ký tự).")

    if not _ALLOWED_RE.match(text):
        raise StreetError(
            "Địa chỉ chỉ được dùng chữ, số, khoảng trắng và các dấu , . / -"
        )

    if not any(ch.isalpha() for ch in text):
        raise StreetError("Địa chỉ chi tiết phải có tên đường/thôn/ấp, không chỉ gồm số.")

    lowered = _strip_accents(text).lower()
    for word in _ADMIN_HARD:
        if re.search(r"(?<![a-z])" + _strip_accents(word) + r"(?![a-z])", lowered):
            raise StreetError(
                f"Không nhập «{word}» vào ô này — phần đó đã chọn ở mục "
                "Tỉnh/Thành phố và Phường/Xã phía trên."
            )

    match = _ABBREV_RE.search(text)
    if match:
        raise StreetError(
            f"Không dùng chữ viết tắt «{match.group(0)}» — vui lòng viết đầy đủ."
        )

    letters = [ch for ch in text if ch.isalpha()]
    if len(letters) >= 6:
        upper = sum(1 for ch in letters if ch == ch.upper())
        if upper / len(letters) > 0.6:
            raise StreetError(
                "Không viết hoa toàn bộ — chỉ viết hoa chữ cái đầu mỗi từ. "
                "VD: 123 Nguyễn Văn Cừ"
            )

    first_alpha = next((ch for ch in text if ch.isalpha()), "")
    if first_alpha and first_alpha != first_alpha.upper():
        raise StreetError("Chữ cái đầu tiên phải viết hoa. VD: 123 Nguyễn Văn Cừ")

    return text


def street_warnings(value):
    """Cảnh báo mềm — hiển thị nhưng KHÔNG chặn gửi."""
    text = normalize_street(value)
    if not text:
        return []

    notes = []
    if not any(ch.isdigit() for ch in text):
        notes.append(
            "Địa chỉ không có số nhà. Nếu ở thôn/ấp không có số thì bỏ qua nhắc nhở này."
        )

    lowered = _strip_accents(text).lower()
    for word in _ADMIN_SOFT:
        if re.search(r"(?<![a-z])" + _strip_accents(word) + r"(?![a-z])", lowered):
            notes.append(
                f"Chuỗi có chứa «{word}» — kiểm tra lại xem có bị trùng với "
                "mục Phường/Xã đã chọn phía trên không."
            )
    return notes
