from django.conf import settings
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404
from django.urls import reverse
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser
from .authentication import IsHubAuthenticated
from core.models import HealthInsuranceRegistration, InsuranceEvidence
from core.insurance_contract import WorkflowError, Conflict, safe_path
from core.insurance_workflow import detail, supplement


class InsuranceDetailView(APIView):
    permission_classes = [IsHubAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def registration(self, request, pk):
        if not request.user.student_id:
            raise Http404
        return get_object_or_404(HealthInsuranceRegistration, pk=pk, student_id=request.user.student_id)

    def get(self, request, pk):
        return Response(detail(self.registration(request, pk),
            lambda e: reverse('api_insurance_evidence', args=[pk, e.pk])))

    def post(self, request, pk):
        self.registration(request, pk)
        try:
            reg = supplement(pk, request.user.student_id, key=request.data.get('request_key'),
                row_version=request.data.get('row_version'), uploads=request.FILES.getlist('evidences'),
                hospital_code=request.data.get('hospital_code', ''), province_code=request.data.get('province_code', ''))
        except WorkflowError as exc:
            return Response({'detail': str(exc)}, status=409 if isinstance(exc, Conflict) else 400)
        return Response({'id': reg.pk, 'status': reg.status, 'row_version': reg.row_version})


class InsuranceEvidenceView(APIView):
    permission_classes = [IsHubAuthenticated]

    def get(self, request, pk, evidence_id):
        if not request.user.student_id:
            raise Http404
        evidence = get_object_or_404(InsuranceEvidence, pk=evidence_id, registration_id=pk,
                                     registration__student_id=request.user.student_id)
        path = safe_path(settings.MEDIA_ROOT, evidence.storage_key)
        if path is None:
            raise Http404
        response = FileResponse(path.open('rb'), content_type=evidence.mime_type)
        response['Cache-Control'] = 'private, no-store'
        response['X-Content-Type-Options'] = 'nosniff'
        return response
