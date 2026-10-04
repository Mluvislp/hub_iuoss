"""Kho ảnh cố định (profile) của SV — xem core/student_images.py. Chỉ đọc: ảnh được lưu qua các luồng nghiệp vụ."""
from django.http import FileResponse, Http404
from rest_framework.response import Response
from rest_framework.views import APIView

from students.models import Student
from core import student_images
from .authentication import IsHubAuthenticated


def _student(request):
    if not request.user.student_id:
        return None
    return Student.objects.filter(pk=request.user.student_id).first()


class StudentImagesView(APIView):
    """GET ảnh profile của CHÍNH SV + registry loại ảnh."""

    permission_classes = [IsHubAuthenticated]

    def get(self, request):
        student = _student(request)
        if student is None:
            raise Http404
        images = sorted(student_images.get_images(student).values(), key=lambda row: (row.kind, row.subject))
        return Response({'images': [student_images.image_payload(row) for row in images],
                         'kinds': student_images.kinds_payload()})


class StudentImageFileView(APIView):
    """GET file ảnh của CHÍNH SV theo id."""

    permission_classes = [IsHubAuthenticated]

    def get(self, request, pk):
        student = _student(request)
        if student is None:
            raise Http404
        path, mime = student_images.image_path(student_images.get_image(student, pk))
        if path is None:
            raise Http404
        response = FileResponse(path.open('rb'), content_type=mime)
        response['Cache-Control'] = 'private, no-store'
        response['X-Content-Type-Options'] = 'nosniff'
        return response
