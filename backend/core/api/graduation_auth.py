"""Phiên RIÊNG của trang Lễ tốt nghiệp — tách hẳn khỏi phiên Hub.

`GraduationToken` có `token_type = "graduation"`: SimpleJWT kiểm loại token, nên token này
gửi tới API thường của Hub bị `HubJWTAuthentication` từ chối (sai loại), và ngược lại token
Hub thường không mở được API tốt nghiệp. Nhờ vậy học viên cao học xác minh bằng thông tin cá
nhân (không mật khẩu) KHÔNG bao giờ có được quyền gì ngoài trang tốt nghiệp của chính mình.
Không có refresh token: hết 2 giờ thì xác minh lại.
"""
from datetime import timedelta

from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.permissions import BasePermission
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import Token


class GraduationToken(Token):
    token_type = "graduation"
    lifetime = timedelta(hours=2)

    @classmethod
    def for_member(cls, member, via):
        token = cls()
        token["grad_member"] = member.pk
        token["student_id"] = member.student_id
        token["via"] = via
        return token


class GraduationPrincipal:
    is_authenticated = True

    def __init__(self, payload):
        self.member_id = payload["grad_member"]
        self.student_id = payload.get("student_id")
        self.via = payload.get("via", "")
        # HubScopedRateThrottle đọc ldap_uid để định danh — dùng id dòng danh sách.
        self.ldap_uid = f"grad:{self.member_id}"


class GraduationAuthentication(BaseAuthentication):
    def authenticate(self, request):
        header = request.headers.get("Authorization", "")
        if not header.startswith("Bearer "):
            return None
        raw = header[7:].strip()
        if not raw:
            return None
        try:
            token = GraduationToken(raw)
        except TokenError:
            raise AuthenticationFailed("Phiên xác minh đã hết hạn. Vui lòng xác minh lại.") from None
        if "grad_member" not in token.payload:
            raise AuthenticationFailed("Phiên xác minh không hợp lệ.")
        return GraduationPrincipal(token.payload), token

    def authenticate_header(self, request):
        return "Bearer"


class IsGraduationVerified(BasePermission):
    message = "Vui lòng xác minh thông tin để tiếp tục."

    def has_permission(self, request, view):
        return isinstance(request.user, GraduationPrincipal)
