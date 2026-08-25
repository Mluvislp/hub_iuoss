import logging
from django.conf import settings
from django.db import connection
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.exceptions import NotFound
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from core import microsoft_auth
from core.auth import verify_ldap
from core.login_policy import check_login
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
    Student, HealthInsuranceCard, CivicActivity, Hospital, VnProvince, VnWard, VnEthnicity,
)
from .authentication import IsHubAuthenticated
from .tokens import HubRefreshToken
from .serializers import (
    StudentSerializer,
    HealthInsuranceCardSerializer,
    CivicActivitySerializer,
    ConfirmationRequestSerializer,
    InsuranceRegistrationSerializer,
)
from core.models import HealthInsuranceRegistration


logger = logging.getLogger(__name__)


def feature_flags() -> dict:
    """Cờ bật/tắt tính năng — xem settings.FEATURE_*. Mặc định tắt trên production."""
    return {
        "document_requests": settings.FEATURE_DOCUMENT_REQUESTS,
        "civic_activities": settings.FEATURE_CIVIC_ACTIVITIES,
        # Không phải cờ FEATURE_* bật/tắt bằng tay: tự suy ra từ việc đã cấu hình
        # app registration hay chưa, để không bao giờ hiện nút dẫn tới endpoint chết.
        "microsoft_login": settings.MS_LOGIN_ENABLED,
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


def issue_session(student, *, ip: str, channel: str) -> Response:
    """Ghi nhận lần đăng nhập rồi cấp cặp token — dùng chung cho LDAP và Microsoft.

    `ldap_uid` luôn là MSSV HIỆN TẠI, kể cả khi vào bằng mã cũ qua email Microsoft.
    Nhờ vậy `hub_students` và các bản ghi tra theo uid không bị tách đôi khi sinh
    viên đổi mã.
    """
    uid = student.current_student_code

    HubStudent.record_login(student_code=uid, student_id=student.pk, channel=channel)

    token = HubRefreshToken.for_student(
        ldap_uid=uid,
        student_id=student.pk,
        student_code=uid,
        full_name=student.full_name,
    )

    logger.info(
        "LOGIN_SUCCESS     | uid=%-20s | student_id=%-6s | qua=%-9s | ip=%s",
        uid, student.pk, channel, ip,
    )

    return Response({
        "access": str(token.access_token),
        "refresh": str(token),
        "student_session": {
            "ldap_uid": uid,
            "student_id": student.pk,
            "student_code": uid,
            "full_name": student.full_name,
        },
    })


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

        # ── DEBUG bypass: bỏ qua LDAP, chỉ tra DB ────────────────────────
        # Khi chạy local (DEBUG=True / DJANGO_ENV=local) không có LDAP server,
        # nên bỏ qua bước xác thực mật khẩu và để check_login() tra thẳng DB.
        # Production BẮT BUỘC phải qua LDAP trước.
        if not settings.DEBUG:
            if verify_ldap(uid, password) is None:
                logger.warning("LOGIN_FAIL        | uid=%-20s | ip=%s", uid, ip)
                return Response(
                    {"detail": "Tài khoản hoặc mật khẩu không đúng."},
                    status=status.HTTP_401_UNAUTHORIZED,
                )
        else:
            logger.info("LOGIN_DEBUG_BYPASS | uid=%-20s | ip=%s | LDAP skipped", uid, ip)

        # Mật khẩu đúng (hoặc đã bypass) nhưng chưa chắc được vào — xem core/login_policy.py.
        decision = check_login(uid)
        if not decision.allowed:
            logger.warning(
                "LOGIN_DENIED      | uid=%-20s | reason=%-18s | ip=%s",
                uid, decision.reason, ip,
            )
            return Response(
                {"detail": decision.message},
                status=status.HTTP_403_FORBIDDEN,
            )

        return issue_session(decision.student, ip=ip, channel=HubStudent.CHANNEL_LDAP)


# ── Đăng nhập bằng tài khoản Microsoft ───────────────────────────────────────

class MicrosoftLoginRequiredMixin:
    """404 khi chưa cấu hình app registration — endpoint biến mất thay vì lỗi 500."""

    def initial(self, request, *args, **kwargs):
        if not settings.MS_LOGIN_ENABLED:
            raise NotFound("Đăng nhập bằng tài khoản Microsoft chưa được bật.")
        super().initial(request, *args, **kwargs)


class MicrosoftStartView(MicrosoftLoginRequiredMixin, APIView):
    """GET /api/auth/microsoft/start/ — trả URL để frontend chuyển hướng sang Microsoft.

    Trả URL thay vì tự 302: frontend gọi bằng fetch nên redirect sẽ bị chính fetch
    nuốt mất, phải để trình duyệt tự đi bằng `window.location`.
    """

    authentication_classes = []
    permission_classes = []

    def get(self, request):
        return Response({"authorize_url": microsoft_auth.build_authorize_url()})


class MicrosoftCallbackView(MicrosoftLoginRequiredMixin, APIView):
    """POST /api/auth/microsoft/callback/ — đổi `code` lấy phiên của Hub.

    Trang callback bên Next.js chỉ chuyển tiếp `code` + `state`; toàn bộ việc đổi
    token với Microsoft xảy ra ở đây, nơi giữ client secret.
    """

    authentication_classes = []
    permission_classes = []

    def post(self, request):
        ip = _get_ip(request)
        code = (request.data.get("code") or "").strip()
        state = (request.data.get("state") or "").strip()

        if not code or not state:
            return Response(
                {"detail": "Thiếu thông tin trả về từ Microsoft. Vui lòng đăng nhập lại."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            claims = microsoft_auth.exchange_code(code, state)
            uid = microsoft_auth.extract_student_code(claims)
        except microsoft_auth.MicrosoftAuthError as exc:
            logger.warning("MS_LOGIN_FAIL     | %s | ip=%s", exc, ip)
            return Response({"detail": str(exc)}, status=status.HTTP_401_UNAUTHORIZED)

        logger.info("MS_LOGIN_ATTEMPT  | uid=%-20s | oid=%s | ip=%s",
                    uid, claims.get("oid"), ip)

        # follow_old_code=True: email do trường cấp, sinh viên không sửa được mã
        # trong đó — xem giải thích ở core/login_policy.py.
        decision = check_login(uid, follow_old_code=True)
        if not decision.allowed:
            logger.warning(
                "LOGIN_DENIED      | uid=%-20s | reason=%-18s | qua=Microsoft | ip=%s",
                uid, decision.reason, ip,
            )
            return Response({"detail": decision.message},
                            status=status.HTTP_403_FORBIDDEN)

        if decision.remapped_from:
            logger.info(
                "MS_CODE_REMAPPED  | email=%-20s -> MSSV hien tai=%s",
                decision.remapped_from, decision.student.current_student_code,
            )

        return issue_session(decision.student, ip=ip, channel=HubStudent.CHANNEL_MICROSOFT)


# ── POST /api/auth/token/refresh/ ────────────────────────────────────────────

class HubTokenRefreshView(APIView):
    """Gia hạn phiên bằng refresh token, có xét LẠI điều kiện vào cổng.

    KHÔNG dùng `TokenRefreshView` của SimpleJWT: serializer của nó tra
    `get_user_model().objects.get(id=<claim>)`, mà Hub đặt `USER_ID_CLAIM` là
    `ldap_uid` (MSSV) và không dùng django.contrib.auth — nên endpoint cũ ném
    `ValueError: Field 'id' expected a number` với MỌI refresh token hợp lệ.
    Ở đây tự dựng lại cặp token từ hồ sơ sinh viên hiện tại.

    Xét lại điều kiện là bắt buộc: refresh token sống 7 ngày, nếu chỉ chặn ở màn
    đăng nhập thì sinh viên vừa bị đổi trạng thái vẫn dùng tiếp được gần một tuần.
    """

    authentication_classes = []
    permission_classes = []

    def post(self, request):
        expired = Response(
            {"detail": "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại."},
            status=status.HTTP_401_UNAUTHORIZED,
        )

        try:
            uid = RefreshToken(request.data.get("refresh") or "").payload.get("ldap_uid")
        except TokenError:
            return expired
        if not uid:
            return expired

        decision = check_login(uid)
        if not decision.allowed:
            logger.warning(
                "REFRESH_DENIED    | uid=%-20s | reason=%-18s | ip=%s",
                uid, decision.reason, _get_ip(request),
            )
            return Response(
                {"detail": decision.message},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Dựng lại từ hồ sơ hiện tại → tên/mã đổi thì phiên mới cũng cập nhật theo.
        student = decision.student
        token = HubRefreshToken.for_student(
            ldap_uid=uid,
            student_id=student.pk,
            student_code=student.current_student_code,
            full_name=student.full_name,
        )
        return Response({"access": str(token.access_token), "refresh": str(token)})


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
            return Response({"is_eligible": False, "current": None, "history": [], "registrations": []})

        cards = list(
            HealthInsuranceCard.objects
            .filter(student_id=student_id)
            .select_related("registration_type")
        )
        current = next((c for c in cards if c.is_current), None)
        history = [c for c in cards if c is not current]
        
        regs = list(
            HealthInsuranceRegistration.objects
            .filter(student_id=student_id)
            .order_by("-created_at")
        )
        
        reg_data = []
        for r in regs:
            reg_data.append({
                "id": r.id,
                "registration_year": r.registration_year,
                "registration_period": r.registration_period,
                "created_at": r.created_at,
                "status": r.status,
                "rejection_reason": getattr(r, 'rejection_reason', None),
            })

        # --- Kiểm tra điều kiện đăng ký BHYT (Eligibility Rules) ---
        # Sinh viên ĐƯỢC đăng ký nếu:
        # 1. Không có thẻ BHYT hiện tại (current is None)
        # 2. Hoặc thẻ BHYT hiện tại sắp hết hạn (<= 60 ngày tính từ hôm nay)
        import datetime
        from django.utils import timezone
        
        is_eligible = False
        if not current:
            is_eligible = True
        elif current.valid_until:
            today = timezone.localdate()
            if (current.valid_until - today).days <= 60:
                is_eligible = True

        ctx = {"hospital_names": hospital_names(cards)}
        return Response({
            "is_eligible": is_eligible,
            "current": HealthInsuranceCardSerializer(current, context=ctx).data if current else None,
            "history": HealthInsuranceCardSerializer(history, many=True, context=ctx).data,
            "registrations": reg_data,
        })


    def get(self, request):
        student_id = request.user.student_id
        if not student_id:
            return Response({"is_eligible": False, "current": None, "history": [], "registrations": []})

        cards = list(
            HealthInsuranceCard.objects
            .filter(student_id=student_id)
            .select_related("registration_type")
        )
        current = next((c for c in cards if c.is_current), None)
        history = [c for c in cards if c is not current]
        
        regs = list(
            HealthInsuranceRegistration.objects
            .filter(student_id=student_id)
            .order_by("-created_at")
        )
        
        reg_data = []
        for r in regs:
            reg_data.append({
                "id": r.id,
                "registration_year": r.registration_year,
                "registration_period": r.registration_period,
                "created_at": r.created_at,
                "status": r.status,
                "rejection_reason": getattr(r, 'rejection_reason', None),
            })

        # --- Kiểm tra điều kiện đăng ký BHYT (Eligibility Rules) ---
        # Sinh viên ĐƯỢC đăng ký nếu:
        # 1. Không có thẻ BHYT hiện tại (current is None)
        # 2. Hoặc thẻ BHYT hiện tại sắp hết hạn (<= 60 ngày tính từ hôm nay)
        import datetime
        from django.utils import timezone
        
        is_eligible = False
        if not current:
            is_eligible = True
        elif current.valid_until:
            today = timezone.localdate()
            if (current.valid_until - today).days <= 60:
                is_eligible = True

        ctx = {"hospital_names": hospital_names(cards)}
        return Response({
            "is_eligible": is_eligible,
            "current": HealthInsuranceCardSerializer(current, context=ctx).data if current else None,
            "history": HealthInsuranceCardSerializer(history, many=True, context=ctx).data,
            "registrations": reg_data,
        })

from rest_framework.parsers import MultiPartParser, FormParser

class HospitalListView(APIView):
    permission_classes = [IsHubAuthenticated]

    def get(self, request):
        province_code = request.GET.get("province", "").strip()
        search = request.GET.get("q", "").strip()
        qs = Hospital.objects.filter(is_active=True)
        if province_code:
            qs = qs.filter(province_code=province_code)
        if search:
            qs = qs.filter(name__icontains=search)
        
        # Limit to 50 results to avoid massive payload
        results = qs.values("code", "name")[:50]
        return Response(list(results))

class EthnicityListView(APIView):
    permission_classes = [IsHubAuthenticated]

    def get(self, request):
        qs = VnEthnicity.objects.filter(is_active=True).values("code", "name")
        return Response(list(qs))

from rest_framework.parsers import MultiPartParser, FormParser
from core.models import HealthInsuranceRegistration, HealthInsuranceConfig
from students.models import Student, StudentContactPoint, StudentIdentityDocument, StudentAddress, HealthInsuranceCard

class InsuranceRegistrationView(APIView):
    permission_classes = [IsHubAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def get_throttles(self):
        if self.request.method == "POST":
            self.throttle_scope = "create_request"
            return super().get_throttles()
        return []

    def _student(self, request):
        if not request.user.student_id:
            return None
        return Student.objects.filter(pk=request.user.student_id).first()

    def get(self, request):
        from students.models import StudentContactPoint, StudentAddress, StudentIdentityDocument
        student = self._student(request)
        if not student:
            return Response({"detail": "Không tìm thấy hồ sơ sinh viên."}, status=status.HTTP_400_BAD_REQUEST)

        prefill = {
            "full_name": student.full_name,
            "student_code": student.current_student_code,
        # Không dùng _current_contact, lấy trực tiếp từ bảng liên lạc / địa chỉ.
        phone_row = StudentContactPoint.objects.filter(
            student_id=student.id, 
            contact_type=StudentContactPoint.TYPE_MOBILE_PHONE, 
            is_current=True
        ).first()
        phone = phone_row.contact_value if phone_row else ""
        
        cccd_row = StudentIdentityDocument.objects.filter(
            student_id=student.id, 
            document_type=StudentIdentityDocument.TYPE_CCCD, 
            is_current=True
        ).first()
        cccd = cccd_row.document_number if cccd_row else ""
        
        addresses = {a.address_type: a for a in student.addresses.filter(is_current=True)}
        perm = addresses.get(StudentAddress.TYPE_CURRENT)
        
        card = student.health_insurance_cards.filter(is_current=True).first()
        
        return Response({
            "full_name": student.full_name,
            "student_code": student.current_student_code,
            "gender": student.gender_label,
            "dob": student.date_of_birth.strftime("%Y-%m-%d") if student.date_of_birth else "",
            "ethnicity": getattr(student, "ethnicity", ""),
            "phone_number": phone,
            "social_insurance_number": card.social_insurance_code if card else "",
            "citizen_id": cccd,
            "permanent": {
                "provinceCode": perm.province_code if perm else "",
                "wardCode": perm.ward_code if perm else "",
                "street": perm.full_address if perm else ""
            },
        })
            "gender": student.sex,
            "dob": student.date_of_birth,
        }
    def post(self, request):
        student = self._student(request)
        if not student:
            return Response({"detail": "Không tìm thấy thông tin sinh viên."}, status=status.HTTP_404_NOT_FOUND)
            
        data = request.data
        period_id = data.get("period_id")
        year = data.get("year")
        
        # --- Kiểm tra trùng lặp (Conflict Check) ---
        # Không cho phép tạo mới nếu đã có đăng ký pending/processing cho cùng kỳ/năm
        exists = HealthInsuranceRegistration.objects.filter(
            student_id=student.id,
            registration_year=year,
            registration_period=period_id,
            status__in=['pending', 'processing', 'done']
        ).exists()
        
        if exists:
            return Response({"detail": "Bạn đã đăng ký BHYT cho đợt này rồi."}, status=status.HTTP_409_CONFLICT)
            
        # --- Theo dõi thay đổi thông tin cá nhân (Change Log) ---
        # So sánh dữ liệu gửi lên với ORM hiện tại. Chỉ ghi nhận nếu có khác biệt.
        change_log = {}
        
        if data.get("full_name") and data["full_name"] != student.full_name:
            change_log["full_name"] = {"from": student.full_name, "to": data["full_name"]}
            
        if data.get("gender") and data["gender"] != student.gender_label:
            change_log["gender"] = {"from": student.gender_label, "to": data["gender"]}
            
        student_dob_str = student.date_of_birth.strftime("%Y-%m-%d") if student.date_of_birth else ""
        data_dob_str = str(data["dob"]) if data.get("dob") else ""
        if data.get("dob") and data_dob_str != student_dob_str:
            change_log["dob"] = {"from": student_dob_str, "to": data_dob_str}
            
        old_ethnicity = getattr(student, "ethnicity", "")
        if data.get("ethnicity") and data["ethnicity"] != old_ethnicity:
            change_log["ethnicity"] = {"from": old_ethnicity, "to": data["ethnicity"]}
        
        phone_row = StudentContactPoint.objects.filter(
            student_id=student.id, 
            contact_type=StudentContactPoint.TYPE_MOBILE_PHONE, 
            is_current=True
        ).first()
        old_phone = phone_row.contact_value if phone_row else ""
        if data.get("phone_number") and data["phone_number"] != old_phone:
            change_log["phone_number"] = {"from": old_phone, "to": data["phone_number"]}

        cccd_row = StudentIdentityDocument.objects.filter(
            student_id=student.id, 
            document_type=StudentIdentityDocument.TYPE_CCCD, 
            is_current=True
        ).first()
        old_cccd = cccd_row.document_number if cccd_row else ""
        if data.get("citizen_id") and data["citizen_id"] != old_cccd:
            change_log["citizen_id"] = {"from": old_cccd, "to": data["citizen_id"]}

        card = student.health_insurance_cards.filter(is_current=True).first()
        old_bhxh = card.social_insurance_code if card else ""
        if data.get("social_insurance_number", "") != old_bhxh:
            change_log["social_insurance_number"] = {"from": old_bhxh, "to": data.get("social_insurance_number", "")}

        addresses = {a.address_type: a for a in student.addresses.filter(is_current=True)}
        
        perm = addresses.get(StudentAddress.TYPE_CURRENT)
        old_perm_prov = perm.province_code if perm else ""
        old_perm_ward = perm.ward_code if perm else ""
        old_perm_street = perm.full_address if perm else ""
        
        new_perm_prov = data.get("permanent_province", "")
        new_perm_ward = data.get("permanent_ward", "")
        new_perm_street = data.get("permanent_street", "")
        
        if (new_perm_prov != old_perm_prov or 
            new_perm_ward != old_perm_ward or 
            new_perm_street != old_perm_street):
            change_log["permanent_address"] = {
                "from": {"province": old_perm_prov, "ward": old_perm_ward, "street": old_perm_street},
                "to": {"province": new_perm_prov, "ward": new_perm_ward, "street": new_perm_street}
            }


        # Truy vấn trực tiếp bằng ORM thay vì hàm nội bộ
        phone_row = StudentContactPoint.objects.filter(
            student_id=student.id, 
            contact_type=StudentContactPoint.TYPE_MOBILE_PHONE, 
            is_current=True
        ).first()
        prefill["phone_number"] = phone_row.contact_value if phone_row else ""

        cccd_row = StudentIdentityDocument.objects.filter(
            student_id=student.id, 
            document_type=StudentIdentityDocument.TYPE_CCCD, 
            is_current=True
        ).first()
        prefill["citizen_id"] = cccd_row.document_number if cccd_row else ""

        addresses = {a.address_type: a for a in student.addresses.filter(is_current=True)}
        
        permanent = addresses.get(StudentAddress.TYPE_CURRENT)
        if permanent:
            prefill["permanent_province"] = permanent.province_code or ""
            prefill["permanent_ward"] = permanent.ward_code or ""
            prefill["permanent_street"] = permanent.full_address or ""

        temporary = addresses.get(StudentAddress.TYPE_TEMPORARY)
        if temporary:
            prefill["temporary_province"] = temporary.province_code or ""
            prefill["temporary_ward"] = temporary.ward_code or ""
            prefill["temporary_street"] = temporary.full_address or ""

        card = student.health_insurance_cards.filter(is_current=True).first()
        prefill["social_insurance_number"] = card.social_insurance_code if card else ""

        return Response({"prefill": prefill})

    def post(self, request):
        student = self._student(request)
        if not student:
            return Response({"detail": "Không tìm thấy hồ sơ sinh viên."}, status=status.HTTP_400_BAD_REQUEST)

        serializer = InsuranceRegistrationSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        data = serializer.validated_data

        # --- Chống Spam (Spam Check) ---
        # Kiểm tra nếu sinh viên đã có một đơn đăng ký trong cùng năm và đợt này đang ở trạng thái pending/processing.
        existing_reg = HealthInsuranceRegistration.objects.filter(
            student_id=student.id,
            registration_year=data["registration_year"],
            registration_period=data["registration_period"],
            status__in=["pending", "processing"]
        ).first()

        if existing_reg:
            return Response(
                {"detail": "Bạn đã gửi một yêu cầu đăng ký trong đợt này và đang được xử lý."},
                status=status.HTTP_409_CONFLICT
            )

        from students.models import StudentContactPoint, StudentAddress, StudentIdentityDocument
        
        # --- Lưu lịch sử thay đổi thông tin (Comprehensive Change Log) ---
        change_log = {}
        
        # So sánh full_name
        if data.get("full_name") and data["full_name"] != student.full_name:
            change_log["full_name"] = {"from": student.full_name, "to": data["full_name"]}
            
        # So sánh gender
        if data.get("gender") and data["gender"] != student.sex:
            change_log["gender"] = {"from": student.sex, "to": data["gender"]}
            
        # So sánh dob
        # dob from student is DateField, from data is str or Date object
        student_dob_str = str(student.date_of_birth) if student.date_of_birth else ""
        data_dob_str = str(data["dob"]) if data.get("dob") else ""
        if data.get("dob") and data_dob_str != student_dob_str:
            change_log["dob"] = {"from": student_dob_str, "to": data_dob_str}
            
        # So sánh ethnicity
        old_ethnicity = getattr(student, "ethnicity", "")
        if data.get("ethnicity") and data["ethnicity"] != old_ethnicity:
            change_log["ethnicity"] = {"from": old_ethnicity, "to": data["ethnicity"]}
        
        phone_row = _current_contact(student, StudentContactPoint.TYPE_MOBILE_PHONE)
        # Truy vấn trực tiếp bằng ORM thay vì hàm nội bộ
        phone_row = StudentContactPoint.objects.filter(
            student_id=student.id, 
            contact_type=StudentContactPoint.TYPE_MOBILE_PHONE, 
            is_current=True
        ).first()
        old_phone = phone_row.contact_value if phone_row else ""
        if data.get("phone_number") and data["phone_number"] != old_phone:
            change_log["phone_number"] = {"from": old_phone, "to": data["phone_number"]}

        cccd_row = StudentIdentityDocument.objects.filter(
            student_id=student.id, 
            document_type=StudentIdentityDocument.TYPE_CCCD, 
            is_current=True
        ).first()
        old_cccd = cccd_row.document_number if cccd_row else ""
        if data.get("citizen_id") and data["citizen_id"] != old_cccd:
            change_log["citizen_id"] = {"from": old_cccd, "to": data["citizen_id"]}

        card = student.health_insurance_cards.filter(is_current=True).first()
        old_bhxh = card.social_insurance_code if card else ""
        if data.get("social_insurance_number", "") != old_bhxh:
            change_log["social_insurance_number"] = {"from": old_bhxh, "to": data.get("social_insurance_number", "")}

        addresses = {a.address_type: a for a in student.addresses.filter(is_current=True)}
        
        perm = addresses.get(StudentAddress.TYPE_CURRENT)
        old_perm_prov = perm.province_code if perm else ""
        old_perm_ward = perm.ward_code if perm else ""
        old_perm_street = perm.full_address if perm else ""
        
        new_perm_prov = data.get("permanent_province", "")
        new_perm_ward = data.get("permanent_ward", "")
        new_perm_street = data.get("permanent_street", "")
        
        if (new_perm_prov != old_perm_prov or 
            new_perm_ward != old_perm_ward or 
            new_perm_street != old_perm_street):
            change_log["permanent_address"] = {
                "from": {"province": old_perm_prov, "ward": old_perm_ward, "street": old_perm_street},
                "to": {"province": new_perm_prov, "ward": new_perm_ward, "street": new_perm_street}
            }

        temp = addresses.get(StudentAddress.TYPE_TEMPORARY)
        old_temp_prov = temp.province_code if temp else ""
        old_temp_ward = temp.ward_code if temp else ""
        old_temp_street = temp.full_address if temp else ""
        
        new_temp_prov = data.get("temporary_province", "")
        new_temp_ward = data.get("temporary_ward", "")
        new_temp_street = data.get("temporary_street", "")
        
        if (new_temp_prov != old_temp_prov or 
            new_temp_ward != old_temp_ward or 
            new_temp_street != old_temp_street):
            change_log["temporary_address"] = {
                "from": {"province": old_temp_prov, "ward": old_temp_ward, "street": old_temp_street},
                "to": {"province": new_temp_prov, "ward": new_temp_ward, "street": new_temp_street}
            }

        reg = HealthInsuranceRegistration(
            student_id=request.user.student_id,
            registration_year=data["registration_year"],
            registration_period=data["registration_period"],
            hospital_code=data["hospital_code"],
            change_log=change_log,
            status="pending"
        )

        if data.get("cccd_image"):
            reg.cccd_image = data["cccd_image"]
        if data.get("bhyt_image"):
            reg.bhyt_image = data["bhyt_image"]
        if data.get("payment_receipt_image"):
            reg.payment_receipt_image = data["payment_receipt_image"]

        reg.save()
        return Response({"id": reg.id, "status": "pending"}, status=status.HTTP_201_CREATED)


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
