"""SV sửa lại yêu cầu giấy tờ khi bị "Chờ bổ sung thông tin" (PUT /api/requests/<id>/).

Chạy: python manage.py test core.test_request_edit --settings=config.insurance_test_settings
"""
from contextlib import nullcontext
from datetime import date
from unittest import mock

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from core.api.authentication import StudentPrincipal
from core.models import ConfirmationRequest, ConfirmationRequestComment
from core.request_edit import EDIT_COMMENT
from students.models import Student, StudentIdentityDocument


@override_settings(FEATURE_DOCUMENT_REQUESTS=True)
class RequestEditTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.student = Student.objects.create(
            current_student_code="ITITIU20001", full_name="Nguyễn Văn A",
            date_of_birth=date(2002, 5, 1), academic_entry_year=2020,
        )
        StudentIdentityDocument.objects.create(
            student=cls.student, document_type=StudentIdentityDocument.TYPE_CCCD,
            document_number="079202000001", issue_date=date(2021, 4, 10), is_current=True,
        )

    def setUp(self):
        # Hạn mức dùng GET_LOCK của MySQL — test chạy SQLite, và không phải thứ đang kiểm.
        for target, value in (("core.request_quota.student_lock", lambda sid: nullcontext()),
                              ("core.request_quota.check", lambda *a, **k: None)):
            patcher = mock.patch(target, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.client = APIClient()
        self.client.force_authenticate(StudentPrincipal({"ldap_uid": "TEST001", "student_id": self.student.pk}))

    def _create(self, **over):
        body = dict(request_type="other", purpose_code="scholarship", dob="01/05/2002",
                    citizen_id="079202000001", note="ghi chú")
        body.update(over)
        resp = self.client.post("/api/requests/", body, format="json")
        self.assertEqual(resp.status_code, 201, resp.content)
        return ConfirmationRequest.objects.get(pk=resp.json()["id"])

    def _await(self, req, **payload_over):
        req.status = ConfirmationRequest.STATUS_AWAITING_INFO
        if payload_over:
            req.payload = {**req.payload, **payload_over}
        req.save()
        return req

    def _put(self, req, **over):
        body = dict(request_type="other", purpose_code="scholarship", dob="01/05/2002",
                    citizen_id="079202000001")
        body.update(over)
        return self.client.put(f"/api/requests/{req.pk}/", body, format="json")

    def _purpose_codes(self):
        resp = self.client.get("/api/requests/other/form/")
        return [c["code"] for c in resp.json()["purpose_choices"]]

    def test_chi_sua_duoc_khi_cho_bo_sung(self):
        req = self._create(purpose_code=self._purpose_codes()[0])
        self.assertFalse(self.client.get(f"/api/requests/{req.pk}/").json()["student_can_edit"])
        resp = self._put(req, purpose_code=self._purpose_codes()[0])
        self.assertEqual(resp.status_code, 400)

    def test_sua_xong_ve_dang_xu_ly_va_ghi_luot_trao_doi(self):
        codes = self._purpose_codes()
        req = self._await(self._create(purpose_code=codes[0]))
        self.assertTrue(self.client.get(f"/api/requests/{req.pk}/").json()["student_can_edit"])

        resp = self._put(req, purpose_code=codes[1], dob="02/05/2002", note="đã sửa")
        self.assertEqual(resp.status_code, 200, resp.content)
        req.refresh_from_db()
        self.assertEqual(req.status, ConfirmationRequest.STATUS_PENDING)
        self.assertEqual(req.payload["purpose"]["code"], codes[1])
        self.assertEqual(req.note, "đã sửa")
        dob = req.payload["editable"]["dob"]
        self.assertEqual((dob["proposed"], dob["changed"], dob["review"]), ("02/05/2002", True, "pending"))
        last = ConfirmationRequestComment.objects.filter(request=req).latest("id")
        self.assertEqual((last.author_role, last.body), ("student", EDIT_COMMENT))
        self.assertEqual(ConfirmationRequest.objects.count(), 1)

    def test_giu_khoa_cua_dashboard_va_o_da_duyet(self):
        codes = self._purpose_codes()
        req = self._create(purpose_code=codes[0], dob="02/05/2002")
        ed = req.payload["editable"]
        ed["dob"]["review"] = "approved"
        self._await(req, exports=[{"at": "x"}], editable=ed)
        # Dashboard đã ghi ngày sinh duyệt vào hồ sơ gốc.
        Student.objects.filter(pk=self.student.pk).update(date_of_birth=date(2002, 5, 2))

        resp = self._put(req, purpose_code=codes[0], dob="02/05/2002")
        self.assertEqual(resp.status_code, 200, resp.content)
        req.refresh_from_db()
        self.assertEqual(req.payload["exports"], [{"at": "x"}])
        self.assertEqual(req.payload["editable"]["dob"]["review"], "approved")
        self.assertEqual(req.payload["editable"]["dob"]["original"], "01/05/2002")

    def test_khong_sua_lai_o_da_duyet(self):
        codes = self._purpose_codes()
        req = self._create(purpose_code=codes[0], dob="02/05/2002")
        ed = req.payload["editable"]
        ed["dob"]["review"] = "approved"
        self._await(req, editable=ed)
        Student.objects.filter(pk=self.student.pk).update(date_of_birth=date(2002, 5, 2))

        resp = self._put(req, purpose_code=codes[0], dob="03/05/2002")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("đã được Phòng CTSV duyệt", resp.json()["detail"])
        req.refresh_from_db()
        self.assertEqual(req.status, ConfirmationRequest.STATUS_AWAITING_INFO)
        self.assertFalse(ConfirmationRequestComment.objects.filter(request=req).exists())

    def test_du_lieu_sai_thi_khong_doi_gi(self):
        codes = self._purpose_codes()
        req = self._await(self._create(purpose_code=codes[0]))
        resp = self._put(req, purpose_code=codes[0], citizen_id="123")
        self.assertEqual(resp.status_code, 400)
        req.refresh_from_db()
        self.assertEqual(req.status, ConfirmationRequest.STATUS_AWAITING_INFO)

    def test_khong_sua_yeu_cau_cua_nguoi_khac(self):
        codes = self._purpose_codes()
        req = self._await(self._create(purpose_code=codes[0]))
        self.client.force_authenticate(StudentPrincipal({"ldap_uid": "OTHER", "student_id": self.student.pk}))
        self.assertEqual(self._put(req, purpose_code=codes[0]).status_code, 404)
