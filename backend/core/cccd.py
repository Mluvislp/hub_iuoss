"""Đọc chuỗi mã QR in trên thẻ CCCD gắn chip.

Trình duyệt lo phần ảnh → chuỗi; ở đây chỉ tách chuỗi ra các trường. Cố ý đặt
riêng một module vì dữ liệu CCCD sẽ còn được thu thập ở nhiều luồng khác (khai
báo ngoại trú, yêu cầu giấy tờ…), tất cả phải đi qua đúng một bộ đọc này.

Chuỗi gồm 7 trường ngăn bằng dấu `|`:

    079204001234|123456789|Nguyễn Văn A|08042006|Nam|<địa chỉ>|15032021
      số CCCD     CMND cũ    họ và tên   ngày sinh  GT           ngày cấp

Ngày viết liền dạng ddMMyyyy. Trường CMND cũ có thể rỗng.

⚠️ Thẻ Căn cước mẫu mới (từ 01/07/2024) dời QR sang mặt sau và nội dung mã hóa
được quy định khác — chưa xác minh được payload. Gặp chuỗi không đúng khuôn thì
hàm này trả None; TUYỆT ĐỐI không đoán, dữ liệu định danh sai còn tệ hơn thiếu.
"""

from __future__ import annotations

import logging
import re
from datetime import date, datetime

logger = logging.getLogger(__name__)

FIELD_COUNT = 7
MAX_RAW_LENGTH = 512

_CITIZEN_ID = re.compile(r"^\d{12}$")
_OLD_ID = re.compile(r"^\d{9,12}$")
_GENDERS = {"nam": "Nam", "nữ": "Nữ", "nu": "Nữ"}


def _parse_date(value: str) -> date | None:
    """`ddMMyyyy` → date. Sai khuôn thì bỏ qua trường đó, không làm hỏng cả bản ghi."""
    value = (value or "").strip()
    if not re.fullmatch(r"\d{8}", value):
        return None
    try:
        return datetime.strptime(value, "%d%m%Y").date()
    except ValueError:
        return None


def parse_cccd_qr(raw: str | None) -> dict | None:
    """Tách chuỗi QR thành các trường. Trả None nếu chuỗi không phải QR của CCCD.

    Chỉ `citizen_id` và `full_name` là bắt buộc — thiếu một trong hai thì bản ghi
    không có giá trị gì để lưu.
    """
    if not raw:
        return None

    raw = str(raw).strip()
    if len(raw) > MAX_RAW_LENGTH:
        logger.warning("CCCD_QR_TOO_LONG | %d ky tu", len(raw))
        return None

    parts = raw.split("|")
    if len(parts) != FIELD_COUNT:
        logger.info("CCCD_QR_SHAPE_MISMATCH | %d truong (can %d)", len(parts), FIELD_COUNT)
        return None

    citizen_id = parts[0].strip()
    full_name = parts[2].strip()
    if not _CITIZEN_ID.match(citizen_id) or not full_name:
        logger.info("CCCD_QR_INVALID | so CCCD hoac ho ten khong hop le")
        return None

    old_id = parts[1].strip()
    gender_raw = parts[4].strip()

    return {
        "citizen_id": citizen_id,
        "old_id_number": old_id if _OLD_ID.match(old_id) else "",
        "full_name": full_name[:255],
        "date_of_birth": _parse_date(parts[3]),
        # Giữ nguyên văn khi gặp giá trị lạ thay vì ép về rỗng.
        "gender": _GENDERS.get(gender_raw.lower(), gender_raw[:10]),
        # Nguyên văn trên thẻ, theo cơ cấu hành chính TRƯỚC sáp nhập 2025.
        # KHÔNG ánh xạ sang vn_provinces/vn_wards — tỉnh khớp 72%, phường/xã 20%.
        "residence_address": parts[5].strip()[:255],
        "issue_date": _parse_date(parts[6]),
    }
