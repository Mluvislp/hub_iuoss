"""Declarations tied to intake windows, with in-place edits and audit events."""
from pathlib import Path
from uuid import uuid4

from django.conf import settings
from django.db import transaction
from rest_framework import serializers
from rest_framework.response import Response
from students.models import Hospital, Student, VnProvince, VnWard
from core.models import ExternalInsuranceDeclaration
from core.insurance_contract import WorkflowError, Conflict, fingerprint, request_key
from core.insurance_files import inspect_upload
from .serializers import InsuranceRegistrationSerializer
from .views import InsuranceRegistrationView


class ExternalInsuranceSerializer(InsuranceRegistrationSerializer):
    registration_year = None
    registration_period = None
    payment_receipt_image = None
    medical_insurance_code = serializers.RegexField(r'^(?:[A-Z]{2}[0-9]{13}|[0-9]{10})$', max_length=64)
    social_insurance_number = serializers.RegexField(r'^[0-9]{10}$', max_length=15)
    valid_from = serializers.DateField()
    valid_until = serializers.DateField()

    def validate(self, attrs):
        if attrs['valid_until'] < attrs['valid_from']:
            raise serializers.ValidationError('Ngày hết hạn phải từ ngày bắt đầu trở đi.')
        if not attrs['medical_insurance_code'].endswith(attrs['social_insurance_number']):
            raise serializers.ValidationError('Mã thẻ BHYT phải khớp mã số BHXH.')
        if not VnWard.objects.filter(code=attrs['permanent_ward'],
                                     province_code=attrs['permanent_province'], is_active=True).exists():
            raise serializers.ValidationError('Phường/xã không thuộc tỉnh/thành đã chọn.')
        return attrs


from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone
from core.models import HealthInsuranceConfig
from core.external_insurance_models import ExternalInsuranceEvent
from core.insurance_editing import window
from core.insurance_history import check_version, require_active
from core.insurance_contract import safe_path
from .views import _insurance_config_payload

EXTERNAL_IMAGES = ('cccd_image', 'cccd_image_back', 'bhyt_image')


def active_config():
    now = timezone.now()
    rows = list(HealthInsuranceConfig.objects.select_related('bank_account').filter(
        is_active=True, registration_opens_at__lte=now, registration_closes_at__gte=now)[:2])
    return rows[0] if len(rows) == 1 else None


def external_detail(row):
    hospital = Hospital.objects.filter(code=row.hospital_code).first()
    province_code = (row.snapshot or {}).get('permanent_province', '')
    ward_code = (row.snapshot or {}).get('permanent_ward', '')
    province = VnProvince.objects.filter(code=province_code).first()
    ward = VnWard.objects.filter(code=ward_code, province_code=province_code).first()
    edited = row.events.filter(event_type='STUDENT_UPDATED').order_by('created_at').first()
    prefill = dict(row.snapshot or {})
    prefill.update(full_name=row.full_name, student_code=row.student_code,
        social_insurance_number=row.social_insurance_code, medical_insurance_code=row.medical_insurance_code,
        hospital_code=row.hospital_code, hospital_province=hospital.province_code if hospital else '',
        valid_from=str(row.valid_from), valid_until=str(row.valid_until))
    win = window(row.intake_year, row.intake_period, row.intake_snapshot)
    return dict(id=row.pk, status=row.status, row_version=row.row_version,
        prefill=prefill, config=row.intake_snapshot, window=win,
        display={'permanent_province': province.name if province else 'Chưa xác định',
                 'permanent_ward': ward.name if ward else 'Chưa xác định',
                 'hospital_code': hospital.name if hospital else 'Chưa xác định'},
        can_edit=win['can_edit'] and edited is None,
        can_resubmit=row.status == 'rejected', edited_at=edited.created_at if edited else None,
        review_note=row.review_note, created_at=row.created_at, updated_at=row.updated_at,
        images=[{'field': field, 'filename': field,
                 'url': f'/api/health-insurance/external/{row.pk}/images/{field}/?v={row.row_version}'}
                for field in EXTERNAL_IMAGES if (row.images or {}).get(field)],
        history=list(row.events.values('event_type', 'created_at', 'source_app', 'payload')))


class ExternalInsuranceView(InsuranceRegistrationView):
    def get(self, request, pk=None):
        if pk is not None:
            return Response(external_detail(get_object_or_404(ExternalInsuranceDeclaration,
                            pk=pk, student_id=request.user.student_id)))
        student = self._student(request)
        if student is None:
            raise Http404
        cfg = active_config()
        if cfg is None:
            cfg = (HealthInsuranceConfig.objects.select_related('bank_account')
                   .order_by('-is_active', '-registration_opens_at', '-id').first())
        # Reuse the submitted record in the current intake, including rejections.
        previous = ExternalInsuranceDeclaration.objects.filter(student=student,
            intake_year=cfg.registration_year, intake_period=cfg.registration_period).order_by('-id').first() if cfg else None
        if previous:
            return Response(external_detail(previous))
        prefill = self._snapshot(student)
        card = student.health_insurance_cards.order_by('-id').first()
        if card:
            hospital = Hospital.objects.filter(code=card.hospital_code).first()
            prefill.update(medical_insurance_code=card.medical_insurance_code or '',
                valid_from=str(card.valid_from or ''), valid_until=str(card.valid_until or ''),
                hospital_code=card.hospital_code or '', hospital_province=hospital.province_code if hospital else '')
        return Response({'prefill': prefill,
                         'config': _insurance_config_payload(cfg, include_payment=False, student=student) if cfg else None})

    def post(self, request, pk=None):
        written = []
        try:
            require_active()
            key = request_key(request.data.get('request_key'))
            payload = {k: request.data.get(k) for k in request.data if k not in request.FILES and k != 'request_key'}
            checked = {k: inspect_upload(upload) for k, upload in request.FILES.items() if k in EXTERNAL_IMAGES}
            payload.update({k: value[3] for k, value in checked.items()})
            digest = fingerprint(payload)
            with transaction.atomic():
                student = Student.objects.select_for_update().filter(pk=request.user.student_id).first()
                if student is None:
                    raise Http404
                row = get_object_or_404(ExternalInsuranceDeclaration.objects.select_for_update(),
                        pk=pk, student=student) if pk else None
                event = ExternalInsuranceEvent.objects.filter(declaration__student=student, request_key=key).first()
                if event:
                    if event.payload.get('request_digest') != digest or (pk and event.declaration_id != pk):
                        raise Conflict('Yêu cầu này đã được dùng cho nội dung khác.')
                    return Response({'id': event.declaration_id, 'status': event.declaration.status})
                legacy = ExternalInsuranceDeclaration.objects.filter(student=student, request_key=key).first() if not pk else None
                if legacy:
                    if legacy.request_digest != digest:
                        raise Conflict('Yêu cầu này đã được dùng cho nội dung khác.')
                    return Response({'id': legacy.pk, 'status': legacy.status})
                cfg = active_config()
                if row:
                    check_version(row, request.data.get('row_version'))
                    resubmitted = row.status == 'rejected' and request.data.get('action') == 'resubmit'
                    if not resubmitted and not window(row.intake_year, row.intake_period, row.intake_snapshot)['can_edit']:
                        raise Conflict('Đã hết hạn chỉnh sửa bản khai.')
                    previous_edit = row.events.filter(event_type='STUDENT_UPDATED').order_by('created_at').first()
                    if not resubmitted and previous_edit:
                        edited_at = timezone.localtime(previous_edit.created_at).strftime('%H:%M:%S %d/%m/%Y')
                        raise Conflict(f'Sinh viên đã chỉnh sửa vào lúc {edited_at}, không thể chỉnh sửa thêm')
                else:
                    if not cfg:
                        raise Conflict('Hiện không trong thời gian tiếp nhận khai báo.')
                    if ExternalInsuranceDeclaration.objects.filter(student=student, intake_year=cfg.registration_year,
                            intake_period=cfg.registration_period).exists():
                        raise Conflict('Đã có bản khai trong thời gian này. Hãy mở bản khai để chỉnh sửa.')
                serializer = ExternalInsuranceSerializer(data=request.data)
                if row:
                    for field in EXTERNAL_IMAGES:
                        serializer.fields[field].required = False
                    serializer.fields.pop('student_code')
                serializer.is_valid(raise_exception=True)
                data = serializer.validated_data
                if not row and data['student_code'] != student.current_student_code:
                    raise WorkflowError('MSSV không khớp với tài khoản đăng nhập.')
                values = dict(full_name=data['full_name'], social_insurance_code=data['social_insurance_number'],
                    medical_insurance_code=data['medical_insurance_code'], hospital_code=data['hospital_code'],
                    valid_from=data['valid_from'], valid_until=data['valid_until'])
                images = dict(row.images or {}) if row else {}
                before = {'snapshot': dict(row.snapshot or {}), 'images': dict(images), 'status': row.status,
                          'review_note': row.review_note} if row else {}
                for field, checked_file in checked.items():
                    content, ext, mime, _ = checked_file
                    storage_key = f'insurance_private/external/{uuid4().hex}.{ext}'
                    target = Path(settings.MEDIA_ROOT).resolve() / storage_key
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with target.open('xb') as stream:
                        written.append(target)
                        stream.write(content)
                    images[field] = {'storage_key': storage_key, 'mime_type': mime}
                snapshot = dict(row.snapshot or {}) if row else {}
                snapshot.update({k: str(v) for k, v in data.items() if k not in EXTERNAL_IMAGES})
                if row:
                    changes = {k: {'before': (row.snapshot or {}).get(k), 'after': v}
                               for k, v in snapshot.items() if (row.snapshot or {}).get(k) != v}
                    changes.update({k: {'before': before.get('images', {}).get(k), 'after': images[k]} for k in checked})
                    if not changes:
                        raise WorkflowError('Sinh viên không có chỉnh sửa')
                    for name, value in values.items():
                        setattr(row, name, value)
                    row.snapshot, row.images = snapshot, images
                    if resubmitted:
                        row.status = 'pending'
                        row.supplement_pending = True
                        row.supplemented_at = timezone.now()
                    row.row_version += 1
                    row.save(update_fields=[*values, 'snapshot', 'images', 'status', 'supplement_pending',
                                           'supplemented_at', 'row_version', 'updated_at'])
                    kind = 'RESUBMITTED' if resubmitted else 'STUDENT_UPDATED'
                else:
                    row = ExternalInsuranceDeclaration.objects.create(student=student,
                        student_code=student.current_student_code, registration_year=data['valid_from'].year,
                        intake_year=cfg.registration_year, intake_period=cfg.registration_period,
                        intake_snapshot=_insurance_config_payload(cfg, include_payment=False, student=student),
                        snapshot=snapshot, images=images, request_key=key, request_digest=digest, **values)
                    kind = 'SUBMITTED'
                    changes = {k: {'before': None, 'after': v} for k, v in snapshot.items()}
                    changes.update({k: {'before': None, 'after': images[k]} for k in checked})
                ExternalInsuranceEvent.objects.create(declaration=row, event_type=kind, actor_id=student.pk,
                    source_app='Hub', request_key=key, payload={'request_digest': digest, 'changes': changes,
                    'previous_rejection': before.get('review_note') if kind == 'RESUBMITTED' else None})
            return Response({'id': row.pk, 'status': row.status, 'row_version': row.row_version}, status=200 if pk else 201)
        except Exception as exc:
            for path in written:
                path.unlink(missing_ok=True)
            if isinstance(exc, WorkflowError):
                return Response({'detail': str(exc)}, status=409 if isinstance(exc, Conflict) else 400)
            if isinstance(exc, serializers.ValidationError):
                return Response({'detail': 'Vui lòng kiểm tra các trường thông tin.', 'errors': exc.detail}, status=400)
            raise


class ExternalInsuranceImageView(ExternalInsuranceView):
    http_method_names = ['get']

    def get(self, request, pk, field):
        row = get_object_or_404(ExternalInsuranceDeclaration, pk=pk, student_id=request.user.student_id)
        if field not in EXTERNAL_IMAGES:
            raise Http404
        data = (row.images or {}).get(field, {})
        path = safe_path(settings.MEDIA_ROOT, data.get('storage_key', ''))
        if path is None:
            raise Http404
        response = FileResponse(path.open('rb'), content_type=data.get('mime_type'))
        response['Cache-Control'] = 'private, no-store'
        response['X-Content-Type-Options'] = 'nosniff'
        return response
