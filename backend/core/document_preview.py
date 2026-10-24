"""Bản xem trước giấy tờ cho sinh viên — Hub xin ảnh từ Dashboard, không tự dựng giấy.

Mẫu .docx + luật dựng nội dung giấy (registry) chỉ có ở Dashboard; chép sang Hub là hai bản
trôi khỏi nhau. Vì vậy đây là NGOẠI LỆ DUY NHẤT của luật "hai app không gọi API của nhau":
Hub backend gọi `POST {DASHBOARD_INTERNAL_URL}/documents/internal/preview/` (cổng nội bộ trên
cùng máy chủ, không qua Internet) kèm token chung `DOCUMENT_PREVIEW_TOKEN`.

Dashboard trả ảnh JPEG từng trang đã đóng dấu chìm "BẢN XEM TRƯỚC — KHÔNG CÓ GIÁ TRỊ SỬ DỤNG"
+ MSSV + giờ xem, độ phân giải thấp (dashboard `documents/preview.py`). Không có file PDF/DOCX
nào tới tay sinh viên. Không ghi gì vào DB ở cả hai phía.
"""
import json
import logging
import urllib.error
import urllib.request

from django.conf import settings

logger = logging.getLogger(__name__)

# Loại giấy Dashboard dựng từ mẫu .docx (dashboard documents/registry.DOCUMENT_TYPES).
# Bảng điểm rèn luyện dựng kiểu khác (conduct_sheet) — chưa hỗ trợ xem trước.
PREVIEW_TYPES = {"other", "deferment", "thuong_binh", "bank_loan", "english_form"}
TIMEOUT_SECONDS = 60


class PreviewUnavailable(Exception):
    pass


def enabled():
    return bool(settings.DASHBOARD_INTERNAL_URL and settings.DOCUMENT_PREVIEW_TOKEN)


def render(request_type, student_id, payload, viewer):
    """→ list ảnh base64 (JPEG). Raise PreviewUnavailable kèm câu báo lỗi đọc được."""
    if not enabled():
        raise PreviewUnavailable("Tính năng xem trước chưa được bật.")
    body = json.dumps({"request_type": request_type, "student_id": student_id,
                       "payload": payload, "viewer": viewer}, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        f"{settings.DASHBOARD_INTERNAL_URL}/documents/internal/preview/",
        data=body, method="POST",
        headers={"Content-Type": "application/json", "X-Preview-Token": settings.DOCUMENT_PREVIEW_TOKEN},
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        detail = ""
        try:
            detail = json.loads(exc.read()).get("error", "")
        except Exception:
            pass
        logger.warning("Xem trước giấy: Dashboard trả %s %s", exc.code, detail)
        raise PreviewUnavailable(detail if exc.code == 400 and detail else
                                 "Chưa tạo được bản xem trước. Vui lòng thử lại sau.")
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        logger.warning("Xem trước giấy: không gọi được Dashboard — %s", exc)
        raise PreviewUnavailable("Chưa tạo được bản xem trước. Vui lòng thử lại sau.")
    pages = data.get("pages") or []
    if not pages:
        raise PreviewUnavailable("Chưa tạo được bản xem trước. Vui lòng thử lại sau.")
    return pages
