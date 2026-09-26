"""Luật hợp lệ của số CCCD / Căn cước và ngày cấp.

(Khác `core/cccd.py` bên Hub — module đó đọc chuỗi mã QR trên thẻ.)

⚠️ BẢN SONG SINH — giữ giống hệt nhau:
    dashboard  students/cccd_rules.py
    hub        backend/core/cccd_rules.py
    hub        frontend/lib/form-validators.ts (validateCccd / validateIssueDate)
Sửa một nơi phải sửa cả ba.

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
