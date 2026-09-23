from io import BytesIO, StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from uuid import uuid4
from PIL import Image
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient
from core.api.authentication import StudentPrincipal
from core.models import HealthInsuranceRegistration as Registration, HealthInsuranceConfig, InsuranceEvent, InsuranceEvidence
from students.models import (
    Student, Hospital, VnProvince, HealthInsuranceCard,
    HealthInsuranceRegistrationType,
)
from core.insurance_contract import WorkflowError, Conflict, assessment, safe_path, validate_transition
from core.insurance_history import append_event, add_assessment
from core.insurance_workflow import supplement, detail
from core.insurance_files import inspect_upload


def picture(name='receipt.png', color='red'):
    content=BytesIO();Image.new('RGB',(5,5),color).save(content,format='PNG')
    return SimpleUploadedFile(name,content.getvalue(),content_type='application/octet-stream')


class HubWorkflowTests(TestCase):
    def setUp(self):
        self.temp=TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        override=override_settings(MEDIA_ROOT=self.temp.name);override.enable();self.addCleanup(override.disable)
        self.student=Student.objects.create(current_student_code='TEST001',full_name='Test Student')
        self.reg=Registration.objects.create(student=self.student,registration_year=2027,registration_period='Q2',
            hospital_code='79001',fee_amount_vnd=1000000,payment_receipt_image='old.png',
            status='rejected',rejection_reason_code='UNDERPAID',rejection_reason='Thiếu tiền')
        self.client=APIClient();self.client.force_authenticate(StudentPrincipal({'ldap_uid':'TEST001','student_id':self.student.pk}))

    def submit(self, **kwargs):
        kwargs.setdefault('key',uuid4().hex);kwargs.setdefault('row_version',self.reg.row_version)
        return supplement(self.reg.pk,self.student.pk,**kwargs)

    def test_default_new_status(self):
        self.assertEqual(Registration().status,'iu_processing')

    def test_card_selected_by_staff_is_current_and_other_cards_are_history(self):
        from datetime import date
        now = timezone.now()
        old = HealthInsuranceCard.objects.create(student=self.student, registration_year=2027,
            valid_from=date(2027, 1, 1), valid_until=date(2030, 12, 31), is_current=True,
            created_at=now, updated_at=now)
        latest = HealthInsuranceCard.objects.create(student=self.student, registration_year=2027,
            valid_from=date(2027, 4, 1), valid_until=date(2027, 12, 31),
            social_insurance_code='0123456789', medical_insurance_code='SV4790123456789',
            created_at=now, updated_at=now)
        response = self.client.get('/api/health-insurance/')
        self.assertEqual(response.status_code, 200)
        data = response.data
        self.assertEqual(data['current']['id'], old.pk)
        self.assertEqual([card['id'] for card in data['history']], [latest.pk, old.pk])
        self.assertTrue(next(card for card in data['history'] if card['id'] == old.pk)['is_current'])
        self.assertEqual(data['current']['registration_year'], 2027)
        self.assertEqual(data['current']['valid_from'], '2027-01-01')
        self.assertEqual(data['current']['valid_until'], '2030-12-31')
        latest.delete()
        restored = self.client.get('/api/health-insurance/').data
        self.assertEqual(restored['current']['id'], old.pk)
        self.assertEqual([card['id'] for card in restored['history']], [old.pk])

    def test_single_card_is_displayed_even_without_current_flag_or_card_details(self):
        now = timezone.now()
        registration_type = HealthInsuranceRegistrationType.objects.create(
            code='KHONG_THAM_GIA',
            name='SV đăng ký không tham gia BHYT tại trường',
            created_at=now,
            updated_at=now,
        )
        card = HealthInsuranceCard.objects.create(
            student=self.student,
            registration_type=registration_type,
            registration_year=2027,
            is_current=False,
            created_at=now,
            updated_at=now,
        )

        data = self.client.get('/api/health-insurance/').data

        self.assertEqual(data['current']['id'], card.pk)
        self.assertIsNone(data['current']['medical_insurance_code'])
        self.assertIsNone(data['current']['social_insurance_code'])
        self.assertIsNone(data['current']['hospital_code'])
        self.assertEqual(
            data['current']['registration_type'],
            'SV đăng ký không tham gia BHYT tại trường',
        )
        self.assertEqual([row['id'] for row in data['history']], [card.pk])

    def test_main_period_allows_registration_with_long_valid_card(self):
        from datetime import timedelta

        now = timezone.now()
        HealthInsuranceCard.objects.create(
            student=self.student,
            registration_year=2027,
            valid_until=timezone.localdate() + timedelta(days=61),
            is_current=True,
            created_at=now,
            updated_at=now,
        )
        HealthInsuranceConfig.objects.create(
            registration_period='MAIN',
            registration_year=2028,
            registration_opens_at=now - timedelta(days=1),
            registration_closes_at=now + timedelta(days=1),
            is_active=True,
            bank_name='Bank',
            bank_account_number='123456',
            bank_account_name='University',
            insurance_fee=1000000,
        )

        data = self.client.get('/api/health-insurance/').data

        self.assertTrue(data['is_eligible'])

    def test_later_period_blocks_registration_with_long_valid_card(self):
        from datetime import timedelta

        now = timezone.now()
        HealthInsuranceCard.objects.create(
            student=self.student,
            registration_year=2027,
            valid_until=timezone.localdate() + timedelta(days=61),
            is_current=True,
            created_at=now,
            updated_at=now,
        )
        HealthInsuranceConfig.objects.create(
            registration_period='Q2',
            registration_year=2027,
            registration_opens_at=now - timedelta(days=1),
            registration_closes_at=now + timedelta(days=1),
            is_active=True,
            bank_name='Bank',
            bank_account_number='123456',
            bank_account_name='University',
            insurance_fee=1000000,
        )

        data = self.client.get('/api/health-insurance/').data

        self.assertFalse(data['is_eligible'])

    def test_image_append_resubmit_and_never_assess(self):
        reg=self.submit(uploads=[picture()])
        self.assertEqual(reg.status,'iu_processing')
        self.assertEqual(reg.payment_receipt_image.name,'old.png')
        self.assertEqual(reg.evidences.count(),1)
        self.assertEqual(len(set(reg.evidences.values_list('storage_key',flat=True))),1)
        for evidence in reg.evidences.all(): self.assertTrue(Path(self.temp.name,evidence.storage_key).is_file())
        self.assertFalse(reg.assessments.exists())
        self.assertEqual(list(reg.events.values_list('event_type',flat=True)),['PAYMENT_EVIDENCE_SUBMITTED','RESUBMITTED'])

    def test_multiple_supplement_rounds_keep_files(self):
        self.submit(uploads=[picture()]);self.reg.refresh_from_db()
        self.reg.status='rejected';self.reg.rejection_reason_code='UNDERPAID';self.reg.save()
        self.submit(uploads=[picture()])
        self.assertEqual(self.reg.evidences.count(),2)
        for e in self.reg.evidences.all(): self.assertTrue(Path(self.temp.name,e.storage_key).exists())

    def test_each_supplement_accepts_at_most_one_image(self):
        with self.assertRaisesRegex(WorkflowError, 'tối đa 1 ảnh'):
            self.submit(uploads=[picture(), picture()])
        self.assertFalse(self.reg.evidences.exists())

    def test_hospital_change_before_after_and_resubmit(self):
        VnProvince.objects.create(code='79',name='TP HCM',unit_type='Thành phố')
        for code,name in [('79001','Bệnh viện A'),('79002','Bệnh viện B')]:
            Hospital.objects.create(code=code,name=name,province_code='79',created_at=timezone.now(),updated_at=timezone.now())
        self.reg.rejection_reason_code='HOSPITAL_NOT_ACCEPTED';self.reg.save()
        reg=self.submit(hospital_code='79002',province_code='79')
        self.assertEqual((reg.hospital_code,reg.status),('79002','iu_processing'))
        event=reg.events.get(event_type='HOSPITAL_CHANGED')
        self.assertIsNone(event.from_status)
        self.assertIsNone(event.to_status)
        self.assertEqual(event.payload['before']['hospital_name'],'Bệnh viện A')
        self.assertEqual(event.payload['after']['hospital_name'],'Bệnh viện B')
        Hospital.objects.filter(code='79001').update(name='Renamed')
        event.refresh_from_db();self.assertEqual(event.payload['before']['hospital_name'],'Bệnh viện A')

    def test_invalid_hospital_cannot_resubmit(self):
        self.reg.rejection_reason_code='HOSPITAL_NOT_ACCEPTED';self.reg.save()
        with self.assertRaises(WorkflowError): self.submit(hospital_code='wrong',province_code='79')
        self.assertFalse(self.reg.events.exists())

    def test_hospital_outside_allowed_provinces_cannot_resubmit(self):
        VnProvince.objects.create(code='01', name='Hà Nội', unit_type='Thành phố')
        Hospital.objects.create(code='01001', name='Bệnh viện khác', province_code='01',
                                created_at=timezone.now(), updated_at=timezone.now())
        self.reg.rejection_reason_code = 'HOSPITAL_NOT_ACCEPTED'
        self.reg.save()
        with self.assertRaises(WorkflowError):
            self.submit(hospital_code='01001', province_code='01')
        self.assertFalse(self.reg.events.exists())

    def test_replay_upload_does_not_duplicate(self):
        key=uuid4().hex
        self.submit(key=key,uploads=[picture()]);self.submit(key=key,uploads=[picture()])
        self.assertEqual(self.reg.evidences.count(),1)
        self.assertEqual(self.reg.events.count(),2)
        with self.assertRaises(Conflict): self.submit(key=key,uploads=[picture(color='blue')])

    def test_stale_request_conflict(self):
        self.submit(uploads=[picture()])
        with self.assertRaises(Conflict): self.submit(uploads=[picture()])

    def test_payment_qr_uses_latest_assessment_and_snapshot(self):
        self.reg.config_snapshot={'bank_bin':'970436','bank_name':'Snapshot Bank','bank_account_number':'123456', 'bank_account_name':'University'}
        self.reg.save()
        for paid in [600000,800000]:
            e=append_event(self.reg,'PAYMENT_ASSESSED',source='Dashboard',actor_id=10)
            add_assessment(self.reg,e,assessment(1000000,paid))
        payload=detail(self.reg,lambda e:'/test')
        self.assertEqual(payload['payment']['missing_amount_vnd'],200000)
        self.assertIn('amount=200000',payload['payment']['qr_url'])
        self.assertEqual(
            payload['payment']['reference'],
            'BHYT sinh vien dot 2 2027_TEST001_Test Student',
        )
        self.assertIn(
            'BHYT+sinh+vien+dot+2+2027_TEST001_Test+Student',
            payload['payment']['qr_url'],
        )
        self.assertEqual(payload['payment']['bank_name'],'Snapshot Bank')
        e=append_event(self.reg,'PAYMENT_ASSESSED',source='Dashboard')
        add_assessment(self.reg,e,assessment(1000000,1000000))
        self.assertIsNone(detail(self.reg,lambda e:'/test')['payment']['qr_url'])

    def test_missing_snapshot_does_not_use_current_bank(self):
        e=append_event(self.reg,'REJECTED',source='Dashboard')
        add_assessment(self.reg,e,assessment(1000000,0,'UNPAID'))
        self.assertIsNone(detail(self.reg,lambda e:'/test')['payment']['qr_url'])

    def test_fake_mime_rejected_real_content_accepted(self):
        self.assertEqual(inspect_upload(picture())[2],'image/png')
        with self.assertRaises(WorkflowError): inspect_upload(SimpleUploadedFile('fake.jpg',b'<script>x</script>',content_type='image/jpeg'))
        with self.assertRaises(WorkflowError): inspect_upload(SimpleUploadedFile('large.png',b'x'*(5*1024*1024+1)))

    def test_file_failure_rolls_back_and_cleans_new_files(self):
        with patch.object(InsuranceEvidence.objects,'create',side_effect=RuntimeError('DB failure')):
            with self.assertRaises(RuntimeError): self.submit(uploads=[picture()])
        self.assertFalse(self.reg.events.exists())
        self.assertFalse([p for p in Path(self.temp.name).rglob('*') if p.is_file()])
        self.reg.refresh_from_db();self.assertEqual(self.reg.status,'rejected')

    def test_api_ownership_and_private_images(self):
        self.submit(uploads=[picture()]);e=self.reg.evidences.get()
        url=reverse('api_insurance_evidence',args=[self.reg.pk,e.pk])
        response=self.client.get(url);self.assertEqual(response.status_code,200)
        self.assertEqual(response['Cache-Control'],'private, no-store');b''.join(response.streaming_content)
        self.client.force_authenticate(StudentPrincipal({'ldap_uid':'OTHER','student_id':999}))
        self.assertEqual(self.client.get(url).status_code,404)
        self.assertEqual(self.client.get(reverse('api_insurance_detail',args=[self.reg.pk])).status_code,404)
        self.client.force_authenticate(None)
        self.assertIn(self.client.get(url).status_code,[401,403])

    def test_traversal(self):
        for path in ['../secret','/etc/passwd','C:/secret','..\\secret','//host/share']:
            self.assertIsNone(safe_path(self.temp.name,path))
        self.submit(uploads=[picture()]);e=self.reg.evidences.get();e.storage_key='../secret';e.save()
        self.assertEqual(self.client.get(reverse('api_insurance_evidence',args=[self.reg.pk,e.pk])).status_code,404)

    def test_detail_timeline_in_one_request(self):
        self.submit(uploads=[picture()])
        result=self.client.get(reverse('api_insurance_detail',args=[self.reg.pk])).json()
        self.assertEqual(len(result['timeline'][0]['evidences']),1)
        self.assertEqual(result['timeline'][1]['to_status'],'iu_processing')

    def test_legacy_without_history(self):
        self.reg.status='pending';self.reg.workflow_version=1;self.reg.save()
        result=detail(self.reg,lambda e:'/test')
        self.assertEqual(result['status'],'iu_processing');self.assertEqual(result['timeline'],[])

    def test_backfill_rerun_preserves_fee_and_import_event(self):
        self.reg.status='done';self.reg.workflow_version=1;self.reg.fee_amount_vnd=None;self.reg.save()
        Path(self.temp.name,'old.png').write_bytes(picture().read())
        opts={'apply':True,'database_name':__import__('django.db',fromlist=['connection']).connection.settings_dict['NAME'],
              'map_statuses':True,'stdout':StringIO()}
        call_command('backfill_insurance_workflow',**opts)
        call_command('backfill_insurance_workflow',**opts)
        self.reg.refresh_from_db()
        self.assertEqual(self.reg.status,'issued');self.assertIsNone(self.reg.fee_amount_vnd)
        self.assertEqual(self.reg.events.count(),1);self.assertEqual(self.reg.evidences.count(),0)
        self.assertEqual(self.reg.events.get().payload['observed_status'],'done')

    def test_backfill_default_read_only(self):
        self.reg.workflow_version=1;self.reg.save()
        call_command('backfill_insurance_workflow',stdout=StringIO())
        self.assertFalse(self.reg.events.exists())

    def test_contract_transitions(self):
        validate_transition('pending','waiting_bhxh')
        validate_transition('waiting_bhxh','issued')
        for old,new in [('iu_processing','issued'),('issued','iu_processing'),('rejected','waiting_bhxh')]:
            with self.assertRaises(Conflict):validate_transition(old,new)

    def test_other_requires_staff_reception(self):
        self.reg.rejection_reason_code='OTHER';self.reg.save()
        with self.assertRaises(WorkflowError): self.submit(uploads=[picture()])

    def submission_data(self, key):
        return dict(request_key=key, registration_year=2027, registration_period='MAIN',
            full_name='Test Student', student_code='TEST001', gender='Nam',dob='2005-01-01',
            ethnicity='Kinh',phone_number='0901234567',citizen_id='012345678901',
            permanent_province='79',permanent_ward='00001',permanent_street='Test street',
            hospital_code='79001',cccd_image=picture('front.png'),cccd_image_back=picture('back.png'),
            bhyt_image=picture('bhyt.png'),
            payment_receipt_image=picture('receipt.html'))

    def prepare_submission(self):
        from datetime import timedelta
        from students.models import VnWard, VnEthnicity
        VnProvince.objects.create(code='79',name='TP HCM',unit_type='Thành phố')
        VnWard.objects.create(code='00001',province_code='79',name='Ward',unit_type='Phường')
        VnEthnicity.objects.create(code='01',name='Kinh')
        Hospital.objects.create(code='79001',name='Hospital',province_code='79',created_at=timezone.now(),updated_at=timezone.now())
        HealthInsuranceConfig.objects.create(registration_period='MAIN',registration_year=2027,
            registration_opens_at=timezone.now()-timedelta(days=1),registration_closes_at=timezone.now()+timedelta(days=1),
            is_active=True,bank_name='Bank',bank_bin='970436',bank_account_number='123456',
            bank_account_name='University',insurance_fee=1000000)

    def test_new_submission_atomic_default_receipt_and_retry(self):
        self.prepare_submission();key=uuid4().hex;url=reverse('api_health_insurance_registrations')
        response=self.client.post(url,self.submission_data(key),format='multipart')
        self.assertEqual(response.status_code,201,response.data)
        reg=Registration.objects.get(pk=response.data['id'])
        self.assertEqual(reg.status,'iu_processing');self.assertEqual(reg.fee_amount_vnd,1000000)
        self.assertEqual(reg.events.get().event_type,'SUBMITTED');self.assertEqual(reg.evidences.count(),0)
        self.assertTrue(reg.payment_receipt_image.name.endswith('.png'))
        self.assertTrue(reg.payment_receipt_image.name.startswith('insurance_private/'))
        response=self.client.post(url,self.submission_data(key),format='multipart')
        self.assertEqual(response.status_code,200,response.data)
        self.assertEqual(response.data['id'],reg.pk)
        self.assertEqual(reg.events.count(),1)
        response=self.client.post(url,self.submission_data(uuid4().hex),format='multipart')
        self.assertEqual(response.status_code,409)

    def test_new_submission_requires_all_four_images(self):
        self.prepare_submission();data=self.submission_data(uuid4().hex);data.pop('bhyt_image')
        response=self.client.post(reverse('api_health_insurance_registrations'),data,format='multipart')
        self.assertEqual(response.status_code,400,response.data)
        self.assertIn('bhyt_image',response.data)

    def test_prior_period_blocks_later_period_form_and_submission(self):
        self.prepare_submission()
        HealthInsuranceConfig.objects.filter(registration_period='MAIN').update(
            registration_period='Q3',
        )
        url = reverse('api_health_insurance_registrations')

        response = self.client.get(url, {'period': 'Q3'})
        self.assertEqual(response.status_code, 409, response.data)
        self.assertIn('đợt 2 năm 2027', response.data['detail'])

        data = self.submission_data(uuid4().hex)
        data['registration_period'] = 'Q3'
        response = self.client.post(url, data, format='multipart')
        self.assertEqual(response.status_code, 409, response.data)
        self.assertIn('đợt 2 năm 2027', response.data['detail'])
        self.assertFalse(Registration.objects.filter(registration_period='Q3').exists())

    def test_new_submission_failure_rolls_back_files_and_row(self):
        self.prepare_submission()
        with patch('core.api.views.append_event',side_effect=RuntimeError('event failure')):
            with self.assertRaises(RuntimeError):
                self.client.post(reverse('api_health_insurance_registrations'),self.submission_data(uuid4().hex),format='multipart')
        self.assertEqual(Registration.objects.count(),1)
        self.assertFalse([p for p in Path(self.temp.name).rglob('*') if p.is_file()])

    def test_events_cannot_be_changed_or_deleted(self):
        event=append_event(self.reg,'REJECTED',source='Dashboard')
        with self.assertRaises(ValueError): event.save()
        with self.assertRaises(ValueError): event.delete()
        with self.assertRaises(ValueError): self.reg.events.update(reason_text='replace')
        with self.assertRaises(ValueError): self.reg.events.all().delete()
