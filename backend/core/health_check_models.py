"""Khám sức khỏe định kỳ — 2 bảng dùng chung với Dashboard (bản đối ứng:
`dashboard_iuoss/healthcheck/models.py`). Schema: `docs/schema.sql`.
"""
from django.db import models


class HealthCheckRound(models.Model):
    """Một đợt = một năm học. Mở/khóa hoàn toàn theo `opens_at`/`closes_at`."""

    id = models.BigAutoField(primary_key=True)
    academic_year = models.CharField(max_length=9, unique=True)
    title = models.CharField(max_length=255)
    opens_at = models.DateTimeField()
    closes_at = models.DateTimeField()
    package_name = models.CharField(max_length=255)
    package_content = models.TextField()
    schedule_note = models.CharField(max_length=255, null=True, blank=True)
    created_by_id = models.IntegerField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = "health_check_rounds"


class HealthCheckResponse(models.Model):
    """Câu trả lời của một SV trong một đợt.

    `status` không trùng giá trị giữa hai nhánh (xem SQL tạo bảng), nên đọc
    riêng cột này cũng biết SV đang ở đâu.
    """

    CHOICE_EXAMINED = "examined"
    CHOICE_REGISTER = "register"

    STATUS_PENDING = "pending"
    STATUS_APPROVED = "approved"
    STATUS_REJECTED = "rejected"
    STATUS_REGISTERED = "registered"
    STATUS_ATTENDED = "attended"
    STATUS_ABSENT = "absent"

    STATUS_LABELS = {
        STATUS_PENDING: "Chờ xác nhận minh chứng",
        STATUS_APPROVED: "Minh chứng đã được xác nhận",
        STATUS_REJECTED: "Minh chứng chưa hợp lệ",
        STATUS_REGISTERED: "Đã đăng ký khám tại trường",
        STATUS_ATTENDED: "Đã khám tại trường",
        STATUS_ABSENT: "Vắng buổi khám",
    }

    id = models.BigAutoField(primary_key=True)
    round = models.ForeignKey(HealthCheckRound, on_delete=models.DO_NOTHING)
    student_id = models.BigIntegerField()
    choice = models.CharField(max_length=16)
    status = models.CharField(max_length=16)
    evidence = models.JSONField(null=True)
    residence = models.JSONField(null=True)
    consent_at = models.DateTimeField(null=True)
    submit_count = models.PositiveSmallIntegerField(default=1)
    submitted_at = models.DateTimeField()
    review_note = models.CharField(max_length=500, null=True, blank=True)
    reviewed_by_id = models.IntegerField(null=True)
    reviewed_at = models.DateTimeField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = "health_check_responses"
        unique_together = [("round", "student_id")]
