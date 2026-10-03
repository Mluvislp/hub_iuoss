"""Chương trình liên kết (ký tự 5–6 của MSSV khác IU) luôn 48/72 tháng — chốt 03/10/2026.

Chạy: python manage.py test core.test_joint_program --settings=config.insurance_test_settings
"""
from types import SimpleNamespace
from unittest import mock

from django.test import SimpleTestCase

from students.timeline import build_course_numbers, joint_program_code, training_duration_for


class JointProgramTests(SimpleTestCase):
    def test_nhan_dien(self):
        self.assertEqual(joint_program_code("ITITWE24066"), "WE")
        self.assertEqual(joint_program_code("ITITDK25008"), "DK")
        self.assertEqual(joint_program_code("ITITIU24066"), "")
        self.assertEqual(joint_program_code("MBAIU25025"), "")   # học viên cao học
        self.assertEqual(joint_program_code("IT060092"), "")      # MSSV kiểu cũ

    def test_lien_ket_bo_qua_bang(self):
        major = SimpleNamespace(code="ITIT")
        with mock.patch("students.timeline.resolve_training_duration", return_value=(53, 80)):
            self.assertEqual(training_duration_for(SimpleNamespace(current_student_code="ITITWE24066"), major, 2024),
                             (48, 72))
            self.assertEqual(training_duration_for(SimpleNamespace(current_student_code="ITITIU24066"), major, 2024),
                             (53, 80))

    def test_so_nam_thang_tren_form(self):
        st = SimpleNamespace(current_student_code="ITITWE24066", admission_term=None, academic_entry_year=2024)
        with mock.patch("students.timeline.infer_major_for_student", return_value=SimpleNamespace(code="ITIT")), \
                mock.patch("students.timeline.resolve_training_duration", return_value=(53, 80)):
            nums = build_course_numbers(st)
        self.assertEqual((nums["course_month_number"], nums["max_month_number"]), ("48", "72"))
