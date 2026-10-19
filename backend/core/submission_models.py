"""Nạp giấy tờ trực tiếp — model phía Hub (managed=False).

Ba bảng dùng chung với Dashboard (`submissions/models.py`, mỗi repo giữ model riêng); DDL ở
dashboard `docs/sql/20261019_direct_submissions.sql`. Hub tạo yêu cầu + file + lượt trao đổi
của sinh viên; Dashboard đổi trạng thái, duyệt, trả giấy. Nghiệp vụ: `core/direct_submissions.py`.
"""

from django.db import models


class DirectSubmission(models.Model):
    STATUS_PENDING = "pending"
    STATUS_PROCESSING = "processing"
    STATUS_AWAITING_INFO = "awaiting_info"
    STATUS_DONE = "done"
    STATUS_RETURNED = "returned"
    STATUS_REJECTED = "rejected"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Chờ xử lý"),
        (STATUS_PROCESSING, "Đang xử lý"),
        (STATUS_AWAITING_INFO, "Chờ bổ sung thông tin"),
        (STATUS_DONE, "Hoàn thành"),
        (STATUS_RETURNED, "Đã trả giấy"),
        (STATUS_REJECTED, "Từ chối"),
    ]
    # GIỐNG Dashboard `DirectSubmission.STUDENT_CAN_COMMENT_STATUSES` — sửa cả hai.
    STUDENT_CAN_COMMENT_STATUSES = (STATUS_PENDING, STATUS_AWAITING_INFO)

    student_id = models.BigIntegerField()
    ldap_uid = models.CharField(max_length=64)
    document_name = models.CharField(max_length=255)
    copies = models.PositiveSmallIntegerField(default=1)
    contact_phone = models.CharField(max_length=20, null=True, blank=True)
    note = models.TextField(null=True, blank=True)
    payload = models.JSONField(null=True, blank=True)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_PENDING)
    # Ghi chú NỘI BỘ của chuyên viên — KHÔNG trả ra API.
    staff_note = models.TextField(null=True, blank=True)
    return_code = models.CharField(max_length=64, null=True, blank=True)
    consented_at = models.DateTimeField()
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = "hub_direct_submissions"
        ordering = ["-created_at"]

    @property
    def code(self):
        """Mã hiển thị `NG-YYMM-XXXXX` (core/submission_code.py) — trùng khớp Dashboard."""
        from .submission_code import encode
        return encode(self.pk, self.created_at)

    @property
    def student_can_comment(self):
        return self.status in self.STUDENT_CAN_COMMENT_STATUSES

    @property
    def student_can_edit(self):
        return self.status == self.STATUS_AWAITING_INFO


class SubmissionFile(models.Model):
    submission = models.ForeignKey(DirectSubmission, on_delete=models.CASCADE, db_column="submission_id",
                                   db_constraint=False, related_name="files")
    storage_key = models.CharField(max_length=255)
    original_filename = models.CharField(max_length=255)
    mime_type = models.CharField(max_length=64)
    file_size_bytes = models.PositiveIntegerField()
    sha256 = models.CharField(max_length=64)
    # SV gỡ khi sửa yêu cầu — xoá MỀM, file còn trên đĩa, Dashboard vẫn xem được.
    is_removed = models.BooleanField(default=False)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = "hub_direct_submission_files"
        ordering = ["id"]

    @classmethod
    def active_qs(cls):
        return cls.objects.filter(is_removed=False)


class SubmissionComment(models.Model):
    ROLE_STUDENT = "student"
    ROLE_STAFF = "staff"

    submission = models.ForeignKey(DirectSubmission, on_delete=models.CASCADE, db_column="submission_id",
                                   db_constraint=False, related_name="comments")
    author_role = models.CharField(max_length=16)
    author_user_id = models.BigIntegerField(null=True, blank=True)
    author_name = models.CharField(max_length=255)
    body = models.TextField()
    # Hai cờ do Dashboard đặt; Hub chỉ ĐỌC và luôn lọc bỏ khi trả cho sinh viên.
    is_internal = models.BooleanField(default=False)
    is_removed = models.BooleanField(default=False)
    event = models.CharField(max_length=32, null=True, blank=True)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = "hub_direct_submission_comments"
        ordering = ["id"]

    @classmethod
    def visible_qs(cls):
        return cls.objects.filter(is_internal=False, is_removed=False)
