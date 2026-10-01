"""Sinh viên sửa lại yêu cầu giấy tờ khi chuyên viên chuyển sang "Chờ bổ sung thông tin".

Payload mới dựng bằng đúng hàm build_*_payload như lúc tạo (RequestsView), rồi gộp
với payload cũ ở đây:

- Ô chuyên viên ĐÃ DUYỆT giữ nguyên: lúc duyệt Dashboard đã ghi giá trị vào hồ sơ
  gốc, và "hoàn tác" cần `original` cũ để khôi phục. SV xin đổi lại ô đó ⇒ từ chối.
- Khóa payload do Dashboard ghi (`exports`, `quota_exempt`, `staff_fields`…) mà
  builder không sinh ra thì chép sang, không để mất.

Sửa xong ⇒ yêu cầu về "Đang xử lý" + một lượt trao đổi của SV, giống lúc SV trả lời
(RequestCommentsView), để Dashboard thấy "SV đã phản hồi".
"""
from rest_framework.exceptions import ParseError

from core.models import ConfirmationRequest, ConfirmationRequestComment

# Loại giấy có form riêng trên Hub ⇒ sửa được. Loại cũ (chỉ mục đích tự do) thì không.
EDITABLE_TYPES = ("other", "deferment", "thuong_binh", "bank_loan", "english_form", "conduct_score")

FIELD_LABELS = {
    "dob": "Ngày sinh",
    "citizen_id": "Số CCCD",
    "citizen_id_issue_date": "Ngày cấp CCCD",
    "permanent_address": "Địa chỉ thường trú",
    "class_code": "Mã lớp",
}

EDIT_COMMENT = "Sinh viên đã cập nhật thông tin yêu cầu."


def can_student_edit(req):
    return (req.status == ConfirmationRequest.STATUS_AWAITING_INFO
            and req.request_type in EDITABLE_TYPES)


def _merge_payload(old, new):
    merged = dict(new)
    for key, value in old.items():
        merged.setdefault(key, value)

    old_ed = old.get("editable") or {}
    new_ed = dict(new.get("editable") or {})
    for field, info in old_ed.items():
        if info.get("review") != "approved":
            continue
        fresh = new_ed.get(field)
        if fresh and fresh.get("changed") and fresh.get("proposed") != info.get("proposed"):
            label = FIELD_LABELS.get(field, field)
            raise ParseError(f"{label} đã được Phòng CTSV duyệt nên không sửa lại được.")
        new_ed[field] = info
    if new_ed:
        merged["editable"] = new_ed
    return merged


def apply_student_edit(req, request, fields):
    """Ghi đè `req` (đã khóa dòng) bằng dữ liệu form mới. Trả về `req`."""
    if fields.get("request_type") != req.request_type:
        raise ParseError("Không đổi được loại giấy của yêu cầu.")

    old = req.payload or {}
    new = fields.get("payload")
    if new is not None:
        if req.request_type == "conduct_score":
            old_sem = (old.get("purpose") or {}).get("code")
            if old_sem and (new.get("purpose") or {}).get("code") != old_sem:
                raise ParseError("Không đổi được học kỳ của yêu cầu bảng điểm rèn luyện.")
        req.payload = _merge_payload(old, new)

    req.purpose = fields["purpose"]
    req.note = fields.get("note")
    req.status = ConfirmationRequest.STATUS_PROCESSING
    req.save(update_fields=["payload", "purpose", "note", "status", "updated_at"])

    ConfirmationRequestComment.objects.create(
        request=req,
        author_role=ConfirmationRequestComment.ROLE_STUDENT,
        author_user_id=None,
        author_name=request.user.full_name or request.user.ldap_uid,
        body=EDIT_COMMENT,
    )
    return req
