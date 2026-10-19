"""Nạp giấy tờ trực tiếp — API sinh viên (core/direct_submissions.py, core/api/submission_views.py).

Chạy: python manage.py test core.test_direct_submissions --settings=config.insurance_test_settings
"""
import io
import shutil
import tempfile
from datetime import date

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from PIL import Image
from rest_framework.test import APIClient

from core.api.authentication import StudentPrincipal
from core.submission_code import decode
from core.submission_models import DirectSubmission, SubmissionComment, SubmissionFile
from students.models import Student, StudentContactPoint, StudentIdentityDocument


def _png(name="a.png"):
    buf = io.BytesIO()
    Image.new("RGB", (40, 30), "white").save(buf, format="PNG")
    return SimpleUploadedFile(name, buf.getvalue(), content_type="image/png")


def _pdf(name="scan.pdf"):
    return SimpleUploadedFile(name, b"%PDF-1.4\n%test\n", content_type="application/pdf")


@override_settings(FEATURE_DIRECT_SUBMISSIONS=True)
class DirectSubmissionApiTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.student = Student.objects.create(current_student_code="ITITIU20001", full_name="Nguyễn Văn A",
                                             date_of_birth=date(2002, 5, 1))
        StudentContactPoint.objects.create(student=cls.student, contact_type=StudentContactPoint.TYPE_MOBILE_PHONE,
                                           contact_value="0911111111", normalized_contact_value="0911111111",
                                           is_current=True)
        StudentIdentityDocument.objects.create(student=cls.student, document_type=StudentIdentityDocument.TYPE_CCCD,
                                               document_number="079202000001", issue_date=date(2021, 4, 1),
                                               is_current=True)
        cls.other = Student.objects.create(current_student_code="ITITIU20002", full_name="Trần B")

    def setUp(self):
        self.media = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.media, ignore_errors=True)
        override = override_settings(MEDIA_ROOT=self.media)
        override.enable()
        self.addCleanup(override.disable)
        self.client = APIClient()
        self.client.force_authenticate(StudentPrincipal({"ldap_uid": "ITITIU20001", "student_id": self.student.pk,
                                                         "full_name": "Nguyễn Văn A"}))

    def body(self, **over):
        data = {"document_name": "Đơn xác nhận vay vốn ngân hàng ABC", "copies": "2", "phone": "0911 111 111",
                "dob": "01/05/2002", "citizen_id": "079202000001", "citizen_id_issue_date": "01/04/2021",
                "note": "", "consent": "1", "files": [_png(), _pdf()]}
        data.update(over)
        return data

    def create(self, **over):
        return self.client.post("/api/submissions/", self.body(**over), format="multipart")

    def test_form_prefill(self):
        r = self.client.get("/api/submissions/form/")
        self.assertEqual(r.status_code, 200)
        p = r.json()["prefill"]
        self.assertEqual(p["student_id"], "ITITIU20001")
        self.assertEqual(p["phone"], "0911111111")
        self.assertTrue(p["cccd_valid"])
        self.assertEqual(r.json()["limits"]["max_files"], 10)

    def test_tao_moi_luu_file_va_payload(self):
        r = self.create()
        self.assertEqual(r.status_code, 201, r.content)
        sub = DirectSubmission.objects.get(pk=r.json()["id"])
        self.assertEqual(decode(r.json()["code"])[0], sub.pk)
        self.assertEqual(sub.copies, 2)
        self.assertEqual(sub.contact_phone, "0911111111")
        self.assertEqual(sub.status, "pending")
        self.assertFalse(sub.payload["editable"]["dob"]["changed"])
        self.assertEqual(SubmissionFile.objects.filter(submission=sub).count(), 2)
        detail = self.client.get(f"/api/submissions/{sub.pk}/").json()
        self.assertEqual(len(detail["files"]), 2)
        f = detail["files"][0]
        resp = self.client.get(f"/api/submissions/{sub.pk}/files/{f['id']}/")
        self.assertEqual(resp.status_code, 200)

    def test_xin_sua_ngay_sinh_va_cccd(self):
        r = self.create(dob="02/05/2002", citizen_id="079202000009", citizen_id_issue_date="03/03/2023")
        self.assertEqual(r.status_code, 201, r.content)
        ed = DirectSubmission.objects.get(pk=r.json()["id"]).payload["editable"]
        self.assertEqual(ed["dob"]["review"], "pending")
        self.assertEqual(ed["citizen_id"]["proposed"], "079202000009")
        self.assertTrue(ed["citizen_id_issue_date"]["changed"])

    def test_bat_buoc_cam_doan_ten_giay_file_sdt(self):
        self.assertEqual(self.create(consent="").json()["errors"], {"consent": "Vui lòng tích vào ô cam đoan trước khi gửi yêu cầu."})
        self.assertIn("document_name", self.create(document_name="  ").json()["errors"])
        self.assertIn("phone", self.create(phone="12345").json()["errors"])
        self.assertIn("files", self.create(files=[]).json()["errors"])
        self.assertIn("copies", self.create(copies="11").json()["errors"])
        self.assertFalse(DirectSubmission.objects.exists())

    def test_toi_da_10_file_va_tu_choi_file_gia(self):
        r = self.create(files=[_png(f"{i}.png") for i in range(11)])
        self.assertEqual(r.status_code, 400)
        fake = SimpleUploadedFile("x.pdf", b"not a pdf", content_type="application/pdf")
        r = self.create(files=[fake])
        self.assertEqual(r.status_code, 400)
        self.assertIn("files", r.json()["errors"])

    def test_khong_xem_duoc_yeu_cau_nguoi_khac(self):
        sid = self.create().json()["id"]
        other = APIClient()
        other.force_authenticate(StudentPrincipal({"ldap_uid": "ITITIU20002", "student_id": self.other.pk}))
        self.assertEqual(other.get(f"/api/submissions/{sid}/").status_code, 404)
        self.assertEqual(other.get("/api/submissions/").json(), [])

    def test_sua_luc_cho_bo_sung_go_va_them_file(self):
        sid = self.create().json()["id"]
        sub = DirectSubmission.objects.get(pk=sid)
        # Chưa ở "Chờ bổ sung" ⇒ không sửa được.
        r = self.client.put(f"/api/submissions/{sid}/", self.body(files=[]), format="multipart")
        self.assertEqual(r.status_code, 400)
        sub.status = "awaiting_info"
        sub.payload["return_receipts"] = [{"storage_key": "x.pdf"}]
        sub.save()
        first = SubmissionFile.objects.filter(submission=sub).first()
        r = self.client.put(f"/api/submissions/{sid}/",
                            self.body(document_name="Giấy mới", files=[_png("moi.png")], remove_file_ids=[first.pk]),
                            format="multipart")
        self.assertEqual(r.status_code, 200, r.content)
        body = r.json()
        self.assertEqual(body["status"], "pending")
        self.assertEqual(body["document_name"], "Giấy mới")
        self.assertEqual(len(body["files"]), 2)
        self.assertNotIn("return_receipts", body["payload"])
        self.assertTrue(SubmissionFile.objects.get(pk=first.pk).is_removed)
        self.assertEqual(SubmissionComment.objects.filter(submission=sub, event="student_edit").count(), 1)

    def test_sua_khong_doi_duoc_o_da_duyet(self):
        sid = self.create(dob="02/05/2002").json()["id"]
        sub = DirectSubmission.objects.get(pk=sid)
        sub.status = "awaiting_info"
        sub.payload["editable"]["dob"]["review"] = "approved"
        sub.save()
        r = self.client.put(f"/api/submissions/{sid}/", self.body(dob="03/05/2002", files=[]), format="multipart")
        self.assertEqual(r.status_code, 400)
        self.assertIn("dob", r.json()["errors"])

    def test_tra_loi_luc_cho_bo_sung_ve_cho_xu_ly(self):
        sid = self.create().json()["id"]
        DirectSubmission.objects.filter(pk=sid).update(status="awaiting_info")
        SubmissionComment.objects.create(submission_id=sid, author_role="staff", author_name="CV", body="nội bộ",
                                         is_internal=True, created_at="2026-10-19T08:00:00Z")
        r = self.client.post(f"/api/submissions/{sid}/comments/", {"body": "Em đã bổ sung"}, format="json")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.json()["status"], "pending")
        comments = self.client.get(f"/api/submissions/{sid}/").json()["comments"]
        self.assertEqual([c["body"] for c in comments], ["Em đã bổ sung"])   # ghi chú nội bộ bị lọc

    @override_settings(FEATURE_DIRECT_SUBMISSIONS=False)
    def test_tat_co_thi_endpoint_bien_mat(self):
        self.assertEqual(self.client.get("/api/submissions/").status_code, 404)
