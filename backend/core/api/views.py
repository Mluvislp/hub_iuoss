import logging
from django.conf import settings
from django.db import connection
from django.utils import timezone
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

from core.auth import verify_ldap
from core.models import HubStudent, ConfirmationRequest
from students.models import Student, HealthInsuranceCard, CivicActivity
from .authentication import IsHubAuthenticated
from .tokens import HubRefreshToken
from .serializers import (
    StudentSerializer,
    HealthInsuranceCardSerializer,
    CivicActivitySerializer,
    ConfirmationRequestSerializer,
)

logger = logging.getLogger(__name__)


def _get_ip(request) -> str:
    return (
        request.META.get("HTTP_X_FORWARDED_FOR", request.META.get("REMOTE_ADDR", "-"))
        .split(",")[0]
        .strip()
    )


# ── GET /api/health/ ─────────────────────────────────────────────────────────
# Endpoint cho systemd / Nginx / Cloudflare / uptime monitor. Không cần auth.
# Kiểm tra kết nối DB → trả 200 nếu khoẻ, 503 nếu DB lỗi.

class HealthView(APIView):
    authentication_classes = []
    permission_classes = []

    def get(self, request):
        db_ok = True
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
                cursor.fetchone()
        except Exception as exc:  # noqa: BLE001 — health check phải nuốt mọi lỗi DB
            db_ok = False
            logger.error("HEALTH_DB_FAIL    | %s: %s", type(exc).__name__, exc)

        return Response(
            {
                "status": "ok" if db_ok else "degraded",
                "environment": settings.DJANGO_ENV,
                "database": db_ok,
            },
            status=status.HTTP_200_OK if db_ok else status.HTTP_503_SERVICE_UNAVAILABLE,
        )


# ── POST /api/auth/login/ ────────────────────────────────────────────────────

class LoginView(APIView):
    authentication_classes = []
    permission_classes = []

    def post(self, request):
        uid = request.data.get("uid", "").strip()
        password = request.data.get("password", "")
        ip = _get_ip(request)

        if not uid or not password:
            return Response(
                {"detail": "Vui lòng nhập MSSV và mật khẩu."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        logger.info("LOGIN_ATTEMPT     | uid=%-20s | ip=%s", uid, ip)

        ldap_info = verify_ldap(uid, password)
        if ldap_info is None:
            logger.warning("LOGIN_FAIL        | uid=%-20s | ip=%s", uid, ip)
            return Response(
                {"detail": "Tài khoản hoặc mật khẩu không đúng."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        student = Student.objects.filter(
            current_student_code__iexact=uid
        ).first()

        hub_student, _ = HubStudent.objects.get_or_create(ldap_uid=uid)
        hub_student.last_login_at = timezone.now()
        hub_student.login_count = (hub_student.login_count or 0) + 1
        if student:
            hub_student.student_id = student.pk
        hub_student.save(update_fields=["last_login_at", "login_count", "student_id"])

        student_id = student.pk if student else None
        student_code = student.current_student_code if student else uid
        full_name = (
            student.full_name if student
            else ldap_info.get("display_name", uid)
        )

        token = HubRefreshToken.for_student(
            ldap_uid=uid,
            student_id=student_id,
            student_code=student_code,
            full_name=full_name,
        )

        logger.info(
            "LOGIN_SUCCESS     | uid=%-20s | student_id=%-6s | linked=%s | ip=%s",
            uid,
            student_id or "None",
            "yes" if student else "no",
            ip,
        )

        return Response({
            "access": str(token.access_token),
            "refresh": str(token),
            "student_session": {
                "ldap_uid": uid,
                "student_id": student_id,
                "student_code": student_code,
                "full_name": full_name,
            },
        })


# ── POST /api/auth/logout/ ───────────────────────────────────────────────────

class LogoutView(APIView):
    permission_classes = [IsHubAuthenticated]

    def post(self, request):
        logger.info(
            "LOGOUT            | uid=%-20s | ip=%s",
            request.user.ldap_uid,
            _get_ip(request),
        )
        return Response({"detail": "Đăng xuất thành công."})


# ── GET /api/dashboard/ ──────────────────────────────────────────────────────

class DashboardView(APIView):
    permission_classes = [IsHubAuthenticated]

    def get(self, request):
        student_id = request.user.student_id
        ldap_uid = request.user.ldap_uid

        student = None
        health_insurance = None
        civic_activities = []

        if student_id:
            student = (
                Student.objects
                .select_related(
                    "current_department",
                    "current_degree_level",
                    "current_status",
                )
                .filter(pk=student_id)
                .first()
            )
            if student:
                health_insurance = HealthInsuranceCard.objects.filter(
                    student=student, is_current=True
                ).first()
                civic_activities = list(CivicActivity.objects.filter(student=student))

        confirmation_requests = list(
            ConfirmationRequest.objects.filter(ldap_uid=ldap_uid)[:10]
        )

        return Response({
            "student": StudentSerializer(student).data if student else None,
            "health_insurance": (
                HealthInsuranceCardSerializer(health_insurance).data
                if health_insurance else None
            ),
            "civic_activities": CivicActivitySerializer(civic_activities, many=True).data,
            "confirmation_requests": ConfirmationRequestSerializer(
                confirmation_requests, many=True
            ).data,
        })


# ── GET + POST /api/requests/ ────────────────────────────────────────────────

class RequestsView(APIView):
    permission_classes = [IsHubAuthenticated]

    def get(self, request):
        qs = ConfirmationRequest.objects.filter(ldap_uid=request.user.ldap_uid)
        return Response(ConfirmationRequestSerializer(qs, many=True).data)

    def post(self, request):
        request_type = request.data.get("request_type", "").strip()
        purpose = request.data.get("purpose", "").strip()
        note = request.data.get("note", "").strip()

        valid_types = dict(ConfirmationRequest.REQUEST_TYPES)
        errors = {}
        if not request_type or request_type not in valid_types:
            errors["request_type"] = "Vui lòng chọn loại giấy xác nhận hợp lệ."
        if not purpose:
            errors["purpose"] = "Vui lòng nhập mục đích yêu cầu."
        if errors:
            return Response(errors, status=status.HTTP_400_BAD_REQUEST)

        req = ConfirmationRequest.objects.create(
            student_id=request.user.student_id or 0,
            ldap_uid=request.user.ldap_uid,
            request_type=request_type,
            purpose=purpose,
            note=note or None,
        )

        logger.info(
            "CONFIRMATION_REQUEST | uid=%-20s | type=%s | purpose=%s",
            request.user.ldap_uid, request_type, purpose,
        )

        return Response(
            ConfirmationRequestSerializer(req).data,
            status=status.HTTP_201_CREATED,
        )
