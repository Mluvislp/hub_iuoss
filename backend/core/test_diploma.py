from datetime import timedelta
from io import BytesIO
from tempfile import TemporaryDirectory
from uuid import uuid4

from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient

from core.api.authentication import StudentPrincipal
from core.diploma_models import DiplomaEvent, DiplomaRound, DiplomaSubmission
from core.student_image_models import StudentImage
from students.models import Student, StudentContactPoint, StudentIdentityDocument


def pdf(name='bang.pdf', body=b'%PDF-1.4 test'):
    return SimpleUploadedFile(name, body, content_type='application/pdf')


def png(name='cccd.png'):
    buffer = BytesIO()
    Image.new('RGB', (8, 8), 'white').save(buffer, format='PNG')
    return SimpleUploadedFile(name, buffer.getvalue(), content_type='image/png')


@override_settings(FEATURE_DIPLOMA=True)
class DiplomaTests(TestCase):
    url = '/api/diploma/'

    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        override = override_settings(MEDIA_ROOT=self.temp.name)
        override.enable()
        self.addCleanup(override.disable)
        cache.clear()
        self.addCleanup(cache.clear)
        now = timezone.now()
        self.student = Student.objects.create(current_student_code='ITITIU25001', full_name='Nguyễn Văn A')
        StudentContactPoint.objects.create(student=self.student, contact_type='UNIVERSITY_EMAIL',
                                           contact_value='ITITIU25001@student.hcmiu.edu.vn', is_current=True)
        StudentContactPoint.objects.create(student=self.student, contact_type='MOBILE_PHONE',
                                           contact_value='0901234567', is_current=True)
        StudentIdentityDocument.objects.create(student=self.student, document_type='CCCD',
                                               document_number='079200000001', is_current=True)
        self.round = DiplomaRound.objects.create(title='Đợt 1 năm 2026', opens_at=now - timedelta(days=1),
                                                 closes_at=now + timedelta(days=1))
        self.client = APIClient()
        self.client.force_authenticate(StudentPrincipal({'ldap_uid': 'ITITIU25001', 'student_id': self.student.pk}))

    def post(self, **data):
        body = {'request_key': uuid4().hex, 'confirm': 'true', 'phone_number': '0901234567',
                'citizen_id': '079200000001', 'diploma_number': 'ab 123456', 'issued_by': 'Sở GD&ĐT TP.HCM',
                'issued_on': '2025-07-20', 'exam_session': '2025'}
        body.update(data)
        return self.client.post(self.url, {k: v for k, v in body.items() if v is not None}, format='multipart')

    def test_prefill_comes_from_profile(self):
        data = self.client.get(self.url).data
        self.assertTrue(data['can_submit'])
        self.assertEqual(data['profile']['university_email'], 'ititiu25001@student.hcmiu.edu.vn')
        self.assertEqual(data['profile']['citizen_id'], '079200000001')
        self.assertIsNone(data['cccd_image'])

    def test_submit_saves_cccd_to_image_store_and_pdf(self):
        response = self.post(cccd_front=png(), diploma_pdf=pdf())
        self.assertEqual(response.status_code, 200, response.data)
        sub = DiplomaSubmission.objects.get(student=self.student)
        self.assertEqual(sub.status, 'pending')
        self.assertEqual(sub.diploma_number, 'AB123456')
        self.assertTrue(sub.diploma_pdf['storage_key'].startswith('insurance_private/diplomas/'))
        image = StudentImage.objects.get(student=self.student, kind='cccd_front', is_current=True)
        self.assertEqual(image.source, 'diploma')
        self.assertEqual(sub.cccd_front['storage_key'], image.storage_key)
        self.assertIsNone(sub.profile_diff)

    def test_existing_cccd_image_is_reused(self):
        image = StudentImage.objects.create(student=self.student, kind='cccd_front', subject='SELF',
            storage_key='insurance_private/student_images/1/a.jpg', original_filename='a.jpg',
            mime_type='image/jpeg', file_size_bytes=1, sha256='x', source='bhyt_registration')
        self.assertEqual(self.client.get(self.url).data['cccd_image']['id'], image.pk)
        response = self.post(diploma_pdf=pdf())
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(DiplomaSubmission.objects.get().cccd_front['image_id'], image.pk)
        self.assertEqual(StudentImage.objects.count(), 1)

    def test_missing_cccd_and_non_pdf_rejected(self):
        response = self.post(diploma_pdf=SimpleUploadedFile('a.pdf', b'not a pdf'))
        self.assertEqual(response.status_code, 400)
        self.assertIn('diploma_pdf', response.data['errors'])
        response = self.post(diploma_pdf=pdf())
        self.assertEqual(response.status_code, 400)
        self.assertIn('cccd_front', response.data['errors'])
        self.assertFalse(DiplomaSubmission.objects.exists())

    def test_field_validation(self):
        response = self.post(cccd_front=png(), diploma_pdf=pdf(), issued_on='2024-01-01', exam_session='26/06/2025',
                             citizen_id='123', diploma_number='?')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(set(response.data['errors']), {'issued_on', 'citizen_id', 'diploma_number'})

    def test_profile_diff_recorded_not_written(self):
        self.post(cccd_front=png(), diploma_pdf=pdf(), phone_number='0911111111')
        sub = DiplomaSubmission.objects.get()
        self.assertEqual(sub.profile_diff['phone_number'], {'profile': '0901234567', 'declared': '0911111111'})
        self.assertEqual(StudentContactPoint.objects.get(contact_type='MOBILE_PHONE').contact_value, '0901234567')

    def test_replay_same_request_key_is_idempotent(self):
        key = uuid4().hex
        self.post(request_key=key, cccd_front=png(), diploma_pdf=pdf())
        response = self.post(request_key=key, cccd_front=png(), diploma_pdf=pdf())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(DiplomaEvent.objects.count(), 1)

    def test_closed_round_blocks_new_but_returned_can_resubmit(self):
        self.post(cccd_front=png(), diploma_pdf=pdf())
        sub = DiplomaSubmission.objects.get()
        self.round.closes_at = timezone.now() - timedelta(minutes=1)
        self.round.save()
        response = self.post(row_version=sub.row_version, diploma_number='AB999999')
        self.assertEqual(response.status_code, 409)
        sub.status, sub.review_note = 'returned', 'Số hiệu sai'
        sub.save()
        response = self.post(row_version=sub.row_version, diploma_number='AB999999')
        self.assertEqual(response.status_code, 200, response.data)
        sub.refresh_from_db()
        self.assertEqual((sub.status, sub.submit_count, sub.supplement_pending), ('pending', 2, True))
        self.assertEqual(sub.diploma_number, 'AB999999')

    def test_approved_submission_is_locked(self):
        self.post(cccd_front=png(), diploma_pdf=pdf())
        sub = DiplomaSubmission.objects.get()
        sub.status = 'approved'
        sub.save()
        response = self.post(row_version=sub.row_version, diploma_number='AB999999')
        self.assertEqual(response.status_code, 409)

    def test_files_only_served_to_owner(self):
        self.post(cccd_front=png(), diploma_pdf=pdf())
        response = self.client.get('/api/diploma/files/diploma_pdf/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'application/pdf')
        response.close()  # Windows không xóa được file đang mở
        self.assertEqual(self.client.get('/api/diploma/files/other/').status_code, 404)
        other = Student.objects.create(current_student_code='X2', full_name='B')
        client = APIClient()
        client.force_authenticate(StudentPrincipal({'ldap_uid': 'X2', 'student_id': other.pk}))
        self.assertEqual(client.get('/api/diploma/files/diploma_pdf/').status_code, 404)

    @override_settings(FEATURE_DIPLOMA=False)
    def test_feature_flag_hides_endpoint(self):
        self.assertEqual(self.client.get(self.url).status_code, 404)
