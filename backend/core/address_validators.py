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

# Tiền tố loại đơn vị trong `vn_provinces.name` / `vn_wards.name`. Bỏ đi để
# lấy tên trần ("Phường Bến Nghé" → "Bến Nghé").
_UNIT_PREFIXES = ("thành phố", "tỉnh", "phường", "xã", "đặc khu")

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


def _fold(value):
    """So khớp CÓ DẤU, không phân biệt hoa thường, gộp khoảng trắng."""
    return _MULTISPACE_RE.sub(" ", unicodedata.normalize("NFC", value or "")).strip().lower()


def _contains(haystack, needle):
    return bool(needle) and re.search(
        r"(?<!\w)" + re.escape(needle) + r"(?!\w)", haystack
    ) is not None


def _bare_name(name):
    folded = _fold(name)
    for prefix in _UNIT_PREFIXES:
        if folded.startswith(prefix + " "):
            return folded[len(prefix) + 1:]
    return folded


def _selected_units(province_name, ward_name):
    return [(label, name) for label, name in
            (("Tỉnh/Thành phố", province_name), ("Phường/Xã", ward_name)) if name]


def clean_street(value, *, province_name=None, ward_name=None):
    """Chuẩn hóa + kiểm tra. Trả về chuỗi sạch, hoặc raise StreetError.

    `province_name` / `ward_name`: tên đầy đủ của đơn vị đã chọn ở select
    ("Phường Bến Nghé"). Chuỗi chứa nguyên tên đó là nhập lại — chặn. Chỉ chứa
    tên trần ("Bến Nghé") thì có thể là tên đường thật, xem `street_warnings()`.

    Từng chặn mọi chuỗi có chữ phường/quận/huyện/tỉnh… (bỏ 23/09/2026): luật đó
    so khớp sau khi BỎ DẤU nên chặn nhầm «Quan Hoa», «Hải Quan», «Tỉnh lộ 10».
    """
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

    folded = _fold(text)
    for label, name in _selected_units(province_name, ward_name):
        if _contains(folded, _fold(name)):
            raise StreetError(
                f"Không nhập lại «{name}» vào ô này — phần đó đã chọn ở mục {label} phía trên."
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

    # Viết hoa chữ cái đầu ĐÃ TỪNG chặn cứng ở đây, bỏ 17/09/2026: luật cũ lấy
    # ký tự chữ cái đầu tiên gặp ở BẤT KỲ đâu trong chuỗi, nên chặn nhầm cả
    # «48/15 đường số 1» và «ngõ 5 Nguyễn Trãi» — hai địa chỉ viết đúng chính
    # tả, vì "đường"/"ngõ" là danh từ chung, viết thường mới đúng. Chữ hoa là
    # chuyện hình thức, không phải "chắc chắn sai", nên chuyển xuống
    # `street_warnings()`.
    return text


# Danh từ chung hay mở đầu địa chỉ — viết thường là ĐÚNG chính tả, đừng nhắc.
_STREET_LEAD = (
    "đường", "phố", "ngõ", "ngách", "hẻm", "kiệt", "tổ", "ấp", "thôn", "xóm",
    "khu", "lô", "số", "căn", "tầng", "block", "đại lộ", "bis",
)


def street_warnings(value, *, province_name=None, ward_name=None):
    """Cảnh báo mềm — hiển thị nhưng KHÔNG chặn gửi."""
    text = normalize_street(value)
    if not text:
        return []

    notes = []
    if not any(ch.isdigit() for ch in text):
        notes.append(
            "Địa chỉ không có số nhà. Nếu ở thôn/ấp không có số thì bỏ qua nhắc nhở này."
        )

    # Tên trần của đơn vị đã chọn — có thể là nhập lại, cũng có thể là tên
    # đường thật (đường Hồ Chí Minh, phố Hàng Bông ở phường Hàng Bông). Bỏ qua
    # tên một chữ ("Láng", "Chũ") hay tên số ("Phường 12" → "12"): quá dễ trùng.
    folded = _fold(text)
    for label, name in _selected_units(province_name, ward_name):
        bare = _bare_name(name)
        if len(bare.split()) >= 2 and not _contains(folded, _fold(name)) and _contains(folded, bare):
            notes.append(
                f"Chuỗi có chứa «{bare.title()}» — kiểm tra lại xem có bị trùng với "
                f"mục {label} đã chọn phía trên không."
            )

    # Chữ cái đầu viết thường — chỉ NHẮC, không chặn. Bỏ qua khi từ đầu là danh
    # từ chung ("đường", "ngõ"…), vì viết thường ở đó mới đúng chính tả.
    if text[0].isalpha() and text[0] != text[0].upper():
        first_word = _strip_accents(text.split()[0]).lower()
        leads = {_strip_accents(w).lower().split()[0] for w in _STREET_LEAD}
        if first_word not in leads:
            notes.append(
                "Nên viết hoa chữ cái đầu. VD: 123 Nguyễn Văn Cừ"
            )
    return notes
