"""Trang "Thông tin cá nhân" (GET/POST /api/personal-info/).

Chạy: python manage.py test core.test_personal_info --settings=config.insurance_test_settings
"""
from datetime import date

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from core.api.authentication import StudentPrincipal
from students.models import (
    ProfileChangeRequest, Student, StudentContactPoint, StudentFamilyMember,
)

FATHER = {"status": "", "full_name": "Nguyễn Văn Ba", "phone": "0901234567",
          "email": "", "occupation": "Kỹ sư"}


@override_settings(FEATURE_PERSONAL_INFO=True)
class PersonalInfoApiTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.student = Student.objects.create(
            current_student_code="ITITIU20001", full_name="Nguyễn Văn A", sex="Nam",
            date_of_birth=date(2002, 5, 1),
        )
        StudentContactPoint.objects.create(
            student=cls.student, contact_type=StudentContactPoint.TYPE_MOBILE_PHONE,
            contact_value="0911111111", normalized_contact_value="0911111111", is_current=True,
        )
        StudentFamilyMember.objects.create(student=cls.student, relationship="MOTHER",
                                           full_name="Trần Thị B", parent_status="DECEASED")

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(StudentPrincipal({"ldap_uid": "TEST001",
                                                         "student_id": self.student.pk}))

    def post(self, groups):
        return self.client.post("/api/personal-info/", {"groups": groups}, format="json")

    def group(self, data, key):
        return next(g for g in data["groups"] if g["key"] == key)

    def test_get_readonly_and_groups(self):
        data = self.client.get("/api/personal-info/").json()
        self.assertEqual(data["readonly"]["student_code"], "ITITIU20001")
        self.assertEqual(data["readonly"]["date_of_birth"], "01/05/2002")
        self.assertTrue(self.group(data, "personal_email")["is_blank"])
        self.assertFalse(self.group(data, "mobile_phone")["is_blank"])
        mother = self.group(data, "mother")["value"]
        self.assertEqual(mother["status"], "DECEASED")
        self.assertEqual(mother["full_name"], "Trần Thị B")
        self.assertEqual(self.group(data, "father")["value"]["status"], "")

    def test_submit_creates_pending_and_touches_nothing(self):
        resp = self.post({"personal_email": "a@gmail.com", "father": FATHER})
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()["sent"], 2)
        rows = ProfileChangeRequest.objects.filter(student=self.student)
        self.assertEqual({r.status for r in rows}, {ProfileChangeRequest.STATUS_PENDING})
        self.assertEqual(len({r.group_key for r in rows}), 1)
        self.assertFalse(StudentContactPoint.objects.filter(
            student=self.student, contact_type=StudentContactPoint.TYPE_PERSONAL_EMAIL).exists())
        self.assertFalse(StudentFamilyMember.objects.filter(
            student=self.student, relationship="FATHER").exists())
        self.assertIsNotNone(self.group(resp.json(), "father")["pending"])

    def test_errors_are_per_group_and_nothing_saved(self):
        resp = self.post({"personal_email": "a@gmail.com",
                          "citizen_id": {"number": "079202000001", "issue_place": "",
                                         "issue_date": "10/04/2021"},
                          "mother": {"status": "", "full_name": "Trần Thị B"}})
        self.assertEqual(resp.status_code, 400)
        errors = resp.json()["errors"]
        self.assertIn("citizen_id", errors)
        self.assertIn("mother", errors)
        self.assertNotIn("personal_email", errors)
        self.assertFalse(ProfileChangeRequest.objects.exists())

    def test_deceased_or_none_needs_no_details(self):
        self.assertEqual(self.post({"father": {"status": "NONE"}}).status_code, 200)
        ProfileChangeRequest.objects.all().delete()
        self.assertEqual(self.post({"father": {"status": "DECEASED"}}).status_code, 200)

    def test_pending_group_is_locked(self):
        self.post({"personal_email": "a@gmail.com"})
        resp = self.post({"personal_email": "b@gmail.com"})
        self.assertEqual(resp.status_code, 400)
        self.assertIn("personal_email", resp.json()["errors"])

    def test_rejection_shown_and_resubmit_allowed(self):
        self.post({"personal_email": "a@gmail.com"})
        ProfileChangeRequest.objects.update(status=ProfileChangeRequest.STATUS_REJECTED,
                                            review_note="Email sai chính tả")
        data = self.client.get("/api/personal-info/").json()
        rej = self.group(data, "personal_email")["rejection"]
        self.assertEqual(rej["note"], "Email sai chính tả")
        self.assertEqual(rej["value"], "a@gmail.com")
        self.assertEqual(self.post({"personal_email": "ab@gmail.com"}).status_code, 200)

    def test_unchanged_value_is_not_sent(self):
        resp = self.post({"mobile_phone": "0911111111"})
        self.assertEqual(resp.status_code, 400)
        self.assertFalse(ProfileChangeRequest.objects.exists())

    @override_settings(FEATURE_PERSONAL_INFO=False)
    def test_flag_off_404(self):
        self.assertEqual(self.client.get("/api/personal-info/").status_code, 404)
