"""Sự kiện cộng tác viên phía Hub — ai thấy, gửi / sửa / hủy, file, ảnh.

    python manage.py test core.test_volunteer_events --settings=config.insurance_test_settings
"""
import json
from datetime import timedelta
from io import BytesIO
from tempfile import TemporaryDirectory

from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient

from core import volunteer_form as fs
from core.api.authentication import StudentPrincipal
from core.volunteer_models import VolunteerEvent as E
from core.volunteer_models import VolunteerEventStudent as Aud
from core.volunteer_models import VolunteerRegistration as R
from students.models import DegreeLevel, Student, StudentContactPoint, StudentStatus


def png():
    buf = BytesIO()
    Image.new('RGB', (40, 30), (200, 10, 10)).save(buf, 'PNG')
    return SimpleUploadedFile('anh.png', buf.getvalue(), content_type='image/png')


SCHEMA = {
    'profile': {'fields': ['class_code', 'phone', 'email'], 'editable': ['phone']},
    'questions': [
        {'id': 'q_00000001', 'type': 'single', 'title': 'Size áo', 'required': True,
         'options': [{'id': 'o_00000001', 'label': 'S'}, {'id': 'o_00000002', 'label': 'M'}]},
        {'id': 'q_00000002', 'type': 'long_text', 'title': 'Kinh nghiệm', 'required': False},
        {'id': 'q_00000003', 'type': 'file', 'title': 'Ảnh chân dung', 'required': True, 'accept': 'image', 'max_files': 1},
    ],
}


@override_settings(FEATURE_VOLUNTEER_EVENTS=True)
class VolunteerHubTests(TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        override = override_settings(MEDIA_ROOT=self.temp.name)
        override.enable()
        self.addCleanup(override.disable)
        cache.clear()
        self.addCleanup(cache.clear)
        bach = DegreeLevel.objects.create(code='BACHELOR', name='Bachelor')
        active = StudentStatus.objects.create(code='ACTIVE', name_vi='Đang học', status_group='ACTIVE')
        grad = StudentStatus.objects.create(code='GRADUATED', name_vi='Đã tốt nghiệp', status_group='GRADUATED')
        self.student = Student.objects.create(current_student_code='ITITIU25001', full_name='Nguyễn Văn A',
                                              class_code='ITIT25IU01', current_degree_level=bach, current_status=active)
        self.alumni = Student.objects.create(current_student_code='ITITIU18001', full_name='Trần B',
                                             current_degree_level=bach, current_status=grad)
        StudentContactPoint.objects.create(student=self.student, contact_type='MOBILE_PHONE',
                                           contact_value='0901234567', is_current=True)
        now = timezone.now()
        self.event = E.objects.create(
            title='Ngày hội việc làm', description='<p>Hỗ trợ</p><script>x</script>', starts_at=now + timedelta(days=5),
            ends_at=now + timedelta(days=6), location='Hội trường Trần Chí Đáo', audience_mode='all', capacity=50,
            registration_opens_at=now - timedelta(hours=1), registration_closes_at=now + timedelta(days=2),
            form_schema=SCHEMA, published_at=now, created_by_id=1)
        self.client = APIClient()
        self.login(self.student)

    def login(self, s):
        self.client.force_authenticate(StudentPrincipal({'ldap_uid': s.current_student_code, 'student_id': s.pk}))

    def url(self, suffix=''):
        return f'/api/volunteer-events/{self.event.pk}/{suffix}'

    def register(self, answers=None, profile=None, **extra):
        body = {'answers': json.dumps(answers if answers is not None else {'q_00000001': 'o_00000002'}),
                'profile': json.dumps(profile or {'phone': '0912 345 678'})}
        body.update(extra)
        return self.client.post(self.url('register/'), body, format='multipart')

    # ── Ai thấy ──
    def test_all_mode_visible_only_to_active_bachelor(self):
        self.assertEqual(len(self.client.get('/api/volunteer-events/').data['events']), 1)
        self.login(self.alumni)
        self.assertEqual(self.client.get('/api/volunteer-events/').data['events'], [])
        self.assertEqual(self.client.get(self.url()).status_code, 404)

    def test_list_mode_and_unpublished(self):
        self.event.audience_mode = 'list'
        self.event.save()
        self.assertEqual(self.client.get(self.url()).status_code, 404)
        Aud.objects.create(event=self.event, student=self.alumni, student_code='ITITIU18001', source='manual')
        self.login(self.alumni)
        self.assertEqual(self.client.get(self.url()).status_code, 200)
        self.event.published_at = None
        self.event.save()
        self.assertEqual(self.client.get(self.url()).status_code, 404)

    def test_feature_flag_off(self):
        with override_settings(FEATURE_VOLUNTEER_EVENTS=False):
            self.assertEqual(self.client.get('/api/volunteer-events/').status_code, 404)

    def test_detail_has_profile_and_clean_description(self):
        d = self.client.get(self.url()).data
        self.assertNotIn('script', d['description'])
        prof = {p['key']: p for p in d['form']['profile']}
        self.assertEqual(list(prof), ['student_code', 'full_name', 'class_code', 'phone', 'email'])
        self.assertEqual(prof['phone']['value'], '0901234567')
        self.assertTrue(prof['phone']['editable'])
        self.assertFalse(prof['email']['editable'])
        self.assertEqual(d['day_count'], 2)

    # ── Gửi ──
    def test_register_validates_then_saves(self):
        r = self.register(answers={})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(set(r.data['errors']), {'q_00000001', 'q_00000003'})
        r = self.register(**{'file:q_00000003': png()})
        self.assertEqual(r.status_code, 200, r.data)
        reg = R.objects.get(event=self.event, student=self.student)
        self.assertEqual(reg.status, 'pending')
        self.assertEqual(reg.answers['profile'], {'phone': '0912345678'})
        f = reg.answers['q_00000003'][0]
        self.assertTrue(f['key'].startswith(f'volunteer_events/{self.event.pk}/reg/{self.student.pk}/'))
        self.assertEqual(r.data['registration']['answers']['q_00000003'][0]['name'], 'anh.png')
        self.assertNotIn('key', r.data['registration']['answers']['q_00000003'][0])
        # Tải lại được file của chính mình qua media.
        resp = self.client.get(self.url('media/'), {'key': f['key']})
        self.assertEqual(resp.status_code, 200)
        resp.close()

    def test_edit_keeps_old_file_and_locks_after_review(self):
        self.register(**{'file:q_00000003': png()})
        r = self.register(answers={'q_00000001': 'o_00000001'}, **{'keep:q_00000003': '[0]'})
        self.assertEqual(r.status_code, 200, r.data)
        reg = R.objects.get(event=self.event, student=self.student)
        self.assertEqual(reg.answers['q_00000001'], 'o_00000001')
        self.assertEqual(len(reg.answers['q_00000003']), 1)
        reg.status = 'approved'
        reg.save()
        self.assertEqual(self.register(**{'keep:q_00000003': '[0]'}).status_code, 409)

    def test_yes_no_reason_saved(self):
        self.event.form_schema = {'profile': {'fields': [], 'editable': []}, 'questions': [
            {'id': 'q_000000aa', 'type': 'yes_no', 'title': 'Tham gia cả 2 ngày?', 'required': True, 'reason_label': 'Lý do'}]}
        self.event.save()
        r = self.client.post(self.url('register/'), {'answers': json.dumps({'q_000000aa': 'no'})}, format='multipart')
        self.assertEqual(r.status_code, 200, r.data)                                    # lý do không bắt buộc
        r = self.client.post(self.url('register/'), {'answers': json.dumps({'q_000000aa': 'no', 'q_000000aa:reason': 'Trùng lịch thi'})},
                             format='multipart')
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(R.objects.get(event=self.event).answers['q_000000aa:reason'], 'Trùng lịch thi')

    def test_submit_checks_latest_form_after_type_change(self):
        # Tab SV mở lúc câu còn "Chọn một" (gửi 1 giá trị), staff đã đổi sang "Chọn nhiều" ⇒ lưu đúng dạng mới.
        schema = json.loads(json.dumps(SCHEMA))
        schema['questions'][0]['type'] = 'multi'
        self.event.form_schema = schema
        self.event.save()
        r = self.register(**{'file:q_00000003': png()})          # answers: {'q_00000001': 'o_00000002'}
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(R.objects.get(event=self.event).answers['q_00000001'], ['o_00000002'])

    def test_pdf_rejected_for_image_question(self):
        pdf = SimpleUploadedFile('cv.pdf', b'%PDF-1.4 test', content_type='application/pdf')
        r = self.register(**{'file:q_00000003': pdf})
        self.assertEqual(r.status_code, 400)
        self.assertIn('q_00000003', r.data['errors'])

    def test_closed_window_blocks(self):
        self.event.registration_closes_at = timezone.now() - timedelta(minutes=1)
        self.event.save()
        self.assertEqual(self.register(**{'file:q_00000003': png()}).status_code, 409)

    def test_cancel_and_reregister(self):
        self.register(**{'file:q_00000003': png()})
        r = self.client.post(self.url('cancel/'))
        self.assertEqual(r.data['registration']['status'], 'cancelled')
        self.assertTrue(r.data['registration']['can_reregister'])
        r = self.register(**{'keep:q_00000003': '[0]'})
        self.assertEqual(r.data['registration']['status'], 'pending')

    def test_media_only_event_images_and_own_files(self):
        self.assertEqual(self.client.get(self.url('media/'), {'key': 'volunteer_events/1/x.jpg'}).status_code, 404)
        other = R.objects.create(event=self.event, student=self.alumni, student_code='x', submitted_at=timezone.now(),
                                 answers={'q_00000003': [{'key': f'volunteer_events/{self.event.pk}/reg/9/a.jpg'}]})
        self.assertEqual(self.client.get(self.url('media/'), {'key': other.answers['q_00000003'][0]['key']}).status_code, 404)

    # ── Trang công khai (link / QR) ──
    def test_public_event_without_login(self):
        anon = APIClient()
        anon.credentials(HTTP_AUTHORIZATION='Bearer hong')         # token hỏng vẫn không 401
        r = anon.get(f'/api/public/volunteer-events/{self.event.pk}/')
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data['title'], 'Ngày hội việc làm')
        self.assertEqual(r.data['audience'], 'all')
        for leaked in ('form', 'registration', 'my_status', 'eligible'):
            self.assertNotIn(leaked, r.data)
        self.assertNotIn('script', r.data['description'])
        self.assertIsNone(r.data['cover_url'])
        self.assertEqual(anon.get(f'/api/public/volunteer-events/{self.event.pk}/cover/').status_code, 404)

    def test_public_event_hidden_when_unpublished_or_flag_off(self):
        anon = APIClient()
        with override_settings(FEATURE_VOLUNTEER_EVENTS=False):
            self.assertEqual(anon.get(f'/api/public/volunteer-events/{self.event.pk}/').status_code, 404)
        self.event.published_at = None
        self.event.save()
        self.assertEqual(anon.get(f'/api/public/volunteer-events/{self.event.pk}/').status_code, 404)
        self.assertEqual(anon.get('/api/public/volunteer-events/999/').status_code, 404)

    def test_public_cover(self):
        from pathlib import Path
        key = f'volunteer_events/{self.event.pk}/cover-x.jpg'
        target = Path(self.temp.name) / key
        target.parent.mkdir(parents=True)
        target.write_bytes(bytes([0xFF, 0xD8]) + b"jpg")
        self.event.cover_image_key = key
        self.event.save()
        anon = APIClient()
        self.assertEqual(anon.get(f'/api/public/volunteer-events/{self.event.pk}/').data['cover_url'],
                         f'/api/public/volunteer-events/{self.event.pk}/cover/')
        r = anon.get(f'/api/public/volunteer-events/{self.event.pk}/cover/')
        self.assertEqual(r.status_code, 200)
        r.close()
        # Key ngoài thư mục sự kiện ⇒ không phục vụ.
        self.event.cover_image_key = 'insurance_private/x.jpg'
        self.event.save()
        self.assertEqual(anon.get(f'/api/public/volunteer-events/{self.event.pk}/cover/').status_code, 404)

    def test_twin_module_matches_dashboard(self):
        from pathlib import Path
        dash = Path(__file__).resolve().parents[3] / 'dashboard_iuoss' / 'volunteers' / 'form_schema.py'
        if dash.exists():
            self.assertEqual(dash.read_text(encoding='utf-8'), Path(fs.__file__).read_text(encoding='utf-8'))


class ShortLinkApiTests(TestCase):
    def setUp(self):
        from django.utils import timezone
        from core.short_link_models import ShortLink
        now = timezone.now()
        self.link = ShortLink.objects.create(slug='hcmiu-run-2026', target_url='https://hub.iuoss.com/su-kien/2',
                                             created_by_id=1, created_at=now, updated_at=now)
        self.client = APIClient()

    def test_resolves_and_counts(self):
        self.client.credentials(HTTP_AUTHORIZATION='Bearer hong')     # token hỏng vẫn không chặn
        r = self.client.get('/api/short-links/HCMIU-Run-2026/')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data['target'], 'https://hub.iuoss.com/su-kien/2')
        self.client.get('/api/short-links/hcmiu-run-2026/')
        self.link.refresh_from_db()
        self.assertEqual(self.link.click_count, 2)
        self.assertIsNotNone(self.link.last_clicked_at)

    def test_inactive_and_missing(self):
        self.link.is_active = False
        self.link.save()
        self.assertEqual(self.client.get('/api/short-links/hcmiu-run-2026/').status_code, 410)
        self.link.refresh_from_db()
        self.assertEqual(self.link.click_count, 0)
        self.assertEqual(self.client.get('/api/short-links/khong-co/').status_code, 404)
