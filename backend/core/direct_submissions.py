"""Nạp giấy tờ trực tiếp — phía sinh viên: form, tạo, sửa lúc "Chờ bổ sung", trao đổi.

Sinh viên khai lại thông tin cơ bản (ngày sinh + CCCD xin sửa được, chuyên viên duyệt ở Dashboard
như yêu cầu giấy tờ), ghi tên loại giấy tờ cần xét, số bản, SĐT liên hệ, tải lên tối đa 10 ảnh /
PDF và tích cam đoan. Không giới hạn số lần nạp (người dùng chốt 19/10/2026).

File lưu dưới MEDIA_ROOT của Hub: `direct_submissions/<năm>/<tháng>/<id>/<uuid>.<đuôi>` — Dashboard đọc
qua `HUB_MEDIA_ROOT` (cùng server, cùng user). Ảnh kiểm bằng nội dung thật (`insurance_files.inspect_upload`,
HEIC tự đổi sang JPEG), PDF kiểm chữ ký `%PDF-`.
"""

import hashlib
import logging
import re
from pathlib import Path
from uuid import uuid4

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from students.models import Student, StudentContactPoint
from students.timeline import infer_major_for_student, format_student_birth_date

from .documents import _cccd_fields, _cccd_prefill, _editable_field, validate_dob
from .insurance_contract import WorkflowError
from .insurance_files import inspect_upload
from .submission_models import DirectSubmission, SubmissionComment, SubmissionFile

logger = logging.getLogger(__name__)

MAX_FILES = 10
IMAGE_MAX_BYTES = 5 * 1024 * 1024        # cùng giới hạn ảnh của BHYT / hỏi đáp (insurance_files.MAX_BYTES)
PDF_MAX_BYTES = 10 * 1024 * 1024         # bản scan nhiều trang nặng hơn ảnh
TOTAL_MAX_BYTES = 50 * 1024 * 1024       # Nginx hub nhận tối đa 64 MB mỗi request
DOC_NAME_MAX = 200
NOTE_MAX = 1000
COPIES_MAX = 10
PDF_MIME = "application/pdf"
ROOT_DIR = "direct_submissions"
PHONE_RE = re.compile(r"^0(3|5|7|8|9)\d{8}$")   # cùng luật profile_changes.PHONE_RE

# Lượt trao đổi Hub tự ghi khi SV sửa lại yêu cầu lúc "Chờ bổ sung" (Dashboard gắn nhãn theo `event`).
EDIT_COMMENT = "Sinh viên đã cập nhật thông tin yêu cầu."
EDIT_EVENT = "student_edit"
FIELD_LABELS = {"dob": "Ngày sinh", "citizen_id": "Số CCCD", "citizen_id_issue_date": "Ngày cấp CCCD"}
# Khoá payload do Dashboard ghi — không trả cho sinh viên.
INTERNAL_PAYLOAD_KEYS = ("return_receipts", "return_reopens")


class SubmissionError(ValueError):
    """Lỗi dữ liệu sinh viên nhập — trả 400. `field` để frontend tô đỏ đúng ô."""

    def __init__(self, message, field=None):
        super().__init__(message)
        self.field = field


# ── Đọc hồ sơ ──────────────────────────────────────────────────────────────────────────

def load_student(student_id):
    if not student_id:
        return None
    return (Student.objects.select_related("current_department", "current_status", "admission_term")
            .filter(pk=student_id).first())


def _current_contact(student, contact_type):
    row = (StudentContactPoint.objects.filter(student=student, contact_type=contact_type, is_current=True)
           .order_by("-id").first())
    return (row.contact_value or "").strip() if row else ""


def _snapshot(student):
    major = infer_major_for_student(student)
    return {
        "student_name": student.full_name or "",
        "student_id": student.current_student_code or "",
        "department": student.current_department.name_vi if student.current_department else "",
        "major": major.name_vi if major else "",
        "class_code": (student.class_code or "").strip(),
        "cur_status_group": student.current_status.status_group if student.current_status else "",
        "cur_status_vi": student.current_status.name_vi if student.current_status else "",
    }


def build_prefill(student):
    """Dữ liệu đổ form: phần chỉ xem + ngày sinh + CCCD (xin sửa được) + SĐT liên hệ."""
    data = _snapshot(student)
    data.update({
        "dob": format_student_birth_date(student),
        "phone": _current_contact(student, StudentContactPoint.TYPE_MOBILE_PHONE),
        "email": _current_contact(student, StudentContactPoint.TYPE_UNIVERSITY_EMAIL),
    })
    data.update(_cccd_prefill(student))
    return data


def form_limits():
    return {
        "max_files": MAX_FILES, "image_max_bytes": IMAGE_MAX_BYTES, "pdf_max_bytes": PDF_MAX_BYTES,
        "total_max_bytes": TOTAL_MAX_BYTES, "document_name_max": DOC_NAME_MAX, "note_max": NOTE_MAX,
        "copies_max": COPIES_MAX,
    }


# ── Kiểm dữ liệu form ──────────────────────────────────────────────────────────────────

def _text(data, key):
    v = data.get(key)
    return v.strip() if isinstance(v, str) else ""


def clean_fields(data):
    """Các cột thường: tên giấy tờ, số bản, SĐT, ghi chú, cam đoan."""
    name = " ".join(_text(data, "document_name").split())
    if not name:
        raise SubmissionError("Vui lòng nhập tên loại giấy tờ cần xét.", "document_name")
    if len(name) > DOC_NAME_MAX:
        raise SubmissionError(f"Tên giấy tờ quá dài (tối đa {DOC_NAME_MAX} ký tự).", "document_name")

    raw_copies = _text(data, "copies") or "1"
    if not raw_copies.isdigit() or not 1 <= int(raw_copies) <= COPIES_MAX:
        raise SubmissionError(f"Số bản phải từ 1 đến {COPIES_MAX}.", "copies")

    phone = re.sub(r"[\s.\-()]", "", _text(data, "phone"))
    if phone.startswith("+84"):
        phone = "0" + phone[3:]
    elif phone.startswith("84") and len(phone) == 11:
        phone = "0" + phone[2:]
    if not PHONE_RE.match(phone):
        raise SubmissionError("Số điện thoại không hợp lệ — cần 10 chữ số, bắt đầu bằng 03, 05, 07, 08 hoặc 09.",
                              "phone")

    note = _text(data, "note")
    if len(note) > NOTE_MAX:
        raise SubmissionError(f"Ghi chú quá dài (tối đa {NOTE_MAX} ký tự).", "note")

    if _text(data, "consent") not in ("1", "true", "on"):
        raise SubmissionError("Vui lòng tích vào ô cam đoan trước khi gửi yêu cầu.", "consent")

    return {"document_name": name, "copies": int(raw_copies), "contact_phone": phone, "note": note or None}


def build_payload(student, data):
    """`snapshot` + `editable` (ngày sinh, CCCD, ngày cấp) — cùng contract với yêu cầu giấy tờ, để
    Dashboard dùng lại đúng đường duyệt / ghi hồ sơ gốc (documents/services.py)."""
    dob_field = _editable_field(format_student_birth_date(student), _text(data, "dob"))
    if dob_field["changed"]:
        try:
            validate_dob(dob_field["proposed"])
        except ValueError as exc:
            raise SubmissionError(str(exc), "dob") from exc
    try:
        cid_field, issue_field = _cccd_fields(student, _text(data, "citizen_id"),
                                              _text(data, "citizen_id_issue_date"))
    except ValueError as exc:
        field = "citizen_id_issue_date" if "ngày cấp" in str(exc).lower() else "citizen_id"
        raise SubmissionError(str(exc), field) from exc
    return {
        "doc_type": "direct_submission",
        "snapshot": _snapshot(student),
        "editable": {"dob": dob_field, "citizen_id": cid_field, "citizen_id_issue_date": issue_field},
    }


def _merge_payload(old, new):
    """Sửa lúc "Chờ bổ sung": ô chuyên viên ĐÃ DUYỆT giữ nguyên (đã ghi hồ sơ gốc, "hoàn tác" cần
    `original` cũ); khoá Dashboard ghi thì chép sang. Cùng luật core/request_edit.py."""
    merged = dict(new)
    for key, value in (old or {}).items():
        merged.setdefault(key, value)
    new_ed = dict(new.get("editable") or {})
    for field, info in ((old or {}).get("editable") or {}).items():
        if (info or {}).get("review") != "approved":
            continue
        fresh = new_ed.get(field)
        if fresh and fresh.get("changed") and fresh.get("proposed") != info.get("proposed"):
            raise SubmissionError(f"{FIELD_LABELS.get(field, field)} đã được Phòng CTSV duyệt nên không sửa lại được.",
                                  field)
        new_ed[field] = info
    merged["editable"] = new_ed
    return merged


# ── File ───────────────────────────────────────────────────────────────────────────────

def _check_pdf(upload):
    data = upload.read(PDF_MAX_BYTES + 1)
    upload.seek(0)
    if not data or len(data) > PDF_MAX_BYTES:
        raise SubmissionError(f"“{upload.name}”: mỗi file PDF tối đa {PDF_MAX_BYTES // (1024 * 1024)} MB.", "files")
    if not data.startswith(b"%PDF-"):
        raise SubmissionError(f"“{upload.name}” không phải PDF hợp lệ.", "files")
    return data, "pdf", PDF_MIME, hashlib.sha256(data).hexdigest()


def check_files(uploads, *, keep_count=0, keep_bytes=0):
    """Kiểm TẤT CẢ file trước khi ghi gì xuống DB. Trả [(upload, (data, ext, mime, sha256))]."""
    uploads = [u for u in uploads if u]
    if keep_count + len(uploads) > MAX_FILES:
        raise SubmissionError(f"Chỉ tải lên tối đa {MAX_FILES} file.", "files")
    out, total = [], keep_bytes
    for upload in uploads:
        head = upload.read(5)
        upload.seek(0)
        if head.startswith(b"%PDF-"):
            checked = _check_pdf(upload)
        else:
            try:
                checked = inspect_upload(upload)
            except WorkflowError as exc:
                raise SubmissionError(f"“{upload.name}”: {exc} Chỉ nhận ảnh hoặc PDF.", "files") from exc
        total += len(checked[0])
        out.append((upload, checked))
    if total > TOTAL_MAX_BYTES:
        raise SubmissionError(f"Tổng dung lượng file vượt {TOTAL_MAX_BYTES // (1024 * 1024)} MB.", "files")
    if keep_count + len(out) == 0:
        raise SubmissionError("Vui lòng tải lên ít nhất một ảnh chụp hoặc bản scan giấy tờ.", "files")
    return out


def _storage_dir(sub):
    created = timezone.localtime(sub.created_at)
    return f"{ROOT_DIR}/{created:%Y}/{created:%m}/{sub.pk}"


def _store_files(sub, checked, written, now):
    root = Path(settings.MEDIA_ROOT).resolve()
    for upload, (data, ext, mime, digest) in checked:
        key = f"{_storage_dir(sub)}/{uuid4().hex}.{ext}"
        target = root / key
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("xb") as stream:     # tên ngẫu nhiên + 'x' ⇒ không bao giờ ghi đè
            written.append(target)
            stream.write(data)
        raw_name = Path((upload.name or "file").replace("\\", "/")).name
        # HEIC đã đổi sang JPEG ⇒ đổi đuôi tên hiển thị cho khớp nội dung thật.
        name = raw_name if raw_name.lower().endswith("." + ext) else f"{Path(raw_name).stem}.{ext}"
        SubmissionFile.objects.create(
            submission=sub, storage_key=key, original_filename=name[:255], mime_type=mime,
            file_size_bytes=len(data), sha256=digest, created_at=now,
        )


def _cleanup(paths):
    for path in paths:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            logger.warning("Không xoá được file mồ côi %s", path)


# ── Tạo / sửa / trao đổi ───────────────────────────────────────────────────────────────

def create(principal, data, uploads):
    student = load_student(principal.student_id)
    if student is None:
        raise SubmissionError("Không tìm thấy hồ sơ sinh viên.")
    fields = clean_fields(data)
    payload = build_payload(student, data)
    checked = check_files(uploads)
    written = []
    try:
        with transaction.atomic():
            now = timezone.now()
            sub = DirectSubmission.objects.create(
                student_id=student.pk, ldap_uid=principal.ldap_uid, payload=payload,
                status=DirectSubmission.STATUS_PENDING, consented_at=now, created_at=now, updated_at=now,
                **fields,
            )
            _store_files(sub, checked, written, now)
    except Exception:
        _cleanup(written)
        raise
    logger.info("DIRECT_SUBMISSION | uid=%-20s | sub=%s | files=%s", principal.ldap_uid, sub.pk, len(checked))
    return sub


def _remove_ids(data):
    raw = data.getlist("remove_file_ids") if hasattr(data, "getlist") else data.get("remove_file_ids") or []
    if isinstance(raw, str):
        raw = raw.split(",")
    out = set()
    for v in raw:
        v = str(v).strip()
        if v.isdigit():
            out.add(int(v))
    return out


def update(principal, pk, data, uploads):
    """SV sửa lại yêu cầu đang "Chờ bổ sung thông tin": đổi thông tin, gỡ / thêm file.
    Xong ⇒ về "Chờ xử lý" + một lượt trao đổi của SV (Dashboard hiện "SV đã phản hồi")."""
    student = load_student(principal.student_id)
    if student is None:
        raise SubmissionError("Không tìm thấy hồ sơ sinh viên.")
    fields = clean_fields(data)
    new_payload = build_payload(student, data)
    remove = _remove_ids(data)

    written = []
    try:
        with transaction.atomic():
            sub = (DirectSubmission.objects.select_for_update()
                   .filter(pk=pk, ldap_uid=principal.ldap_uid).first())
            if sub is None:
                raise LookupError
            if sub.status != DirectSubmission.STATUS_AWAITING_INFO:
                raise SubmissionError("Chỉ sửa được yêu cầu đang ở trạng thái “Chờ bổ sung thông tin”.")
            active = list(SubmissionFile.active_qs().filter(submission=sub))
            keep = [f for f in active if f.pk not in remove]
            checked = check_files(uploads, keep_count=len(keep),
                                  keep_bytes=sum(f.file_size_bytes for f in keep))
            now = timezone.now()
            sub.payload = _merge_payload(sub.payload, new_payload)
            for key, value in fields.items():
                setattr(sub, key, value)
            sub.status = DirectSubmission.STATUS_PENDING
            sub.consented_at = now
            sub.updated_at = now
            sub.save()
            SubmissionFile.objects.filter(submission=sub, pk__in=[f.pk for f in active if f.pk in remove]) \
                .update(is_removed=True)
            _store_files(sub, checked, written, now)
            SubmissionComment.objects.create(
                submission=sub, author_role=SubmissionComment.ROLE_STUDENT, author_user_id=None,
                author_name=(principal.full_name or principal.ldap_uid)[:255], body=EDIT_COMMENT,
                event=EDIT_EVENT, created_at=now,
            )
    except Exception:
        _cleanup(written)
        raise
    logger.info("DIRECT_SUBMISSION_EDIT | uid=%-20s | sub=%s | +%s -%s", principal.ldap_uid, sub.pk,
                len(checked), len(remove))
    return sub


MAX_COMMENT_LEN = 2000


def add_comment(principal, sub, body):
    if not sub.student_can_comment:
        raise SubmissionError(f"Không gửi được trao đổi khi yêu cầu ở trạng thái “{sub.get_status_display()}”.")
    body = (body or "").strip()
    if not body:
        raise SubmissionError("Vui lòng nhập nội dung trao đổi.", "body")
    if len(body) > MAX_COMMENT_LEN:
        raise SubmissionError(f"Nội dung quá dài (tối đa {MAX_COMMENT_LEN} ký tự).", "body")
    with transaction.atomic():
        now = timezone.now()
        comment = SubmissionComment.objects.create(
            submission=sub, author_role=SubmissionComment.ROLE_STUDENT, author_user_id=None,
            author_name=(principal.full_name or principal.ldap_uid)[:255], body=body, created_at=now,
        )
        # SV trả lời lúc "Chờ bổ sung" ⇒ việc quay về phía văn phòng (cùng luật yêu cầu giấy tờ).
        if sub.status == DirectSubmission.STATUS_AWAITING_INFO:
            sub.status = DirectSubmission.STATUS_PENDING
            sub.updated_at = now
            sub.save(update_fields=["status", "updated_at"])
    return comment


def public_payload(sub):
    payload = dict(sub.payload or {})
    for key in INTERNAL_PAYLOAD_KEYS:
        payload.pop(key, None)
    return payload


def latest_receipt(sub):
    rows = (sub.payload or {}).get("return_receipts")
    rows = [r for r in rows if isinstance(r, dict) and r.get("storage_key")] if isinstance(rows, list) else []
    return rows[-1] if rows else None
