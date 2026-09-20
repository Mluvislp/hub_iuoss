"""Submission transaction boundary and idempotency before mutable catalog validation."""
from functools import wraps
from django.db import transaction
from rest_framework.response import Response
from students.models import Student
from .models import InsuranceEvent
from .insurance_contract import WorkflowError, Conflict, request_key, fingerprint
from .insurance_history import require_active
from .insurance_files import inspect_upload


def submission(view):
    @wraps(view)
    def wrapped(self, request, *args, **kwargs):
        written = []
        try:
            require_active()
            key = request_key(request.data.get('request_key'))
            payload = {k: request.data.get(k) for k in request.data if k not in request.FILES and k != 'request_key'}
            for k, file in request.FILES.items():
                payload[k] = inspect_upload(file)[3]
            digest = fingerprint(payload)
            with transaction.atomic():
                student = Student.objects.select_for_update().filter(pk=request.user.student_id).first()
                if student is None:
                    raise WorkflowError('Không tìm thấy hồ sơ sinh viên.')
                existing = InsuranceEvent.objects.filter(registration__student_id=student.pk,
                    source_app='Hub', request_key=key, event_type='SUBMITTED').select_related('registration').first()
                if existing:
                    if (existing.payload or {}).get('request_digest') != digest:
                        raise Conflict('Request key đã dùng cho nội dung khác.')
                    return Response({'id': existing.registration_id, 'status': existing.registration.status})
                request.insurance_request_digest = digest
                request.insurance_written_files = written
                return view(self, request, *args, **kwargs)
        except Exception as exc:
            for path in written:
                path.unlink(missing_ok=True)
            if isinstance(exc, WorkflowError):
                return Response({'detail': str(exc)}, status=409 if isinstance(exc, Conflict) else 400)
            raise
    return wrapped
