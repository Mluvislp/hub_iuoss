"""Unrestricted declarations: no registration window, eligibility or payment gate."""
from pathlib import Path
from uuid import uuid4

from django.conf import settings
from django.db import transaction
from rest_framework import serializers
from rest_framework.response import Response
from students.models import Hospital, Student, VnWard
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


class ExternalInsuranceView(InsuranceRegistrationView):
    def get(self, request):
        student = self._student(request)
        if student is None:
            return Response({'detail': 'Không tìm thấy hồ sơ sinh viên.'}, status=400)
        prefill = self._snapshot(student)
        card = student.health_insurance_cards.order_by('-id').first()
        if card:
            hospital = Hospital.objects.filter(code=card.hospital_code).first()
            prefill.update({
                'medical_insurance_code': card.medical_insurance_code or '',
                'valid_from': card.valid_from.isoformat() if card.valid_from else '',
                'valid_until': card.valid_until.isoformat() if card.valid_until else '',
                'hospital_code': card.hospital_code or '',
                'hospital_province': hospital.province_code if hospital else '',
            })
        # Bản khai gần nhất (kể cả bị từ chối) chỉ dùng làm dữ liệu GỢI Ý để sinh
        # viên sửa và khai lại; nó không được ghi vào bảng thẻ nếu staff chưa xác nhận.
        previous = (ExternalInsuranceDeclaration.objects.filter(student=student)
                    .order_by('-created_at', '-id').first())
        if previous:
            hospital = Hospital.objects.filter(code=previous.hospital_code).first()
            prefill.update({
                'medical_insurance_code': previous.medical_insurance_code,
                'valid_from': previous.valid_from.isoformat(),
                'valid_until': previous.valid_until.isoformat(),
                'hospital_code': previous.hospital_code,
                'hospital_province': hospital.province_code if hospital else '',
            })
            for field in prefill:
                if not prefill[field] and previous.snapshot.get(field):
                    prefill[field] = previous.snapshot[field]
        return Response({'prefill': prefill, 'config': None})

    def post(self, request):
        written = []
        try:
            key = request_key(request.data.get('request_key'))
            payload = {k: request.data.get(k) for k in request.data
                       if k not in request.FILES and k != 'request_key'}
            checked = {k: inspect_upload(upload) for k, upload in request.FILES.items()
                       if k in ('cccd_image', 'cccd_image_back', 'bhyt_image')}
            payload.update({k: value[3] for k, value in checked.items()})
            digest = fingerprint(payload)
            with transaction.atomic():
                student = Student.objects.select_for_update().filter(pk=request.user.student_id).first()
                if student is None:
                    raise WorkflowError('Không tìm thấy hồ sơ sinh viên.')
                existing = ExternalInsuranceDeclaration.objects.filter(student=student, request_key=key).first()
                if existing:
                    if existing.request_digest != digest:
                        raise Conflict('Yêu cầu này đã được dùng cho nội dung khác.')
                    return Response({'id': existing.pk, 'status': existing.status})
                serializer = ExternalInsuranceSerializer(data=request.data)
                serializer.is_valid(raise_exception=True)
                data = serializer.validated_data
                if data['student_code'] != student.current_student_code:
                    raise WorkflowError('MSSV không khớp với tài khoản đăng nhập.')
                values = {
                    'social_insurance_code': data['social_insurance_number'],
                    'medical_insurance_code': data['medical_insurance_code'],
                    'hospital_code': data['hospital_code'],
                    'valid_from': data['valid_from'], 'valid_until': data['valid_until'],
                    'registration_year': data['valid_from'].year,
                }
                images = {}
                for field in ('cccd_image', 'cccd_image_back', 'bhyt_image'):
                    content, ext, mime, _ = checked[field]
                    storage_key = f'insurance_private/external/{uuid4().hex}.{ext}'
                    target = Path(settings.MEDIA_ROOT).resolve() / storage_key
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with target.open('xb') as stream:
                        written.append(target)
                        stream.write(content)
                    images[field] = {'storage_key': storage_key, 'mime_type': mime}
                snapshot = {k: str(v) for k, v in data.items() if k not in images}
                declaration = ExternalInsuranceDeclaration.objects.create(
                    student=student, full_name=data['full_name'],
                    student_code=student.current_student_code,
                    snapshot=snapshot, images=images, request_key=key,
                    request_digest=digest, status=ExternalInsuranceDeclaration.STATUS_PENDING,
                    **values)
            return Response({'id': declaration.pk, 'status': declaration.status}, status=201)
        except Exception as exc:
            for path in written:
                path.unlink(missing_ok=True)
            if isinstance(exc, WorkflowError):
                return Response({'detail': str(exc)}, status=409 if isinstance(exc, Conflict) else 400)
            if isinstance(exc, serializers.ValidationError):
                messages = exc.detail.get('non_field_errors', []) if isinstance(exc.detail, dict) else exc.detail
                return Response({
                    'detail': str(messages[0]) if messages else 'Vui lòng kiểm tra các trường thông tin.',
                    'errors': exc.detail,
                }, status=400)
            raise
