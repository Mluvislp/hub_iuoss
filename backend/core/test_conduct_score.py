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
    conduct_purpose_codes,
    conduct_semester_choices,
)
from core import request_quota
from core.models import ConfirmationRequest
from students.models import Student, StudentIdentityDocument, VnProvince, VnWard


def _student(term_code=None, entry_year=None):
    term = SimpleNamespace(term_code=term_code, academic_year=None) if term_code else None
    return SimpleNamespace(admission_term=term, academic_entry_year=entry_year)


def _codes(student, today):
    return [c["code"] for c in conduct_semester_choices(student, today=today)]


class ConductYearChoicesTests(SimpleTestCase):
    """Từ 09/10/2026: chỉ còn "Cả năm học" (bỏ học kỳ lẻ), SV tích được nhiều năm."""

    def test_during_hk1_latest_is_previous_year(self):
        # 09/10/2026 đang HK1 2026-2027 ⇒ năm học gần nhất đã xong là 2025-2026.
        self.assertEqual(_codes(_student("20241"), date(2026, 10, 9)), ["2025N", "2024N"])

    def test_only_whole_years(self):
        kinds = {c["kind"] for c in conduct_semester_choices(_student("20211"), today=date(2026, 10, 9))}
        self.assertEqual(kinds, {"year"})

    def test_january_still_previous_year(self):
        self.assertEqual(_codes(_student("20241"), date(2027, 1, 15))[0], "2025N")

    def test_during_hk2_current_year_not_finished(self):
        self.assertEqual(_codes(_student("20241"), date(2026, 3, 1)), ["2024N"])

    def test_summer_current_year_finished(self):
        self.assertEqual(_codes(_student("20241"), date(2026, 7, 20)), ["2025N", "2024N"])

    def test_admission_hk2_keeps_first_year(self):
        # Nhập học HK2 2024-2025 vẫn có bảng điểm năm đó (chỉ HK2).
        self.assertEqual(_codes(_student("20242"), date(2026, 10, 9)), ["2025N", "2024N"])

    def test_admission_hk3_starts_next_year(self):
        self.assertEqual(_codes(_student("20243"), date(2026, 10, 9)), ["2025N"])

    def test_freshman_has_no_year_yet(self):
        self.assertEqual(_codes(_student("20261"), date(2026, 10, 9)), [])
        self.assertEqual(_codes(_student("20251"), date(2026, 3, 1)), [])

    def test_entry_year_only(self):
        self.assertEqual(_codes(_student(entry_year=2025), date(2026, 10, 9)), ["2025N"])

    def test_no_admission_data_falls_back_four_years(self):
        self.assertEqual(_codes(_student(), date(2026, 10, 9)), ["2025N", "2024N", "2023N", "2022N"])

    def test_label(self):
        first = conduct_semester_choices(_student("20251"), today=date(2026, 10, 9))[0]
        self.assertEqual((first["code"], first["label"]), ("2025N", "Cả năm học 2025-2026"))

    def test_overlapping_codes(self):
        self.assertEqual(conduct_overlapping_codes("2025N"), {"2025N", "20251", "20252"})
        self.assertEqual(conduct_overlapping_codes("20251"), {"20251"})
        self.assertEqual(conduct_overlapping_codes(""), set())

    def test_purpose_codes_old_and_new(self):
        self.assertEqual(conduct_purpose_codes({"code": "20252"}), ["20252"])
        self.assertEqual(conduct_purpose_codes({"code": "2024N,2025N"}), ["2024N", "2025N"])
        self.assertEqual(conduct_purpose_codes({"code": "x", "codes": ["2023N"]}), ["2023N"])
        self.assertEqual(conduct_purpose_codes(None), [])


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
        data = dict(semester_codes=["2021N"], delivery="online", dob="01/05/2002", citizen_id="079202000001",
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
        self.assertEqual(label, "Cả năm học 2021-2022")
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
                     {"ward_code": ""}, {"semester_codes": ["20301"]}, {"semester_codes": ["20211"]},
                     {"semester_codes": []}, {"semester_codes": ["2021N", "2030N"]},
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

    def test_multi_year_payload(self):
        payload, label = self._payload(semester_codes=["2023N", "2021N", "2023N"])
        self.assertEqual(label, "Cả năm học 2021-2022, 2023-2024")
        self.assertEqual(payload["purpose"]["codes"], ["2021N", "2023N"])
        self.assertEqual(payload["purpose"]["code"], "2021N,2023N")
        self.assertEqual(payload["snapshot"]["semester"], label)

    def test_locked_purpose_keeps_old_semester_on_edit(self):
        old = {"code": "20212", "label": "Học kỳ 2, năm học 2021-2022"}
        payload, label = self._payload(semester_codes=[], locked_purpose=old)
        self.assertEqual((payload["purpose"]["code"], label), ("20212", "Học kỳ 2, năm học 2021-2022"))


class ConductQuotaTests(TestCase):
    """Mỗi năm học chiếm lượt riêng; yêu cầu nhiều năm chiếm lượt mọi năm trong đó."""

    @classmethod
    def setUpTestData(cls):
        cls.student = Student.objects.create(current_student_code="ITITIU20002", full_name="B")

    def _request(self, purpose, status=ConfirmationRequest.STATUS_PENDING):
        return ConfirmationRequest.objects.create(
            student_id=self.student.pk, ldap_uid="ITITIU20002", request_type="conduct_score",
            purpose=purpose.get("label", ""), status=status, payload={"purpose": purpose},
        )

    def _check(self, *codes):
        return request_quota.check(self.student.pk, "conduct_score", list(codes),
                                   {c: f"Cả năm học {c[:4]}-{int(c[:4]) + 1}" for c in codes})

    def test_multi_year_request_blocks_each_year(self):
        self._request({"code": "2023N,2024N", "codes": ["2023N", "2024N"],
                       "label": "Cả năm học 2023-2024, 2024-2025"})
        msg = self._check("2022N", "2024N")
        self.assertIn("năm học 2024-2025", msg)
        self.assertNotIn("2022-2023", msg)
        self.assertIsNone(self._check("2022N", "2025N"))
        blocked = request_quota.availability(self.student.pk, ["conduct_score"])[
            "types"]["conduct_score"]["blocked_semesters"]
        self.assertTrue({"2023N", "2024N"} <= set(blocked))

    def test_old_semester_request_does_not_block_year(self):
        self._request({"code": "20252", "label": "Học kỳ 2, năm học 2025-2026"})
        self.assertIsNone(self._check("2025N"))

    def test_old_whole_year_request_still_blocks(self):
        self._request({"code": "2025N", "label": "Cả năm học 2025-2026"})
        self.assertIsNotNone(self._check("2025N"))

    def test_rejected_frees_year(self):
        self._request({"code": "2025N", "codes": ["2025N"], "label": "Cả năm học 2025-2026"},
                      status=ConfirmationRequest.STATUS_REJECTED)
        self.assertIsNone(self._check("2025N"))


class ConductScoreMathTests(SimpleTestCase):
    """Trung bình năm học + xếp loại — đúng cách mẫu in bảng điểm tính (sheet `In`)."""

    def test_average_rounds_half_up_to_one_decimal(self):
        from decimal import Decimal
        from core.documents import conduct_year_average
        self.assertEqual(conduct_year_average([85, 90]), Decimal("87.5"))
        self.assertEqual(conduct_year_average([88, 88]), Decimal("88.0"))
        self.assertEqual(conduct_year_average([100, None]), Decimal("100.0"))
        self.assertEqual(conduct_year_average([-2, 3]), Decimal("0.5"))
        self.assertIsNone(conduct_year_average([None, None]))

    def test_rank_thresholds(self):
        from decimal import Decimal
        from core.documents import conduct_rank_for_score
        cases = {"90": "EXCELLENT", "89.5": "GOOD", "80": "GOOD", "79.5": "FAIR", "65": "FAIR",
                 "64.5": "AVERAGE", "50": "AVERAGE", "49.5": "WEAK", "-2": "WEAK"}
        for score, rank in cases.items():
            self.assertEqual(conduct_rank_for_score(Decimal(score)), rank, score)


class ConductScoresByYearTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        from students.models import AcademicTerm, StudentConductScore
        cls.student = Student.objects.create(current_student_code="ITITIU22001", full_name="Trần Thị B")
        other = Student.objects.create(current_student_code="ITITIU22002", full_name="Lê Văn C")
        terms = {}
        for i, code in enumerate(["20231", "20232", "20241", "20242", "20243"], start=1):
            terms[code] = AcademicTerm.objects.create(
                id=i, term_code=code, academic_year=int(code[:4]), semester=int(code[4]))
        for code, score, rank in [("20231", 85, "GOOD"), ("20232", 90, "EXCELLENT"), ("20241", 64, "AVERAGE"),
                                  ("20243", 100, "EXCELLENT")]:
            StudentConductScore.objects.create(student=cls.student, term=terms[code], final_score=score,
                                               conduct_rank=rank)
        StudentConductScore.objects.create(student=other, term=terms["20242"], final_score=10, conduct_rank="WEAK")

    def test_full_year_partial_year_and_empty_year(self):
        from core.documents import conduct_scores_by_year
        data = conduct_scores_by_year(self.student, [{"code": "2025N"}, {"code": "2024N"}, {"code": "2023N"}])
        full = data["2023N"]
        self.assertEqual([s["score"] for s in full["semesters"]], [85, 90])
        self.assertEqual([s["rank"] for s in full["semesters"]], ["Tốt", "Xuất sắc"])
        self.assertEqual((full["average"], full["average_rank"], full["semester_count"]), ("87,5", "Tốt", 2))
        # HK2 chưa có (dòng HK2 của SV khác không được lẫn vào), HK hè không tính.
        part = data["2024N"]
        self.assertEqual([s["score"] for s in part["semesters"]], [64, None])
        self.assertEqual((part["average"], part["average_rank"], part["semester_count"]), ("64", "Trung bình", 1))
        empty = data["2025N"]
        self.assertEqual((empty["average"], empty["average_rank"], empty["semester_count"]), (None, "", 0))
