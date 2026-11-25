"""API "Sự kiện cộng tác viên" — nghiệp vụ ở `core/volunteer_events.py`."""
import logging
import mimetypes

from django.conf import settings
from django.http import FileResponse, Http404
from rest_framework import status
from rest_framework.exceptions import NotFound
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from core import volunteer_events as ve
from students.models import Student

from .authentication import IsHubAuthenticated

logger = logging.getLogger(__name__)


class VolunteerRequiredMixin:
    """404 cho mọi method khi FEATURE_VOLUNTEER_EVENTS tắt."""

    permission_classes = [IsHubAuthenticated]

    def initial(self, request, *args, **kwargs):
        if not settings.FEATURE_VOLUNTEER_EVENTS:
            raise NotFound('Chức năng sự kiện cộng tác viên đang tạm ngưng.')
        super().initial(request, *args, **kwargs)

    def student(self, request):
        s = (Student.objects.select_related('current_department').filter(pk=request.user.student_id).first()
             if request.user.student_id else None)
        if s is None:
            raise Http404
        return s

    def event(self, student, pk):
        e = ve.get_event(student, pk)
        if e is None:
            raise Http404
        return e


def _error(exc):
    body = {'detail': str(exc)}
    if exc.errors:
        body['errors'] = exc.errors
    code = status.HTTP_409_CONFLICT if exc.code in ('closed', 'conflict') else status.HTTP_400_BAD_REQUEST
    return Response(body, status=code)


class PublicVolunteerMixin:
    """Trang công khai của link / QR chia sẻ: không cần đăng nhập, không đọc token (token hỏng không làm 401)."""

    authentication_classes = []
    permission_classes = [AllowAny]

    def initial(self, request, *args, **kwargs):
        if not settings.FEATURE_VOLUNTEER_EVENTS:
            raise NotFound('Không tìm thấy sự kiện.')
        super().initial(request, *args, **kwargs)

    def event(self, pk):
        e = ve.public_event(pk)
        if e is None:
            raise Http404
        return e


class PublicVolunteerEventView(PublicVolunteerMixin, APIView):
    def get(self, request, pk):
        return Response(ve.serialize_public(self.event(pk)))


class PublicVolunteerCoverView(PublicVolunteerMixin, APIView):
    def get(self, request, pk):
        path = ve.public_cover_path(self.event(pk))
        if path is None:
            raise Http404
        response = FileResponse(path.open('rb'), content_type=mimetypes.guess_type(path.name)[0] or 'image/jpeg')
        response['Cache-Control'] = 'public, max-age=3600'
        response['X-Content-Type-Options'] = 'nosniff'
        return response


class VolunteerEventListView(VolunteerRequiredMixin, APIView):
    def get(self, request):
        return Response({'events': ve.list_for(self.student(request))})


class VolunteerEventDetailView(VolunteerRequiredMixin, APIView):
    def get(self, request, pk):
        student = self.student(request)
        return Response(ve.serialize_detail(student, self.event(student, pk)))


class VolunteerRegisterView(VolunteerRequiredMixin, APIView):
    """POST multipart: `answers` (JSON) · `profile` (JSON) · `file:<id câu>` (nhiều file) · `keep:<id câu>` (JSON chỉ số file cũ giữ lại)."""

    parser_classes = [MultiPartParser, FormParser, JSONParser]
    throttle_scope = 'create_request'

    def post(self, request, pk):
        student = self.student(request)
        event = self.event(student, pk)
        try:
            reg = ve.submit(student, event, request.data, request.FILES)
        except ve.VolunteerError as exc:
            return _error(exc)
        logger.info('VOLUNTEER_REGISTER | uid=%s | student_id=%s | event=%s | reg=%s',
                    request.user.ldap_uid, student.pk, event.pk, reg.pk)
        return Response(ve.serialize_detail(student, event))


class VolunteerCancelView(VolunteerRequiredMixin, APIView):
    def post(self, request, pk):
        student = self.student(request)
        event = self.event(student, pk)
        try:
            ve.cancel(student, event)
        except ve.VolunteerError as exc:
            return _error(exc)
        logger.info('VOLUNTEER_CANCEL | uid=%s | student_id=%s | event=%s', request.user.ldap_uid, student.pk, event.pk)
        return Response(ve.serialize_detail(student, event))


class VolunteerMediaView(VolunteerRequiredMixin, APIView):
    """Ảnh bìa, ảnh ghi chú câu hỏi, file SV đã nộp — chỉ của sự kiện SV được thấy."""

    def get(self, request, pk):
        student = self.student(request)
        path = ve.media_path(student, self.event(student, pk), request.query_params.get('key', ''))
        if path is None:
            raise Http404
        response = FileResponse(path.open('rb'), content_type=mimetypes.guess_type(path.name)[0] or 'application/octet-stream')
        response['Cache-Control'] = 'private, max-age=3600'
        response['X-Content-Type-Options'] = 'nosniff'
        return response
