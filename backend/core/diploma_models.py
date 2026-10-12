"""Nộp bằng tốt nghiệp THPT — bảng dùng chung với Dashboard; imported by models.py for Django discovery.

Schema: dashboard_iuoss/docs/sql/20261012_diploma_submissions.sql. Bản đối ứng:
dashboard_iuoss/diplomas/models.py — đổi cột phải sửa cả hai. Nghiệp vụ: dashboard_iuoss/docs/DIPLOMA.md.
"""
from django.db import models


class DiplomaRound(models.Model):
    """Đợt nhận hồ sơ online. Hub mở/khóa form mới hoàn toàn theo `opens_at`/`closes_at`."""

    id = models.BigAutoField(primary_key=True)
    title = models.CharField(max_length=255)
    opens_at = models.DateTimeField()
    closes_at = models.DateTimeField()
    description = models.TextField(null=True, blank=True)
    original_note = models.TextField(null=True, blank=True)
    created_by_id = models.IntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = 'diploma_rounds'
        ordering = ['-opens_at']


class DiplomaSubmission(models.Model):
    STATUS_PENDING = 'pending'
    STATUS_RETURNED = 'returned'
    STATUS_APPROVED = 'approved'
    STATUS_NOTIFIED = 'notified'
    STATUS_RECEIVED = 'received'
    # Cùng nhãn Dashboard (diplomas/models.py) — sinh viên và chuyên viên đọc cùng một câu.
    STATUS_LABELS = {
        STATUS_PENDING: 'Chờ duyệt hồ sơ online',
        STATUS_RETURNED: 'Cần sửa lại',
        STATUS_APPROVED: 'Đã duyệt online, chờ thư hẹn',
        STATUS_NOTIFIED: 'Đã hẹn nộp bản gốc',
        STATUS_RECEIVED: 'Đã nhận bằng gốc',
    }

    id = models.BigAutoField(primary_key=True)
    round = models.ForeignKey(DiplomaRound, on_delete=models.PROTECT, related_name='submissions')
    student = models.OneToOneField('students.Student', on_delete=models.DO_NOTHING,
                                   related_name='diploma_submission')
    student_code = models.CharField(max_length=64)
    full_name = models.CharField(max_length=255)
    university_email = models.CharField(max_length=255, default='')
    phone_number = models.CharField(max_length=20)
    citizen_id = models.CharField(max_length=12)
    diploma_number = models.CharField(max_length=32)
    issued_by = models.CharField(max_length=255)
    issued_on = models.DateField()
    exam_session = models.CharField(max_length=32)
    cccd_front = models.JSONField()
    diploma_pdf = models.JSONField()
    profile_diff = models.JSONField(null=True, blank=True)
    status = models.CharField(max_length=16, default=STATUS_PENDING)
    review_note = models.CharField(max_length=1000, null=True, blank=True)
    reviewed_by_id = models.IntegerField(null=True, blank=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    supplement_pending = models.BooleanField(default=False)
    supplemented_at = models.DateTimeField(null=True, blank=True)
    submit_count = models.PositiveSmallIntegerField(default=1)
    notice_batch_id = models.BigIntegerField(null=True, blank=True)
    notified_at = models.DateTimeField(null=True, blank=True)
    received_at = models.DateTimeField(null=True, blank=True)
    received_by_id = models.IntegerField(null=True, blank=True)
    row_version = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = 'diploma_submissions'

    @property
    def status_label(self):
        return self.STATUS_LABELS.get(self.status, self.status)


class DiplomaEvent(models.Model):
    submission = models.ForeignKey(DiplomaSubmission, on_delete=models.PROTECT, related_name='events')
    event_type = models.CharField(max_length=40)
    actor_id = models.BigIntegerField(null=True)
    source_app = models.CharField(max_length=16)
    request_key = models.CharField(max_length=96, null=True)
    payload = models.JSONField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed = False
        db_table = 'diploma_submission_events'
        unique_together = [('submission', 'request_key')]
        ordering = ['id']
