"""Luật hợp lệ của số CCCD / Căn cước và ngày cấp.

(Khác `core/cccd.py` bên Hub — module đó đọc chuỗi mã QR trên thẻ.)

⚠️ BẢN SONG SINH — giữ giống hệt nhau:
    dashboard  students/cccd_rules.py
    hub        backend/core/cccd_rules.py
    hub        frontend/lib/form-validators.ts (validateCccd / validateIssueDate)
Sửa một nơi phải sửa cả ba. (Nơi cấp — ISSUE_PLACES — chỉ có ở hai bản Python; form Hub
nhận danh sách lựa chọn từ API.)

Cố ý chỉ kiểm cơ bản (chốt 26/09/2026): số đúng 12 chữ số, ngày cấp là ngày thật và
không ở tương lai. KHÔNG soi mã tỉnh (3 số đầu), mã thế kỷ (số thứ 4) hay đối chiếu
năm sinh — dữ liệu gốc (ngày sinh, số cũ) lệch nhiều, soi chặt là chặn nhầm SV.
"""
import re
from datetime import date, datetime

CCCD_RE = re.compile(r"^\d{12}$")


def parse_date(text):
    """'dd/mm/yyyy' → date. Trống ⇒ None. Sai ⇒ ValueError."""
    text = (text or "").strip()
    if not text:
        return None
    return datetime.strptime(text, "%d/%m/%Y").date()


def check_number(number):
    """Số CCCD mới do sinh viên/chuyên viên nhập. Raise ValueError nếu sai."""
    number = (number or "").strip()
    if not number:
        raise ValueError("Vui lòng nhập số CCCD (12 chữ số).")
    if not CCCD_RE.match(number):
        raise ValueError("Số CCCD phải gồm đúng 12 chữ số.")


def check_issue_date(issued):
    """Ngày cấp CCCD (date). Raise ValueError nếu sai."""
    if issued is None:
        raise ValueError("Vui lòng nhập ngày cấp CCCD.")
    if issued > date.today():
        raise ValueError("Ngày cấp CCCD không được ở tương lai.")


# ── Nơi cấp CCCD ──────────────────────────────────────────────────────────────
# Chỉ 3 cơ quan cấp thẻ căn cước. `student_identity_documents.issue_place` còn hàng nghìn
# dòng ghi tên tỉnh (nơi cấp CMND cũ) và nhiều cách viết tắt ⇒ chuẩn hoá theo từ khoá; mọi
# giá trị khác (trống, tên tỉnh…) ⇒ mặc định (chốt 19/10/2026).
ISSUE_PLACE_DEFAULT = "Cục Cảnh sát Quản lý Hành chính về Trật tự Xã hội"
ISSUE_PLACES = (
    ISSUE_PLACE_DEFAULT,
    "Cục Cảnh sát Đăng ký, Quản lý cư trú và Dữ liệu quốc gia về dân cư",
    "Bộ Công an",
)
_ISSUE_PLACE_KEYWORDS = (
    (("hành chính", "ttxh"), ISSUE_PLACES[0]),
    (("hành chính", "trật tự"), ISSUE_PLACES[0]),
    (("cư trú", "dân cư"), ISSUE_PLACES[1]),
    (("bộ công an",), ISSUE_PLACES[2]),
)


def match_issue_place(value):
    """Tên cơ quan cấp nhận ra được từ chuỗi tự do, hoặc None."""
    text = " ".join((value or "").lower().split())
    for keywords, name in _ISSUE_PLACE_KEYWORDS:
        if all(k in text for k in keywords):
            return name
    return None


def normalize_issue_place(value):
    """Nơi cấp in lên giấy: nhận ra được thì dùng tên chuẩn, không thì mặc định."""
    return match_issue_place(value) or ISSUE_PLACE_DEFAULT


def check_issue_place(value):
    """Nơi cấp sinh viên/chuyên viên chọn — phải là một trong ISSUE_PLACES. Trả tên chuẩn."""
    name = match_issue_place(value)
    if name is None:
        raise ValueError("Nơi cấp CCCD không hợp lệ.")
    return name
