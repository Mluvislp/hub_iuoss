from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.permissions import BasePermission
from rest_framework_simplejwt.tokens import AccessToken
from rest_framework_simplejwt.exceptions import TokenError


class StudentPrincipal:
    """
    Thay thế User object trong DRF — mang dữ liệu student session từ JWT.
    Không liên quan tới django.contrib.auth.
    """
    is_authenticated = True

    def __init__(self, payload: dict):
        self.ldap_uid: str = payload["ldap_uid"]
        self.student_id = payload.get("student_id")
        self.student_code: str = payload.get("student_code", self.ldap_uid)
        self.full_name: str = payload.get("full_name", self.ldap_uid)
        self.bhyt_only: bool = payload.get("bhyt_only") is True


class HubJWTAuthentication(BaseAuthentication):
    """
    Xác thực bằng Bearer JWT.
    Đọc Authorization header, validate token, trả StudentPrincipal.
    """

    def authenticate(self, request):
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return None  # Không có token → tiếp tục anonymous

        raw_token = auth_header[7:].strip()
        if not raw_token:
            return None

        try:
            token = AccessToken(raw_token)
        except TokenError as exc:
            raise AuthenticationFailed(str(exc)) from exc

        if "ldap_uid" not in token.payload:
            raise AuthenticationFailed("Token không chứa thông tin sinh viên.")

        return (StudentPrincipal(token.payload), token)


# API mà phiên `bhyt_only` (học viên cao học) được gọi — theo tên route trong
# core/api/urls.py. Danh sách CHO PHÉP, không phải danh sách chặn: thêm endpoint
# mới thì mặc định học viên cao học không gọi được.
BHYT_ONLY_URL_NAMES = frozenset({
    "api_logout",
    "api_health_insurance",
    "api_health_insurance_registrations",
    "api_insurance_detail",
    "api_insurance_image",
    "api_insurance_evidence",
    "api_external_insurance",
    "api_external_insurance_detail",
    "api_external_insurance_image",
    "api_provinces",
    "api_wards",
    "api_ethnicities",
    "api_hospitals",
})


class IsHubAuthenticated(BasePermission):
    """Chỉ cho phép StudentPrincipal đã xác thực.

    Phiên `bhyt_only` còn bị giới hạn trong BHYT_ONLY_URL_NAMES — chặn ở đây vì
    mọi view của Hub đều dùng permission này (mặc định trong settings).
    """

    message = "Tài khoản học viên cao học chỉ sử dụng được chức năng Bảo hiểm y tế."

    def has_permission(self, request, view):
        user = request.user
        if not isinstance(user, StudentPrincipal):
            return False
        if user.bhyt_only:
            match = getattr(request, "resolver_match", None)
            return match is not None and match.url_name in BHYT_ONLY_URL_NAMES
        return True
