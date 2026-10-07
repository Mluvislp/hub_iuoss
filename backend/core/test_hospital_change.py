from datetime import timedelta
from tempfile import TemporaryDirectory
from uuid import uuid4

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from core.api.authentication import StudentPrincipal
from core.hospital_change_models import HospitalChangeConfig, HospitalChangeRequest
from core.models import HealthInsuranceRegistration
from students.models import Hospital, Student, VnProvince, VnWard


class HospitalChangeTests(TestCase):
    url = '/api/health-insurance/hospital-change/'

    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        override = override_settings(MEDIA_ROOT=self.temp.name)
        override.enable()
        self.addCleanup(override.disable)
        # POST dùng chung throttle `create_request` (cache) với các bộ test khác.
        cache.clear()
        self.addCleanup(cache.clear)
        now = timezone.now()
        self.student = Student.objects.create(current_student_code='TEST001', full_name='Test Student')
        self.cfg = HospitalChangeConfig.objects.create(change_period='Q2', change_year=now.year,
            opens_at=now - timedelta(days=1), closes_at=now + timedelta(days=1), is_active=True)
        self.client = APIClient()
        self.client.force_authenticate(StudentPrincipal({'ldap_uid': 'TEST001', 'student_id': self.student.pk}))
        VnProvince.objects.create(code='79', name='TP.HCM', unit_type='Thành phố')
        VnProvince.objects.create(code='01', name='Hà Nội', unit_type='Thành phố')
        VnWard.objects.create(code='26734', province_code='79', name='Ward', unit_type='Phường')
        for code, province in (('79001', '79'), ('79002', '79'), ('01001', '01')):
            Hospital.objects.create(code=code, name='BV ' + code, province_code=province,
                                    created_at=now, updated_at=now)
        self.reg = HealthInsuranceRegistration.objects.create(
            student=self.student, registration_year=now.year, registration_period='MAIN', status='issued',
            full_name='Test Student', student_code='TEST001', gender='Nam', citizen_id='012345678901',
            social_insurance_number='0123456789', permanent_province='79', permanent_ward='26734',
            permanent_street='1 Street', hospital_code='79001', note='Sai ngày sinh', cccd_image='insurance_private/a.jpg',
            payment_receipt_image='insurance_private/r.png')

    def post(self, path=None, **data):
        data.setdefault('request_key', uuid4().hex)
        return self.client.post(path or self.url, data, format='multipart')

    def test_prefill_comes_from_latest_sent_registration(self):
        HealthInsuranceRegistration.objects.create(student=self.student, registration_year=2030,
            registration_period='Q2', status='iu_processing', hospital_code='79002', payment_receipt_image='x.png')
        data = self.client.get(self.url).data
        self.assertEqual(data['source']['id'], self.reg.pk)
        self.assertEqual(data['prefill']['citizen_id'], '012345678901')
        self.assertEqual(data['config']['status'], 'open')
        self.assertEqual(len(data['images']), 2)

    def test_without_sent_registration_is_conflict(self):
        self.reg.status = 'iu_processing'
        self.reg.save(update_fields=['status'])
        self.assertEqual(self.client.get(self.url).status_code, 409)
        self.assertEqual(self.post(hospital_code='79002').status_code, 409)

    def test_submit_copies_registration_and_only_changes_hospital(self):
        response = self.post(hospital_code='79002', full_name='Hacker', citizen_id='999999999999')
        self.assertEqual(response.status_code, 201, response.data)
        row = HospitalChangeRequest.objects.get()
        self.assertEqual((row.status, row.old_hospital_code, row.hospital_code), ('iu_processing', '79001', '79002'))
        self.assertEqual(row.registration_id, self.reg.pk)
        self.assertEqual(row.full_name, 'Test Student')
        self.assertEqual(row.snapshot['citizen_id'], '012345678901')
        self.assertEqual(row.snapshot['note'], 'Sai ngày sinh')
        self.assertEqual(row.images['cccd_image']['mime_type'], 'image/jpeg')
        self.assertEqual(set(row.images), {'cccd_image', 'payment_receipt_image'})
        self.assertEqual(self.client.get(self.url).data['id'], row.pk)
        health = self.client.get('/api/health-insurance/').data['hospital_change']
        self.assertEqual(health['requests'][0]['hospital_name'], 'BV 79002')
        self.assertTrue(health['has_source'])

    def test_hospital_rules(self):
        for code in ('79001', '01001', '', 'NOPE'):
            response = self.post(hospital_code=code)
            self.assertEqual(response.status_code, 400, code)
            self.assertIn('hospital_code', response.data['errors'])
        self.assertFalse(HospitalChangeRequest.objects.exists())

    def test_retry_is_idempotent_and_one_request_per_period(self):
        key = uuid4().hex
        self.assertEqual(self.post(hospital_code='79002', request_key=key).status_code, 201)
        self.assertEqual(self.post(hospital_code='79002', request_key=key).status_code, 200)
        self.assertEqual(self.post(hospital_code='79002').status_code, 409)
        self.assertEqual(HospitalChangeRequest.objects.count(), 1)

    def test_closed_period_blocks_new_request(self):
        self.cfg.is_active = False
        self.cfg.save(update_fields=['is_active'])
        self.assertEqual(self.post(hospital_code='79002').status_code, 409)

    def test_edit_once_then_resubmit_after_rejection(self):
        Hospital.objects.create(code='79003', name='BV 79003', province_code='79',
                                created_at=timezone.now(), updated_at=timezone.now())
        self.post(hospital_code='79002')
        row = HospitalChangeRequest.objects.get()
        detail = self.url + f'{row.pk}/'
        response = self.post(detail, hospital_code='79003', action='edit', row_version=row.row_version)
        self.assertEqual(response.status_code, 200, response.data)
        row.refresh_from_db()
        self.assertEqual(row.hospital_code, '79003')
        self.assertEqual(self.post(detail, hospital_code='79002', action='edit',
                                   row_version=row.row_version).status_code, 409)
        row.status, row.review_note = 'rejected', 'Sai'
        row.save(update_fields=['status', 'review_note'])
        response = self.post(detail, hospital_code='79002', action='resubmit', row_version=row.row_version)
        self.assertEqual(response.status_code, 200, response.data)
        row.refresh_from_db()
        self.assertEqual((row.status, row.supplement_pending, row.hospital_code), ('iu_processing', True, '79002'))
        self.assertEqual([e['event_type'] for e in self.client.get(detail).data['history']],
                         ['SUBMITTED', 'STUDENT_UPDATED', 'RESUBMITTED'])

    def test_request_sent_to_bhxh_is_locked(self):
        self.post(hospital_code='79002')
        row = HospitalChangeRequest.objects.get()
        row.status = 'waiting_bhxh'
        row.save(update_fields=['status'])
        # Đang chờ BHXH vẫn chặn gửi yêu cầu mới.
        self.cfg.change_period = 'Q3'
        self.cfg.save(update_fields=['change_period'])
        self.assertEqual(self.post(hospital_code='79002').status_code, 409)
        self.cfg.change_period = 'Q2'
        self.cfg.save(update_fields=['change_period'])
        self.assertFalse(self.client.get(self.url + f'{row.pk}/').data['can_edit'])
        self.assertEqual(self.post(self.url + f'{row.pk}/', hospital_code='79001', action='resubmit',
                                   row_version=row.row_version).status_code, 409)

    def test_other_student_cannot_read(self):
        self.post(hospital_code='79002')
        row = HospitalChangeRequest.objects.get()
        other = Student.objects.create(current_student_code='TEST002', full_name='Other')
        self.client.force_authenticate(StudentPrincipal({'ldap_uid': 'TEST002', 'student_id': other.pk}))
        self.assertEqual(self.client.get(self.url + f'{row.pk}/').status_code, 404)
        self.assertEqual(self.client.get(self.url + f'{row.pk}/images/cccd_image/').status_code, 404)

    def test_lookup_url_from_config(self):
        self.cfg.hospital_lookup_url = 'https://example.com/benh-vien'
        self.cfg.save(update_fields=['hospital_lookup_url'])
        self.assertEqual(self.client.get(self.url).data['config']['hospital_lookup_url'], 'https://example.com/benh-vien')

    def test_lookup_url_falls_back_to_registration_config(self):
        from core.models import HealthInsuranceConfig
        now = timezone.now()
        HealthInsuranceConfig.objects.create(registration_period='MAIN', registration_year=now.year,
            registration_opens_at=now, registration_closes_at=now, is_active=True, insurance_fee=0,
            bank_name='', bank_account_number='', bank_account_name='', hospital_lookup_url='https://bhyt.example/bv')
        self.assertEqual(self.client.get(self.url).data['config']['hospital_lookup_url'], 'https://bhyt.example/bv')
        self.post(hospital_code='79002')
        row = HospitalChangeRequest.objects.get()
        self.cfg.delete()  # đợt không còn → dùng snapshot, vẫn phải có link
        self.assertEqual(self.client.get(self.url + f'{row.pk}/').data['config']['hospital_lookup_url'], 'https://bhyt.example/bv')
