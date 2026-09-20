from datetime import date
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from uuid import uuid4
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from core.api.authentication import StudentPrincipal
from core.models import ExternalInsuranceDeclaration, HealthInsuranceRegistration
from core.test_insurance_workflow import picture
from students.models import Student, Hospital, VnProvince, VnWard, VnEthnicity, HealthInsuranceCard


class ExternalInsuranceTests(TestCase):
    url = '/api/health-insurance/external/'

    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        override = override_settings(MEDIA_ROOT=self.temp.name)
        override.enable()
        self.addCleanup(override.disable)
        self.student = Student.objects.create(current_student_code='TEST001', full_name='Test Student')
        self.client = APIClient()
        self.client.force_authenticate(StudentPrincipal({'ldap_uid': 'TEST001', 'student_id': self.student.pk}))
        VnProvince.objects.create(code='01', name='Hà Nội', unit_type='Thành phố')
        VnWard.objects.create(code='00001', province_code='01', name='Ward', unit_type='Phường')
        VnEthnicity.objects.create(code='01', name='Kinh')
        Hospital.objects.create(code='01001', name='Hospital', province_code='01',
            created_at=timezone.now(), updated_at=timezone.now())

    def payload(self, key=None, **changes):
        data = dict(request_key=key or uuid4().hex, full_name='Test Student', student_code='TEST001',
            gender='Nam', dob='2005-01-01', ethnicity='Kinh', phone_number='0901234567',
            citizen_id='012345678901', social_insurance_number='0123456789',
            permanent_province='01', permanent_ward='00001', permanent_street='Test street',
            hospital_code='01001', medical_insurance_code='GD4790123456789',
            valid_from='2026-01-01', valid_until='2028-12-31',
            cccd_image=picture(), cccd_image_back=picture(), bhyt_image=picture())
        data.update(changes)
        return data

    def post(self, data=None):
        return self.client.post(self.url, data or self.payload(), format='multipart')

    def test_no_period_or_payment_gate_and_stays_pending_without_card(self):
        old = HealthInsuranceCard.objects.create(student=self.student, is_current=True,
            valid_until=date(2030, 12, 31), created_at=timezone.now(), updated_at=timezone.now())
        self.assertEqual(self.client.get(self.url).status_code, 200)
        response = self.post()
        self.assertEqual(response.status_code, 201, response.data)
        row = ExternalInsuranceDeclaration.objects.get()
        old.refresh_from_db()
        self.assertTrue(old.is_current)
        self.assertEqual(row.status, 'pending')
        self.assertIsNone(row.card_id)
        self.assertEqual(HealthInsuranceCard.objects.count(), 1)
        self.assertEqual(row.snapshot['citizen_id'], '012345678901')
        self.assertEqual(len(row.images), 3)
        self.assertFalse(HealthInsuranceRegistration.objects.exists())
        health_data = self.client.get('/api/health-insurance/').data
        self.assertEqual(health_data['current']['id'], old.pk)
        self.assertEqual(health_data['external_declarations'][0]['status'], 'pending')
        self.assertEqual(health_data['external_declarations'][0]['medical_insurance_code'], 'GD4790123456789')
        self.assertIn(
            {'label': 'Số CCCD', 'value': '012345678901'},
            health_data['external_declarations'][0]['declared'],
        )

    def test_retry_and_multiple_declarations_preserve_history(self):
        key = uuid4().hex
        first = self.post(self.payload(key))
        retry = self.post(self.payload(key))
        self.assertEqual(retry.status_code, 200, retry.data)
        self.assertEqual(first.data['id'], retry.data['id'])
        conflict = self.post(self.payload(key, valid_until='2029-12-31'))
        self.assertEqual(conflict.status_code, 409)
        second = self.post(self.payload(valid_until='2029-12-31'))
        self.assertEqual(second.status_code, 201)
        self.assertEqual(ExternalInsuranceDeclaration.objects.count(), 2)
        self.assertFalse(HealthInsuranceCard.objects.exists())
        self.assertEqual(len(list(Path(self.temp.name).rglob('*.png'))), 6)

    def test_all_three_images_required_and_content_validated(self):
        for field in ('cccd_image', 'cccd_image_back', 'bhyt_image'):
            data = self.payload()
            del data[field]
            response = self.post(data)
            self.assertEqual(response.status_code, 400, response.data)
            self.assertIn(field, response.data['errors'])
        from django.core.files.uploadedfile import SimpleUploadedFile
        self.assertEqual(self.post(self.payload(bhyt_image=SimpleUploadedFile('x.png', b'fake'))).status_code, 400)
        self.assertFalse(ExternalInsuranceDeclaration.objects.exists())
        self.assertFalse(HealthInsuranceCard.objects.exists())

    def test_invalid_dates_identity_catalog_and_mismatched_codes(self):
        for changes in [
            {'valid_until': '2025-01-01'}, {'medical_insurance_code': 'GD4799876543210'},
            {'student_code': 'ANOTHER'}, {'hospital_code': 'missing'}, {'social_insurance_number': ''},
        ]:
            response = self.post(self.payload(**changes))
            self.assertEqual(response.status_code, 400, response.data)
        self.assertFalse(HealthInsuranceCard.objects.exists())

    def test_failure_rolls_back_snapshot_and_files_without_touching_card(self):
        old = HealthInsuranceCard.objects.create(student=self.student, is_current=True,
            created_at=timezone.now(), updated_at=timezone.now())
        with patch.object(ExternalInsuranceDeclaration.objects, 'create', side_effect=RuntimeError('failure')):
            with self.assertRaises(RuntimeError):
                self.post()
        old.refresh_from_db()
        self.assertTrue(old.is_current)
        self.assertEqual(HealthInsuranceCard.objects.count(), 1)
        self.assertFalse(ExternalInsuranceDeclaration.objects.exists())
        self.assertFalse([p for p in Path(self.temp.name).rglob('*') if p.is_file()])

    def test_prefill_is_owned_by_authenticated_student(self):
        self.post()
        declaration = ExternalInsuranceDeclaration.objects.get()
        declaration.status = ExternalInsuranceDeclaration.STATUS_REJECTED
        declaration.review_note = 'Cần khai lại ảnh rõ hơn.'
        declaration.save(update_fields=['status', 'review_note', 'updated_at'])
        response = self.client.get(self.url)
        # Đơn bị từ chối không tạo thẻ, nhưng vẫn là bản khai ngoài trường gần
        # nhất để sinh viên không phải nhập lại toàn bộ thông tin khi sửa đơn.
        self.assertFalse(HealthInsuranceCard.objects.exists())
        self.assertEqual(response.data['prefill']['medical_insurance_code'], 'GD4790123456789')
        self.assertEqual(response.data['prefill']['hospital_province'], '01')
        self.assertEqual(response.data['prefill']['valid_until'], '2028-12-31')
        other = Student.objects.create(current_student_code='OTHER', full_name='Other')
        self.client.force_authenticate(StudentPrincipal({'ldap_uid': 'OTHER', 'student_id': other.pk}))
        self.assertNotIn('medical_insurance_code', self.client.get(self.url).data['prefill'])
        self.client.force_authenticate(user=None)
        self.assertIn(self.client.get(self.url).status_code, (401, 403))
