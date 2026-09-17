"""Student supplement operations. Never mutate confirmed payment assessments."""
from urllib.parse import urlencode, quote
from django.db import transaction
from .models import HealthInsuranceRegistration
from students.models import Hospital, VnProvince
from .insurance_contract import WorkflowError, Conflict, normalized, fingerprint, REASONS
from .insurance_history import (require_active, replay, check_version, ensure_legacy,
                                append_event, save_registration, timeline)
from .insurance_files import inspect_upload, store_evidence


def hospital_snapshot(code):
    hospital = Hospital.objects.filter(code=code).first()
    province = VnProvince.objects.filter(code=hospital.province_code).first() if hospital else None
    return {'hospital_code': code, 'hospital_name': hospital.name if hospital else '',
            'province_code': hospital.province_code if hospital else '',
            'province_name': province.name if province else ''}


def supplement(pk, student_id, *, key, row_version, uploads=(), hospital_code='', province_code=''):
    require_active()
    if len(uploads) > 8:
        raise WorkflowError('Mỗi lần gửi tối đa 8 ảnh.')
    checked = [inspect_upload(f) for f in uploads]
    digest = fingerprint({'hospital_code': hospital_code, 'province_code': province_code,
                          'row_version': str(row_version), 'files': [c[3] for c in checked]})
    written = []
    try:
        with transaction.atomic():
            reg = HealthInsuranceRegistration.objects.select_for_update().get(pk=pk, student_id=student_id)
            if replay(reg, key, digest, student_id, 'Hub'):
                return reg
            check_version(reg, row_version)
            if normalized(reg.status) != 'rejected':
                raise Conflict('Chỉ có thể bổ sung đơn bị từ chối.')
            code = reg.rejection_reason_code
            if code == 'HOSPITAL_NOT_ACCEPTED':
                if uploads:
                    raise WorkflowError('Hãy điều chỉnh bệnh viện theo yêu cầu.')
                if not VnProvince.objects.filter(code=province_code, is_active=True).exists():
                    raise WorkflowError('Tỉnh/thành phố không hợp lệ hoặc không còn được phép chọn.')
                if hospital_code == reg.hospital_code or not Hospital.objects.filter(
                        code=hospital_code, province_code=province_code, is_active=True).exists():
                    raise WorkflowError('Chọn bệnh viện mới hợp lệ trong tỉnh/thành đã chọn.')
                before, after = hospital_snapshot(reg.hospital_code), hospital_snapshot(hospital_code)
            elif code in {'UNPAID', 'UNDERPAID'}:
                if not uploads or hospital_code:
                    raise WorkflowError('Cần ít nhất một ảnh minh chứng thanh toán bổ sung.')
            else:
                raise WorkflowError('Vui lòng liên hệ Phòng CTSV theo nội dung phản hồi; cán bộ sẽ tiếp nhận lại đơn.')
            ensure_legacy(reg)
            if code == 'HOSPITAL_NOT_ACCEPTED':
                append_event(reg, 'HOSPITAL_CHANGED', source='Hub', actor_id=student_id,
                    old='rejected', new='rejected', payload={'before': before, 'after': after})
                reg.hospital_code = hospital_code
            if uploads:
                event = append_event(reg, 'PAYMENT_EVIDENCE_SUBMITTED', source='Hub', actor_id=student_id,
                                     old='rejected', new='rejected')
                for upload, content in zip(uploads, checked):
                    store_evidence(reg, event, upload, content, written)
            append_event(reg, 'RESUBMITTED', source='Hub', actor_id=student_id, key=key,
                old='rejected', new='iu_processing', payload={'request_digest': digest})
            reg.status = 'iu_processing'
            reg.rejection_reason = None
            reg.rejection_reason_code = None
            save_registration(reg)
            return reg
    except Exception:
        # DB rollback cannot remove storage writes. Delete only files created by this request.
        for path in written:
            path.unlink(missing_ok=True)
        raise


def detail(reg, evidence_url):
    events = timeline(reg, evidence_url)
    latest = reg.assessments.order_by('-assessment_no').first()
    payment = None
    if latest and reg.rejection_reason_code in {'UNPAID', 'UNDERPAID'} and normalized(reg.status) == 'rejected':
        snapshot = reg.config_snapshot if isinstance(reg.config_snapshot, dict) else {}
        payment = {key: getattr(latest, key) for key in (
            'required_amount_vnd', 'confirmed_paid_total_vnd', 'missing_amount_vnd')}
        payment.update({key: snapshot.get(key, '') for key in (
            'bank_name', 'bank_bin', 'bank_account_number', 'bank_account_name')})
        payment['reference'] = f'BHYT {reg.pk} {reg.registration_year}'
        payment['qr_url'] = None
        bank_bin, account = str(payment['bank_bin']), str(payment['bank_account_number'])
        if bank_bin.isdigit() and len(bank_bin) == 6 and account.isdigit() and payment['missing_amount_vnd'] > 0:
            payment['qr_url'] = f'https://img.vietqr.io/image/{bank_bin}-{quote(account, safe="")}-compact2.png?' + urlencode({
                'amount': payment['missing_amount_vnd'], 'addInfo': payment['reference'],
                'accountName': payment['bank_account_name']})
    return {'id': reg.pk, 'status': normalized(reg.status), 'row_version': reg.row_version,
            'hospital_code': reg.hospital_code, 'reason_code': reg.rejection_reason_code,
            'reason_label': REASONS.get(reg.rejection_reason_code, ''),
            'reason_text': reg.rejection_reason, 'payment': payment, 'timeline': events}
