import logging
from django.conf import settings
from django.db import connection
from django.utils import timezone
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.exceptions import NotFound

from core.auth import verify_ldap
from core.models import HubStudent, ConfirmationRequest
from core.documents import (
    OTHER_PURPOSE_CHOICES,
    PROGRAM_PURPOSE_CODE,
    build_other_payload,
    build_other_prefill,
    build_deferment_payload,
    build_deferment_prefill,
    build_thuongbinh_payload,
    build_thuongbinh_prefill,
    build_bankloan_payload,
    build_bankloan_prefill,
    build_english_payload,
    build_english_prefill,
    ENGLISH_PURPOSE_CHOICES,
    ENGLISH_PROGRAM_CODE,
)
from core import offcampus
from students.models import (
    Student, HealthInsuranceCard, CivicActivity, Hospital, VnProvince, VnWard,
)
from .authentication import IsHubAuthenticated
from .tokens import HubRefreshToken
from .serializers import (
    StudentSerializer,
    HealthInsuranceCardSerializer,
    CivicActivitySerializer,
    ConfirmationRequestSerializer,
)

logger = logging.getLogger(__name__)


def feature_flags() -> dict:
    """Cờ bật/tắt tính năng — xem settings.FEATURE_*. Mặc định tắt trên production."""
    return {
        "document_requests": settings.FEATURE_DOCUMENT_REQUESTS,
        "civic_activities": settings.FEATURE_CIVIC_ACTIVITIES,
    }


def hospital_names(cards) -> dict:
    """Map {hospital_code: name} cho một nhóm thẻ BHYT — MỘT truy vấn, tránh N+1.

    `hospital_code` không có FK sang `hospitals`; mã lạ đơn giản là không có mặt
    trong map và frontend hiển thị mã thô.
    """
    codes = {c.hospital_code for c in cards if c and c.hospital_code}
    if not codes:
        return {}
    return dict(Hospital.objects.filter(code__in=codes).values_list("code", "name"))


class DocumentRequestsRequiredMixin:
    """Trả 404 cho mọi method khi FEATURE_DOCUMENT_REQUESTS tắt.

    Đặt ở `initial()` nên chạy sau xác thực và áp cho cả GET lẫn POST — tính năng
    bị ẩn thì endpoint phải biến mất, không chỉ ẩn nút ở giao diện.
    """

    def initial(self, request, *args, **kwargs):
        if not settings.FEATURE_DOCUMENT_REQUESTS:
            raise NotFound("Chức năng yêu cầu giấy tờ đang tạm ngưng.")
        super().initial(request, *args, **kwargs)


def _get_ip(request) -> str:
    return (
        request.META.get("HTTP_X_FORWARDED_FOR", request.META.get("REMOTE_ADDR", "-"))
        .split(",")[0]
        .strip()
    )


def _get_str(data, key) -> str:
    """Lấy field dạng chuỗi an toàn từ request.data.

    Client JSON có thể gửi list/dict/bool cho một field → `.strip()` sẽ ném
    AttributeError (không phải ValueError) và biến thành HTTP 500. Hàm này chuẩn
    hóa: chuỗi → strip; số → str(số); mọi kiểu khác (list/dict/bool/None) → ''.
    """
    v = data.get(key)
    if isinstance(v, str):
        return v.strip()
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return str(v)
    return ""


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


# ── GET /api/features/ ───────────────────────────────────────────────────────
# Cờ tính năng cho frontend (ẩn menu/nút tương ứng). Không cần auth: frontend
# phải biết cờ TRƯỚC cả màn đăng nhập, và nội dung chỉ là true/false, không lộ
# dữ liệu gì. Backend vẫn tự chặn endpoint riêng — đây chỉ để giao diện khớp.

class FeaturesView(APIView):
    authentication_classes = []
    permission_classes = []

    def get(self, request):
        return Response(feature_flags())


# ── POST /api/auth/login/ ────────────────────────────────────────────────────

class LoginView(APIView):
    authentication_classes = []
    permission_classes = []
    # Rate-limit đăng nhập tạm TẮT theo yêu cầu — mở lại chỉ cần bỏ comment dòng dưới
    # (ngưỡng cấu hình sẵn ở settings.DEFAULT_THROTTLE_RATES["login"]).
    # throttle_scope = "login"   # giới hạn số lần thử đăng nhập/IP (chống brute-force)

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
                health_insurance = (
                    HealthInsuranceCard.objects
                    .select_related("registration_type")
                    .filter(student=student, is_current=True)
                    .first()
                )
                # Tính năng tắt → không truy vấn, không trả dữ liệu (ẩn thật, không
                # chỉ ẩn ở giao diện).
                if settings.FEATURE_CIVIC_ACTIVITIES:
                    civic_activities = list(CivicActivity.objects.filter(student=student))

        confirmation_requests = (
            list(ConfirmationRequest.objects.filter(ldap_uid=ldap_uid)[:10])
            if settings.FEATURE_DOCUMENT_REQUESTS else []
        )

        return Response({
            "student": StudentSerializer(student).data if student else None,
            "health_insurance": (
                HealthInsuranceCardSerializer(
                    health_insurance,
                    context={"hospital_names": hospital_names([health_insurance])},
                ).data
                if health_insurance else None
            ),
            "civic_activities": CivicActivitySerializer(civic_activities, many=True).data,
            "confirmation_requests": ConfirmationRequestSerializer(
                confirmation_requests, many=True
            ).data,
            "features": feature_flags(),
        })


# ── GET /api/health-insurance/ ───────────────────────────────────────────────
# Trang BHYT riêng: thẻ đang dùng + lịch sử các thẻ cũ.

class HealthInsuranceView(APIView):
    permission_classes = [IsHubAuthenticated]

    def get(self, request):
        student_id = request.user.student_id
        if not student_id:
            return Response({"current": None, "history": []})

        cards = list(
            HealthInsuranceCard.objects
            .filter(student_id=student_id)
            .select_related("registration_type")
        )
        # is_current = thẻ đang dùng (KHÔNG phải "còn hiệu lực") — xem model.
        current = next((c for c in cards if c.is_current), None)
        history = [c for c in cards if c is not current]

        ctx = {"hospital_names": hospital_names(cards)}
        return Response({
            "current": HealthInsuranceCardSerializer(current, context=ctx).data if current else None,
            "history": HealthInsuranceCardSerializer(history, many=True, context=ctx).data,
        })


# ── GET + POST /api/requests/ ────────────────────────────────────────────────

class RequestsView(DocumentRequestsRequiredMixin, APIView):
    permission_classes = [IsHubAuthenticated]

    def get_throttles(self):
        # Chỉ giới hạn thao tác TẠO (POST) để chống spam; GET danh sách không giới hạn.
        if self.request.method == "POST":
            self.throttle_scope = "create_request"
            return super().get_throttles()
        return []

    def get(self, request):
        qs = ConfirmationRequest.objects.filter(ldap_uid=request.user.ldap_uid)
        return Response(ConfirmationRequestSerializer(qs, many=True).data)

    def post(self, request):
        request_type = _get_str(request.data, "request_type")
        if request_type == "other":
            return self._create_other(request)
        if request_type == "deferment":
            return self._create_deferment(request)
        if request_type == "thuong_binh":
            return self._create_thuongbinh(request)
        if request_type == "bank_loan":
            return self._create_bankloan(request)
        if request_type == "english_form":
            return self._create_english(request)

        purpose = _get_str(request.data, "purpose")
        note = _get_str(request.data, "note")

        valid_types = dict(ConfirmationRequest.REQUEST_TYPES)
        errors = {}
        if not request_type or request_type not in valid_types:
            errors["request_type"] = "Vui lòng chọn loại giấy xác nhận hợp lệ."
        if not purpose:
            errors["purpose"] = "Vui lòng nhập mục đích yêu cầu."
        elif len(purpose) > 255:
            errors["purpose"] = "Mục đích quá dài (tối đa 255 ký tự)."
        if len(note) > 1000:
            errors["note"] = "Ghi chú quá dài (tối đa 1000 ký tự)."
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

    def _resolve_student(self, request):
        if not request.user.student_id:
            return None
        return (
            Student.objects
            .select_related("current_department", "current_status", "admission_term")
            .filter(pk=request.user.student_id)
            .first()
        )

    def _create_other(self, request):
        """GXN 'Lý do khác' — dựng payload snapshot + ghi nhận SV sửa DOB/CCCD."""
        student = self._resolve_student(request)
        if student is None:
            return Response(
                {"detail": "Không tìm thấy hồ sơ sinh viên."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        note = _get_str(request.data, "note")
        if len(note) > 1000:
            return Response(
                {"detail": "Ghi chú quá dài (tối đa 1000 ký tự)."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            payload, purpose_label = build_other_payload(
                student,
                purpose_code=_get_str(request.data, "purpose_code"),
                program_name=_get_str(request.data, "program_name"),
                dob=_get_str(request.data, "dob"),
                citizen_id=_get_str(request.data, "citizen_id"),
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        req = ConfirmationRequest.objects.create(
            student_id=student.pk,
            ldap_uid=request.user.ldap_uid,
            request_type="other",
            purpose=purpose_label,
            note=note or None,
            payload=payload,
        )

        logger.info(
            "CONFIRMATION_REQUEST | uid=%-20s | type=other | purpose=%s",
            request.user.ldap_uid, purpose_label,
        )

        return Response(
            ConfirmationRequestSerializer(req).data,
            status=status.HTTP_201_CREATED,
        )

    def _create_deferment(self, request):
        """GXN hoãn nghĩa vụ quân sự — snapshot + ghi nhận SV sửa DOB/địa chỉ."""
        student = self._resolve_student(request)
        if student is None:
            return Response(
                {"detail": "Không tìm thấy hồ sơ sinh viên."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        note = _get_str(request.data, "note")
        if len(note) > 1000:
            return Response({"detail": "Ghi chú quá dài (tối đa 1000 ký tự)."},
                            status=status.HTTP_400_BAD_REQUEST)

        try:
            payload, purpose_label = build_deferment_payload(
                student,
                dob=_get_str(request.data, "dob"),
                province_code=_get_str(request.data, "province_code"),
                ward_code=_get_str(request.data, "ward_code"),
                street=_get_str(request.data, "street"),
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        req = ConfirmationRequest.objects.create(
            student_id=student.pk,
            ldap_uid=request.user.ldap_uid,
            request_type="deferment",
            purpose=purpose_label,
            note=note or None,
            payload=payload,
        )
        logger.info(
            "CONFIRMATION_REQUEST | uid=%-20s | type=deferment | purpose=%s",
            request.user.ldap_uid, purpose_label,
        )
        return Response(ConfirmationRequestSerializer(req).data, status=status.HTTP_201_CREATED)

    def _create_thuongbinh(self, request):
        """GXN thương binh (ưu đãi giáo dục) — snapshot + CCCD/ngày cấp (nếu chưa có)."""
        student = self._resolve_student(request)
        if student is None:
            return Response({"detail": "Không tìm thấy hồ sơ sinh viên."},
                            status=status.HTTP_400_BAD_REQUEST)

        note = _get_str(request.data, "note")
        if len(note) > 1000:
            return Response({"detail": "Ghi chú quá dài (tối đa 1000 ký tự)."},
                            status=status.HTTP_400_BAD_REQUEST)

        try:
            payload, purpose_label = build_thuongbinh_payload(
                student,
                citizen_id=_get_str(request.data, "citizen_id"),
                citizen_id_issue_date=_get_str(request.data, "citizen_id_issue_date"),
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        req = ConfirmationRequest.objects.create(
            student_id=student.pk,
            ldap_uid=request.user.ldap_uid,
            request_type="thuong_binh",
            purpose=purpose_label,
            note=note or None,
            payload=payload,
        )
        logger.info(
            "CONFIRMATION_REQUEST | uid=%-20s | type=thuong_binh | purpose=%s",
            request.user.ldap_uid, purpose_label,
        )
        return Response(ConfirmationRequestSerializer(req).data, status=status.HTTP_201_CREATED)

    def _create_bankloan(self, request):
        """GXN vay vốn ngân hàng — snapshot + DOB/CCCD/ngày cấp + mã lớp (SV nhập)."""
        student = self._resolve_student(request)
        if student is None:
            return Response({"detail": "Không tìm thấy hồ sơ sinh viên."},
                            status=status.HTTP_400_BAD_REQUEST)

        note = _get_str(request.data, "note")
        if len(note) > 1000:
            return Response({"detail": "Ghi chú quá dài (tối đa 1000 ký tự)."},
                            status=status.HTTP_400_BAD_REQUEST)

        try:
            payload, purpose_label = build_bankloan_payload(
                student,
                dob=_get_str(request.data, "dob"),
                citizen_id=_get_str(request.data, "citizen_id"),
                citizen_id_issue_date=_get_str(request.data, "citizen_id_issue_date"),
                class_code=_get_str(request.data, "class_code"),
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        req = ConfirmationRequest.objects.create(
            student_id=student.pk,
            ldap_uid=request.user.ldap_uid,
            request_type="bank_loan",
            purpose=purpose_label,
            note=note or None,
            payload=payload,
        )
        logger.info(
            "CONFIRMATION_REQUEST | uid=%-20s | type=bank_loan | purpose=%s",
            request.user.ldap_uid, purpose_label,
        )
        return Response(ConfirmationRequestSerializer(req).data, status=status.HTTP_201_CREATED)

    def _create_english(self, request):
        """GXN tiếng Anh — snapshot (tên không dấu, School/Department…) + DOB + purpose."""
        student = self._resolve_student(request)
        if student is None:
            return Response({"detail": "Không tìm thấy hồ sơ sinh viên."},
                            status=status.HTTP_400_BAD_REQUEST)

        note = _get_str(request.data, "note")
        if len(note) > 1000:
            return Response({"detail": "Ghi chú quá dài (tối đa 1000 ký tự)."},
                            status=status.HTTP_400_BAD_REQUEST)

        try:
            payload, purpose_label = build_english_payload(
                student,
                dob=_get_str(request.data, "dob"),
                purpose_code=_get_str(request.data, "purpose_code"),
                program_name=_get_str(request.data, "program_name"),
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        req = ConfirmationRequest.objects.create(
            student_id=student.pk,
            ldap_uid=request.user.ldap_uid,
            request_type="english_form",
            purpose=purpose_label,
            note=note or None,
            payload=payload,
        )
        logger.info(
            "CONFIRMATION_REQUEST | uid=%-20s | type=english_form | purpose=%s",
            request.user.ldap_uid, purpose_label,
        )
        return Response(ConfirmationRequestSerializer(req).data, status=status.HTTP_201_CREATED)


# ── GET /api/requests/other/form/ — prefill cho form 'Lý do khác' ─────────────

class OtherRequestFormView(DocumentRequestsRequiredMixin, APIView):
    permission_classes = [IsHubAuthenticated]

    def get(self, request):
        student = (
            Student.objects
            .select_related("current_department", "current_status", "admission_term")
            .filter(pk=request.user.student_id)
            .first()
            if request.user.student_id else None
        )
        if student is None:
            return Response(
                {"detail": "Không tìm thấy hồ sơ sinh viên."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response({
            "purpose_choices": OTHER_PURPOSE_CHOICES,
            "program_purpose_code": PROGRAM_PURPOSE_CODE,
            "prefill": build_other_prefill(student),
        })


# ── GET /api/requests/deferment/form/ — prefill cho form hoãn NVQS ────────────

class DefermentRequestFormView(DocumentRequestsRequiredMixin, APIView):
    permission_classes = [IsHubAuthenticated]

    def get(self, request):
        student = (
            Student.objects
            .select_related("current_department", "current_status", "admission_term")
            .filter(pk=request.user.student_id)
            .first()
            if request.user.student_id else None
        )
        if student is None:
            return Response(
                {"detail": "Không tìm thấy hồ sơ sinh viên."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response({"prefill": build_deferment_prefill(student)})


# ── GET /api/requests/thuong-binh/form/ — prefill cho form thương binh ────────

class ThuongBinhRequestFormView(DocumentRequestsRequiredMixin, APIView):
    permission_classes = [IsHubAuthenticated]

    def get(self, request):
        student = (
            Student.objects
            .select_related("current_department", "current_status", "admission_term")
            .filter(pk=request.user.student_id)
            .first()
            if request.user.student_id else None
        )
        if student is None:
            return Response(
                {"detail": "Không tìm thấy hồ sơ sinh viên."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response({"prefill": build_thuongbinh_prefill(student)})


# ── GET /api/requests/bank-loan/form/ — prefill cho form vay vốn ──────────────

class BankLoanRequestFormView(DocumentRequestsRequiredMixin, APIView):
    permission_classes = [IsHubAuthenticated]

    def get(self, request):
        student = (
            Student.objects
            .select_related("current_department", "current_status", "admission_term")
            .filter(pk=request.user.student_id)
            .first()
            if request.user.student_id else None
        )
        if student is None:
            return Response(
                {"detail": "Không tìm thấy hồ sơ sinh viên."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response({"prefill": build_bankloan_prefill(student)})


# ── GET /api/requests/english/form/ — prefill cho form tiếng Anh ──────────────

class EnglishRequestFormView(DocumentRequestsRequiredMixin, APIView):
    permission_classes = [IsHubAuthenticated]

    def get(self, request):
        student = (
            Student.objects
            .select_related("current_department", "current_status", "admission_term")
            .filter(pk=request.user.student_id)
            .first()
            if request.user.student_id else None
        )
        if student is None:
            return Response(
                {"detail": "Không tìm thấy hồ sơ sinh viên."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response({
            "purpose_choices": ENGLISH_PURPOSE_CHOICES,
            "program_purpose_code": ENGLISH_PROGRAM_CODE,
            "prefill": build_english_prefill(student),
        })


# ── Danh mục đơn vị hành chính (cơ cấu 2025) ─────────────────────────────────

# ── Khai báo thông tin ngoại trú ─────────────────────────────────────────────

class OffCampusDeclarationView(APIView):
    """GET  — dữ liệu dựng form (thông tin cá nhân + 2 địa chỉ + gợi ý prefill)
    POST — ghi khai báo. Địa chỉ lẫn CCCD/email/SĐT đều ghi thẳng, không qua
           duyệt; mỗi thay đổi để lại một dòng nhật ký.
    """

    permission_classes = [IsHubAuthenticated]

    def _student(self, request):
        if not request.user.student_id:
            return None
        return (
            Student.objects
            .select_related("current_department", "current_status")
            .filter(pk=request.user.student_id)
            .first()
        )

    def get(self, request):
        student = self._student(request)
        if student is None:
            return Response(
                {"detail": "Không tìm thấy hồ sơ sinh viên."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(offcampus.build_prefill(student))

    def post(self, request):
        student = self._student(request)
        if student is None:
            return Response(
                {"detail": "Không tìm thấy hồ sơ sinh viên."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        data = request.data if isinstance(request.data, dict) else {}
        try:
            result = offcampus.submit(student, data)
        except offcampus.DeclarationLocked as exc:
            return Response({"detail": str(exc), "locked": True},
                            status=status.HTTP_409_CONFLICT)
        except offcampus.DeclarationError as exc:
            # Trả lỗi theo từng ô để frontend tô đúng chỗ, không chỉ một câu chung.
            return Response(
                {"detail": "Vui lòng kiểm tra lại thông tin.", "errors": exc.errors},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        logger.info(
            "OFFCAMPUS_DECLARED | uid=%s | student_id=%s | fields=%s",
            request.user.ldap_uid, student.pk, result.get("fields"),
        )
        return Response(result)


class OffCampusReopenRequestView(APIView):
    """POST — sinh viên xin phòng CTSV mở lại biểu mẫu đã khai."""

    permission_classes = [IsHubAuthenticated]

    def post(self, request):
        student = (
            Student.objects.filter(pk=request.user.student_id).first()
            if request.user.student_id else None
        )
        if student is None:
            return Response({"detail": "Không tìm thấy hồ sơ sinh viên."},
                            status=status.HTTP_400_BAD_REQUEST)
        data = request.data if isinstance(request.data, dict) else {}
        try:
            result = offcampus.request_reopen(student, (data.get("reason") or "").strip())
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        logger.info("OFFCAMPUS_REOPEN_REQUEST | uid=%s | student_id=%s | new=%s",
                    request.user.ldap_uid, student.pk, result["created"])
        return Response(result)


class ProvinceListView(APIView):
    permission_classes = [IsHubAuthenticated]

    def get(self, request):
        rows = (
            VnProvince.objects.filter(is_active=True)
            .order_by("name").values("code", "name", "unit_type")
        )
        return Response(list(rows))


class WardListView(APIView):
    permission_classes = [IsHubAuthenticated]

    def get(self, request):
        province = (request.GET.get("province") or "").strip()
        if not province:
            return Response({"detail": "Thiếu tham số province."}, status=status.HTTP_400_BAD_REQUEST)
        rows = (
            VnWard.objects.filter(province_code=province, is_active=True)
            .order_by("name").values("code", "name", "unit_type")
        )
        return Response(list(rows))
