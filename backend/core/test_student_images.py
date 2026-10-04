from datetime import timedelta
from io import BytesIO, StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connection, transaction
from django.test import TestCase, override_settings
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient

from core import student_images
from core.api.authentication import StudentPrincipal
from core.insurance_contract import WorkflowError
from core.insurance_files import inspect_upload
from core.models import ExternalInsuranceDeclaration, HealthInsuranceRegistration, StudentImage
from core.test_insurance_workflow import picture
from students.models import Student

URL = '/api/student-images/'


class MediaTestCase(TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        override = override_settings(MEDIA_ROOT=self.temp.name)
        override.enable()
        self.addCleanup(override.disable)
        self.student = Student.objects.create(current_student_code='TEST001', full_name='Test Student')

    def files(self):
        return [p for p in Path(self.temp.name).rglob('*') if p.is_file()]

    def save(self, student=None, kind='cccd_front', subject='SELF', color='red'):
        with transaction.atomic():
            return student_images.save_image(student or self.student, kind, subject, inspect_upload(picture(color=color)),
                original_filename='x.png', source=student_images.SOURCE_BHYT_REGISTRATION)


class StudentImageTests(MediaTestCase):
    def setUp(self):
        super().setUp()
        self.other = Student.objects.create(current_student_code='TEST002', full_name='Other Student')
        self.client = APIClient()
        self.client.force_authenticate(StudentPrincipal({'ldap_uid': 'TEST001', 'student_id': self.student.pk}))

    def test_list_and_serve_own_image(self):
        image = self.save()
        self.assertTrue(image.storage_key.startswith(f'insurance_private/student_images/{self.student.pk}/'))
        listed = self.client.get(URL).data
        self.assertEqual([i['id'] for i in listed['images']], [image.pk])
        self.assertIn('cccd_front', [k['kind'] for k in listed['kinds']])
        served = self.client.get(f'/api/student-images/{image.pk}/file/')
        served.close()  # Windows khóa file đang mở, TemporaryDirectory không dọn được
        self.assertEqual(served.status_code, 200)
        self.assertEqual(served['Content-Type'], 'image/png')
        self.assertEqual(served['Cache-Control'], 'private, no-store')

    def test_replace_adds_new_row_and_demotes_old_one(self):
        first = self.save(color='red')
        second = self.save(color='blue')
        self.assertNotEqual(second.pk, first.pk)
        first.refresh_from_db()
        self.assertFalse(first.is_current)
        self.assertTrue(second.is_current)
        self.assertEqual(StudentImage.objects.filter(student=self.student, kind='cccd_front').count(), 2)
        self.assertEqual(StudentImage.objects.filter(student=self.student, kind='cccd_front', is_current=True).count(), 1)
        # Dòng và file cũ còn nguyên — đơn cũ có thể đang trỏ vào đó; API chỉ liệt kê ảnh đang dùng
        # nhưng vẫn phục vụ ảnh cũ theo id.
        self.assertEqual(len(self.files()), 2)
        self.assertEqual([i['id'] for i in self.client.get(URL).data['images']], [second.pk])
        served = self.client.get(f'/api/student-images/{first.pk}/file/')
        served.close()
        self.assertEqual(served.status_code, 200)

    def test_source_is_recorded_per_row(self):
        with transaction.atomic():
            row = student_images.save_image(self.student, 'cccd_front', 'SELF', inspect_upload(picture()),
                original_filename='x.png', source=student_images.SOURCE_MGHP)
        self.assertEqual(row.source, 'mghp')
        self.assertEqual(self.client.get(URL).data['images'][0]['source'], 'mghp')

    def test_same_bytes_does_not_write_a_new_file(self):
        first = self.save(color='red')
        again = self.save(color='red')
        self.assertEqual((again.pk, again.storage_key), (first.pk, first.storage_key))
        self.assertEqual((len(self.files()), StudentImage.objects.count()), (1, 1))

    def test_family_subjects_are_separate_slots(self):
        self.save(subject='FATHER')
        self.save(subject='MOTHER', color='green')
        self.save(color='blue')
        self.assertEqual(set(student_images.get_images(self.student)),
                         {('cccd_front', 'FATHER'), ('cccd_front', 'MOTHER'), ('cccd_front', 'SELF')})

    def test_validate_slot(self):
        with self.assertRaises(WorkflowError):
            student_images.validate_slot('payment_receipt', 'SELF')
        with self.assertRaises(WorkflowError) as caught:
            student_images.validate_slot('avatar', 'FATHER')
        self.assertIn('Ảnh đại diện', str(caught.exception))
        student_images.validate_slot('cccd_back', 'GUARDIAN')

    def test_cannot_read_another_students_image(self):
        foreign = self.save(self.other)
        self.assertEqual(self.client.get(f'/api/student-images/{foreign.pk}/file/').status_code, 404)
        self.assertEqual(self.client.get(URL).data['images'], [])

    def test_save_requires_transaction(self):
        connection_ = transaction.get_connection()
        saved = connection_.in_atomic_block
        connection_.in_atomic_block = False  # TestCase bọc mỗi test trong atomic; tắt tạm để thấy guard
        try:
            with self.assertRaises(RuntimeError):
                student_images.save_image(self.student, 'portrait', 'SELF', inspect_upload(picture()),
                    original_filename='p.png', source=student_images.SOURCE_BHYT_REGISTRATION)
        finally:
            connection_.in_atomic_block = saved

    def test_bhyt_only_session_can_read_image_store(self):
        client = APIClient()
        client.force_authenticate(StudentPrincipal({'ldap_uid': 'GRAD', 'student_id': self.student.pk,
                                                    'bhyt_only': True}))
        self.assertEqual(client.get(URL).status_code, 200)


class BackfillStudentImagesTests(MediaTestCase):
    """Lệnh backfill_student_images trên dữ liệu đơn cũ."""

    def setUp(self):
        super().setUp()
        now = timezone.now()
        self.old = HealthInsuranceRegistration.objects.create(student=self.student, registration_year=2025,
            registration_period='MAIN', hospital_code='1', payment_receipt_image='r.png',
            cccd_image=self.file('insurance_data/2025/01/old_front.png', 'red'),
            cccd_image_back=self.file('insurance_data/2025/01/old_back.png', 'red'),
            bhyt_image='insurance_data/2025/01/missing.png')
        self.new = ExternalInsuranceDeclaration.objects.create(student=self.student, full_name='x',
            student_code='TEST001', social_insurance_code='1', medical_insurance_code='1', hospital_code='1',
            valid_from=now.date(), valid_until=now.date(), registration_year=2026, snapshot={},
            request_key='k', request_digest='d',
            images={'cccd_image': {'storage_key': self.file('insurance_private/external/new.png', 'blue'),
                                   'mime_type': 'image/png'}})
        HealthInsuranceRegistration.objects.filter(pk=self.old.pk).update(created_at=now - timedelta(days=300))

    def file(self, key, color):
        path = Path(self.temp.name) / key
        path.parent.mkdir(parents=True, exist_ok=True)
        buffer = BytesIO()
        Image.new('RGB', (4, 4), color).save(buffer, format='PNG')
        path.write_bytes(buffer.getvalue())
        return key

    def run_command(self, *args):
        out, err = StringIO(), StringIO()
        call_command('backfill_student_images', *args, stdout=out, stderr=err)
        return out.getvalue(), err.getvalue()

    def apply(self):
        return self.run_command('--apply', '--database-name', connection.settings_dict['NAME'])

    def test_dry_run_writes_nothing(self):
        out, err = self.run_command()
        self.assertIn('XEM TRƯỚC', out)
        self.assertIn('THIẾU FILE', err)
        self.assertFalse(StudentImage.objects.exists())

    def test_apply_needs_matching_database_name(self):
        with self.assertRaises(CommandError):
            self.run_command('--apply', '--database-name', 'wrong')

    def test_apply_takes_newest_reuses_file_in_place_and_skips_missing(self):
        self.apply()
        images = {i.kind: i for i in StudentImage.objects.filter(student=self.student, is_current=True)}
        # Mặt trước: bản khai ngoài trường (nộp sau) thắng đơn cũ.
        self.assertEqual(images['cccd_front'].storage_key, 'insurance_private/external/new.png')
        # Mặt sau chỉ có ở đơn cũ; dùng lại file tại chỗ, không chép.
        self.assertEqual(images['cccd_back'].storage_key, 'insurance_data/2025/01/old_back.png')
        self.assertEqual(images['cccd_back'].mime_type, 'image/png')
        self.assertEqual({i.source for i in images.values()}, {'backfill'})
        # Thẻ BHYT mất file → không tạo dòng.
        self.assertNotIn('bhyt_card', images)
        # Không chép file nào; đơn BHYT không bị sửa.
        self.assertEqual(len(self.files()), 3)
        self.old.refresh_from_db()
        self.assertEqual(self.old.cccd_image.name, 'insurance_data/2025/01/old_front.png')

    def test_missing_newest_file_falls_back_to_older(self):
        (Path(self.temp.name) / 'insurance_private/external/new.png').unlink()
        self.apply()
        self.assertEqual(StudentImage.objects.get(kind='cccd_front', is_current=True).storage_key, 'insurance_data/2025/01/old_front.png')

    def test_heic_style_file_is_converted_to_a_new_jpeg(self):
        buffer = BytesIO()
        Image.new('RGB', (4, 4), 'green').save(buffer, format='JPEG')
        with patch('core.management.commands.backfill_student_images._inspect',
                   return_value=('convert', 'image/jpeg', buffer.getvalue())):
            self.apply()
        image = StudentImage.objects.get(kind='cccd_back')
        self.assertTrue(image.storage_key.startswith('insurance_private/student_images/'))
        self.assertEqual(image.mime_type, 'image/jpeg')
        self.assertTrue((Path(self.temp.name) / image.storage_key).is_file())

    def test_rerun_and_existing_image_are_not_overwritten(self):
        fresh = self.save(kind='cccd_front', color='green')
        self.apply()
        self.apply()
        self.assertEqual(StudentImage.objects.get(kind='cccd_front').storage_key, fresh.storage_key)
        self.assertEqual(StudentImage.objects.filter(kind='cccd_back').count(), 1)
        self.assertEqual(StudentImage.objects.filter(is_current=False).count(), 0)

    def test_student_code_filter(self):
        out, _ = self.run_command('--student-code', 'TEST001')
        self.assertIn('students=1', out)
        with self.assertRaises(CommandError):
            self.run_command('--student-code', 'NOPE')
