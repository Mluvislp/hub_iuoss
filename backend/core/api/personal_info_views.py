"""GET/POST /api/personal-info/ — trang "Thông tin cá nhân". Xem core/personal_info.py."""
import logging

from django.conf import settings
from rest_framework import status
from rest_framework.exceptions import NotFound
from rest_framework.response import Response
from rest_framework.views import APIView

from core import personal_info
from students.models import Student

from .authentication import IsHubAuthenticated

logger = logging.getLogger(__name__)


class PersonalInfoView(APIView):
    """404 cho mọi method khi FEATURE_PERSONAL_INFO tắt — tính năng chưa mở thì endpoint biến mất."""

    permission_classes = [IsHubAuthenticated]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if not settings.FEATURE_PERSONAL_INFO:
            raise NotFound()

    def _student(self, request):
        if not request.user.student_id:
            return None
        return (
            Student.objects.select_related("current_department")
            .filter(pk=request.user.student_id).first()
        )

    def get(self, request):
        student = self._student(request)
        if student is None:
            return Response({"detail": "Không tìm thấy hồ sơ sinh viên."},
                            status=status.HTTP_400_BAD_REQUEST)
        return Response(personal_info.build(student))

    def post(self, request):
        student = self._student(request)
        if student is None:
            return Response({"detail": "Không tìm thấy hồ sơ sinh viên."},
                            status=status.HTTP_400_BAD_REQUEST)
        groups = (request.data or {}).get("groups") if isinstance(request.data, dict) else None
        try:
            sent = personal_info.submit(student, groups)
        except personal_info.SubmitErrors as exc:
            return Response(
                {"detail": exc.errors.get("_") or "Vui lòng kiểm tra lại thông tin.",
                 "errors": {k: v for k, v in exc.errors.items() if k != "_"}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        logger.info("Thông tin cá nhân: SV id=%s gửi %s mục chờ duyệt", student.pk, sent)
        return Response({"sent": sent, **personal_info.build(student)})
