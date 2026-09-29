"""Ticket hỏi đáp sinh viên ↔ Phòng CTSV — model phía Hub.

Bốn bảng dùng chung với Dashboard (`support/models.py` bên đó), managed=False.
DDL: dashboard_iuoss/docs/sql/20260929_support_tickets.sql. Nghiệp vụ:
dashboard_iuoss/docs/SUPPORT_TICKETS.md.

Hub chỉ GHI: tạo ticket, lượt trao đổi của sinh viên, file đính kèm, mốc
`student_read_at`. Đóng / mở lại ticket là việc của chuyên viên (Dashboard).
"""

import re

from django.db import models

_EMAIL_SPLIT_RE = re.compile(r"[,;\s]+")


class TicketTopic(models.Model):
    code = models.CharField(max_length=32, unique=True)
    name = models.CharField(max_length=128)
    description = models.CharField(max_length=500, blank=True, null=True)
    notify_emails = models.TextField()
    sort_order = models.SmallIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        managed = False
        db_table = "support_ticket_topics"
        ordering = ["sort_order", "id"]

    def __str__(self):
        return self.name

    @property
    def email_list(self):
        seen, out = set(), []
        for part in _EMAIL_SPLIT_RE.split(self.notify_emails or ""):
            value = part.strip().lower()
            if value and value not in seen:
                seen.add(value)
                out.append(value)
        return out


class SupportTicket(models.Model):
    """Trạng thái giữ khớp `support.SupportTicket` bên Dashboard."""

    STATUS_OPEN = "open"
    STATUS_ANSWERED = "answered"
    STATUS_CLOSED = "closed"
    STATUS_LABELS = {
        STATUS_OPEN: "Chờ phản hồi",
        STATUS_ANSWERED: "Đã phản hồi",
        STATUS_CLOSED: "Đã đóng",
    }

    topic = models.ForeignKey(TicketTopic, on_delete=models.PROTECT, db_column="topic_id",
                              related_name="tickets")
    student_id = models.BigIntegerField()
    student_code = models.CharField(max_length=32)
    subject = models.CharField(max_length=200)
    status = models.CharField(max_length=16)
    last_student_message_at = models.DateTimeField(null=True, blank=True)
    last_staff_message_at = models.DateTimeField(null=True, blank=True)
    student_read_at = models.DateTimeField(null=True, blank=True)
    staff_read_at = models.DateTimeField(null=True, blank=True)
    first_response_at = models.DateTimeField(null=True, blank=True)
    closed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = "support_tickets"
        ordering = ["-updated_at"]

    @property
    def status_label(self):
        return self.STATUS_LABELS.get(self.status, self.status)

    @property
    def unread_for_student(self):
        last = self.last_staff_message_at
        return bool(last and (self.student_read_at is None or last > self.student_read_at))


class TicketMessage(models.Model):
    ROLE_STUDENT = "student"
    ROLE_STAFF = "staff"
    ROLE_SYSTEM = "system"

    ticket = models.ForeignKey(SupportTicket, on_delete=models.CASCADE, db_column="ticket_id",
                               related_name="messages")
    author_role = models.CharField(max_length=16)
    author_user_id = models.IntegerField(null=True, blank=True)
    author_name = models.CharField(max_length=255)
    body = models.TextField()
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = "support_ticket_messages"
        ordering = ["id"]


class TicketAttachment(models.Model):
    ticket = models.ForeignKey(SupportTicket, on_delete=models.CASCADE, db_column="ticket_id",
                               related_name="attachments")
    message = models.ForeignKey(TicketMessage, on_delete=models.CASCADE, db_column="message_id",
                                related_name="attachments")
    storage_key = models.CharField(max_length=255)
    original_filename = models.CharField(max_length=255)
    mime_type = models.CharField(max_length=64)
    file_size_bytes = models.PositiveIntegerField()
    sha256 = models.CharField(max_length=64)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = "support_ticket_attachments"
        ordering = ["id"]


class OutboundEmail(models.Model):
    """Hàng đợi email DÙNG CHUNG (`email_messages`) — Dashboard sở hữu bảng và gửi thư.

    Hub chỉ INSERT dòng `pending`; timer `send_emails` của Dashboard gửi đi, áp
    `EMAIL_REDIRECT_TO`/nhãn môi trường lúc gửi. Model rút gọn: chỉ các cột Hub ghi.
    """

    STATUS_PENDING = "pending"
    STATUS_SENDING = "sending"

    to_email = models.CharField(max_length=255)
    bcc_emails = models.JSONField(blank=True, null=True)
    subject = models.CharField(max_length=255)
    body = models.TextField()
    event_key = models.CharField(max_length=64)
    object_id = models.CharField(max_length=64, blank=True, null=True)
    student_id = models.BigIntegerField(blank=True, null=True)
    status = models.CharField(max_length=16)
    attempts = models.SmallIntegerField(default=0)
    scheduled_at = models.DateTimeField()
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = "email_messages"
