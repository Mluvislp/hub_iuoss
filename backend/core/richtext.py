"""Làm sạch HTML của tin nhắn chuyên viên + phản hồi chung (soạn bằng CKEditor).

Chỉ dùng thư viện chuẩn (`html.parser`) — venv hai repo không có bleach/nh3 và đây là
tập thẻ rất nhỏ. Cách làm: DỰNG LẠI HTML từ đầu, chỉ giữ thẻ/thuộc tính trong danh sách
cho phép, mọi chữ đều được escape. Không "xoá thẻ xấu" (dễ lọt), mà "chỉ chép thẻ tốt".

⚠️ BẢN SAO của Dashboard `support/richtext.py` — sửa cả hai. Hub lọc lại lần nữa trước khi
trả API dù Dashboard đã lọc lúc ghi (phòng thủ hai lớp: DB có thể bị ghi từ đường khác).
"""

import html
import re
from html.parser import HTMLParser

ALLOWED_TAGS = {"p", "br", "strong", "b", "em", "i", "u", "s", "ul", "ol", "li", "a", "blockquote"}
VOID_TAGS = {"br"}
# Thẻ bị bỏ CẢ nội dung bên trong (không chỉ bỏ vỏ).
DROP_WITH_CONTENT = {"script", "style", "iframe", "object", "embed", "template", "noscript", "svg", "math"}
_SAFE_HREF = re.compile(r"^(https?://|mailto:)", re.I)
_TAG_RE = re.compile(r"<[^>]+>")
_BLANK_P = re.compile(r"(<p>(\s|&nbsp;|<br>)*</p>\s*)+$")


class _Cleaner(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out = []
        self.open = []          # thẻ đã mở (đã cho phép) để tự đóng khi HTML lệch
        self.drop_depth = 0

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag in DROP_WITH_CONTENT:
            self.drop_depth += 1
            return
        if self.drop_depth or tag not in ALLOWED_TAGS:
            return
        if tag == "a":
            href = (dict(attrs).get("href") or "").strip()
            if not _SAFE_HREF.match(href):
                return            # link javascript:/data: … → bỏ vỏ, giữ chữ
            self.out.append(f'<a href="{html.escape(href, quote=True)}" target="_blank" rel="noopener noreferrer">')
        else:
            self.out.append(f"<{tag}>")
        if tag not in VOID_TAGS:
            self.open.append(tag)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag.lower() in self.open and tag.lower() not in VOID_TAGS:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag in DROP_WITH_CONTENT:
            self.drop_depth = max(0, self.drop_depth - 1)
            return
        if self.drop_depth or tag not in self.open:
            return
        # Đóng mọi thẻ mở sau nó (HTML lệch như <b><i></b>) để kết quả luôn cân.
        while self.open:
            last = self.open.pop()
            self.out.append(f"</{last}>")
            if last == tag:
                break

    def handle_data(self, data):
        if not self.drop_depth:
            self.out.append(html.escape(data, quote=False))

    def result(self):
        while self.open:
            self.out.append(f"</{self.open.pop()}>")
        return "".join(self.out)


def looks_like_html(text):
    return bool(text) and text.lstrip().startswith("<") and "</" in text


def sanitize(raw):
    """HTML an toàn để lưu/hiển thị. Chuỗi trơn (tin nhắn cũ) → escape + xuống dòng."""
    raw = raw or ""
    if not looks_like_html(raw):
        return plain_to_html(raw)
    cleaner = _Cleaner()
    cleaner.feed(raw)
    cleaner.close()
    return _BLANK_P.sub("", cleaner.result()).strip()


def plain_to_html(text):
    text = (text or "").strip()
    if not text:
        return ""
    paragraphs = re.split(r"\n\s*\n", text)
    return "".join("<p>" + html.escape(p).replace("\n", "<br>") + "</p>" for p in paragraphs)


def to_text(value):
    """Chữ thuần (đếm độ dài, xem trước, kiểm rỗng)."""
    if not looks_like_html(value or ""):
        return (value or "").strip()
    text = re.sub(r"(?i)<br\s*/?>|</p>|</li>|</blockquote>", "\n", value)
    text = html.unescape(_TAG_RE.sub("", text)).replace("\xa0", " ")
    return re.sub(r"\n{3,}", "\n\n", "\n".join(line.strip() for line in text.splitlines())).strip()
