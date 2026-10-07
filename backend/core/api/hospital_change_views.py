"""Yêu cầu đổi nơi KCB ban đầu.

Cùng khuôn khai BHYT nơi khác (external_insurance_views): mỗi đợt một yêu cầu, sửa một
lần trong thời gian đợt mở, bị từ chối thì gửi lại. Khác ở chỗ mọi thông tin được chép
nguyên từ đơn đăng ký BHYT tại trường gần nhất đã gửi BHXH/phát hành — sinh viên chỉ
đổi được `hospital_code`, nên server không nhận bất kỳ trường nào khác từ form.
Đợt nhận yêu cầu là bảng riêng `hub_insurance_hospital_change_configs`.
"""
import mimetypes

from django.conf import settings
from django.db import transaction
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.response import Response

from core.hospital_change_models import HospitalChangeConfig, HospitalChangeEvent, HospitalChangeRequest
from core.insurance_contract import Conflict, WorkflowError, fingerprint, normalized, request_key, safe_path
from core.insurance_editing import FIELDS, IMAGES, snapshot_datetime
from core.insurance_history import check_version, readable_payloads, require_active
from core.models import HealthInsuranceRegistration
from students.models import Hospital, Student, VnProvince, VnWard
from .views import InsuranceRegistrationView, hospital_lookup_url

PERIOD_NUMBER = {'MAIN': 1, 'Q2': 2, 'Q3': 3, 'Q4': 4}
# Đơn tại trường đã qua khâu ĐHQT xử lý. Đơn còn `iu_processing` thì sinh viên đổi
# bệnh viện bằng luồng chỉnh sửa đơn sẵn có. `done` là trạng thái cũ của `issued`.
SOURCE_STATUSES = ('waiting_bhxh', 'issued', 'done')
# Cùng phạm vi bệnh viện của đăng ký tại trường (TP.HCM, Đồng Nai).
ALLOWED_PROVINCES = {'79', '75'}


def config_status(cfg, now=None):
    now = now or timezone.now()
    if now > cfg.closes_at:
        return 'expired'
    if now < cfg.opens_at:
        return 'upcoming'
    return 'open' if cfg.is_active else 'upcoming'


def config_payload(cfg):
    """Cùng hình dạng `InsurancePeriodConfig` của frontend để form dùng chung."""
    return {
        'id': cfg.change_period.lower(),
        'registration_period': cfg.change_period,
        'registration_year': cfg.change_year,
        'name': f'Đợt {PERIOD_NUMBER.get(cfg.change_period, cfg.change_period)} năm {cfg.change_year}',
        'description': cfg.description or '',
        'start_date': cfg.opens_at.isoformat(),
        'end_date': cfg.closes_at.isoformat(),
        'status': config_status(cfg),
        'is_active': cfg.is_active,
        'hospital_lookup_url': hospital_lookup_url(cfg.hospital_lookup_url),
    }


def active_config():
    now = timezone.now()
    rows = list(HospitalChangeConfig.objects.filter(is_active=True, opens_at__lte=now, closes_at__gte=now))
    return rows[0] if len(rows) == 1 else None


def change_window(year, period, snapshot=None):
    cfg = HospitalChangeConfig.objects.filter(change_year=year, change_period=period).first()
    snapshot = snapshot if isinstance(snapshot, dict) else {}
    start = cfg.opens_at if cfg else snapshot_datetime(snapshot.get('start_date'))
    end = cfg.closes_at if cfg else snapshot_datetime(snapshot.get('end_date'))
    now = timezone.now()
    opened = bool(cfg and cfg.is_active and start <= now <= end)
    return {'start_date': start, 'end_date': end, 'status': 'open' if opened else 'closed', 'can_edit': opened}


def source_registration(student):
    return (HealthInsuranceRegistration.objects.filter(student=student, status__in=SOURCE_STATUSES)
            .order_by('-created_at', '-id').first())


def hospital_name(code):
    hospital = Hospital.objects.filter(code=code).first() if code else None
    return hospital.name if hospital else ''


def registration_snapshot(reg):
    """Chép toàn bộ thông tin đơn nguồn — staff duyệt đúng những gì đã chụp lúc gửi."""
    snapshot = {name: str(getattr(reg, name) or '') for name in FIELDS}
    snapshot.update(student_code=reg.student_code or '', registration_id=reg.pk,
                    registration_year=reg.registration_year, registration_period=reg.registration_period)
    images = {}
    for name in IMAGES:
        key = str(getattr(reg, name) or '')
        if key:
            images[name] = {'storage_key': key, 'mime_type': mimetypes.guess_type(key)[0] or 'application/octet-stream'}
    return snapshot, images


def source_payload(reg):
    return {'id': reg.pk, 'registration_year': reg.registration_year,
            'registration_period': reg.registration_period, 'status': normalized(reg.status),
            'hospital_code': reg.hospital_code, 'hospital_name': hospital_name(reg.hospital_code)}


def readable_history(events):
    events = list(events)
    for event, payload in zip(events, readable_payloads([e['payload'] for e in events])):
        event['payload'] = payload
    return events


def change_detail(row):
    snapshot = row.snapshot or {}
    province_code, ward_code = snapshot.get('permanent_province', ''), snapshot.get('permanent_ward', '')
    province = VnProvince.objects.filter(code=province_code).first()
    ward = VnWard.objects.filter(code=ward_code, province_code=province_code).first()
    hospital = Hospital.objects.filter(code=row.hospital_code).first()
    edited = row.events.filter(event_type='STUDENT_UPDATED').order_by('created_at').first()
    win = change_window(row.intake_year, row.intake_period, row.intake_snapshot)
    cfg = HospitalChangeConfig.objects.filter(change_year=row.intake_year, change_period=row.intake_period).first()
    prefill = dict(snapshot)
    prefill.update(hospital_code=row.hospital_code, hospital_province=hospital.province_code if hospital else '')
    return dict(
        id=row.pk, status=row.status, row_version=row.row_version, prefill=prefill,
        config=config_payload(cfg) if cfg else {**(row.intake_snapshot or {}), 'hospital_lookup_url': hospital_lookup_url()},
        window=win,
        registration_year=snapshot.get('registration_year'), registration_period=snapshot.get('registration_period'),
        display={'permanent_province': province.name if province else 'Chưa xác định',
                 'permanent_ward': ward.name if ward else 'Chưa xác định',
                 'hospital_code': hospital.name if hospital else 'Chưa xác định'},
        old_hospital={'code': row.old_hospital_code, 'name': hospital_name(row.old_hospital_code)},
        # Đã xác nhận là thẻ đã đổi; sửa nữa chỉ làm lệch dữ liệu đã duyệt.
        can_edit=win['can_edit'] and edited is None and row.status == HospitalChangeRequest.STATUS_PENDING,
        can_resubmit=row.status == HospitalChangeRequest.STATUS_REJECTED,
        edited_at=edited.created_at if edited else None,
        review_note=row.review_note, created_at=row.created_at, updated_at=row.updated_at,
        images=[{'field': field, 'filename': field,
                 'url': f'/api/health-insurance/hospital-change/{row.pk}/images/{field}/?v={row.row_version}'}
                for field in IMAGES if (row.images or {}).get(field)],
        history=readable_history(row.events.values('event_type', 'created_at', 'source_app', 'payload')))


def _field_error(message):
    return Response({'detail': 'Vui lòng kiểm tra các trường thông tin.',
                     'errors': {'hospital_code': [message]}}, status=400)


class HospitalChangeView(InsuranceRegistrationView):
    def get(self, request, pk=None):
        if pk is not None:
            return Response(change_detail(get_object_or_404(HospitalChangeRequest,
                            pk=pk, student_id=request.user.student_id)))
        student = self._student(request)
        if student is None:
            raise Http404
        cfg = active_config() or (HospitalChangeConfig.objects
                                  .order_by('-is_active', '-opens_at', '-id').first())
        # Đợt đang xem đã có yêu cầu (kể cả bị từ chối) thì mở lại chính yêu cầu đó.
        previous = HospitalChangeRequest.objects.filter(
            student=student, intake_year=cfg.change_year, intake_period=cfg.change_period,
        ).order_by('-id').first() if cfg else None
        if previous:
            return Response(change_detail(previous))
        reg = source_registration(student)
        if reg is None:
            return Response({'detail': 'Chưa có đơn đăng ký BHYT tại trường đã gửi BHXH hoặc đã phát hành, '
                             'nên chưa thể yêu cầu đổi nơi khám chữa bệnh ban đầu.'}, status=409)
        from core.insurance_editing import registration_data
        data = registration_data(reg)
        return Response({'prefill': data['prefill'], 'images': data['images'], 'display': data['display'],
                         'source': source_payload(reg), 'config': config_payload(cfg) if cfg else None})

    def post(self, request, pk=None):
        try:
            require_active()
            key = request_key(request.data.get('request_key'))
            action = request.data.get('action') or ''
            hospital_code = str(request.data.get('hospital_code') or '').strip()
            digest = fingerprint({'hospital_code': hospital_code, 'action': action,
                                  'row_version': str(request.data.get('row_version') or '')})
            with transaction.atomic():
                student = Student.objects.select_for_update().filter(pk=request.user.student_id).first()
                if student is None:
                    raise Http404
                row = get_object_or_404(HospitalChangeRequest.objects.select_for_update(),
                                        pk=pk, student=student) if pk else None
                event = HospitalChangeEvent.objects.filter(change_request__student=student, request_key=key).first()
                if event:
                    if (event.payload or {}).get('request_digest') != digest or (pk and event.change_request_id != pk):
                        raise Conflict('Yêu cầu này đã được dùng cho nội dung khác.')
                    return Response({'id': event.change_request_id, 'status': event.change_request.status})
                if row:
                    check_version(row, request.data.get('row_version'))
                    resubmitted = row.status == HospitalChangeRequest.STATUS_REJECTED and action == 'resubmit'
                    if row.status == HospitalChangeRequest.STATUS_CONFIRMED:
                        raise Conflict('Yêu cầu đã được xác nhận, không thể chỉnh sửa.')
                    if not resubmitted and not change_window(row.intake_year, row.intake_period,
                                                             row.intake_snapshot)['can_edit']:
                        raise Conflict('Đã hết hạn chỉnh sửa yêu cầu.')
                    previous_edit = row.events.filter(event_type='STUDENT_UPDATED').order_by('created_at').first()
                    if not resubmitted and previous_edit:
                        edited_at = timezone.localtime(previous_edit.created_at).strftime('%H:%M:%S %d/%m/%Y')
                        raise Conflict(f'Sinh viên đã chỉnh sửa vào lúc {edited_at}, không thể chỉnh sửa thêm')
                    current = row.old_hospital_code
                    reg = None
                else:
                    cfg = active_config()
                    if not cfg:
                        raise Conflict('Hiện không trong thời gian tiếp nhận yêu cầu đổi nơi khám chữa bệnh ban đầu.')
                    if HospitalChangeRequest.objects.filter(student=student, intake_year=cfg.change_year,
                                                            intake_period=cfg.change_period).exists():
                        raise Conflict('Đã có yêu cầu trong đợt này. Hãy mở yêu cầu để chỉnh sửa.')
                    if HospitalChangeRequest.objects.filter(student=student,
                                                            status=HospitalChangeRequest.STATUS_PENDING).exists():
                        raise Conflict('Bạn đang có một yêu cầu đổi nơi khám chữa bệnh ban đầu chờ xử lý.')
                    reg = source_registration(student)
                    if reg is None:
                        raise Conflict('Chưa có đơn đăng ký BHYT tại trường đã gửi BHXH hoặc đã phát hành.')
                    current = reg.hospital_code
                if not hospital_code:
                    return _field_error('Vui lòng chọn nơi ĐK KCB ban đầu.')
                if not Hospital.objects.filter(code=hospital_code, is_active=True,
                                               province_code__in=ALLOWED_PROVINCES).exists():
                    return _field_error('Bệnh viện không hợp lệ hoặc không thuộc TP.HCM/Đồng Nai.')
                if hospital_code == current:
                    return _field_error('Nơi KCB mới phải khác nơi KCB ban đầu hiện tại.')

                if row:
                    if hospital_code == row.hospital_code and not resubmitted:
                        raise WorkflowError('Sinh viên không có chỉnh sửa')
                    changes = {'hospital_code': {'before': row.hospital_code, 'after': hospital_code}} \
                        if hospital_code != row.hospital_code else {}
                    previous_rejection = row.review_note
                    row.hospital_code = hospital_code
                    row.snapshot = {**(row.snapshot or {}), 'hospital_code': hospital_code}
                    if resubmitted:
                        row.status = HospitalChangeRequest.STATUS_PENDING
                        row.supplement_pending = True
                        row.supplemented_at = timezone.now()
                    row.row_version += 1
                    row.save(update_fields=['hospital_code', 'snapshot', 'status', 'supplement_pending',
                                            'supplemented_at', 'row_version', 'updated_at'])
                    kind = 'RESUBMITTED' if resubmitted else 'STUDENT_UPDATED'
                else:
                    snapshot, images = registration_snapshot(reg)
                    snapshot['hospital_code'] = hospital_code
                    row = HospitalChangeRequest.objects.create(
                        student=student, registration=reg,
                        full_name=reg.full_name or student.full_name or '',
                        student_code=reg.student_code or student.current_student_code or '',
                        social_insurance_code=reg.social_insurance_number or '',
                        old_hospital_code=reg.hospital_code or '', hospital_code=hospital_code,
                        intake_year=cfg.change_year, intake_period=cfg.change_period,
                        intake_snapshot=config_payload(cfg), snapshot=snapshot, images=images,
                        request_key=key, request_digest=digest)
                    kind = 'SUBMITTED'
                    changes = {'hospital_code': {'before': reg.hospital_code, 'after': hospital_code}}
                    previous_rejection = None
                HospitalChangeEvent.objects.create(change_request=row, event_type=kind, actor_id=student.pk,
                    source_app='Hub', request_key=key, payload={'request_digest': digest, 'changes': changes,
                    'previous_rejection': previous_rejection if kind == 'RESUBMITTED' else None})
            return Response({'id': row.pk, 'status': row.status, 'row_version': row.row_version},
                            status=200 if pk else 201)
        except WorkflowError as exc:
            return Response({'detail': str(exc)}, status=409 if isinstance(exc, Conflict) else 400)


class HospitalChangeImageView(HospitalChangeView):
    http_method_names = ['get']

    def get(self, request, pk, field):
        row = get_object_or_404(HospitalChangeRequest, pk=pk, student_id=request.user.student_id)
        if field not in IMAGES:
            raise Http404
        data = (row.images or {}).get(field, {})
        path = safe_path(settings.MEDIA_ROOT, data.get('storage_key', ''))
        if path is None:
            raise Http404
        response = FileResponse(path.open('rb'), content_type=data.get('mime_type'))
        response['Cache-Control'] = 'private, no-store'
        response['X-Content-Type-Options'] = 'nosniff'
        return response
