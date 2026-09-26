"""API "Khám sức khỏe định kỳ" — nghiệp vụ ở `core/health_check.py`."""
import logging

from django.http import FileResponse, Http404
from rest_framework import status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from core import health_check
from students.models import Student

from .authentication import IsHubAuthenticated

logger = logging.getLogger(__name__)


def _student(request):
    if not request.user.student_id:
        return None
    return (
        Student.objects.select_related("current_department", "current_status")
        .filter(pk=request.user.student_id).first()
    )


def _no_student():
    return Response({"detail": "Không tìm thấy hồ sơ sinh viên."},
                    status=status.HTTP_400_BAD_REQUEST)


def _error(exc):
    code = status.HTTP_409_CONFLICT if exc.code in ("exists", "closed") else status.HTTP_400_BAD_REQUEST
    body = {"detail": str(exc)}
    if exc.errors:
        body["errors"] = exc.errors
    if exc.code:
        body["code"] = exc.code
    return Response(body, status=code)


class HealthCheckView(APIView):
    """GET — trạng thái đợt + phản hồi của SV + dữ liệu form khai báo."""

    permission_classes = [IsHubAuthenticated]

    def get(self, request):
        student = _student(request)
        if student is None:
            return _no_student()
        return Response(health_check.build_state(student))


class HealthCheckEvidenceView(APIView):
    """POST multipart `files` (1–3 ảnh) — nhánh "Đã khám rồi" / nộp lại."""

    permission_classes = [IsHubAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        student = _student(request)
        if student is None:
            return _no_student()
        try:
            resp = health_check.submit_evidence(student, request.FILES.getlist("files"))
        except health_check.HealthCheckError as exc:
            return _error(exc)
        logger.info("HEALTH_CHECK_EVIDENCE | uid=%s | student_id=%s | round=%s | count=%s",
                    request.user.ldap_uid, student.pk, resp.round_id, resp.submit_count)
        return Response(health_check.build_state(student), status=status.HTTP_201_CREATED)


class HealthCheckRegisterView(APIView):
    """POST JSON {declaration?, consent} — nhánh "Chưa khám"."""

    permission_classes = [IsHubAuthenticated]
    parser_classes = [JSONParser]

    def post(self, request):
        student = _student(request)
        if student is None:
            return _no_student()
        data = request.data if isinstance(request.data, dict) else {}
        try:
            resp = health_check.register(student, data)
        except health_check.HealthCheckError as exc:
            return _error(exc)
        logger.info("HEALTH_CHECK_REGISTER | uid=%s | student_id=%s | round=%s | declared_now=%s",
                    request.user.ldap_uid, student.pk, resp.round_id,
                    (resp.residence or {}).get("declared_with_registration"))
        return Response(health_check.build_state(student), status=status.HTTP_201_CREATED)


class HealthCheckEvidenceFileView(APIView):
    """GET ảnh minh chứng của CHÍNH SV — chỉ đọc theo chỉ số, không nhận đường dẫn."""

    permission_classes = [IsHubAuthenticated]

    def get(self, request, index):
        student = _student(request)
        if student is None:
            raise Http404
        path, mime = health_check.evidence_path(student, index)
        if path is None:
            raise Http404
        response = FileResponse(path.open("rb"), content_type=mime or "application/octet-stream")
        response["Cache-Control"] = "private, no-store"
        response["X-Content-Type-Options"] = "nosniff"
        return response
