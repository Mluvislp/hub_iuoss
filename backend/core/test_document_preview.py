"""Xem trước giấy tờ (POST /api/requests/preview/) — không tạo yêu cầu, đi chung đường kiểm tra.

Chạy: python manage.py test core.test_document_preview --settings=config.insurance_test_settings
"""
from datetime import date
from unittest import mock

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from core.api.authentication import StudentPrincipal
from core.models import ConfirmationRequest
from students.models import Student, StudentIdentityDocument


@override_settings(FEATURE_DOCUMENT_REQUESTS=True, DASHBOARD_INTERNAL_URL="http://127.0.0.1:9",
                   DOCUMENT_PREVIEW_TOKEN="t")
class DocumentPreviewTests(TestCase):
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
        self.client = APIClient()
        self.client.force_authenticate(StudentPrincipal({"ldap_uid": "TEST001", "student_id": self.student.pk}))

    def _body(self, **over):
        purpose = self.client.get("/api/requests/other/form/").json()["purpose_choices"][0]["code"]
        body = dict(request_type="other", purpose_code=purpose, dob="03/05/2002", citizen_id="079202000001")
        body.update(over)
        return body

    @mock.patch("core.document_preview.render", return_value=["QUJD"])
    def test_tra_anh_va_khong_tao_yeu_cau(self, render):
        resp = self.client.post("/api/requests/preview/", self._body(), format="json")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json(), {"pages": ["QUJD"]})
        self.assertEqual(resp["Cache-Control"], "no-store")
        self.assertEqual(ConfirmationRequest.objects.count(), 0)
        request_type, student_id, payload, viewer = render.call_args.args
        self.assertEqual((request_type, student_id, viewer), ("other", self.student.pk, "ITITIU20001"))
        # Payload giống hệt lúc gửi thật: ngày sinh SV sửa nằm ở editable.dob.proposed.
        self.assertEqual(payload["editable"]["dob"]["proposed"], "03/05/2002")

    @mock.patch("core.document_preview.render")
    def test_loi_du_lieu_tra_400_nhu_luc_gui(self, render):
        resp = self.client.post("/api/requests/preview/", self._body(purpose_code="khong-co"), format="json")
        self.assertEqual(resp.status_code, 400)
        render.assert_not_called()

    def test_bang_diem_ren_luyen_chua_ho_tro(self):
        resp = self.client.post("/api/requests/preview/", {"request_type": "conduct_score"}, format="json")
        self.assertEqual(resp.status_code, 400)

    @override_settings(DOCUMENT_PREVIEW_TOKEN="")
    def test_tat_khi_chua_cau_hinh(self):
        self.assertFalse(self.client.get("/api/requests/preview/").json()["enabled"])
        resp = self.client.post("/api/requests/preview/", self._body(), format="json")
        self.assertEqual(resp.status_code, 503)
