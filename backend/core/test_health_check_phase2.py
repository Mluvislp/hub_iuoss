"""Đợt khám 2 trong cùng năm học (10/11/2026) — core/health_check.py:
lịch nhiều đợt khám, đăng ký lại đợt mới (lưu lịch sử), hủy kết quả khám ngoài để đăng ký, dòng đã hủy.

Chạy: python manage.py test core.test_health_check_phase2 --settings=config.insurance_test_settings
"""
from datetime import date, timedelta

from django.test import TestCase
from django.utils import timezone

from core import health_check as hc
from core import health_check_slots as slots
from core import profile_changes as pc
from core.health_check_models import HealthCheckResponse as R, HealthCheckRound
from students.models import Student, StudentAddress, StudentIdentityDocument, StudentStatus

P1 = ["2026-10-27", "2026-10-28", "2026-10-29"]
P2 = ["2099-11-17", "2099-11-18", "2099-11-19"]
EXAM_SLOTS = {"phases": [
    {"label": "Đợt 1", "dates": P1, "capacity": None,
     "shifts": [{"label": "Ca sáng thứ nhất", "start": "07:30", "end": "09:30"},
                {"label": "Ca chiều thứ nhất", "start": "13:00", "end": "15:00"}]},
    {"label": "Đợt 2", "dates": P2, "capacity": 2,
     "shifts": [{"label": "Ca sáng", "start": "07:30", "end": "11:30"},
                {"label": "Ca chiều", "start": "13:30", "end": "16:30"}]},
]}
OLD_SLOT = {"key": "2026-10-28 07:30", "date": "2026-10-28", "start": "07:30", "end": "09:30",
            "label": "Ca sáng thứ nhất"}
REG = {"consent": True, "data_consent": True}


class Phase2Tests(TestCase):
    @classmethod
    def setUpTestData(cls):
        now = timezone.now()
        cls.round = HealthCheckRound.objects.create(
            academic_year="2026-2027", title="KSK", opens_at=now - timedelta(days=30),
            closes_at=now + timedelta(days=30), package_name="Gói", package_content="x", exam_slots=EXAM_SLOTS,
            register_opens_at=now - timedelta(hours=1), register_closes_at=now + timedelta(days=1),
            examined_opens_at=now - timedelta(days=30), examined_closes_at=now - timedelta(days=1),
            other_opens_at=now - timedelta(days=30), other_closes_at=now - timedelta(days=1))
        cls.active = StudentStatus.objects.create(code="ACTIVE", name_vi="Đang học", status_group="ACTIVE")
        cls.suspended = StudentStatus.objects.create(code="SUSPENDED", name_vi="Tạm dừng", status_group="SUSPENDED")
        cls.graduated = StudentStatus.objects.create(code="GRADUATED", name_vi="Tốt nghiệp", status_group="GRADUATED")
        cls.n = 0

    def student(self, status=None, hcm=True):
        Phase2Tests.n += 1
        s = Student.objects.create(current_student_code=f"T{self.n:04d}", full_name=f"SV {self.n}",
                                   date_of_birth=date(2006, 1, 2), current_status=status or self.active)
        StudentIdentityDocument.objects.create(student=s, document_type=StudentIdentityDocument.TYPE_CCCD,
                                               document_number=f"0792060{self.n:05d}", is_current=True)
        StudentAddress.objects.create(student=s, address_type=StudentAddress.TYPE_CURRENT_STD, sequence_no=1,
                                      full_address="1 Lê Lợi", province_code="79" if hcm else "01",
                                      ward_code="26734", is_current=True, effective_from=date(2026, 11, 1))
        pc.mark_declared(s)                         # đã khai báo → không gửi phần khai báo kèm đăng ký
        return s

    def resp(self, s, **over):
        data = dict(round=self.round, student_id=s.pk, choice=R.CHOICE_REGISTER, status=R.STATUS_REGISTERED,
                    evidence={"exam_slot": OLD_SLOT}, exam_code="7-28/10/2026", submitted_at=timezone.now())
        data.update(over)
        return R.objects.create(**data)

    # ── Lịch ──
    def test_chi_chon_ca_dot_kham_moi_nhat(self):
        opts = hc.slot_options(self.round)
        self.assertEqual([d["date"] for d in opts["days"]], P2)
        self.assertEqual((opts["phase_label"], opts["capacity"]), ("Đợt 2", 2))
        self.assertEqual([s["start"] for s in opts["days"][0]["shifts"]], ["07:30", "13:30"])
        with self.assertRaises(hc.HealthCheckError):
            hc._pick_slot(self.round, "2026-10-28 07:30")              # ca đợt cũ (dù còn trong cấu hình)

    def test_moi_ca_toi_da_so_cho_cua_dot(self):
        for _ in range(2):
            hc.register(self.student(), {**REG, "exam_slot": "2099-11-17 07:30"})
        with self.assertRaises(hc.HealthCheckError) as ctx:
            hc.register(self.student(), {**REG, "exam_slot": "2099-11-17 07:30"})
        self.assertEqual(ctx.exception.code, "exam_slot")
        self.assertEqual(hc.slot_options(self.round)["days"][0]["shifts"][0]["reason"], "Đã đủ chỗ")

    def test_chi_dang_hoc_va_tam_dung(self):
        hc.register(self.student(self.suspended), {**REG, "exam_slot": "2099-11-18 13:30"})
        with self.assertRaises(hc.HealthCheckError) as ctx:
            hc.register(self.student(self.graduated), {**REG, "exam_slot": "2099-11-18 13:30"})
        self.assertEqual(ctx.exception.code, "not_eligible_status")

    def test_van_bat_buoc_tp_hcm(self):
        with self.assertRaises(hc.HealthCheckError) as ctx:
            hc.register(self.student(hcm=False), {**REG, "exam_slot": "2099-11-18 13:30"})
        self.assertEqual(ctx.exception.code, "not_eligible")

    # ── Đăng ký lại đợt khám mới ──
    def test_dang_ky_dot_truoc_chua_kham_dang_ky_lai(self):
        s = self.student()
        r = self.resp(s, status=R.STATUS_REGISTERED,
                      evidence={"exam_slot": OLD_SLOT, "cancel_request": {"status": "pending", "reason": "bận"}})
        state = hc.build_state(s)
        self.assertTrue(state["can_reregister"])
        self.assertFalse(state["can_request_cancel"])                  # không cần xin hủy
        self.assertIsNone(state["exam_ticket"])                        # phiếu Đợt 1 hết tác dụng → ẩn
        self.assertTrue(state["previous_phase_registration"])
        self.assertEqual(state["exam_slots"]["phase_label"], "Đợt 2")
        with self.assertRaises(hc.HealthCheckError):                   # thiếu cờ reregister → như đã có phản hồi
            hc.register(s, {**REG, "exam_slot": "2099-11-17 13:30"})
        hc.register(s, {**REG, "exam_slot": "2099-11-17 13:30", "reregister": True})
        r.refresh_from_db()
        self.assertEqual((r.status, r.exam_code, slots.chosen(r.evidence)["key"]),
                         (R.STATUS_REGISTERED, None, "2099-11-17 13:30"))
        old = hc.history(r.evidence)
        self.assertEqual(len(old), 1)
        self.assertEqual((old[0]["kind"], old[0]["status"], old[0]["exam_code"], old[0]["evidence"]["exam_slot"]),
                         (hc.HISTORY_REREGISTER, R.STATUS_REGISTERED, "7-28/10/2026", OLD_SLOT))
        self.assertEqual(old[0]["evidence"]["cancel_request"]["reason"], "bận")
        self.assertIsNone(hc.cancel_info(r.evidence))
        state = hc.build_state(s)
        self.assertFalse(state["can_reregister"])                      # đã ở đợt mới
        self.assertIsNone(state["exam_ticket"])                        # chờ Phòng CTSV nhập mã mới
        self.assertEqual(state["response"]["history"][0]["exam_code"], "7-28/10/2026")
        with self.assertRaises(hc.HealthCheckError):
            hc.register(s, {**REG, "exam_slot": "2099-11-18 13:30", "reregister": True})

    def test_vang_cung_dang_ky_lai_duoc(self):
        s = self.student()
        self.resp(s, status=R.STATUS_ABSENT)
        hc.register(s, {**REG, "exam_slot": "2099-11-19 07:30", "reregister": True})
        self.assertEqual(hc.history(R.objects.get(student_id=s.pk).evidence)[0]["status"], R.STATUS_ABSENT)

    def test_da_kham_dot_1_khong_dang_ky_lai(self):
        s = self.student()
        self.resp(s, status=R.STATUS_ATTENDED)
        st = hc.build_state(s)
        self.assertFalse(st["can_reregister"])
        self.assertTrue(st["exam_ticket"])                             # đã khám: phiếu vẫn hiện
        self.assertFalse(st["previous_phase_registration"])
        with self.assertRaises(hc.HealthCheckError) as ctx:
            hc.register(s, {**REG, "exam_slot": "2099-11-19 07:30", "reregister": True})
        self.assertIn("đã được ghi nhận khám", str(ctx.exception))

    # ── Hủy kết quả khám ngoài ──
    def test_khai_kham_ngoai_phai_xac_nhan_huy(self):
        for choice in (R.CHOICE_EXAMINED, R.CHOICE_OTHER):
            with self.subTest(choice=choice):
                s = self.student()
                r = self.resp(s, choice=choice, status=R.STATUS_PENDING, exam_code=None,
                              evidence={"files": [], "result": {"exam_place": "BV"}})
                self.assertTrue(hc.build_state(s)["can_switch_to_register"])
                with self.assertRaises(hc.HealthCheckError) as ctx:
                    hc.register(s, {**REG, "exam_slot": "2099-11-19 13:30", "switch_from_examined": True})
                self.assertEqual(ctx.exception.code, "confirm_cancel_result")
                hc.register(s, {**REG, "exam_slot": "2099-11-19 13:30", "switch_from_examined": True,
                                "cancel_previous_result": True})
                r.refresh_from_db()
                info = hc.superseded_info(r.evidence)
                self.assertEqual((r.choice, info["previous_choice"], info["evidence"]["result"]["exam_place"]),
                                 (R.CHOICE_REGISTER, choice, "BV"))

    def test_kham_ngoai_da_xac_nhan_khong_dang_ky_khong_huy(self):
        s = self.student()
        self.resp(s, choice=R.CHOICE_EXAMINED, status=R.STATUS_APPROVED, exam_code=None, evidence={"files": []})
        state = hc.build_state(s)
        self.assertFalse(state["can_switch_to_register"])
        self.assertFalse(state["can_request_cancel"])
        with self.assertRaises(hc.HealthCheckError) as ctx:
            hc.register(s, {**REG, "exam_slot": "2099-11-19 13:30", "switch_from_examined": True,
                            "cancel_previous_result": True})
        self.assertIn("đã được Phòng Công tác Sinh viên xác nhận", str(ctx.exception))

    # ── Dòng đã hủy (Dashboard duyệt hủy) ──
    def test_dong_da_huy_coi_nhu_chua_tra_loi_dang_ky_tren_chinh_dong(self):
        s = self.student()
        old = {"kind": "cancel", "at": "2026-10-30T10:00:00+07:00", "choice": "register", "status": "attended",
               "exam_code": "3-27/10/2026", "evidence": {"exam_slot": OLD_SLOT}}
        r = self.resp(s, status=R.STATUS_CANCELLED, exam_code=None, evidence={"history": [old]})
        state = hc.build_state(s)
        self.assertIsNone(state["response"])
        self.assertTrue(state["can_submit_register"])
        hc.register(s, {**REG, "exam_slot": "2099-11-18 07:30"})
        r.refresh_from_db()
        self.assertEqual((r.status, slots.chosen(r.evidence)["key"]), (R.STATUS_REGISTERED, "2099-11-18 07:30"))
        self.assertEqual(hc.history(r.evidence), [old])
        self.assertEqual(R.objects.filter(student_id=s.pk).count(), 1)

    def test_dong_da_huy_khong_giu_cho(self):
        s = self.student()
        self.resp(s, status=R.STATUS_CANCELLED, evidence={"exam_slot": {**OLD_SLOT, "key": "2099-11-17 07:30",
                                                                          "date": "2099-11-17"}})
        self.assertEqual(hc.slot_options(self.round)["days"][0]["shifts"][0]["remaining"], 2)

    def test_ngay_du_kien(self):
        self.round.exam_slots = {"phases": [EXAM_SLOTS["phases"][0], {**EXAM_SLOTS["phases"][1], "tentative": True}]}
        self.round.save()
        days = hc.slot_options(self.round)["days"]
        self.assertTrue(all(d["label"].endswith("(Ngày dự kiến)") for d in days))
        s = self.student()
        hc.register(s, {**REG, "exam_slot": "2099-11-17 07:30"})
        self.assertTrue(hc.build_state(s)["response"]["exam_slot_label"].endswith("(Ngày dự kiến)"))
        r = R.objects.get(student_id=s.pk)
        r.exam_code = "1-17/11/2099"
        r.save()
        self.assertTrue(hc.build_state(s)["exam_ticket"]["date_label"].endswith("(Ngày dự kiến)"))
