from rest_framework_simplejwt.tokens import RefreshToken


class HubRefreshToken(RefreshToken):
    """RefreshToken tùy chỉnh — mang thông tin student session trong payload."""

    @classmethod
    def for_student(
        cls,
        ldap_uid: str,
        student_id,
        student_code: str,
        full_name: str,
    ) -> "HubRefreshToken":
        token = cls()
        token["ldap_uid"] = ldap_uid
        token["student_id"] = student_id
        token["student_code"] = student_code
        token["full_name"] = full_name
        return token
