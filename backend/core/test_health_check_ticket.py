"""Phiếu khám sức khỏe (core/health_check.py::exam_ticket).

Chạy: python manage.py test core.test_health_check_ticket --settings=config.insurance_test_settings
"""
from datetime import date

from django.test import TestCase
from django.utils import timezone

from core import health_check as hc
from core.health_check_models import HealthCheckResponse as R, HealthCheckRound
from students.models import Student, StudentContactPoint, StudentIdentityDocument

SLOT = {"key": "2026-10-27 07:30", "date": "2026-10-27", "start": "07:30", "end": "09:30",
        "label": "Ca sáng thứ nhất"}


class ExamTicketTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        now = timezone.now()
        cls.round = HealthCheckRound.objects.create(
            academic_year="2026-2027", title="KSK", opens_at=now, closes_at=now,
            package_name="Gói", package_content="x", schedule_note="Hội trường A2")
        cls.student = Student.objects.create(current_student_code="ITCSIU24092", full_name="Phạm Hoàng Tuấn Tú",
                                             date_of_birth=date(2006, 1, 2), sex="Nam", class_code="ITCS24IU01")
        StudentContactPoint.objects.create(student=cls.student, contact_type=StudentContactPoint.TYPE_MOBILE_PHONE,
                                           contact_value="0911111111", normalized_contact_value="0911111111",
                                           is_current=True)
        StudentIdentityDocument.objects.create(student=cls.student, document_type=StudentIdentityDocument.TYPE_CCCD,
                                               document_number="079206000001", is_current=True)

    def _resp(self, **over):
        data = dict(round=self.round, student_id=self.student.pk, choice=R.CHOICE_REGISTER,
                    status=R.STATUS_REGISTERED, evidence={"exam_slot": SLOT}, submitted_at=timezone.now())
        data.update(over)
        return R.objects.create(**data)

    def test_chua_gan_ma_thi_khong_co_phieu(self):
        resp = self._resp()
        self.assertIsNone(hc.exam_ticket(self.student, resp, self.round))
        self.assertIsNone(hc.exam_ticket(self.student, None, self.round))

    def test_co_ma_thi_phat_hanh_phieu_kem_thong_tin(self):
        resp = self._resp(exam_code="100-27/10/2026")
        t = hc.exam_ticket(self.student, resp, self.round)
        self.assertEqual(t["code"], "100-27/10/2026")
        self.assertEqual(t["date_label"], "Thứ Ba, 27/10/2026")
        self.assertEqual((t["slot_label"], t["slot_time"]), ("Ca sáng thứ nhất", "07:30–09:30"))
        s = t["student"]
        self.assertEqual((s["student_code"], s["date_of_birth"], s["citizen_id"], s["phone"]),
                         ("ITCSIU24092", "02/01/2006", "079206000001", "0911111111"))
        self.assertEqual(s["health_insurance_code"], "")

    def test_nhanh_da_kham_khong_co_phieu(self):
        resp = self._resp(choice=R.CHOICE_EXAMINED, status=R.STATUS_PENDING, exam_code="5-27/10/2026")
        self.assertIsNone(hc.exam_ticket(self.student, resp, self.round))
