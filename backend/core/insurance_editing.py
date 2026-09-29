"""In-place student edits; historical identity and status are immutable."""
from pathlib import Path
from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from .models import HealthInsuranceRegistration, HealthInsuranceConfig
from .insurance_contract import Conflict, WorkflowError, fingerprint
from .insurance_history import (require_active, replay, check_version, ensure_legacy, append_event,
                                readable_changes)
from .insurance_files import inspect_uploads, store_evidence

FIELDS = ('full_name', 'gender', 'dob', 'ethnicity', 'phone_number', 'citizen_id',
          'social_insurance_number', 'permanent_province', 'permanent_ward',
          'permanent_street', 'hospital_code', 'note')
IMAGES = ('cccd_image', 'cccd_image_back', 'bhyt_image', 'payment_receipt_image')


def period_config(year, period, snapshot=None, student=None):
    """Live config of the record's own period, so the Hub shows the description staff
    maintain now; falls back to the submit-time snapshot when the slot moved to another year."""
    from .api.views import _insurance_config_payload
    cfg = (HealthInsuranceConfig.objects.select_related('bank_account')
           .filter(registration_year=year, registration_period=period).first()) if year and period else None
    if cfg is None:
        return snapshot if isinstance(snapshot, dict) else None
    return _insurance_config_payload(cfg, include_payment=True, student=student)


def snapshot_datetime(value):
    try:
        return parse_datetime(value or '')
    except (TypeError, ValueError):
        return None


def window(year, period, snapshot=None):
    cfg = HealthInsuranceConfig.objects.filter(registration_year=year, registration_period=period).first() if year and period else None
    snapshot = snapshot if isinstance(snapshot, dict) else {}
    start = cfg.registration_opens_at if cfg else snapshot_datetime(snapshot.get('start_date'))
    end = cfg.registration_closes_at if cfg else snapshot_datetime(snapshot.get('end_date'))
    now = timezone.now()
    opened = bool(start and end and (cfg.is_active if cfg else False) and start <= now <= end)
    return {'start_date': start, 'end_date': end, 'status': 'open' if opened else 'closed', 'can_edit': opened}


def registration_data(reg):
    from students.models import Hospital, VnProvince, VnWard
    hospital = Hospital.objects.filter(code=reg.hospital_code).first()
    province = VnProvince.objects.filter(code=reg.permanent_province).first()
    ward = VnWard.objects.filter(
        code=reg.permanent_ward, province_code=reg.permanent_province,
    ).first()
    edited = reg.events.filter(event_type='STUDENT_UPDATED').order_by('created_at').first()
    edit_window = window(reg.registration_year, reg.registration_period, reg.config_snapshot)
    values = {name: str(getattr(reg, name) or '') for name in FIELDS}
    values.update(student_code=reg.student_code or '', hospital_province=hospital.province_code if hospital else '')
    config = period_config(reg.registration_year, reg.registration_period, reg.config_snapshot, reg.student)
    return dict(prefill=values, config=config,
                display={'permanent_province': province.name if province else 'Chưa xác định',
                         'permanent_ward': ward.name if ward else 'Chưa xác định',
                         'hospital_code': hospital.name if hospital else 'Chưa xác định'},
                legacy_changes=readable_changes([reg.change_log or {}])[0][0],
                registration_year=reg.registration_year, registration_period=reg.registration_period,
                created_at=reg.created_at, updated_at=reg.updated_at, edited_at=edited.created_at if edited else None,
                can_edit=edit_window['can_edit'] and edited is None, window=edit_window,
                images=[{'field': name, 'filename': name, 'url': f'/api/health-insurance/registrations/{reg.pk}/images/{name}/?v={reg.row_version}'}
                        for name in IMAGES if getattr(reg, name)])


def edit_registration(pk, student_id, data, files):
    from .api.serializers import InsuranceRegistrationSerializer
    from students.models import VnWard
    from rest_framework.exceptions import ValidationError
    require_active()
    checked = inspect_uploads(files, IMAGES)
    digest = fingerprint({'action': 'edit', 'data': {k: data.get(k) for k in data if k not in files and k != 'request_key'},
                          'files': {k: v[3] for k, v in checked.items()}})
    written = []
    try:
        with transaction.atomic():
            reg = HealthInsuranceRegistration.objects.select_for_update().get(pk=pk, student_id=student_id)
            if replay(reg, data.get('request_key'), digest, student_id, 'Hub'):
                return reg
            check_version(reg, data.get('row_version'))
            if not window(reg.registration_year, reg.registration_period, reg.config_snapshot)['can_edit']:
                raise Conflict('Đợt đã đóng hoặc chưa mở; chỉ tiếp nhận bổ sung theo phản hồi từ chối.')
            previous_edit = reg.events.filter(event_type='STUDENT_UPDATED').order_by('created_at').first()
            if previous_edit:
                edited_at = timezone.localtime(previous_edit.created_at).strftime('%H:%M:%S %d/%m/%Y')
                raise Conflict(f'Sinh viên đã chỉnh sửa vào lúc {edited_at}, không thể chỉnh sửa thêm')
            serializer = InsuranceRegistrationSerializer(data=data)
            for name in ('registration_year', 'registration_period', 'student_code', *IMAGES):
                serializer.fields.pop(name, None)
            serializer.is_valid(raise_exception=True)
            values = serializer.validated_data
            if not VnWard.objects.filter(code=values['permanent_ward'], province_code=values['permanent_province'], is_active=True).exists():
                raise ValidationError({'permanent_ward': 'Phường/xã không thuộc tỉnh/thành.'})
            ensure_legacy(reg)
            changes = {}
            for name in FIELDS:
                if name in values and str(getattr(reg, name) or '') != str(values[name] or ''):
                    changes[name] = {'before': str(getattr(reg, name) or ''), 'after': str(values[name] or '')}
                    setattr(reg, name, values[name])
            # Refresh the staff comparison, retaining its previous form in audit.
            # This reads the profile only for comparison, never as edit form data.
            from .api.views import InsuranceRegistrationView
            profile = InsuranceRegistrationView()._snapshot(reg.student)
            previous_comparison = reg.change_log
            comparison = {}
            for name in ('full_name', 'gender', 'dob', 'ethnicity', 'phone_number',
                         'citizen_id', 'social_insurance_number'):
                current = str(getattr(reg, name) or '')
                if current != str(profile.get(name) or ''):
                    comparison[name] = {'from': profile.get(name) or '', 'to': current}
            before_address = {name: profile.get('permanent_' + name) or '' for name in ('province', 'ward', 'street')}
            after_address = {name: getattr(reg, 'permanent_' + name) or '' for name in ('province', 'ward', 'street')}
            if before_address != after_address:
                comparison['permanent_address'] = {'from': before_address, 'to': after_address}
            if not changes and not checked:
                raise WorkflowError('Sinh viên không có chỉnh sửa')
            reg.change_log = comparison
            event = append_event(reg, 'STUDENT_UPDATED', source='Hub', actor_id=student_id,
                                 key=data.get('request_key'), payload={'request_digest': digest, 'changes': changes,
                                     'previous_profile_comparison': previous_comparison})
            for name, content in checked.items():
                evidence = store_evidence(reg, event, files[name], content, written)
                changes[name] = {'before': str(getattr(reg, name) or ''), 'after': evidence.storage_key}
                setattr(reg, name, evidence.storage_key)
            # Event objects are append-only: include image changes in a separate event.
            if checked:
                append_event(reg, 'IMAGES_REPLACED', source='Hub', actor_id=student_id,
                             payload={'changes': {k: changes[k] for k in checked}})
            reg.row_version += 1
            reg.updated_at = timezone.now()
            reg.save(update_fields=[*FIELDS, *IMAGES, 'change_log', 'row_version', 'updated_at'])
            return reg
    except Exception:
        for path in written:
            Path(path).unlink(missing_ok=True)
        raise
