"""Ticket hỏi đáp — phía sinh viên: tạo, nhắn thêm, đóng, đánh dấu đã đọc.

Luật trạng thái giữ khớp Dashboard `support/services.py`:
  tạo ticket / sinh viên nhắn      → open      (chờ Phòng CTSV)
  chuyên viên trả lời (Dashboard)  → answered  (chờ sinh viên)
  chuyên viên đóng (Dashboard)     → closed    (sinh viên không nhắn thêm được)

Email: Hub KHÔNG gửi thư. Hub chỉ INSERT vào hàng đợi dùng chung `email_messages`;
timer `send_emails` của Dashboard gửi đi và tự đính file (tra theo `object_id`).
"""

import hashlib
import logging
from pathlib import Path
from uuid import uuid4

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import F, Q
from django.template.loader import render_to_string
from django.utils import timezone

from students.models import Student

from .insurance_contract import WorkflowError
from .insurance_files import MAX_BYTES, inspect_upload
from .ticket_models import OutboundEmail, SupportTicket, TicketAttachment, TicketMessage, TicketTopic

logger = logging.getLogger(__name__)

MAX_FILES = 2
MAX_SUBJECT = 200
MIN_SUBJECT = 5
MAX_BODY = 5000
# Chặn spam: quá số này ticket đang mở thì phải chờ trả lời / đóng bớt.
MAX_OPEN_TICKETS = 5
PDF_MIME = "application/pdf"

EVENT_CREATED = "support_ticket.created"
EVENT_STUDENT_REPLY = "support_ticket.student_reply"


class TicketError(Exception):
    """Lỗi dữ liệu sinh viên nhập — trả 400. `field` để frontend gắn lỗi đúng ô."""

    def __init__(self, message, field=None):
        super().__init__(message)
        self.field = field


# ── File đính kèm ────────────────────────────────────────────────────────────

def _check_pdf(upload):
    data = upload.read(MAX_BYTES + 1)
    upload.seek(0)
    if not data or len(data) > MAX_BYTES:
        raise TicketError("Mỗi file tối đa 5 MB.", "files")
    # Kiểm chữ ký thật của file, không tin đuôi/Content-Type do trình duyệt gửi.
    if not data.startswith(b"%PDF-"):
        raise TicketError(f"“{upload.name}” không phải PDF hợp lệ.", "files")
    return data, "pdf", PDF_MIME, hashlib.sha256(data).hexdigest()


def check_files(uploads):
    """Kiểm TẤT CẢ file trước khi ghi gì xuống DB. Trả [(upload, checked)]."""
    uploads = [u for u in uploads if u]
    if len(uploads) > MAX_FILES:
        raise TicketError(f"Chỉ đính kèm tối đa {MAX_FILES} file.", "files")
    out = []
    for upload in uploads:
        head = upload.read(5)
        upload.seek(0)
        if head.startswith(b"%PDF-"):
            checked = _check_pdf(upload)
        else:
            try:
                checked = inspect_upload(upload)
            except WorkflowError as exc:
                raise TicketError(f"“{upload.name}”: {exc} Chỉ nhận PDF hoặc ảnh.", "files") from exc
        out.append((upload, checked))
    return out


def _store_files(ticket, message, checked_files, written, now):
    root = Path(settings.MEDIA_ROOT).resolve()
    for upload, (data, ext, mime, digest) in checked_files:
        key = f"support_tickets/{ticket.pk}/{uuid4().hex}.{ext}"
        target = root / key
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("xb") as stream:   # tên ngẫu nhiên + 'x' ⇒ không bao giờ ghi đè
            written.append(target)
            stream.write(data)
        raw_name = Path((upload.name or "file").replace("\\", "/")).name
        # HEIC đã đổi sang JPEG ⇒ đổi đuôi tên hiển thị cho khớp nội dung thật.
        name = raw_name if raw_name.lower().endswith("." + ext) else f"{Path(raw_name).stem}.{ext}"
        TicketAttachment.objects.create(
            ticket=ticket, message=message, storage_key=key, original_filename=name[:255],
            mime_type=mime, file_size_bytes=len(data), sha256=digest, created_at=now,
        )


def _cleanup(paths):
    for path in paths:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            logger.warning("Không xoá được file mồ côi %s", path)


# ── Email cho người phụ trách ────────────────────────────────────────────────

def email_subject(ticket):
    """PHẢI giống hệt Dashboard `support/services.py::email_subject` — để Gmail gom luồng."""
    return f"Hub-Ticket #{ticket.pk} - {ticket.student_code} - {ticket.topic.name}"


def dashboard_ticket_url(ticket):
    return f"{settings.DASHBOARD_PUBLIC_URL}/support/{ticket.pk}/"


def _queue_staff_mail(ticket, message, *, event_key, student, attachments):
    """Xếp một thư cho MỖI địa chỉ phụ trách. Lỗi xếp thư không làm hỏng ticket."""
    recipients = ticket.topic.email_list
    if not recipients:
        logger.warning("Mảng %s chưa có email phụ trách — ticket #%s không báo ai", ticket.topic.code, ticket.pk)
        return 0

    now = timezone.now().replace(microsecond=0)   # MySQL làm tròn DATETIME — xem notifications/service.py
    body = render_to_string("emails/ticket_staff.html", {
        "is_new": event_key == EVENT_CREATED,
        "ticket": ticket,
        "topic_name": ticket.topic.name,
        "student": student,
        "department": getattr(getattr(student, "current_department", None), "name_vi", "") if student else "",
        "message": message,
        "attachments": attachments,
        "ticket_url": dashboard_ticket_url(ticket),
        "created_label": timezone.localtime(ticket.created_at).strftime("%d/%m/%Y %H:%M"),
        "message_label": timezone.localtime(message.created_at).strftime("%d/%m/%Y %H:%M"),
    })
    queued = 0
    for address in recipients:
        try:
            with transaction.atomic():   # savepoint: một dòng trùng không làm hỏng cả ticket
                OutboundEmail.objects.create(
                    to_email=address, bcc_emails=None, subject=email_subject(ticket)[:255], body=body,
                    event_key=event_key, object_id=f"{ticket.pk}-{message.pk}",
                    student_id=ticket.student_id, status=OutboundEmail.STATUS_PENDING, attempts=0,
                    scheduled_at=now, created_at=now, updated_at=now,
                )
            queued += 1
        except IntegrityError:
            pass   # UNIQUE (event_key, object_id, to_email): đã có sẵn
        except Exception:
            logger.exception("Không xếp được thư %s ticket #%s tới %s", event_key, ticket.pk, address)
    return queued


# ── Thao tác của sinh viên ───────────────────────────────────────────────────

def _clean_text(value, *, field, label, max_len, min_len=1):
    text = (value or "").strip() if isinstance(value, str) else ""
    if len(text) < min_len:
        raise TicketError(f"Nhập {label}." if min_len == 1 else f"{label.capitalize()} tối thiểu {min_len} ký tự.", field)
    if len(text) > max_len:
        raise TicketError(f"{label.capitalize()} tối đa {max_len} ký tự.", field)
    return text


def active_topics():
    return TicketTopic.objects.filter(is_active=True).order_by("sort_order", "id")


def create_ticket(principal, *, topic_id, subject, body, uploads):
    try:
        topic = active_topics().get(pk=int(topic_id))
    except (TypeError, ValueError, TicketTopic.DoesNotExist):
        raise TicketError("Chọn mảng cần trao đổi.", "topic_id")
    subject = _clean_text(subject, field="subject", label="tiêu đề", max_len=MAX_SUBJECT, min_len=MIN_SUBJECT)
    body = _clean_text(body, field="body", label="nội dung", max_len=MAX_BODY)
    checked = check_files(uploads)

    open_count = SupportTicket.objects.filter(
        student_id=principal.student_id,
    ).exclude(status=SupportTicket.STATUS_CLOSED).count()
    if open_count >= MAX_OPEN_TICKETS:
        raise TicketError(f"Đang có {open_count} ticket chưa đóng. Đóng bớt ticket đã được giải đáp "
                          "trước khi tạo ticket mới.")

    student = (Student.objects.select_related("current_department")
               .filter(pk=principal.student_id).first())
    written = []
    try:
        with transaction.atomic():
            now = timezone.now()
            ticket = SupportTicket.objects.create(
                topic=topic, student_id=principal.student_id,
                student_code=(principal.student_code or principal.ldap_uid)[:32],
                subject=subject, status=SupportTicket.STATUS_OPEN,
                last_student_message_at=now, student_read_at=now,
                created_at=now, updated_at=now,
            )
            message = TicketMessage.objects.create(
                ticket=ticket, author_role=TicketMessage.ROLE_STUDENT, author_user_id=None,
                author_name=(principal.full_name or principal.ldap_uid)[:255],
                body=body, created_at=now,
            )
            _store_files(ticket, message, checked, written, now)
            _queue_staff_mail(ticket, message, event_key=EVENT_CREATED, student=student,
                              attachments=list(message.attachments.all()))
    except Exception:
        _cleanup(written)
        raise
    logger.info("SUPPORT_TICKET | uid=%-20s | ticket=%s | topic=%s | files=%s",
                principal.ldap_uid, ticket.pk, topic.code, len(checked))
    return ticket


def student_reply(principal, ticket, *, body, uploads):
    body = _clean_text(body, field="body", label="nội dung", max_len=MAX_BODY)
    checked = check_files(uploads)
    student = (Student.objects.select_related("current_department")
               .filter(pk=principal.student_id).first())
    written = []
    try:
        with transaction.atomic():
            ticket = (SupportTicket.objects.select_for_update().select_related("topic")
                      .get(pk=ticket.pk, student_id=principal.student_id))
            if ticket.status == SupportTicket.STATUS_CLOSED:
                raise TicketError("Ticket đã đóng. Tạo ticket mới nếu cần hỏi tiếp.")
            was_answered = ticket.status == SupportTicket.STATUS_ANSWERED
            now = timezone.now()
            message = TicketMessage.objects.create(
                ticket=ticket, author_role=TicketMessage.ROLE_STUDENT, author_user_id=None,
                author_name=(principal.full_name or principal.ldap_uid)[:255],
                body=body, created_at=now,
            )
            _store_files(ticket, message, checked, written, now)
            ticket.status = SupportTicket.STATUS_OPEN
            ticket.last_student_message_at = now
            ticket.student_read_at = now
            ticket.updated_at = now
            ticket.save(update_fields=["status", "last_student_message_at", "student_read_at", "updated_at"])
            # Chỉ báo người phụ trách khi "bóng" vừa quay về phía văn phòng (ticket đang
            # "Đã phản hồi"). Ticket còn "Chờ phản hồi" thì thư báo trước chưa được xử lý —
            # nhắn thêm bao nhiêu cũng sẽ đọc cùng lúc, gửi thêm thư chỉ là làm ồn hộp thư.
            if was_answered:
                _queue_staff_mail(ticket, message, event_key=EVENT_STUDENT_REPLY, student=student,
                                  attachments=list(message.attachments.all()))
    except Exception:
        _cleanup(written)
        raise
    return ticket, message


def mark_student_read(ticket):
    """Không đụng `updated_at` — mốc đọc không phải hoạt động (cột cố ý không ON UPDATE)."""
    now = timezone.now()
    SupportTicket.objects.filter(pk=ticket.pk).update(student_read_at=now)
    ticket.student_read_at = now


def unread_count(student_id):
    return (SupportTicket.objects.filter(student_id=student_id, last_staff_message_at__isnull=False)
            .filter(Q(student_read_at__isnull=True) | Q(last_staff_message_at__gt=F("student_read_at")))
            .count())
