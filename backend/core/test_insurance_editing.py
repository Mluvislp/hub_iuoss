from pathlib import Path
from datetime import timedelta
from uuid import uuid4
from unittest.mock import patch
from django.test import TestCase
from django.utils import timezone
from core.test_external_insurance import ExternalInsuranceTests
from core.test_insurance_workflow import picture
from core.models import HealthInsuranceRegistration, ExternalInsuranceDeclaration
from core.api.authentication import StudentPrincipal
from students.models import Student
from django.test import TransactionTestCase
from django.db import connection, connections
from unittest import skipUnless
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier


class EditingTests(TestCase):
    setUp = ExternalInsuranceTests.setUp
    payload = ExternalInsuranceTests.payload
    url = '/api/health-insurance/external/'

    def registration(self):
        data = self.payload()
        values = {key: data[key] for key in ('full_name', 'student_code', 'gender', 'dob', 'ethnicity',
            'phone_number', 'citizen_id', 'social_insurance_number', 'permanent_province',
            'permanent_ward', 'permanent_street', 'hospital_code')}
        return HealthInsuranceRegistration.objects.create(student=self.student, registration_year=2027,
            registration_period='MAIN', workflow_version=1, status='waiting_bhxh',
            payment_receipt_image='legacy.png', **values)

    def edit(self, row, **changes):
        data = self.payload()
        for key in ('cccd_image', 'cccd_image_back', 'bhyt_image'):
            data.pop(key)
        data.update(action='edit', row_version=row.row_version, full_name='Tên mới')
        data.update(changes)
        url = f'/api/health-insurance/registrations/{row.pk}/' if isinstance(row, HealthInsuranceRegistration) else self.url + str(row.pk) + '/'
        return self.client.post(url, data, format='multipart')

    def close(self):
        self.cfg.registration_closes_at = timezone.now() - timedelta(seconds=1)
        self.cfg.save()

    def test_legacy_view_edit_identity_status_and_version(self):
        row = self.registration()
        HealthInsuranceRegistration.objects.filter(pk=row.pk).update(created_at=timezone.now()-timedelta(days=1), updated_at=timezone.now()-timedelta(days=1))
        row.refresh_from_db()
        created = row.created_at
        self.student.full_name = 'Profile changed later'
        self.student.save()
        detail = self.client.get(f'/api/health-insurance/registrations/{row.pk}/').data
        self.assertTrue(detail['window']['can_edit'])
        self.assertEqual(detail['prefill']['full_name'], 'Test Student')
        response = self.edit(row, student_code='ATTACK', registration_year=2000, registration_period='Q4')
        self.assertEqual(response.status_code, 200, response.data)
        row.refresh_from_db()
        self.assertEqual((row.full_name, row.status, row.row_version), ('Tên mới', 'waiting_bhxh', 1))
        self.assertEqual((row.student_code, row.registration_year, row.registration_period), ('TEST001', 2027, 'MAIN'))
        self.assertEqual(row.created_at, created)
        self.assertEqual(str(row.payment_receipt_image), 'legacy.png')
        self.assertEqual(HealthInsuranceRegistration.objects.count(), 1)
        self.assertEqual(row.events.get(event_type='STUDENT_UPDATED').payload['changes']['full_name']['before'], 'Test Student')
        self.assertEqual(row.change_log['full_name'], {'from':'Profile changed later', 'to':'Tên mới'})
        self.assertGreater(row.updated_at, created)
        detail = self.client.get(f'/api/health-insurance/registrations/{row.pk}/').data
        self.assertFalse(detail['can_edit'])
        self.assertIsNotNone(detail['edited_at'])
        self.assertEqual(detail['display'], {
            'permanent_province': 'Hà Nội', 'permanent_ward': 'Ward', 'hospital_code': 'Hospital',
        })

    def test_edit_retry_and_stale_version(self):
        row = self.registration()
        key = uuid4().hex
        self.assertEqual(self.edit(row, request_key=key).status_code, 200)
        self.assertEqual(self.edit(row, request_key=key).status_code, 200)
        self.assertEqual(self.edit(row).status_code, 409)
        self.assertEqual(row.events.filter(event_type='STUDENT_UPDATED').count(), 1)

    def test_new_image_current_endpoint_and_rollback(self):
        row = self.registration()
        response = self.edit(row, payment_receipt_image=picture(color='blue'))
        self.assertEqual(response.status_code, 200, response.data)
        row.refresh_from_db()
        path = Path(self.temp.name) / str(row.payment_receipt_image)
        self.assertTrue(path.exists())
        url = f'/api/health-insurance/registrations/{row.pk}/images/payment_receipt_image/'
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(b''.join(response.streaming_content), path.read_bytes())
        files = set(Path(self.temp.name).rglob('*.png'))
        rollback_row = self.registration()
        with patch.object(HealthInsuranceRegistration, 'save', side_effect=RuntimeError('rollback')):
            with self.assertRaises(RuntimeError):
                self.edit(rollback_row, payment_receipt_image=picture(color='green'))
        self.assertEqual(set(Path(self.temp.name).rglob('*.png')), files)

    def test_unchanged_registration_and_external_are_rejected(self):
        row = self.registration()
        data = self.payload()
        for key in ('cccd_image', 'cccd_image_back', 'bhyt_image'):
            data.pop(key)
        data.update(action='edit', row_version=row.row_version)
        response = self.client.post(f'/api/health-insurance/registrations/{row.pk}/', data, format='multipart')
        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(response.data['detail'], 'Sinh viên không có chỉnh sửa')
        self.assertFalse(row.events.filter(event_type='STUDENT_UPDATED').exists())

        external = self.external()
        data = self.payload()
        for key in ('cccd_image', 'cccd_image_back', 'bhyt_image'):
            data.pop(key)
        data.update(action='edit', row_version=external.row_version)
        response = self.client.post(self.url + str(external.pk) + '/', data, format='multipart')
        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(response.data['detail'], 'Sinh viên không có chỉnh sửa')
        self.assertFalse(external.events.filter(event_type='STUDENT_UPDATED').exists())

    def test_closed_edit_rejected_but_supplement_allowed_and_queued(self):
        row = self.registration()
        self.close()
        self.assertEqual(self.edit(row).status_code, 409)
        row.status, row.rejection_reason_code = 'rejected', 'UNPAID'
        row.save()
        response = self.client.post(f'/api/health-insurance/registrations/{row.pk}/',
            {'request_key': uuid4().hex, 'row_version': row.row_version, 'evidences': picture()}, format='multipart')
        self.assertEqual(response.status_code, 200, response.data)
        row.refresh_from_db()
        self.assertTrue(row.supplement_pending)
        self.assertIsNotNone(row.supplemented_at)
        self.assertEqual(row.status, 'iu_processing')
        self.assertEqual(HealthInsuranceRegistration.objects.count(), 1)

    def test_ownership_for_detail_edit_and_images(self):
        row = self.registration()
        other = Student.objects.create(current_student_code='OTHER', full_name='Other')
        self.client.force_authenticate(StudentPrincipal({'ldap_uid':'OTHER', 'student_id':other.pk}))
        self.assertEqual(self.edit(row).status_code, 404)
        self.assertEqual(self.client.get(f'/api/health-insurance/registrations/{row.pk}/').status_code, 404)
        self.assertEqual(self.client.get(f'/api/health-insurance/registrations/{row.pk}/images/payment_receipt_image/').status_code, 404)

    def external(self):
        response = self.client.post(self.url, self.payload(), format='multipart')
        self.assertEqual(response.status_code, 201, response.data)
        return ExternalInsuranceDeclaration.objects.get(pk=response.data['id'])

    def test_existing_external_edit_preserves_id_images_year_and_status(self):
        row = self.external()
        images, created, year = row.images, row.created_at, row.registration_year
        row.events.all().delete()  # Represents a legacy declaration backfilled without synthetic history.
        row.status = 'confirmed'
        row.save()
        self.assertEqual(self.edit(row).status_code, 200)
        row.refresh_from_db()
        self.assertEqual((row.full_name, row.status, row.images), ('Tên mới', 'confirmed', images))
        self.assertEqual((row.created_at, row.registration_year, row.intake_year), (created, year, 2027))
        self.assertEqual(ExternalInsuranceDeclaration.objects.count(), 1)
        self.assertEqual(self.edit(row, row_version=0).status_code, 409)

    def test_external_closed_resubmission_and_unmapped_view(self):
        row = self.external()
        self.close()
        self.assertEqual(self.edit(row).status_code, 409)
        row.status, row.review_note = 'rejected', 'Ảnh chưa rõ'
        row.intake_year = row.intake_period = None
        row.save()
        response = self.client.get(self.url + str(row.pk) + '/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['prefill']['citizen_id'], '012345678901')
        self.assertEqual(self.edit(row, action='resubmit', cccd_image=picture(color='green')).status_code, 200)
        row.refresh_from_db()
        self.assertEqual(row.status, 'pending')
        self.assertTrue(row.supplement_pending)
        self.assertEqual(row.events.get(event_type='RESUBMITTED').payload['previous_rejection'], 'Ảnh chưa rõ')
        self.assertEqual(ExternalInsuranceDeclaration.objects.count(), 1)

    def test_external_unmapped_closed_and_foreign_owner(self):
        row = self.external()
        row.intake_year = row.intake_period = None
        row.save()
        self.assertEqual(self.edit(row).status_code, 409)
        other = Student.objects.create(current_student_code='OTHER', full_name='Other')
        self.client.force_authenticate(StudentPrincipal({'ldap_uid':'OTHER', 'student_id':other.pk}))
        self.assertEqual(self.edit(row).status_code, 404)
        self.assertEqual(self.client.get(self.url + str(row.pk) + '/').status_code, 404)

    def test_cccd_images_replaceable_on_edit(self):
        row = self.registration()
        before = (row.cccd_image, row.cccd_image_back)
        response = self.edit(row, cccd_image=picture(color='green'), cccd_image_back=picture(color='blue'))
        self.assertEqual(response.status_code, 200, response.data)
        row.refresh_from_db()
        self.assertNotEqual(row.cccd_image, before[0])
        self.assertNotEqual(row.cccd_image_back, before[1])
        self.assertTrue(row.events.filter(event_type='IMAGES_REPLACED').exists())
        external = self.external()
        images = dict(external.images)
        response = self.edit(external, cccd_image_back=picture(color='green'))
        self.assertEqual(response.status_code, 200, response.data)
        external.refresh_from_db()
        self.assertNotEqual(external.images['cccd_image_back'], images.get('cccd_image_back'))

    def test_detail_config_follows_live_period_description(self):
        row = self.registration()
        row.config_snapshot = {'name': 'Snapshot', 'description': 'Mô tả cũ'}
        row.save()
        self.cfg.description = '<p>Mô tả hiện hành</p>'
        self.cfg.save()
        detail = self.client.get(f'/api/health-insurance/registrations/{row.pk}/').data
        self.assertEqual(detail['config']['description'], '<p>Mô tả hiện hành</p>')
        self.assertEqual(detail['config']['registration_year'], 2027)
        self.cfg.registration_year = 2028
        self.cfg.save()
        detail = self.client.get(f'/api/health-insurance/registrations/{row.pk}/').data
        self.assertEqual(detail['config']['description'], 'Mô tả cũ')

    def test_reused_slot_cannot_reopen_older_record(self):
        row = self.registration()
        self.cfg.registration_year = 2028
        self.cfg.save()
        self.assertEqual(self.edit(row).status_code, 409)

    def test_external_cannot_create_outside_window(self):
        self.close()
        self.assertEqual(self.client.post(self.url, self.payload(), format='multipart').status_code, 409)
        self.assertFalse(ExternalInsuranceDeclaration.objects.exists())


@skipUnless(connection.vendor == 'mysql', 'Requires real MySQL row locks')
class ConcurrentEditingTests(TransactionTestCase):
    setUp = ExternalInsuranceTests.setUp
    payload = ExternalInsuranceTests.payload
    registration = EditingTests.registration
    external = EditingTests.external
    url = '/api/health-insurance/external/'

    def race(self, row, external=False):
        from rest_framework.test import APIClient
        barrier = Barrier(2)

        def submit(index):
            client = APIClient()
            client.force_authenticate(StudentPrincipal({'ldap_uid':'TEST001', 'student_id':self.student.pk}))
            data = self.payload()
            for field in ('cccd_image', 'cccd_image_back', 'bhyt_image'):
                data.pop(field)
            data.update(action='edit', row_version=0, full_name=f'Concurrent {index}')
            url = self.url + str(row.pk) + '/' if external else f'/api/health-insurance/registrations/{row.pk}/'
            try:
                barrier.wait(timeout=10)
                return client.post(url, data, format='multipart').status_code
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            result = list(pool.map(submit, [1, 2]))
        self.assertEqual(sorted(result), [200,409])
        row.refresh_from_db()
        self.assertEqual(row.row_version, 1)
        self.assertEqual(type(row).objects.count(), 1)

    def test_registration_two_sessions_do_not_overwrite(self):
        self.race(self.registration())

    def test_external_two_sessions_do_not_overwrite(self):
        self.race(self.external(), external=True)
