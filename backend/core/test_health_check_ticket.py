"""Phiếu khám sức khỏe (core/health_check.py::exam_ticket).

Chạy: python manage.py test core.test_health_check_ticket --settings=config.insurance_test_settings
"""
from datetime import date, timedelta

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
        self.assertEqual((t["code"], t["number"]), ("100-27/10/2026", "100"))
        self.assertEqual(t["date_label"], "Thứ Ba, 27/10/2026")
        self.assertEqual((t["slot_label"], t["slot_time"]), ("Ca sáng thứ nhất", "07:30–09:30"))
        s = t["student"]
        self.assertEqual((s["student_code"], s["date_of_birth"], s["citizen_id"], s["phone"]),
                         ("ITCSIU24092", "02/01/2006", "079206000001", "0911111111"))
        self.assertEqual(s["health_insurance_code"], "")

    def test_nhanh_da_kham_khong_co_phieu(self):
        resp = self._resp(choice=R.CHOICE_EXAMINED, status=R.STATUS_PENDING, exam_code="5-27/10/2026")
        self.assertIsNone(hc.exam_ticket(self.student, resp, self.round))


class ClosedSlotTests(TestCase):
    """Khóa riêng một ca (`exam_slots.closed_slots`, 27/10/2026): Hub không cho chọn, gửi lên bị từ chối."""

    @classmethod
    def setUpTestData(cls):
        now = timezone.now()
        cls.round = HealthCheckRound.objects.create(
            academic_year="2026-2027", title="KSK", opens_at=now, closes_at=now, package_name="Gói",
            package_content="x",
            exam_slots={"dates": ["2099-10-28"],
                        "shifts": [{"label": "Ca sáng thứ nhất", "start": "07:30", "end": "09:30"},
                                   {"label": "Ca chiều thứ nhất", "start": "13:00", "end": "15:00"}],
                        "closed_slots": ["2099-10-28 07:30"]})

    def test_ca_khoa_khong_chon_duoc(self):
        shifts = {s["key"]: s for s in hc.slot_options(self.round)["days"][0]["shifts"]}
        self.assertEqual((shifts["2099-10-28 07:30"]["available"], shifts["2099-10-28 07:30"]["reason"]),
                         (False, "Đã khóa"))
        self.assertTrue(shifts["2099-10-28 13:00"]["available"])
        with self.assertRaises(hc.HealthCheckError):
            hc._pick_slot(self.round, "2099-10-28 07:30")
        self.assertEqual(hc._pick_slot(self.round, "2099-10-28 13:00")["key"], "2099-10-28 13:00")


class CancelRequestTests(TestCase):
    """Yêu cầu hủy đăng ký khám tại trường (core/health_check.py::request_cancel)."""

    @classmethod
    def setUpTestData(cls):
        now = timezone.now()
        cls.round = HealthCheckRound.objects.create(
            academic_year="2026-2027", title="KSK", opens_at=now, closes_at=now + timedelta(days=30),
            package_name="Gói", package_content="x")
        cls.student = Student.objects.create(current_student_code="ITCSIU24092", full_name="SV Test")

    def _resp(self, **over):
        data = dict(round=self.round, student_id=self.student.pk, choice=R.CHOICE_REGISTER,
                    status=R.STATUS_ATTENDED, evidence={"exam_slot": SLOT}, submitted_at=timezone.now())
        data.update(over)
        return R.objects.create(**data)

    def test_gui_va_rut_yeu_cau_ke_ca_da_kham(self):
        resp = self._resp()
        self.assertTrue(hc.can_request_cancel(resp))
        hc.request_cancel(self.student, {"reason": "Đăng ký nhầm"})
        resp.refresh_from_db()
        info = hc.cancel_info(resp.evidence)
        self.assertEqual((info["status"], info["reason"], info["status_at_request"]),
                         ("pending", "Đăng ký nhầm", R.STATUS_ATTENDED))
        self.assertEqual(resp.evidence["exam_slot"], SLOT)          # không đụng ca
        self.assertFalse(hc.can_request_cancel(resp))
        with self.assertRaises(hc.HealthCheckError):
            hc.request_cancel(self.student, {"reason": "lần 2"})
        hc.withdraw_cancel(self.student)
        resp.refresh_from_db()
        self.assertIsNone(hc.cancel_info(resp.evidence))
        self.assertEqual(hc.build_state(self.student)["response"]["cancel_request"], None)

    def test_bat_buoc_ly_do_va_chi_nhanh_dang_ky(self):
        self._resp()
        with self.assertRaises(hc.HealthCheckError):
            hc.request_cancel(self.student, {"reason": "  "})
        R.objects.all().delete()
        self._resp(choice=R.CHOICE_EXAMINED, status=R.STATUS_PENDING)
        with self.assertRaises(hc.HealthCheckError):
            hc.request_cancel(self.student, {"reason": "x"})

    def test_bi_tu_choi_thi_gui_lai_duoc(self):
        self._resp(evidence={"exam_slot": SLOT, "cancel_request": {"status": "rejected", "reason": "a",
                                                                   "review_note": "Không"}})
        state = hc.build_state(self.student)
        self.assertTrue(state["can_request_cancel"])
        self.assertEqual(state["response"]["cancel_request"]["review_note"], "Không")
