"""Mã hiển thị của yêu cầu nạp giấy tờ trực tiếp: `NG-YYMM-XXXXX`.

Cùng cách làm với mã giấy tờ `GT-…` (documents/request_code.py, phương án C 01/10/2026): YYMM =
năm-tháng gửi (giờ VN), 5 ký tự Crockford base32 = ID nội bộ qua hoán vị Feistel có khoá — không lộ
số lượng, không đoán được mã kế tiếp, giải ngược được để tìm kiếm. Không lưu cột nào.

  NG     tiền tố: Nạp Giấy tờ trực tiếp (bảng `hub_direct_submissions`, ID đếm riêng)

Khoá RIÊNG với mã GT: hai bảng có ID trùng nhau (#5 giấy tờ ≠ #5 nạp giấy), khác khoá thì phần
đuôi cũng khác, nhìn đuôi không suy ra được mã bên kia.

⚠️ BẢN SAO GIỐNG HỆT của Dashboard `submissions/code.py`. Đổi khoá = đổi mọi mã đã gửi email; đừng đổi.
"""

import hashlib
import hmac
import re

from django.utils import timezone

PREFIX = "NG"
_KEY = b"iuoss-ng-direct-submission/v1/c41e8d"
# Crockford base32: bỏ I, L, O, U — đọc qua điện thoại không nhầm 0/O, 1/I/L.
_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
_ROUNDS = 4
# 2 nửa × 12 bit = 24 bit (16,7 triệu yêu cầu) ⇒ vừa 5 ký tự. Vượt thì tự sang 2 × 15 bit, 6 ký tự.
_HALVES = ((12, 5), (15, 6))
_CODE_RE = re.compile(r"^\s*#?\s*NG[-\s]?(\d{4})[-\s]?([0-9A-Za-z]{5,6})\s*$", re.I)


def _round(half_bits, rnd, value):
    msg = f"{half_bits}:{rnd}:{value}".encode()
    digest = hmac.new(_KEY, msg, hashlib.sha256).digest()
    return int.from_bytes(digest[:4], "big") & ((1 << half_bits) - 1)


def _permute(n, half_bits, inverse=False):
    mask = (1 << half_bits) - 1
    left, right = n >> half_bits, n & mask
    rounds = range(_ROUNDS - 1, -1, -1) if inverse else range(_ROUNDS)
    for r in rounds:
        if inverse:
            left, right = right ^ _round(half_bits, r, left), left
        else:
            left, right = right, left ^ _round(half_bits, r, right)
    return (left << half_bits) | right


def _b32(n, width):
    out = []
    for _ in range(width):
        out.append(_ALPHABET[n & 31])
        n >>= 5
    return "".join(reversed(out))


def _from_b32(text):
    n = 0
    for ch in text.upper().replace("O", "0").replace("I", "1").replace("L", "1"):
        idx = _ALPHABET.find(ch)
        if idx < 0:
            return None
        n = n * 32 + idx
    return n


def encode(pk, created_at=None):
    """ID nội bộ → `NG-2610-K7Q3M`."""
    if pk is None:
        return ""
    for half_bits, width in _HALVES:
        if pk < (1 << (2 * half_bits)):
            body = _b32(_permute(pk, half_bits), width)
            break
    else:
        return f"{PREFIX}-{pk}"
    when = timezone.localtime(created_at) if created_at else timezone.localtime()
    return f"{PREFIX}-{when:%y%m}-{body}"


def decode(code):
    """`NG-2610-K7Q3M` (hoa/thường, có/không gạch) → (ID nội bộ, 'YYMM'), hoặc None nếu không phải mã."""
    m = _CODE_RE.match(code or "")
    if not m:
        return None
    yymm, body = m.group(1), m.group(2)
    n = _from_b32(body)
    if n is None:
        return None
    half_bits = dict((w, h) for h, w in _HALVES).get(len(body))
    if half_bits is None or n >= (1 << (2 * half_bits)):
        return None
    return _permute(n, half_bits, inverse=True), yymm
