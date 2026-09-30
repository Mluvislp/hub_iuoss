"""API "Hỏi đáp" (ticket) — nghiệp vụ ở `core/tickets.py`.

Mọi truy vấn lọc theo `student_id` lấy từ JWT do server ký ⇒ id trên URL không mở
được ticket của người khác. Sinh viên không tự đóng ticket — chỉ chuyên viên đóng.

"Realtime" = polling: trang chi tiết gọi `GET tickets/<id>/?after=<id lượt cuối>`
mỗi 5 giây khi tab đang mở; sidebar gọi `tickets/unread/` mỗi phút. Hai endpoint này
không throttle và chỉ chạy một truy vấn có chỉ mục.
"""
import logging

from django.conf import settings
from django.db.models import Count
from django.http import FileResponse, Http404
from rest_framework import status
from rest_framework.exceptions import NotFound
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from core import richtext, tickets
from core.insurance_contract import safe_path
from core.ticket_models import SupportTicket, TicketAttachment, TicketMessage

from .authentication import IsHubAuthenticated

logger = logging.getLogger(__name__)


class TicketsRequiredMixin:
    """404 cho mọi method khi FEATURE_SUPPORT_TICKETS tắt — tính năng chưa mở thì endpoint biến mất."""

    permission_classes = [IsHubAuthenticated]

    def initial(self, request, *args, **kwargs):
        if not settings.FEATURE_SUPPORT_TICKETS:
            raise NotFound("Chức năng hỏi đáp đang tạm ngưng.")
        super().initial(request, *args, **kwargs)

    def own_ticket(self, request, pk):
        ticket = (SupportTicket.objects.select_related("topic__parent")
                  .filter(pk=pk, student_id=request.user.student_id).first())
        if ticket is None:
            raise NotFound("Không tìm thấy ticket.")
        return ticket


def _error(exc):
    body = {"detail": str(exc)}
    if getattr(exc, "field", None):
        body["errors"] = {exc.field: str(exc)}
    return Response(body, status=status.HTTP_400_BAD_REQUEST)


def _attachment(att):
    return {
        "id": att.id,
        "name": att.original_filename,
        "size": att.file_size_bytes,
        "mime_type": att.mime_type,
        "is_pdf": att.mime_type == tickets.PDF_MIME,
    }


def _message(msg):
    return {
        "id": msg.id,
        "author_role": msg.author_role,
        # Chuyên viên hiện tên thật (sinh viên cần biết ai đang trả lời mình).
        "author_name": msg.author_name,
        "body": msg.body,
        # Tin chuyên viên soạn bằng editor ⇒ HTML. Lọc lại ở đây (lớp phòng thủ thứ hai) —
        # frontend chỉ render `body_html`, không bao giờ render `body` như HTML.
        "body_html": richtext.sanitize(msg.body) if msg.author_role == TicketMessage.ROLE_STAFF else "",
        "created_at": msg.created_at,
        "attachments": [_attachment(a) for a in msg.attachments.all()],
    }


def _ticket_summary(ticket):
    return {
        "id": ticket.id,
        "subject": ticket.subject,
        "topic": {"id": ticket.topic_id, "name": ticket.topic.full_name},
        "status": ticket.status,
        "status_label": ticket.status_label,
        "unread": ticket.unread_for_student,
        "created_at": ticket.created_at,
        "updated_at": ticket.updated_at,
        "closed_at": ticket.closed_at,
    }


def _visible_messages(ticket, after=0):
    return (TicketMessage.objects.filter(ticket=ticket, id__gt=after)
            .prefetch_related("attachments").order_by("id"))


def _detail(ticket, messages):
    return {
        **_ticket_summary(ticket),
        "can_reply": ticket.status != SupportTicket.STATUS_CLOSED,
        "messages": [_message(m) for m in messages],
        "max_files": tickets.MAX_FILES,
    }


class TicketTopicsView(TicketsRequiredMixin, APIView):
    """Các mảng đang nhận ticket (form tạo mới)."""

    def get(self, request):
        return Response(tickets.topic_tree())


class TicketsView(TicketsRequiredMixin, APIView):
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_throttles(self):
        # Chỉ tạo mới mới bị giới hạn; GET danh sách thì không.
        self.throttle_scope = "ticket_create" if self.request.method == "POST" else None
        return super().get_throttles() if self.throttle_scope else []

    def get(self, request):
        rows = (SupportTicket.objects.filter(student_id=request.user.student_id)
                .select_related("topic__parent")
                .annotate(message_count=Count("messages"))
                .order_by("-updated_at", "-id")[:200])
        data = []
        for t in rows:
            item = _ticket_summary(t)
            item["message_count"] = t.message_count
            data.append(item)
        return Response(data)

    def post(self, request):
        if not request.user.student_id:
            return Response({"detail": "Không tìm thấy hồ sơ sinh viên."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            ticket = tickets.create_ticket(
                request.user,
                topic_id=request.data.get("topic_id"),
                subject=request.data.get("subject"),
                body=request.data.get("body"),
                uploads=request.FILES.getlist("files"),
            )
        except tickets.TicketError as exc:
            return _error(exc)
        return Response({"id": ticket.id}, status=status.HTTP_201_CREATED)


class TicketUnreadView(TicketsRequiredMixin, APIView):
    """Số ticket có phản hồi mới chưa xem — badge ở sidebar."""

    def get(self, request):
        return Response({"count": tickets.unread_count(request.user.student_id)})


class TicketDetailView(TicketsRequiredMixin, APIView):
    """Chi tiết + polling. `?after=<id>` chỉ trả lượt mới; `seen=0` khi tab đang ẩn."""

    def get(self, request, pk):
        ticket = self.own_ticket(request, pk)
        try:
            after = max(0, int(request.query_params.get("after") or 0))
        except ValueError:
            after = 0
        messages = list(_visible_messages(ticket, after))
        if request.query_params.get("seen") != "0" and ticket.unread_for_student:
            tickets.mark_student_read(ticket)
        return Response(_detail(ticket, messages))


class TicketMessagesView(TicketsRequiredMixin, APIView):
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    throttle_scope = "ticket_message"

    def post(self, request, pk):
        ticket = self.own_ticket(request, pk)
        try:
            ticket, message = tickets.student_reply(
                request.user, ticket, body=request.data.get("body"),
                uploads=request.FILES.getlist("files"))
        except tickets.TicketError as exc:
            return _error(exc)
        message = TicketMessage.objects.prefetch_related("attachments").get(pk=message.pk)
        return Response({"message": _message(message), **_ticket_summary(ticket),
                         "can_reply": True}, status=status.HTTP_201_CREATED)


class TicketAttachmentView(TicketsRequiredMixin, APIView):
    """File đính kèm của CHÍNH sinh viên — cần token nên frontend tải qua fetch."""

    def get(self, request, pk, att_id):
        ticket = self.own_ticket(request, pk)
        att = TicketAttachment.objects.filter(pk=att_id, ticket=ticket).first()
        path = safe_path(settings.MEDIA_ROOT, att.storage_key) if att else None
        if path is None:
            raise Http404
        response = FileResponse(open(path, "rb"), content_type=att.mime_type,
                                filename=att.original_filename)
        response["X-Content-Type-Options"] = "nosniff"
        response["Cache-Control"] = "private, no-store"
        return response
