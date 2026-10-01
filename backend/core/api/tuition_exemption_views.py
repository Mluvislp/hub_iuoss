"""API "Miễn giảm học phí" — nghiệp vụ ở `core/tuition_exemption.py`.
Trạng thái trang, nộp đơn (lần đầu / gia hạn), chi tiết đơn, bổ sung khi cán bộ
yêu cầu, tải giấy tờ.
"""
import logging
import mimetypes

from django.conf import settings
from django.http import FileResponse
from rest_framework import status
from rest_framework.exceptions import NotFound
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from core import tuition_exemption as svc
from students.models import Student

from .authentication import IsHubAuthenticated
from .serializers import TuitionExemptionSubmitSerializer

logger = logging.getLogger(__name__)


class TuitionWaiverRequiredMixin:
    """404 cho mọi method khi FEATURE_TUITION_WAIVER tắt — như HealthCheckRequiredMixin."""

    def initial(self, request, *args, **kwargs):
        if not settings.FEATURE_TUITION_WAIVER:
            raise NotFound("Chức năng miễn giảm học phí đang tạm ngưng.")
        super().initial(request, *args, **kwargs)


def _student(request):
    if not request.user.student_id:
        return None
    return (Student.objects.select_related("current_department")
            .filter(pk=request.user.student_id).first())


def _no_student():
    return Response({"detail": "Không tìm thấy hồ sơ sinh viên."},
                    status=status.HTTP_400_BAD_REQUEST)


def _error(exc):
    conflict = exc.code in ("exists", "closed", "conflict")
    body = {"detail": str(exc)}
    if exc.code:
        body["code"] = exc.code      # "ineligible" → frontend hiện pop-up không đủ điều kiện
    if exc.errors:
        body["errors"] = exc.errors
    return Response(body, status=status.HTTP_409_CONFLICT if conflict else status.HTTP_400_BAD_REQUEST)


class TuitionExemptionView(TuitionWaiverRequiredMixin, APIView):
    """GET — trạng thái trang MGHP (đợt, danh mục, đơn, kết quả, điền sẵn).
    POST multipart — nộp đơn cho đợt đang mở."""

    permission_classes = [IsHubAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def get(self, request):
        student = _student(request)
        if student is None:
            return _no_student()
        return Response(svc.build_state(student))

    def post(self, request):
        student = _student(request)
        if student is None:
            return _no_student()
        data = request.data.dict() if hasattr(request.data, "dict") else dict(request.data)
        if hasattr(request.data, "getlist"):
            data["category_codes"] = request.data.getlist("category_codes")
        # Thông tin riêng theo đối tượng: các trường `detail_<tên>` (contract.CATEGORY_FIELDS).
        details = {k[len("detail_"):]: v for k, v in data.items() if k.startswith("detail_")}
        ser = TuitionExemptionSubmitSerializer(data=data)
        if not ser.is_valid():
            return Response({"detail": "Dữ liệu chưa hợp lệ.", "errors": ser.errors},
                            status=status.HTTP_400_BAD_REQUEST)
        try:
            app = svc.submit(student, {**ser.validated_data, "category_details": details}, request.FILES,
                             request_key=ser.validated_data["request_key"])
        except svc.TuitionExemptionError as exc:
            return _error(exc)
        logger.info("TUITION_SUBMIT | uid=%s | student_id=%s | app=%s | kind=%s",
                    request.user.ldap_uid, student.pk, app.pk, app.submission_kind)
        state = svc.build_state(student)
        state["submitted_id"] = app.pk
        return Response(state, status=status.HTTP_201_CREATED)


class TuitionExemptionDetailView(TuitionWaiverRequiredMixin, APIView):
    """GET — chi tiết một đơn của chính SV (từng đối tượng, timeline, giấy tờ)."""

    permission_classes = [IsHubAuthenticated]

    def get(self, request, pk):
        student = _student(request)
        if student is None:
            return _no_student()
        app = svc.get_application(student, pk)
        if app is None:
            raise NotFound("Không tìm thấy đơn.")
        return Response(svc.serialize_application(app, with_details=True))


class TuitionExemptionSupplementView(TuitionWaiverRequiredMixin, APIView):
    """POST multipart — bổ sung/thay giấy tờ khi đơn cần bổ sung (row_version + request_key)."""

    permission_classes = [IsHubAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request, pk):
        student = _student(request)
        if student is None:
            return _no_student()
        app = svc.get_application(student, pk)
        if app is None:
            raise NotFound("Không tìm thấy đơn.")
        try:
            app = svc.supplement(student, app, request.data, request.FILES,
                           request_key=request.data.get("request_key"),
                           row_version=request.data.get("row_version"))
        except svc.TuitionExemptionError as exc:
            return _error(exc)
        logger.info("TUITION_SUPPLEMENT | uid=%s | student_id=%s | app=%s",
                    request.user.ldap_uid, student.pk, app.pk)
        app = svc.get_application(student, pk)
        return Response(svc.serialize_application(app, with_details=True))


class TuitionExemptionDocumentView(TuitionWaiverRequiredMixin, APIView):
    """GET — tải lại một file giấy tờ của chính SV (FileResponse, không lộ storage_key)."""

    permission_classes = [IsHubAuthenticated]

    def get(self, request, pk, document_id):
        student = _student(request)
        if student is None:
            return _no_student()
        app = svc.get_application(student, pk)
        if app is None:
            raise NotFound("Không tìm thấy đơn.")
        path, doc = svc.document_path(student, app, document_id)
        if path is None:
            raise NotFound("Không tìm thấy file.")
        ext = mimetypes.guess_extension(doc.mime_type) or ""
        return FileResponse(open(path, "rb"), content_type=doc.mime_type,
                            filename=f"giay-to-{doc.pk}{ext}")
