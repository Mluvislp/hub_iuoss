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
from core.graduation_models import Bank, GraduationRound, GraduationRoundStudent as Member
from students.models import Student, StudentBankAccount, StudentCodeHistory


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
        cls.vcb = Bank.objects.create(short_name="Vietcombank", full_name="Ngân hàng TMCP Ngoại Thương Việt Nam",
                                      sort_order=1)
        Bank.objects.create(short_name="OldBank", full_name="Ngân hàng đã ngừng", sort_order=99, is_active=False)

    def bank_data(self, **over):
        data = {"bank_id": str(self.vcb.pk), "bank_account_number": "0071 0000 12345",
                "bank_account_holder": "nguyen  van an"}
        data.update(over)
        return data

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
        res = self.client.post("/api/graduation/register/", self.bank_data(), format="multipart")
        self.assertEqual(res.status_code, 200, res.content)
        qr = res.json()["registration"]["qr"]
        self.assertTrue(qr.startswith(grad.QR_PREFIX))
        self.assertEqual(len(qr) - len(grad.QR_PREFIX), 32)
        self.m_sv.refresh_from_db()
        self.assertEqual((self.m_sv.registration_status, self.m_sv.verified_via), ("registered", "ldap"))
        self.assertEqual(self.client.post("/api/graduation/register/", self.bank_data(), format="multipart").status_code, 400)

    def test_verify_blocked_before_window_opens_but_allowed_after_close(self):
        now = timezone.now()
        GraduationRound.objects.filter(pk=self.round.pk).update(registration_opens_at=None, registration_closes_at=None)
        self.assertEqual(self._verify_hv().status_code, 403)
        self.assertIn("Chưa mở", self._verify_hv().json()["detail"])
        GraduationRound.objects.filter(pk=self.round.pk).update(
            registration_opens_at=now + timedelta(hours=2), registration_closes_at=now + timedelta(days=2))
        self.assertEqual(self._verify_hv().status_code, 403)
        GraduationRound.objects.filter(pk=self.round.pk).update(
            registration_opens_at=now - timedelta(days=3), registration_closes_at=now - timedelta(days=1))
        self.assertEqual(self._verify_hv().status_code, 200)        # hết hạn: vẫn xem lại được

    def test_register_closed_window(self):
        self._login_sv()
        now = timezone.now()
        GraduationRound.objects.filter(pk=self.round.pk).update(
            registration_opens_at=now - timedelta(days=3), registration_closes_at=now - timedelta(days=1))
        res = self.client.post("/api/graduation/register/", self.bank_data(), format="multipart")
        self.assertEqual(res.status_code, 400)
        self.assertIn("Ngoài thời gian", res.json()["detail"])

    def test_register_with_photo_then_replace_deletes_old_file(self):
        self._login_hv()
        res = self.client.post("/api/graduation/register/", {**self.bank_data(), "photo": _jpeg("IMG 0042 (1).JPG")}, format="multipart")
        self.assertEqual(res.status_code, 200, res.content)
        self.m_hv.refresh_from_db()
        old = Path(self.media) / self.m_hv.photo_storage_key
        self.assertTrue(old.exists())
        self.assertEqual(self.m_hv.photo_original_filename, "MBAIU23031.jpg")
        photo = self.client.get("/api/graduation/photo/")
        self.assertEqual(photo.status_code, 200)
        photo.close()
        with self.captureOnCommitCallbacks(execute=True):
            res = self.client.post("/api/graduation/photo/", {"photo": _png_big("chan dung.jpg")}, format="multipart")
        self.assertEqual(res.status_code, 200, res.content)
        self.m_hv.refresh_from_db()
        self.assertFalse(old.exists())
        self.assertTrue((Path(self.media) / self.m_hv.photo_storage_key).exists())
        self.assertTrue(self.m_hv.photo_storage_key.endswith(".png"))
        self.assertEqual(self.m_hv.photo_original_filename, "MBAIU23031.png")
        self.assertTrue(self.m_hv.photo_storage_key.startswith("insurance_private/graduation/"))

    def test_remove_photo(self):
        self._login_hv()
        self.client.post("/api/graduation/register/", {**self.bank_data(), "photo": _jpeg("MBAIU23031.jpeg")}, format="multipart")
        self.m_hv.refresh_from_db()
        path = Path(self.media) / self.m_hv.photo_storage_key
        with self.captureOnCommitCallbacks(execute=True):
            res = self.client.delete("/api/graduation/photo/")
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.json()["registration"]["has_photo"])
        self.assertFalse(path.exists())

    # ── tài khoản hoàn cọc ──
    def test_register_requires_valid_bank(self):
        self._login_sv()
        cases = [({"bank_id": ""}, "chọn ngân hàng"),
                 ({"bank_id": "999999"}, "chọn ngân hàng"),
                 ({"bank_id": str(Bank.objects.get(short_name="OldBank").pk)}, "chọn ngân hàng"),
                 ({"bank_account_number": ""}, "nhập số tài khoản"),
                 ({"bank_account_number": "12AB5678"}, "chỉ gồm chữ số"),
                 ({"bank_account_number": "12345"}, "từ 6 đến 20"),
                 ({"bank_account_holder": "  "}, "tên chủ tài khoản"),
                 ({"bank_account_holder": "Nguyen 123"}, "chữ cái"),
                 ({"bank_account_holder": "Nguyễn Văn An"}, "KHÔNG DẤU"),
                 ({"bank_account_holder": "DANG VAN Đ"}, "KHÔNG DẤU")]
        for over, msg in cases:
            res = self.client.post("/api/graduation/register/", self.bank_data(**over), format="multipart")
            self.assertEqual(res.status_code, 400, over)
            self.assertIn(msg, res.json()["detail"], over)
        self.m_sv.refresh_from_db()
        self.assertIsNone(self.m_sv.registration_status)

    def test_register_normalizes_bank(self):
        self._login_sv()
        res = self.client.post("/api/graduation/register/", self.bank_data(), format="multipart")
        bank = res.json()["bank"]
        self.assertEqual((bank["bank_short_name"], bank["account_number"], bank["holder"]),
                         ("Vietcombank", "0071000012345", "NGUYEN VAN AN"))

    def test_update_bank_and_lock_after_cancel_request(self):
        self._login_sv()
        self.client.post("/api/graduation/register/", self.bank_data(), format="multipart")
        res = self.client.post("/api/graduation/bank/", self.bank_data(bank_account_number="9999888877",
                                                                       bank_account_holder="tran thi binh"),
                               format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["bank"]["holder"], "TRAN THI BINH")
        self.client.post("/api/graduation/cancel/", {"reason": "Bận việc gia đình"}, format="json")
        res = self.client.post("/api/graduation/bank/", self.bank_data(), format="json")
        self.assertEqual(res.status_code, 400)

    def test_bank_suggestion_from_profile(self):
        StudentBankAccount.objects.create(student=self.sv, bank_name="vietcombank", account_number="0071-000-777")
        data = self._login_sv()
        self.assertIsNone(data["bank"])
        self.assertEqual(data["bank_suggestion"], {"bank_id": self.vcb.pk, "account_number": "0071000777",
                                                   "holder": ""})

    def test_public_info_lists_only_active_banks(self):
        names = [b["short_name"] for b in self.client.get("/api/graduation/").json()["banks"]]
        self.assertEqual(names, ["Vietcombank"])

    # ── duyệt ảnh (trạng thái do Dashboard đặt) ──
    def test_upload_sets_pending_and_replace_resets_review(self):
        self._login_hv()
        self.client.post("/api/graduation/register/", {**self.bank_data(), "photo": _jpeg("a.jpg")}, format="multipart")
        self.m_hv.refresh_from_db()
        self.assertEqual(self.m_hv.photo_status, "pending")
        cropped = Path(self.media) / "insurance_private/graduation/1/cropped/MBAIU23031_x.jpg"
        cropped.parent.mkdir(parents=True, exist_ok=True)
        cropped.write_bytes(b"x")
        Member.objects.filter(pk=self.m_hv.pk).update(
            photo_status="approved", photo_crop={"x": 0, "y": 0, "w": 800, "h": 1000},
            photo_cropped_storage_key="insurance_private/graduation/1/cropped/MBAIU23031_x.jpg")
        with self.captureOnCommitCallbacks(execute=True):
            res = self.client.post("/api/graduation/photo/", {"photo": _jpeg("b.jpg")}, format="multipart")
        self.assertEqual(res.json()["registration"]["photo_status"], "pending")
        self.m_hv.refresh_from_db()
        self.assertIsNone(self.m_hv.photo_crop)
        self.assertIsNone(self.m_hv.photo_cropped_storage_key)
        self.assertFalse(cropped.exists())

    def test_rejected_photo_can_be_replaced_after_deadline(self):
        self._login_hv()
        self.client.post("/api/graduation/register/", {**self.bank_data(), "photo": _jpeg("a.jpg")}, format="multipart")
        now = timezone.now()
        GraduationRound.objects.filter(pk=self.round.pk).update(
            registration_opens_at=now - timedelta(days=5), registration_closes_at=now - timedelta(days=1))
        # Hết hạn, ảnh chưa bị từ chối ⇒ không đổi được.
        self.assertEqual(self.client.post("/api/graduation/photo/", {"photo": _jpeg("b.jpg")}, format="multipart").status_code, 400)
        Member.objects.filter(pk=self.m_hv.pk).update(photo_status="rejected", photo_review_note="Không mặc lễ phục")
        me = self.client.get("/api/graduation/me/").json()["registration"]
        self.assertTrue(me["can_replace_photo"])
        self.assertEqual(me["photo_review_note"], "Không mặc lễ phục")
        res = self.client.post("/api/graduation/photo/", {"photo": _jpeg("c.jpg")}, format="multipart")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()["registration"]["photo_status"], "pending")
        self.assertEqual(self.client.delete("/api/graduation/photo/").status_code, 400)   # gỡ ảnh vẫn theo hạn

    # ── kiểm ảnh ──
    def _photo_error(self, upload):
        with self.assertRaises(grad.GraduationError) as ctx:
            grad.validate_photo(upload, self.m_sv)
        return str(ctx.exception)

    def test_photo_any_filename_is_accepted_and_ext_follows_content(self):
        # Bỏ luật tên file (05/11/2026): tên gì cũng nhận, kể cả khoảng trắng / sai mã / sai đuôi.
        for name in ("ITITIU22001 .jpg", "anh cua toi.JPG", "IMG_2024.jpeg ", "ITITIU22002.jpg", "photo.png", "no-ext"):
            data, ext = grad.validate_photo(_jpeg(name), self.m_sv)
            self.assertEqual(ext, "jpg", name)               # ảnh JPEG thật ⇒ .jpg dù đuôi .png / không đuôi
        self.assertEqual(grad.validate_photo(_png_big("x.jpg"), self.m_sv)[1], "png")
        self.assertEqual(grad.stored_photo_name(self.m_sv, "png"), "ITITIU22001.png")

    def test_photo_size_and_content_rules(self):
        small = io.BytesIO()
        Image.new("RGB", (900, 900), "white").save(small, format="JPEG")
        self.assertIn("quá nhỏ", self._photo_error(SimpleUploadedFile("ITITIU22001.jpg", small.getvalue())))
        self.assertIn("quá lớn", self._photo_error(
            SimpleUploadedFile("ITITIU22001.jpg", b"\xff\xd8\xff" + b"0" * (5 * 1024 * 1024))))
        self.assertIn("không phải ảnh", self._photo_error(
            SimpleUploadedFile("ITITIU22001.jpg", b"%PDF-1.4" + b"0" * (2 * 1024 * 1024))))
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
        self.client.post("/api/graduation/register/", self.bank_data(), format="multipart")
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
        first = self.client.post("/api/graduation/register/", self.bank_data(), format="multipart").json()["registration"]["qr"]
        Member.objects.filter(pk=self.m_sv.pk).update(registration_status="cancelled", checkin_token=None,
                                                      cancel_reason="x", cancel_requested_at=timezone.now())
        res = self.client.post("/api/graduation/register/", self.bank_data(), format="multipart")
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
