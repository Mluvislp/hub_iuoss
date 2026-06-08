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


class IsHubAuthenticated(BasePermission):
    """Chỉ cho phép StudentPrincipal đã xác thực."""

    def has_permission(self, request, view):
        return isinstance(request.user, StudentPrincipal)
