"""Bản mềm PDF bảng điểm rèn luyện — sinh viên chỉ tải được khi yêu cầu đã Hoàn thành.

Chạy: python manage.py test core.test_soft_copy --settings=config.insurance_test_settings
"""
import shutil
import tempfile
from pathlib import Path

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from core.api.authentication import StudentPrincipal
from core.models import ConfirmationRequest


@override_settings(FEATURE_DOCUMENT_REQUESTS=True)
class SoftCopyDownloadTests(TestCase):
    def setUp(self):
        self.media = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.media, ignore_errors=True)
        override = override_settings(MEDIA_ROOT=self.media)
        override.enable()
        self.addCleanup(override.disable)
        key = "document_requests/1/abc.pdf"
        (Path(self.media) / key).parent.mkdir(parents=True)
        (Path(self.media) / key).write_bytes(b"%PDF-1.4 test")
        self.req = ConfirmationRequest.objects.create(
            student_id=1, ldap_uid="ITITIU20001", request_type="conduct_score", purpose="x",
            status=ConfirmationRequest.STATUS_PROCESSING,
            payload={"delivery": {"code": "online", "label": "Bản mềm (bản online)"},
                     "soft_copy": {"storage_key": key, "filename": "bd.pdf", "size": 13,
                                   "uploaded_by": "Lan Lê"}},
        )
        self.client = APIClient()
        self.client.force_authenticate(StudentPrincipal({"ldap_uid": "ITITIU20001", "student_id": 1}))

    def _detail(self):
        return self.client.get(f"/api/requests/{self.req.pk}/").json()

    def test_chua_hoan_thanh_thi_khong_thay_khong_tai(self):
        body = self._detail()
        self.assertIsNone(body["soft_copy"])
        self.assertNotIn("soft_copy", body["payload"])
        self.assertEqual(self.client.get(f"/api/requests/{self.req.pk}/soft-copy/").status_code, 404)

    def test_hoan_thanh_thi_tai_duoc(self):
        self.req.status = ConfirmationRequest.STATUS_DONE
        self.req.save()
        body = self._detail()
        self.assertEqual(body["soft_copy"], {"filename": "bd.pdf", "size": 13})
        # Không lộ đường dẫn lưu trữ / tên chuyên viên.
        self.assertNotIn("soft_copy", body["payload"])
        resp = self.client.get(f"/api/requests/{self.req.pk}/soft-copy/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(b"".join(resp.streaming_content), b"%PDF-1.4 test")

    def test_khong_tai_duoc_cua_nguoi_khac(self):
        self.req.status = ConfirmationRequest.STATUS_DONE
        self.req.save()
        other = APIClient()
        other.force_authenticate(StudentPrincipal({"ldap_uid": "ITITIU20009", "student_id": 9}))
        self.assertEqual(other.get(f"/api/requests/{self.req.pk}/soft-copy/").status_code, 404)
