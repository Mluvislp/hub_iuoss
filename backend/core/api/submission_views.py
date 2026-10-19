"""API "Nạp giấy tờ trực tiếp" — nghiệp vụ ở `core/direct_submissions.py`.

Mọi truy vấn lọc theo `ldap_uid` lấy từ JWT do server ký ⇒ id trên URL không mở được yêu cầu
của người khác (không IDOR). Tạo / sửa nhận multipart (file) — chung throttle `create_request`.
"""
import logging

from django.conf import settings
from django.db.models import Count, Prefetch, Q
from django.http import FileResponse, Http404
from rest_framework import status
from rest_framework.exceptions import NotFound
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from core import direct_submissions as ds
from core.insurance_contract import safe_path
from core.submission_models import DirectSubmission, SubmissionComment, SubmissionFile

from .authentication import IsHubAuthenticated

logger = logging.getLogger(__name__)


class SubmissionsRequiredMixin:
    """404 cho mọi method khi FEATURE_DIRECT_SUBMISSIONS tắt — tính năng chưa mở thì endpoint biến mất."""

    permission_classes = [IsHubAuthenticated]

    def initial(self, request, *args, **kwargs):
        if not settings.FEATURE_DIRECT_SUBMISSIONS:
            raise NotFound("Chức năng nạp giấy tờ trực tiếp đang tạm ngưng.")
        super().initial(request, *args, **kwargs)

    def get_throttles(self):
        # Chỉ chặn thao tác GHI (tạo / sửa / trao đổi); đọc không giới hạn.
        if self.request.method in ("POST", "PUT"):
            self.throttle_scope = "create_request"
            return super().get_throttles()
        return []

    def own(self, request, pk, *, detail=False):
        qs = DirectSubmission.objects.filter(pk=pk, ldap_uid=request.user.ldap_uid)
        if detail:
            qs = qs.prefetch_related(
                Prefetch("comments", queryset=SubmissionComment.visible_qs()),
                Prefetch("files", queryset=SubmissionFile.active_qs()),
            )
        sub = qs.first()
        if sub is None:
            raise NotFound("Không tìm thấy yêu cầu này.")
        return sub


def _error(exc):
    body = {"detail": str(exc)}
    if getattr(exc, "field", None):
        body["errors"] = {exc.field: str(exc)}
    return Response(body, status=status.HTTP_400_BAD_REQUEST)


def _file(f):
    return {"id": f.id, "name": f.original_filename, "size": f.file_size_bytes, "mime_type": f.mime_type,
            "is_pdf": f.mime_type == ds.PDF_MIME, "created_at": f.created_at}


def _comment(c):
    return {"id": c.id, "author_role": c.author_role, "author_name": c.author_name, "body": c.body,
            "event": c.event, "created_at": c.created_at}


def _summary(sub, file_count=None, comment_count=None):
    return {
        "id": sub.id, "code": sub.code, "document_name": sub.document_name, "copies": sub.copies,
        "status": sub.status, "status_label": sub.get_status_display(), "return_code": sub.return_code,
        "created_at": sub.created_at, "updated_at": sub.updated_at,
        "file_count": file_count if file_count is not None else getattr(sub, "file_count", 0),
        "comment_count": comment_count if comment_count is not None else getattr(sub, "comment_count", 0),
    }


def _detail(sub):
    files = list(sub.files.all())
    comments = list(sub.comments.all())
    receipt = ds.latest_receipt(sub)
    return {
        **_summary(sub, len(files), len(comments)),
        "contact_phone": sub.contact_phone, "note": sub.note, "consented_at": sub.consented_at,
        "payload": ds.public_payload(sub),
        "files": [_file(f) for f in files],
        "comments": [_comment(c) for c in comments],
        "student_can_comment": sub.student_can_comment,
        "student_can_edit": sub.student_can_edit,
        "returned_at": (receipt or {}).get("returned_at"),
    }


class SubmissionFormView(SubmissionsRequiredMixin, APIView):
    """GET /api/submissions/form/ — prefill + giới hạn file."""

    def get(self, request):
        student = ds.load_student(request.user.student_id)
        if student is None:
            return Response({"detail": "Không tìm thấy hồ sơ sinh viên."}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"prefill": ds.build_prefill(student), "limits": ds.form_limits()})


class SubmissionsView(SubmissionsRequiredMixin, APIView):
    """GET danh sách của chính SV · POST tạo mới (multipart: các ô form + `files` nhiều lần)."""

    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get(self, request):
        qs = (DirectSubmission.objects.filter(ldap_uid=request.user.ldap_uid)
              .annotate(file_count=Count("files", filter=Q(files__is_removed=False), distinct=True),
                        comment_count=Count("comments", filter=Q(comments__is_internal=False,
                                                                 comments__is_removed=False), distinct=True))
              .order_by("-created_at"))
        return Response([_summary(s) for s in qs])

    def post(self, request):
        try:
            sub = ds.create(request.user, request.data, request.FILES.getlist("files"))
        except ds.SubmissionError as exc:
            return _error(exc)
        return Response({"id": sub.id, "code": sub.code}, status=status.HTTP_201_CREATED)


class SubmissionDetailView(SubmissionsRequiredMixin, APIView):
    """GET chi tiết + trao đổi + file · PUT sửa lại lúc "Chờ bổ sung" (multipart, `remove_file_ids`)."""

    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get(self, request, pk):
        return Response(_detail(self.own(request, pk, detail=True)))

    def put(self, request, pk):
        try:
            ds.update(request.user, pk, request.data, request.FILES.getlist("files"))
        except LookupError:
            raise NotFound("Không tìm thấy yêu cầu này.")
        except ds.SubmissionError as exc:
            return _error(exc)
        return Response(_detail(self.own(request, pk, detail=True)))


class SubmissionCommentsView(SubmissionsRequiredMixin, APIView):
    def post(self, request, pk):
        sub = self.own(request, pk)
        body = request.data.get("body")
        try:
            comment = ds.add_comment(request.user, sub, body if isinstance(body, str) else "")
        except ds.SubmissionError as exc:
            return _error(exc)
        sub.refresh_from_db(fields=["status"])
        return Response({"comment": _comment(comment), "status": sub.status,
                         "status_label": sub.get_status_display(),
                         "student_can_comment": sub.student_can_comment,
                         "student_can_edit": sub.student_can_edit}, status=status.HTTP_201_CREATED)


class SubmissionFileView(SubmissionsRequiredMixin, APIView):
    """File SV đã nạp (chỉ của CHÍNH SV) — cần token nên frontend tải qua fetch."""

    def get(self, request, pk, file_id):
        sub = self.own(request, pk)
        f = SubmissionFile.active_qs().filter(pk=file_id, submission=sub).first()
        path = safe_path(settings.MEDIA_ROOT, f.storage_key) if f else None
        if path is None:
            raise Http404
        response = FileResponse(open(path, "rb"), content_type=f.mime_type, filename=f.original_filename)
        response["X-Content-Type-Options"] = "nosniff"
        response["Cache-Control"] = "private, no-store"
        return response
