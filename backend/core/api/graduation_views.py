"""API trang Lễ tốt nghiệp (/le-tot-nghiep) — nghiệp vụ ở core/graduation.py.

Công khai:  GET graduation/ · POST graduation/verify/{ldap,microsoft,info}/
Phiên tốt nghiệp (GraduationToken): GET graduation/me/ · POST graduation/register/ ·
            GET|POST|DELETE graduation/photo/ · POST graduation/cancel/
"""
import logging
from datetime import datetime

from django.conf import settings
from django.core.cache import cache
from django.http import FileResponse, Http404
from rest_framework import status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from core import graduation as grad
from core import microsoft_auth
from core.auth import verify_ldap
from core.graduation_models import GraduationRoundStudent as Member

from .graduation_auth import GraduationAuthentication, GraduationToken, IsGraduationVerified
from .views import _get_ip, _get_str

logger = logging.getLogger("core.api.views")

# Chống dò thông tin học viên cao học: quá số lần sai cho MỘT mã thì khóa tạm mã đó.
INFO_FAIL_LIMIT = 8
INFO_FAIL_WINDOW = 30 * 60


def _error(message, code=status.HTTP_400_BAD_REQUEST):
    return Response({"detail": message}, status=code)


def _session(member, via):
    token = GraduationToken.for_member(member, via)
    return Response({"token": str(token), **grad.member_payload(member)})


class _Public(APIView):
    authentication_classes = []
    permission_classes = []


class _Verify(_Public):
    throttle_scope = "graduation_verify"

    def _round(self):
        round_ = grad.current_round()
        if round_ is None:
            raise Http404
        return round_


class GraduationInfoView(_Public):
    def get(self, request):
        return Response({
            "round": grad.round_payload(grad.current_round()),
            "sessions": grad.SESSIONS,
            "microsoft_login": settings.MS_LOGIN_ENABLED,
        })


class GraduationVerifyLdapView(_Verify):
    def post(self, request):
        uid, password, ip = _get_str(request.data, "uid"), request.data.get("password") or "", _get_ip(request)
        if not uid or not isinstance(password, str) or not password:
            return _error("Vui lòng nhập MSSV và mật khẩu.")
        round_ = self._round()
        if verify_ldap(uid, password) is None:
            logger.warning("GRAD_LDAP_FAIL    | uid=%-20s | ip=%s", uid, ip)
            return _error("Tài khoản hoặc mật khẩu không đúng.", status.HTTP_401_UNAUTHORIZED)
        try:
            member = grad.member_for_account(round_, uid)
        except grad.GraduationError as exc:
            logger.warning("GRAD_NOT_LISTED   | uid=%-20s | qua=ldap | ip=%s", uid, ip)
            return _error(str(exc), status.HTTP_403_FORBIDDEN)
        logger.info("GRAD_VERIFIED     | code=%-14s | qua=ldap | ip=%s", member.student_code, ip)
        return _session(member, "ldap")


class GraduationVerifyMicrosoftView(_Verify):
    def post(self, request):
        if not settings.MS_LOGIN_ENABLED:
            raise Http404
        ip = _get_ip(request)
        code, state = _get_str(request.data, "code"), _get_str(request.data, "state")
        if not code or not state:
            return _error("Thiếu thông tin trả về từ Microsoft. Vui lòng đăng nhập lại.")
        round_ = self._round()
        try:
            claims = microsoft_auth.exchange_code(code, state)
            uid = microsoft_auth.extract_student_code(claims)
        except microsoft_auth.MicrosoftAuthError as exc:
            logger.warning("GRAD_MS_FAIL      | %s | ip=%s", exc, ip)
            return _error(str(exc), status.HTTP_401_UNAUTHORIZED)
        try:
            member = grad.member_for_account(round_, uid)
        except grad.GraduationError as exc:
            logger.warning("GRAD_NOT_LISTED   | uid=%-20s | qua=microsoft | ip=%s", uid, ip)
            return _error(str(exc), status.HTTP_403_FORBIDDEN)
        logger.info("GRAD_VERIFIED     | code=%-14s | qua=microsoft | ip=%s", member.student_code, ip)
        return _session(member, "microsoft")


class GraduationVerifyInfoView(_Verify):
    def post(self, request):
        ip = _get_ip(request)
        code = _get_str(request.data, "code").upper()
        full_name, sex = _get_str(request.data, "full_name"), _get_str(request.data, "sex")
        raw_dob = _get_str(request.data, "date_of_birth")
        if not (code and full_name and sex and raw_dob):
            return _error("Vui lòng nhập đủ mã học viên, họ tên, giới tính và ngày sinh.")
        try:
            dob = datetime.strptime(raw_dob, "%Y-%m-%d").date()
        except ValueError:
            return _error("Ngày sinh không hợp lệ.")
        fail_key = f"grad_info_fail:{code}"
        if (cache.get(fail_key) or 0) >= INFO_FAIL_LIMIT:
            logger.warning("GRAD_INFO_LOCKED  | code=%-14s | ip=%s", code, ip)
            return _error("Nhập sai quá nhiều lần cho mã này. Vui lòng thử lại sau 30 phút hoặc liên hệ "
                          "Phòng Công tác Sinh viên.", status.HTTP_429_TOO_MANY_REQUESTS)
        round_ = self._round()
        try:
            member = grad.member_for_info(round_, code=code, full_name=full_name, sex=sex, date_of_birth=dob)
        except grad.GraduationError as exc:
            if str(exc) == grad.INFO_MISMATCH:
                try:
                    cache.add(fail_key, 0, INFO_FAIL_WINDOW)
                    cache.incr(fail_key)
                except ValueError:
                    cache.set(fail_key, 1, INFO_FAIL_WINDOW)
            logger.warning("GRAD_INFO_FAIL    | code=%-14s | ip=%s", code, ip)
            return _error(str(exc), status.HTTP_403_FORBIDDEN)
        cache.delete(fail_key)
        logger.info("GRAD_VERIFIED     | code=%-14s | qua=info | ip=%s", member.student_code, ip)
        return _session(member, "info")


class _Member(APIView):
    authentication_classes = [GraduationAuthentication]
    permission_classes = [IsGraduationVerified]

    def member(self, request):
        member = (Member.objects.select_related("round", "student", "student__current_department")
                  .filter(pk=request.user.member_id).first())
        if member is None:
            raise Http404
        return member

    def respond(self, member_id):
        member = (Member.objects.select_related("round", "student", "student__current_department")
                  .get(pk=member_id))
        return Response(grad.member_payload(member))


class GraduationMeView(_Member):
    def get(self, request):
        return Response(grad.member_payload(self.member(request)))


class GraduationRegisterView(_Member):
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def post(self, request):
        member = self.member(request)
        try:
            grad.register(member.pk, via=request.user.via, upload=request.FILES.get("photo"))
        except grad.GraduationError as exc:
            return _error(str(exc))
        return self.respond(member.pk)


class GraduationPhotoView(_Member):
    parser_classes = [MultiPartParser, FormParser]

    def get(self, request):
        member = self.member(request)
        path = grad.photo_path(member)
        if path is None:
            raise Http404
        mime = "image/png" if path.suffix.lower() == ".png" else "image/jpeg"
        response = FileResponse(path.open("rb"), content_type=mime)
        response["Cache-Control"] = "private, no-store"
        response["X-Content-Type-Options"] = "nosniff"
        return response

    def post(self, request):
        member = self.member(request)
        try:
            grad.replace_photo(member.pk, request.FILES.get("photo"))
        except grad.GraduationError as exc:
            return _error(str(exc))
        return self.respond(member.pk)

    def delete(self, request):
        member = self.member(request)
        try:
            grad.remove_photo(member.pk)
        except grad.GraduationError as exc:
            return _error(str(exc))
        return self.respond(member.pk)


class GraduationCancelView(_Member):
    def post(self, request):
        member = self.member(request)
        try:
            grad.request_cancel(member.pk, _get_str(request.data, "reason"))
        except grad.GraduationError as exc:
            return _error(str(exc))
        return self.respond(member.pk)
