"""Lễ tốt nghiệp — xác minh, đăng ký, ảnh trình chiếu, xin hủy (core/graduation.py + graduation_views.py).

Chạy: python manage.py test core.test_graduation --settings=config.insurance_test_settings
"""
import io
import os
import shutil
import tempfile
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import patch

from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient

from core import graduation as grad
from core.api.tokens import HubRefreshToken
from core.graduation_models import GraduationRound, GraduationRoundStudent as Member
from students.models import Student, StudentCodeHistory


def _jpeg(name, size=(1100, 1300)):
    """Ảnh nhiễu ⇒ nén JPEG kém ⇒ > 1 MB với kích thước này."""
    image = Image.frombytes("RGB", size, os.urandom(size[0] * size[1] * 3))
    buf = io.BytesIO()
    image.save(buf, format="JPEG", quality=95)
    assert grad.PHOTO_MIN_BYTES <= buf.tell() < grad.PHOTO_MAX_BYTES, buf.tell()
    return SimpleUploadedFile(name, buf.getvalue(), content_type="image/jpeg")


def _png_big(name):
    image = Image.frombytes("RGB", (800, 700), os.urandom(800 * 700 * 3))
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return SimpleUploadedFile(name, buf.getvalue(), content_type="image/png")


class GraduationTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        now = timezone.now()
        cls.round = GraduationRound.objects.create(
            title="Lễ tốt nghiệp 2026", registration_opens_at=now - timedelta(days=1),
            registration_closes_at=now + timedelta(days=5))
        cls.sv = Student.objects.create(current_student_code="ITITIU22001", full_name="Nguyễn Văn An",
                                        sex="Nam", date_of_birth=date(2004, 1, 2))
        StudentCodeHistory.objects.create(student=cls.sv, student_code="ITITIU22001", code_role="CURRENT")
        cls.m_sv = Member.objects.create(round=cls.round, student=cls.sv, student_code="ITITIU22001",
                                         program_group="IU", ceremony_session="SUN_PM")
        # Học viên cao học hồ sơ dùng chung: mã cao học chỉ là mã CŨ của hồ sơ đại học.
        cls.hv = Student.objects.create(current_student_code="BABAWE15274", full_name="Trịnh Thị Thuỳ Nhi",
                                        sex="Nữ", date_of_birth=date(1997, 3, 4))
        StudentCodeHistory.objects.create(student=cls.hv, student_code="MBAIU23031", code_role="OLD")
        cls.m_hv = Member.objects.create(round=cls.round, student=cls.hv, student_code="MBAIU23031",
                                         program_group="MASTER", ceremony_session="SAT_AM")
        cls.outsider = Student.objects.create(current_student_code="ITITIU22999", full_name="Ngoài Danh Sách")

    def setUp(self):
        cache.clear()
        self.media = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.media, ignore_errors=True)
        override = override_settings(MEDIA_ROOT=self.media)
        override.enable()
        self.addCleanup(override.disable)
        self.client = APIClient()

    # ── helpers ──
    def _verify_hv(self, **over):
        data = {"code": "mbaiu23031", "full_name": "  trịnh thị THÙY nhi ", "sex": "Nữ", "date_of_birth": "1997-03-04"}
        data.update(over)
        return self.client.post("/api/graduation/verify/info/", data, format="json")

    def _login_hv(self):
        res = self._verify_hv()
        self.assertEqual(res.status_code, 200, res.content)
        self.client.credentials(HTTP_AUTHORIZATION="Bearer " + res.json()["token"])
        return res.json()

    def _login_sv(self):
        with patch("core.api.graduation_views.verify_ldap", return_value={"uid": "ITITIU22001"}):
            res = self.client.post("/api/graduation/verify/ldap/", {"uid": "ititiu22001", "password": "x"},
                                   format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.client.credentials(HTTP_AUTHORIZATION="Bearer " + res.json()["token"])
        return res.json()

    # ── công khai ──
    def test_public_info(self):
        res = self.client.get("/api/graduation/")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()["round"]["registration_open"])
        self.assertIn("SAT_AM", res.json()["sessions"])

    # ── xác minh ──
    def test_info_verify_tolerates_case_spaces_and_tone_placement(self):
        data = self._login_hv()
        self.assertEqual(data["student"]["student_code"], "MBAIU23031")
        self.assertEqual(data["student"]["session_label"], grad.SESSIONS["SAT_AM"])
        self.assertIsNone(data["registration"]["status"])

    def test_info_verify_rejects_any_wrong_field_with_one_message(self):
        for over in ({"date_of_birth": "1997-04-03"}, {"sex": "Nam"}, {"full_name": "Trịnh Thị Nhi"},
                     {"code": "MBAIU99999"}):
            res = self._verify_hv(**over)
            self.assertEqual(res.status_code, 403, over)
            self.assertEqual(res.json()["detail"], grad.INFO_MISMATCH)

    def test_info_verify_locks_code_after_repeated_failures(self):
        for _ in range(grad_views_limit()):
            self._verify_hv(date_of_birth="2000-01-01")
        self.assertEqual(self._verify_hv().status_code, 429)          # kể cả thông tin đúng

    def test_info_verify_refuses_undergrad_code(self):
        res = self._verify_hv(code="ITITIU22001", full_name="Nguyễn Văn An", sex="Nam", date_of_birth="2004-01-02")
        self.assertEqual(res.status_code, 403)
        self.assertIn("Sinh viên", res.json()["detail"])

    def test_ldap_verify_requires_listed_student(self):
        with patch("core.api.graduation_views.verify_ldap", return_value={"uid": "x"}):
            res = self.client.post("/api/graduation/verify/ldap/", {"uid": "ITITIU22999", "password": "x"},
                                   format="json")
        self.assertEqual(res.status_code, 403)
        with patch("core.api.graduation_views.verify_ldap", return_value=None):
            res = self.client.post("/api/graduation/verify/ldap/", {"uid": "ITITIU22001", "password": "x"},
                                   format="json")
        self.assertEqual(res.status_code, 401)

    def test_ldap_verify_rejects_graduate_member(self):
        with patch("core.api.graduation_views.verify_ldap", return_value={"uid": "x"}):
            res = self.client.post("/api/graduation/verify/ldap/", {"uid": "MBAIU23031", "password": "x"},
                                   format="json")
        self.assertEqual(res.status_code, 403)
        self.assertIn("Học viên cao học", res.json()["detail"])

    def test_tokens_do_not_cross(self):
        data = self._login_hv()
        # Phiên tốt nghiệp không mở được API thường của Hub…
        self.assertIn(self.client.get("/api/dashboard/").status_code, (401, 403))
        # …và phiên Hub thường không mở được API tốt nghiệp.
        hub = HubRefreshToken.for_student(ldap_uid="ITITIU22001", student_id=self.sv.pk,
                                          student_code="ITITIU22001", full_name="x")
        self.client.credentials(HTTP_AUTHORIZATION="Bearer " + str(hub.access_token))
        self.assertEqual(self.client.get("/api/graduation/me/").status_code, 401)
        self.assertTrue(data["token"])

    # ── đăng ký + QR ──
    def test_register_without_photo_issues_unique_qr(self):
        self._login_sv()
        res = self.client.post("/api/graduation/register/", {}, format="multipart")
        self.assertEqual(res.status_code, 200, res.content)
        qr = res.json()["registration"]["qr"]
        self.assertTrue(qr.startswith(grad.QR_PREFIX))
        self.assertEqual(len(qr) - len(grad.QR_PREFIX), 32)
        self.m_sv.refresh_from_db()
        self.assertEqual((self.m_sv.registration_status, self.m_sv.verified_via), ("registered", "ldap"))
        self.assertEqual(self.client.post("/api/graduation/register/", {}, format="multipart").status_code, 400)

    def test_register_closed_window(self):
        GraduationRound.objects.filter(pk=self.round.pk).update(registration_opens_at=None, registration_closes_at=None)
        self._login_sv()
        res = self.client.post("/api/graduation/register/", {}, format="multipart")
        self.assertEqual(res.status_code, 400)
        self.assertIn("Ngoài thời gian", res.json()["detail"])

    def test_register_with_photo_then_replace_deletes_old_file(self):
        self._login_hv()
        res = self.client.post("/api/graduation/register/", {"photo": _jpeg("MBAIU23031.jpg")}, format="multipart")
        self.assertEqual(res.status_code, 200, res.content)
        self.m_hv.refresh_from_db()
        old = Path(self.media) / self.m_hv.photo_storage_key
        self.assertTrue(old.exists())
        photo = self.client.get("/api/graduation/photo/")
        self.assertEqual(photo.status_code, 200)
        photo.close()
        with self.captureOnCommitCallbacks(execute=True):
            res = self.client.post("/api/graduation/photo/", {"photo": _png_big("mbaiu23031.PNG")}, format="multipart")
        self.assertEqual(res.status_code, 200, res.content)
        self.m_hv.refresh_from_db()
        self.assertFalse(old.exists())
        self.assertTrue((Path(self.media) / self.m_hv.photo_storage_key).exists())
        self.assertTrue(self.m_hv.photo_storage_key.endswith(".png"))
        self.assertTrue(self.m_hv.photo_storage_key.startswith("insurance_private/graduation/"))

    def test_remove_photo(self):
        self._login_hv()
        self.client.post("/api/graduation/register/", {"photo": _jpeg("MBAIU23031.jpeg")}, format="multipart")
        self.m_hv.refresh_from_db()
        path = Path(self.media) / self.m_hv.photo_storage_key
        with self.captureOnCommitCallbacks(execute=True):
            res = self.client.delete("/api/graduation/photo/")
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.json()["registration"]["has_photo"])
        self.assertFalse(path.exists())

    # ── kiểm ảnh ──
    def _photo_error(self, upload):
        with self.assertRaises(grad.GraduationError) as ctx:
            grad.validate_photo(upload, self.m_sv)
        return str(ctx.exception)

    def test_photo_name_rules(self):
        self.assertIn("khoảng trắng", self._photo_error(_jpeg("ITITIU22001 .jpg")))
        self.assertIn("khoảng trắng", self._photo_error(_jpeg("ITITIU22001.jpg ")))
        self.assertIn("đúng mã số", self._photo_error(_jpeg("ITITIU22002.jpg")))
        self.assertIn("JPG / JPEG / PNG", self._photo_error(_jpeg("ITITIU22001.heic")))
        self.assertIn("JPG / JPEG / PNG", self._photo_error(_jpeg("ITITIU22001.jpg.png.exe")))
        data, ext = grad.validate_photo(_jpeg("ititiu22001.JPG"), self.m_sv)
        self.assertEqual(ext, "jpg")

    def test_photo_size_and_content_rules(self):
        small = io.BytesIO()
        Image.new("RGB", (900, 900), "white").save(small, format="JPEG")
        self.assertIn("quá nhỏ", self._photo_error(SimpleUploadedFile("ITITIU22001.jpg", small.getvalue())))
        self.assertIn("quá lớn", self._photo_error(
            SimpleUploadedFile("ITITIU22001.jpg", b"\xff\xd8\xff" + b"0" * (5 * 1024 * 1024))))
        self.assertIn("không phải ảnh", self._photo_error(
            SimpleUploadedFile("ITITIU22001.jpg", b"%PDF-1.4" + b"0" * (2 * 1024 * 1024))))
        self.assertIn("đuôi file là .png", self._photo_error(_jpeg("ITITIU22001.png")))
        # Đầu JPEG thật nhưng thân hỏng.
        self.assertIn("Không đọc được", self._photo_error(
            SimpleUploadedFile("ITITIU22001.jpg", b"\xff\xd8\xff\xe0" + os.urandom(2 * 1024 * 1024))))
        # Đủ dung lượng nhưng độ phân giải quá thấp (PNG nhiễu 560x560 ≈ 0,9 MB… nên dùng 590x1300).
        low = Image.frombytes("RGB", (590, 1300), os.urandom(590 * 1300 * 3))
        buf = io.BytesIO()
        low.save(buf, format="PNG")
        self.assertIn("độ phân giải thấp", self._photo_error(SimpleUploadedFile("ITITIU22001.png", buf.getvalue())))

    # ── xin hủy ──
    def test_cancel_request_locks_changes_but_keeps_qr(self):
        self._login_sv()
        self.client.post("/api/graduation/register/", {}, format="multipart")
        self.assertEqual(self.client.post("/api/graduation/cancel/", {"reason": ""}, format="json").status_code, 400)
        res = self.client.post("/api/graduation/cancel/", {"reason": "Trùng lịch công tác"}, format="json")
        self.assertEqual(res.status_code, 200)
        reg = res.json()["registration"]
        self.assertEqual(reg["status"], "cancel_requested")
        self.assertTrue(reg["qr"])
        self.assertFalse(reg["can_edit"])
        res = self.client.post("/api/graduation/photo/", {"photo": _jpeg("ITITIU22001.jpg")}, format="multipart")
        self.assertEqual(res.status_code, 400)

    def test_reregister_after_cancel_gets_new_token(self):
        self._login_sv()
        first = self.client.post("/api/graduation/register/", {}, format="multipart").json()["registration"]["qr"]
        Member.objects.filter(pk=self.m_sv.pk).update(registration_status="cancelled", checkin_token=None,
                                                      cancel_reason="x", cancel_requested_at=timezone.now())
        res = self.client.post("/api/graduation/register/", {}, format="multipart")
        self.assertEqual(res.status_code, 200)
        self.assertNotEqual(res.json()["registration"]["qr"], first)
        self.assertEqual(res.json()["registration"]["cancel_reason"], "")


def grad_views_limit():
    from core.api.graduation_views import INFO_FAIL_LIMIT
    return INFO_FAIL_LIMIT


@override_settings(MS_TENANT_ID="t", MS_CLIENT_ID="c", MS_CLIENT_SECRET="s", MS_LOGIN_ENABLED=True,
                   MS_REDIRECT_URI="https://hub.iuoss.com/auth/microsoft/callback",
                   MS_REDIRECT_URIS=["https://hub.iuoss.com/auth/microsoft/callback",
                                     "https://graduation.iuoss.com/auth/microsoft/callback"],
                   ALLOWED_HOSTS=["testserver", "hub.iuoss.com", "graduation.iuoss.com", "graduation-sandbox.iuoss.com"])
class GraduationDomainTests(TestCase):
    """Tên miền riêng graduation.iuoss.com: Microsoft quay về đúng tên miền đã khai ở Azure."""

    def test_redirect_uri_only_for_registered_hosts(self):
        from core import microsoft_auth as ms
        self.assertEqual(ms.redirect_uri_for_host("graduation.iuoss.com"),
                         "https://graduation.iuoss.com/auth/microsoft/callback")
        self.assertIsNone(ms.redirect_uri_for_host("graduation-sandbox.iuoss.com"))
        self.assertIsNone(ms.redirect_uri_for_host("evil.example.com"))

    def test_start_url_and_state_carry_host_redirect(self):
        from urllib.parse import parse_qs, urlsplit
        from django.core import signing
        from core import microsoft_auth as ms
        res = APIClient().get("/api/auth/microsoft/start/", HTTP_HOST="graduation.iuoss.com")
        q = parse_qs(urlsplit(res.json()["authorize_url"]).query)
        self.assertEqual(q["redirect_uri"], ["https://graduation.iuoss.com/auth/microsoft/callback"])
        state = signing.loads(q["state"][0], salt=ms.STATE_SALT)
        self.assertEqual(state["r"], "https://graduation.iuoss.com/auth/microsoft/callback")
        # Tên miền chưa khai ⇒ về địa chỉ mặc định của Hub.
        res = APIClient().get("/api/auth/microsoft/start/", HTTP_HOST="graduation-sandbox.iuoss.com")
        self.assertIn("redirect_uri=https%3A%2F%2Fhub.iuoss.com", res.json()["authorize_url"])

    def test_exchange_rejects_tampered_redirect(self):
        from django.core import signing
        from core import microsoft_auth as ms
        bad = signing.dumps({"v": "x", "n": "y", "r": "https://evil.example.com/cb"}, salt=ms.STATE_SALT)
        with self.assertRaises(ms.MicrosoftAuthError):
            ms.exchange_code("code", bad)

    def test_info_hides_outlook_on_unregistered_host(self):
        GraduationRound.objects.create(title="Lễ tốt nghiệp 2026")
        self.assertTrue(APIClient().get("/api/graduation/", HTTP_HOST="graduation.iuoss.com").json()["microsoft_login"])
        self.assertFalse(APIClient().get("/api/graduation/", HTTP_HOST="graduation-sandbox.iuoss.com").json()["microsoft_login"])
