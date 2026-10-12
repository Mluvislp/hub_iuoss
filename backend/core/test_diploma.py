from datetime import date, timedelta
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
        self.student = Student.objects.create(current_student_code='ITITIU25001', full_name='Nguyễn Văn A',
                                              academic_entry_year=2025)
        StudentContactPoint.objects.create(student=self.student, contact_type='UNIVERSITY_EMAIL',
                                           contact_value='ITITIU25001@student.hcmiu.edu.vn', is_current=True)
        StudentContactPoint.objects.create(student=self.student, contact_type='MOBILE_PHONE',
                                           contact_value='0901234567', is_current=True)
        StudentIdentityDocument.objects.create(student=self.student, document_type='CCCD',
                                               document_number='079200000001', is_current=True)
        self.round = DiplomaRound.objects.create(title='Đợt khóa 2025', intake_years=[2025],
                                                 opens_at=now - timedelta(days=1), closes_at=now + timedelta(days=1))
        self.client = APIClient()
        self.client.force_authenticate(StudentPrincipal({'ldap_uid': 'ITITIU25001', 'student_id': self.student.pk}))

    def post(self, **data):
        body = {'request_key': uuid4().hex, 'confirm': 'true', 'diploma_number': 'ab 123456',
                'issued_by': 'Sở GD&ĐT TP.HCM', 'issued_on': '2025-07-20', 'exam_session': '2025'}
        body.update(data)
        return self.client.post(self.url, {k: v for k, v in body.items() if v is not None}, format='multipart')

    def stored_image(self):
        return StudentImage.objects.create(student=self.student, kind='cccd_front', subject='SELF',
            storage_key='insurance_private/student_images/1/a.jpg', original_filename='a.jpg',
            mime_type='image/jpeg', file_size_bytes=1, sha256='x', source='bhyt_registration')

    def test_form_mode_shows_read_only_profile(self):
        data = self.client.get(self.url).data
        self.assertEqual(data['mode'], 'form')
        self.assertEqual(data['profile']['university_email'], 'ititiu25001@student.hcmiu.edu.vn')
        self.assertEqual(data['profile']['citizen_id'], '079200000001')
        self.assertIsNone(data['cccd_image'])

    def test_blocked_when_round_is_for_other_intake(self):
        self.round.intake_years = [2026]
        self.round.save()
        data = self.client.get(self.url).data
        self.assertEqual(data['mode'], 'blocked')
        self.assertIn('khóa 2025', data['blocked_message'])
        self.assertEqual(self.post(cccd_front=png(), diploma_pdf=pdf()).status_code, 409)

    def test_round_for_many_intakes(self):
        self.round.intake_years = [2022, 2023, 2024, 2025]
        self.round.save()
        self.assertEqual(self.client.get(self.url).data['mode'], 'form')

    def test_blocked_without_intake_year(self):
        self.student.academic_entry_year = None
        self.student.save()
        self.assertIn('chưa có thông tin khóa', self.client.get(self.url).data['blocked_message'])

    def test_personal_fields_are_ignored(self):
        response = self.post(cccd_front=png(), diploma_pdf=pdf(), phone_number='0999999999', full_name='Hacker')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['mode'], 'submitted')
        self.assertEqual(response.data['profile']['full_name'], 'Nguyễn Văn A')
        self.assertEqual(response.data['profile']['phone_number'], '0901234567')

    def test_submit_saves_missing_cccd_to_store(self):
        response = self.post(cccd_front=png(), diploma_pdf=pdf())
        self.assertEqual(response.status_code, 200, response.data)
        sub = DiplomaSubmission.objects.get(student=self.student)
        self.assertEqual((sub.status, sub.source, sub.diploma_number), ('pending', 'hub', 'AB123456'))
        self.assertTrue(sub.diploma_pdf['storage_key'].startswith('insurance_private/diplomas/'))
        image = StudentImage.objects.get(student=self.student, kind='cccd_front', is_current=True)
        self.assertEqual((image.source, sub.cccd_image_id), ('diploma', image.pk))

    def test_existing_cccd_is_used_and_never_replaced(self):
        image = self.stored_image()
        self.assertEqual(self.client.get(self.url).data['cccd_image']['id'], image.pk)
        response = self.post(cccd_front=png(), diploma_pdf=pdf())
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(DiplomaSubmission.objects.get().cccd_image_id, image.pk)
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
                             diploma_number='?')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(set(response.data['errors']), {'issued_on', 'diploma_number'})

    def test_replay_same_request_key_is_idempotent(self):
        key = uuid4().hex
        self.post(request_key=key, cccd_front=png(), diploma_pdf=pdf())
        self.assertEqual(self.post(request_key=key, cccd_front=png(), diploma_pdf=pdf()).status_code, 200)
        self.assertEqual(DiplomaEvent.objects.count(), 1)

    def test_submitted_is_locked_until_returned_even_after_close(self):
        self.post(cccd_front=png(), diploma_pdf=pdf())
        sub = DiplomaSubmission.objects.get()
        self.assertFalse(self.client.get(self.url).data['can_edit'])
        self.assertEqual(self.post(row_version=sub.row_version, diploma_number='AB999999').status_code, 409)
        self.round.closes_at = timezone.now() - timedelta(minutes=1)
        self.round.save()
        sub.status, sub.review_note = 'returned', 'Số hiệu sai'
        sub.save()
        self.assertTrue(self.client.get(self.url).data['can_edit'])
        response = self.post(row_version=sub.row_version, diploma_number='AB999999')
        self.assertEqual(response.status_code, 200, response.data)
        sub.refresh_from_db()
        self.assertEqual((sub.status, sub.submit_count, sub.supplement_pending, sub.diploma_number),
                         ('pending', 2, True, 'AB999999'))

    def test_imported_mode_shows_diploma_only(self):
        DiplomaSubmission.objects.create(student=self.student, source='import', status='imported',
                                         diploma_number='X1234', issued_by='Sở GD&ĐT Đồng Nai',
                                         issued_on=date(2020, 7, 1), exam_session='2020')
        data = self.client.get(self.url).data
        self.assertEqual(data['mode'], 'imported')
        self.assertEqual(data['submission']['diploma_number'], 'X1234')
        self.assertIsNone(data['submission']['diploma_pdf_url'])
        self.assertEqual(self.post(cccd_front=png(), diploma_pdf=pdf()).status_code, 409)

    def test_files_only_served_to_owner(self):
        self.post(cccd_front=png(), diploma_pdf=pdf())
        response = self.client.get('/api/diploma/files/diploma_pdf/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'application/pdf')
        response.close()  # Windows không xóa được file đang mở
        response = self.client.get('/api/diploma/files/cccd_front/')
        self.assertEqual(response.status_code, 200)
        response.close()
        self.assertEqual(self.client.get('/api/diploma/files/other/').status_code, 404)
        other = Student.objects.create(current_student_code='X2', full_name='B')
        client = APIClient()
        client.force_authenticate(StudentPrincipal({'ldap_uid': 'X2', 'student_id': other.pk}))
        self.assertEqual(client.get('/api/diploma/files/diploma_pdf/').status_code, 404)

    @override_settings(FEATURE_DIPLOMA=False)
    def test_feature_flag_hides_endpoint(self):
        self.assertEqual(self.client.get(self.url).status_code, 404)
