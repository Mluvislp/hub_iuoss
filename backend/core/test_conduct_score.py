"""Luật chọn học kỳ cho yêu cầu Bảng điểm rèn luyện (conduct_score).

Chạy: python manage.py test core.test_conduct_score --settings=config.insurance_test_settings
"""
from datetime import date
from types import SimpleNamespace

from django.test import SimpleTestCase, TestCase

from core.documents import (
    build_bankloan_payload,
    build_conduct_payload,
    build_conduct_prefill,
    build_thuongbinh_payload,
    conduct_overlapping_codes,
    conduct_semester_choices,
)
from core import request_quota
from core.models import ConfirmationRequest
from students.models import Student, StudentIdentityDocument, VnProvince, VnWard


def _student(term_code=None, entry_year=None):
    term = SimpleNamespace(term_code=term_code, academic_year=None) if term_code else None
    return SimpleNamespace(admission_term=term, academic_entry_year=entry_year)


def _codes(student, today, kind="semester"):
    """Mặc định chỉ học kỳ lẻ; kind=None ⇒ mọi lựa chọn (kể cả cả năm học)."""
    return [c["code"] for c in conduct_semester_choices(student, today=today)
            if kind is None or c["kind"] == kind]


class ConductSemesterChoicesTests(SimpleTestCase):
    def test_during_hk1_latest_is_previous_hk2(self):
        # 30/09/2026 đang HK1 2026-2027 ⇒ gần nhất là HK2 2025-2026.
        self.assertEqual(_codes(_student("20241"), date(2026, 9, 30)),
                         ["20252", "20251", "20242", "20241"])

    def test_january_still_counts_as_hk1(self):
        self.assertEqual(_codes(_student("20251"), date(2027, 1, 15))[0], "20252")

    def test_during_hk2_latest_is_current_year_hk1(self):
        self.assertEqual(_codes(_student("20241"), date(2026, 3, 1))[0], "20251")

    def test_summer_latest_is_current_year_hk2(self):
        self.assertEqual(_codes(_student("20241"), date(2026, 7, 20))[0], "20252")

    def test_starts_from_admission_hk2(self):
        self.assertEqual(_codes(_student("20242"), date(2026, 9, 30)),
                         ["20252", "20251", "20242"])

    def test_admission_hk3_starts_next_year_hk1(self):
        self.assertEqual(_codes(_student("20243"), date(2026, 9, 30))[-1], "20251")

    def test_freshman_has_no_semester_yet(self):
        self.assertEqual(_codes(_student("20261"), date(2026, 9, 30)), [])

    def test_entry_year_only_starts_at_hk1(self):
        self.assertEqual(_codes(_student(entry_year=2025), date(2026, 9, 30)), ["20252", "20251"])

    def test_no_admission_data_falls_back_four_years(self):
        codes = _codes(_student(), date(2026, 9, 30))
        self.assertEqual((codes[0], codes[-1], len(codes)), ("20252", "20221", 8))

    def test_label(self):
        first = conduct_semester_choices(_student("20251"), today=date(2026, 9, 30))[1]
        self.assertEqual(first["label"], "Học kỳ 2, năm học 2025-2026")


class ConductWholeYearTests(SimpleTestCase):
    def test_year_option_sits_before_its_hk2(self):
        self.assertEqual(_codes(_student("20241"), date(2026, 9, 30), kind=None),
                         ["2025N", "20252", "20251", "2024N", "20242", "20241"])

    def test_year_needs_both_semesters_finished(self):
        # Đang HK2 2025-2026: HK2 chưa kết thúc ⇒ chưa có "cả năm 2025-2026".
        self.assertEqual(_codes(_student("20241"), date(2026, 3, 1), kind=None),
                         ["20251", "2024N", "20242", "20241"])

    def test_year_needs_both_semesters_in_range(self):
        # Nhập học HK2 2024-2025 ⇒ không có HK1 năm đó ⇒ không có "cả năm 2024-2025".
        self.assertNotIn("2024N", _codes(_student("20242"), date(2026, 9, 30), kind="year"))

    def test_year_label(self):
        first = conduct_semester_choices(_student("20251"), today=date(2026, 9, 30))[0]
        self.assertEqual((first["code"], first["label"]), ("2025N", "Cả năm học 2025-2026"))

    def test_overlapping_codes(self):
        self.assertEqual(conduct_overlapping_codes("2025N"), {"2025N", "20251", "20252"})
        self.assertEqual(conduct_overlapping_codes("20251"), {"20251", "2025N"})
        self.assertEqual(conduct_overlapping_codes(""), set())


class ConductPayloadTests(TestCase):
    """Ngày sinh / CCCD + ngày cấp / địa chỉ là ô xin sửa — cùng luật các loại khác."""

    @classmethod
    def setUpTestData(cls):
        VnProvince.objects.create(code="79", name="Thành phố Hồ Chí Minh", unit_type="Thành phố")
        VnWard.objects.create(code="26734", name="Phường Linh Xuân", unit_type="Phường", province_code="79")
        cls.student = Student.objects.create(
            current_student_code="ITITIU20001", full_name="Nguyễn Văn A",
            date_of_birth=date(2002, 5, 1), academic_entry_year=2020,
        )
        StudentIdentityDocument.objects.create(
            student=cls.student, document_type=StudentIdentityDocument.TYPE_CCCD,
            document_number="079202000001", issue_date=date(2021, 4, 10), is_current=True,
        )

    def _payload(self, **over):
        data = dict(semester_code="20211", delivery="online", dob="01/05/2002", citizen_id="079202000001",
                    citizen_id_issue_date="10/04/2021", province_code="79",
                    ward_code="26734", street="12 Đường số 1")
        data.update(over)
        return build_conduct_payload(self.student, **data)

    def test_prefill_has_editable_sources(self):
        pf = build_conduct_prefill(self.student)
        self.assertEqual((pf["dob"], pf["citizen_id"], pf["citizen_id_issue_date"]),
                         ("01/05/2002", "079202000001", "10/04/2021"))
        self.assertTrue(pf["cccd_valid"])
        self.assertFalse(pf["address_standardized"])

    def test_unchanged_fields_need_no_review_except_new_address(self):
        payload, label = self._payload()
        ed = payload["editable"]
        self.assertEqual(label, "Học kỳ 1, năm học 2021-2022")
        self.assertFalse(ed["dob"]["changed"])
        self.assertFalse(ed["citizen_id"]["changed"])
        # Hồ sơ chưa có địa chỉ chuẩn hóa ⇒ địa chỉ luôn chờ duyệt.
        self.assertEqual(ed["permanent_address"]["review"], "pending")
        self.assertEqual(ed["permanent_address"]["proposed"]["ward_code"], "26734")
        self.assertEqual(payload["snapshot"]["semester"], label)

    def test_changed_dob_and_cccd_go_pending(self):
        payload, _ = self._payload(dob="02/05/2002", citizen_id="079202000009",
                                   citizen_id_issue_date="01/01/2024")
        ed = payload["editable"]
        self.assertEqual(ed["dob"]["review"], "pending")
        self.assertEqual(ed["citizen_id"]["proposed"], "079202000009")
        self.assertEqual(ed["citizen_id_issue_date"]["review"], "pending")

    def test_invalid_inputs_rejected(self):
        for over in ({"citizen_id": "12345"}, {"dob": "31/02/2002"},
                     {"ward_code": ""}, {"semester_code": "20301"},
                     {"delivery": ""}, {"delivery": "fax"}):
            with self.subTest(over=over), self.assertRaises(ValueError):
                self._payload(**over)

    def test_shared_cccd_helper_still_works_for_other_types(self):
        payload, _ = build_thuongbinh_payload(
            self.student, citizen_id="079202000001", citizen_id_issue_date="10/04/2021")
        self.assertFalse(payload["editable"]["citizen_id"]["changed"])
        # Ngày cấp ở tương lai ⇒ `_cccd_fields` chặn cho cả vay vốn.
        with self.assertRaises(ValueError):
            build_bankloan_payload(self.student, dob="01/05/2002", citizen_id="079202000001",
                                   citizen_id_issue_date="01/01/2099", class_code="ITIT20A1",
                                   fee_exemption="none", orphan="no")

    def test_delivery_saved_in_payload_and_snapshot(self):
        payload, _ = self._payload(delivery="paper")
        self.assertEqual(payload["delivery"], {"code": "paper", "label": "Bản cứng (giấy)"})
        self.assertEqual(payload["snapshot"]["delivery"], "Bản cứng (giấy)")

    def test_whole_year_payload(self):
        payload, label = self._payload(semester_code="2021N")
        self.assertEqual(label, "Cả năm học 2021-2022")
        self.assertEqual(payload["purpose"]["code"], "2021N")


class ConductQuotaOverlapTests(TestCase):
    """Cả năm học khoá HK lẻ của năm đó và ngược lại (người dùng chốt 01/10/2026)."""

    @classmethod
    def setUpTestData(cls):
        cls.student = Student.objects.create(current_student_code="ITITIU20002", full_name="B")

    def _request(self, code, label, status=ConfirmationRequest.STATUS_PENDING):
        return ConfirmationRequest.objects.create(
            student_id=self.student.pk, ldap_uid="ITITIU20002", request_type="conduct_score",
            purpose=label, status=status,
            payload={"purpose": {"code": code, "label": label}},
        )

    def test_year_blocks_its_semesters(self):
        self._request("2025N", "Cả năm học 2025-2026")
        msg = request_quota.check(self.student.pk, "conduct_score", "20251",
                                  "Học kỳ 1, năm học 2025-2026")
        self.assertIn("cả năm học 2025-2026", msg)
        self.assertIn("chỉ được xin một trong hai", msg)
        self.assertIsNone(request_quota.check(self.student.pk, "conduct_score", "20241", "x"))

    def test_semester_blocks_year_but_not_other_semester(self):
        self._request("20252", "Học kỳ 2, năm học 2025-2026")
        self.assertIsNotNone(request_quota.check(self.student.pk, "conduct_score", "2025N",
                                                 "Cả năm học 2025-2026"))
        self.assertIsNone(request_quota.check(self.student.pk, "conduct_score", "20251", "x"))
        blocked = request_quota.availability(self.student.pk, ["conduct_score"])[
            "types"]["conduct_score"]["blocked_semesters"]
        self.assertEqual(set(blocked), {"20252", "2025N"})

    def test_rejected_frees_overlap(self):
        self._request("2025N", "Cả năm học 2025-2026", status=ConfirmationRequest.STATUS_REJECTED)
        self.assertIsNone(request_quota.check(self.student.pk, "conduct_score", "20251", "x"))
