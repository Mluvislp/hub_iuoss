"""Shared event writer. Call only while holding the parent registration lock."""
from django.conf import settings
from django.db.models import Max
from django.utils import timezone
from .models import InsuranceEvent, InsuranceAssessment
from .insurance_contract import (Conflict, WorkflowError, normalized, integer,
                                request_key, EVENT_LABELS, REASONS)


def require_active():
    if not getattr(settings, 'INSURANCE_WORKFLOW_V2', False):
        raise WorkflowError('Đăng ký BHYT đang bảo trì nâng cấp. Vui lòng thử lại sau.')


def replay(reg, key, digest, actor_id, source):
    request_key(key)
    event = reg.events.filter(request_key=key).first()
    if event:
        if (event.payload or {}).get('request_digest') != digest or event.actor_id != actor_id or event.source_app != source:
            raise Conflict('Request key đã được dùng cho thao tác khác.')
        return True
    return False


def check_version(reg, value):
    if integer(value, 'Phiên bản đơn') != reg.row_version:
        raise Conflict('Đơn đã được cập nhật bởi thao tác khác. Hãy tải lại.')


def append_event(reg, kind, *, source, actor_id=None, actor_name='', old=None,
                 new=None, key=None, batch=None, reason_code=None, reason_text=None, payload=None):
    data = dict(payload or {})
    if actor_name:
        data['actor_name'] = actor_name
    number = (reg.events.aggregate(n=Max('event_no'))['n'] or 0) + 1
    return InsuranceEvent.objects.create(registration=reg, event_no=number, event_type=kind,
        from_status=old, to_status=new, reason_code=reason_code, reason_text=reason_text,
        actor_type={'Hub': 'student', 'Dashboard': 'staff'}.get(source, 'system'),
        actor_id=actor_id, source_app=source, request_key=key, batch_id=batch, payload=data)


def ensure_legacy(reg):
    if reg.workflow_version < 2 and not reg.events.filter(event_type='LEGACY_IMPORTED').exists():
        append_event(reg, 'LEGACY_IMPORTED', source='Migration', key='legacy-import-v2',
                     old=reg.status, new=normalized(reg.status), payload={'observed_status': reg.status})


def save_registration(reg):
    reg.row_version += 1
    reg.workflow_version = 2
    reg.updated_at = timezone.now()
    reg.save(update_fields=['status', 'rejection_reason', 'rejection_reason_code',
                           'hospital_code', 'fee_amount_vnd', 'workflow_version', 'row_version', 'updated_at', 'supplement_pending', 'supplemented_at', 'supplement_reviewed_at'])


def add_assessment(reg, event, values, note=''):
    return InsuranceAssessment.objects.create(registration=reg, event=event,
        assessment_no=(reg.assessments.aggregate(n=Max('assessment_no'))['n'] or 0) + 1,
        note=note, **values)


CODE_FIELDS = {'permanent_province': 'province', 'permanent_ward': 'ward', 'hospital_code': 'hospital'}
IMAGE_FIELDS = ('cccd_image', 'cccd_image_back', 'bhyt_image', 'payment_receipt_image')


def _code_names(changes_list):
    """{loại: {mã: tên}} cho mọi mã tỉnh/phường/bệnh viện có trong các `changes`."""
    from students.models import Hospital, VnProvince, VnWard
    seen = {'province': set(), 'ward': set(), 'hospital': set()}
    for changes in changes_list:
        for field, change in (changes or {}).items():
            for value in change.values() if isinstance(change, dict) else ():
                if field in CODE_FIELDS:
                    seen[CODE_FIELDS[field]].add(str(value or ''))
                elif field.endswith('_address') and isinstance(value, dict):
                    seen['province'].add(str(value.get('province') or ''))
                    seen['ward'].add(str(value.get('ward') or ''))
    models = {'province': VnProvince, 'ward': VnWard, 'hospital': Hospital}
    return {kind: dict(models[kind].objects.filter(code__in=codes - {''}).order_by().values_list('code', 'name'))
            if codes - {''} else {} for kind, codes in seen.items()}


def _readable(field, value, names):
    if value in (None, ''):
        return value
    if field in CODE_FIELDS:
        return names[CODE_FIELDS[field]].get(str(value), str(value))
    if field.endswith('_address') and isinstance(value, dict):
        ward, province = str(value.get('ward') or ''), str(value.get('province') or '')
        return ', '.join(p for p in (value.get('street'), names['ward'].get(ward, ward),
                                     names['province'].get(province, province)) if p)
    return value


def readable_changes(changes_list):
    """Mã chỉ dùng khi xử lý/xuất Excel; giao diện nhận tên. Ảnh không lộ đường
    dẫn lưu trữ: tách khỏi `changes` thành danh sách trường ảnh đã đổi.
    Trả [(changes, images)] đúng thứ tự đầu vào."""
    names = _code_names(changes_list)
    result = []
    for changes in changes_list:
        text, images = {}, []
        for field, change in (changes or {}).items():
            if field in IMAGE_FIELDS:
                images.append(field)
            elif isinstance(change, dict):
                text[field] = {k: _readable(field, v, names) for k, v in change.items()}
        result.append((text, images))
    return result


def readable_payloads(payloads):
    """Payload sự kiện cho giao diện: bỏ digest, mã → tên, ảnh → `images`."""
    payloads = [{k: v for k, v in (p or {}).items() if k != 'request_digest'} for p in payloads]
    for payload, (changes, images) in zip(payloads, readable_changes([p.get('changes') for p in payloads])):
        if 'changes' in payload:
            payload['changes'], payload['images'] = changes, images
    return payloads


def timeline(reg, evidence_url):
    items = []
    events = list(reg.events.select_related('assessment').prefetch_related('evidences').order_by('event_no'))
    payloads = readable_payloads([event.payload for event in events])
    for event, payload in zip(events, payloads):
        if event.event_type == 'IMAGES_REPLACED' and items and items[-1]['event_type'] == 'STUDENT_UPDATED':
            # Cùng một lần sửa ghi hai sự kiện (append-only); hiển thị gộp làm một.
            items[-1]['payload'].setdefault('images', []).extend(payload.get('images', []))
            continue
        a = getattr(event, 'assessment', None)
        # Các ảnh ban đầu đã nằm trong bốn cột của registration. Timeline chỉ
        # hiển thị ảnh thanh toán tải thêm sau khi đơn bị từ chối vì tiền.
        evidences = event.evidences.all() if event.event_type == 'PAYMENT_EVIDENCE_SUBMITTED' else []
        from_status = event.from_status if event.from_status != event.to_status else None
        to_status = event.to_status if event.from_status != event.to_status else None
        items.append(dict(id=event.pk, event_no=event.event_no, event_type=event.event_type,
            label=EVENT_LABELS.get(event.event_type, event.event_type), created_at=event.created_at,
            actor_type=event.actor_type, actor_id=event.actor_id, source_app=event.source_app,
            from_status=from_status, to_status=to_status,
            reason_code=event.reason_code, reason_label=REASONS.get(event.reason_code, ''),
            reason_text=event.reason_text, payload=payload,
            assessment=({k: getattr(a, k) for k in ('required_amount_vnd', 'confirmed_paid_total_vnd', 'missing_amount_vnd', 'note')} if a else None),
            evidences=[dict(id=e.pk, filename=e.original_filename, url=evidence_url(e),
                            mime_type=e.mime_type, file_size_bytes=e.file_size_bytes) for e in evidences]))
    return items
