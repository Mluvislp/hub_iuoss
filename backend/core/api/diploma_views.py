"""API "Nộp bằng tốt nghiệp THPT" — nghiệp vụ ở `core/diploma.py`."""
import logging

from django.conf import settings
from django.http import FileResponse, Http404
from rest_framework import status
from rest_framework.exceptions import NotFound
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from core import diploma
from core.insurance_contract import WorkflowError
from students.models import Student

from .authentication import IsHubAuthenticated

logger = logging.getLogger(__name__)


class DiplomaRequiredMixin:
    """404 cho mọi method khi FEATURE_DIPLOMA tắt — tính năng chưa mở thì endpoint biến mất."""

    def initial(self, request, *args, **kwargs):
        if not settings.FEATURE_DIPLOMA:
            raise NotFound('Chức năng nộp bằng tốt nghiệp THPT đang tạm ngưng.')
        super().initial(request, *args, **kwargs)


def _student(request):
    if not request.user.student_id:
        return None
    return Student.objects.filter(pk=request.user.student_id).first()


class DiplomaView(DiplomaRequiredMixin, APIView):
    """GET trạng thái + dữ liệu điền sẵn · POST multipart nộp mới / sửa / gửi lại."""

    permission_classes = [IsHubAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def get_throttles(self):
        if self.request.method == 'POST':
            self.throttle_scope = 'create_request'
            return super().get_throttles()
        return []

    def get(self, request):
        student = _student(request)
        if student is None:
            raise Http404
        return Response(diploma.build_state(student))

    def post(self, request):
        student = _student(request)
        if student is None:
            raise Http404
        try:
            sub = diploma.submit(student, request.data, request.FILES)
        except diploma.DiplomaError as exc:
            body = {'detail': str(exc)}
            if exc.errors:
                body['errors'] = exc.errors
            code = status.HTTP_409_CONFLICT if exc.code in ('conflict', 'closed') else status.HTTP_400_BAD_REQUEST
            return Response(body, status=code)
        except WorkflowError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        logger.info('DIPLOMA_SUBMIT | uid=%s | student_id=%s | submission=%s | status=%s | v=%s',
                    request.user.ldap_uid, student.pk, sub.pk, sub.status, sub.row_version)
        return Response(diploma.build_state(student), status=status.HTTP_200_OK)


class DiplomaFileView(DiplomaRequiredMixin, APIView):
    """GET ảnh CCCD / bản scan PDF trong hồ sơ của CHÍNH SV."""

    permission_classes = [IsHubAuthenticated]

    def get(self, request, field):
        student = _student(request)
        if student is None:
            raise Http404
        path, mime = diploma.file_path(student, field)
        if path is None:
            raise Http404
        response = FileResponse(path.open('rb'), content_type=mime or 'application/octet-stream')
        response['Cache-Control'] = 'private, no-store'
        response['X-Content-Type-Options'] = 'nosniff'
        return response
