"""Luật chọn học kỳ cho yêu cầu Bảng điểm rèn luyện (conduct_score).

Chạy: python manage.py test core.test_conduct_score --settings=config.insurance_test_settings
"""
from datetime import date
from types import SimpleNamespace

from django.test import SimpleTestCase

from core.documents import conduct_semester_choices


def _student(term_code=None, entry_year=None):
    term = SimpleNamespace(term_code=term_code, academic_year=None) if term_code else None
    return SimpleNamespace(admission_term=term, academic_entry_year=entry_year)


def _codes(student, today):
    return [c["code"] for c in conduct_semester_choices(student, today=today)]


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
        first = conduct_semester_choices(_student("20251"), today=date(2026, 9, 30))[0]
        self.assertEqual(first["label"], "Học kỳ 2, năm học 2025-2026")
