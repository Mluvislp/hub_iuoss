"""Lễ tốt nghiệp — 2 bảng dùng chung với Dashboard (bản đối ứng: dashboard_iuoss/graduation/models.py).

Schema: dashboard_iuoss/docs/sql/20261104_graduation_rounds.sql + 20261104_graduation_registration.sql.
Hub CHỈ ghi phần đăng ký (registration_status registered / cancel_requested, ảnh, checkin_token,
xin hủy). Duyệt hủy, check-in, log ra/vào là việc của Dashboard. Ghi qua `core.graduation`.
"""
from django.db import models
from django.utils import timezone


class GraduationRound(models.Model):
    id = models.BigAutoField(primary_key=True)
    title = models.CharField(max_length=255, unique=True)
    ceremony_date = models.DateField(null=True, blank=True)
    registration_opens_at = models.DateTimeField(null=True, blank=True)
    registration_closes_at = models.DateTimeField(null=True, blank=True)
    note = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = "graduation_rounds"

    def registration_open(self, now=None):
        """Mở ⇔ đã đặt CẢ HAI mốc và đang ở giữa. Chưa đặt hạn = đóng (Phòng CTSV đặt ở Dashboard)."""
        now = now or timezone.now()
        return bool(self.registration_opens_at and self.registration_closes_at
                    and self.registration_opens_at <= now <= self.registration_closes_at)


class Bank(models.Model):
    """Danh mục ngân hàng dùng chung (Dashboard quản lý — students/catalogs.py). Hub chỉ đọc."""

    id = models.BigAutoField(primary_key=True)
    short_name = models.CharField(max_length=64, unique=True)
    full_name = models.CharField(max_length=255)
    english_name = models.CharField(max_length=255, null=True, blank=True)
    swift_code = models.CharField(max_length=11, null=True, blank=True)
    bank_type = models.CharField(max_length=64, null=True, blank=True)
    sort_order = models.SmallIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        managed = False
        db_table = "banks"
        ordering = ["sort_order", "short_name"]


class GraduationRoundStudent(models.Model):
    STATUS_REGISTERED = "registered"
    STATUS_CANCEL_REQUESTED = "cancel_requested"
    STATUS_CANCELLED = "cancelled"

    id = models.BigAutoField(primary_key=True)
    round = models.ForeignKey(GraduationRound, on_delete=models.DO_NOTHING, related_name="members")
    student = models.ForeignKey("students.Student", on_delete=models.DO_NOTHING, related_name="+")
    student_code = models.CharField(max_length=64)
    program_group = models.CharField(max_length=16)
    major_name = models.CharField(max_length=255, null=True, blank=True)
    cohort_range = models.CharField(max_length=20, null=True, blank=True)
    award_title = models.CharField(max_length=255, null=True, blank=True)
    degree_class = models.CharField(max_length=64, null=True, blank=True)
    contact_email = models.CharField(max_length=255, null=True, blank=True)
    note = models.CharField(max_length=255, null=True, blank=True)
    ceremony_session = models.CharField(max_length=16, null=True, blank=True)
    registration_status = models.CharField(max_length=20, null=True, blank=True)
    registered_at = models.DateTimeField(null=True, blank=True)
    verified_via = models.CharField(max_length=16, null=True, blank=True)
    checkin_token = models.CharField(max_length=32, null=True, blank=True, unique=True)
    photo_storage_key = models.CharField(max_length=500, null=True, blank=True)
    photo_original_filename = models.CharField(max_length=255, null=True, blank=True)
    photo_size_bytes = models.PositiveIntegerField(null=True, blank=True)
    photo_uploaded_at = models.DateTimeField(null=True, blank=True)
    # Tài khoản nhận hoàn tiền cọc lễ phục — bắt buộc khi đăng ký (core/graduation.py::parse_bank).
    bank = models.ForeignKey(Bank, on_delete=models.DO_NOTHING, null=True, blank=True, related_name="+")
    bank_account_number = models.CharField(max_length=32, null=True, blank=True)
    bank_account_holder = models.CharField(max_length=120, null=True, blank=True)
    cancel_reason = models.CharField(max_length=500, null=True, blank=True)
    cancel_requested_at = models.DateTimeField(null=True, blank=True)
    cancel_reviewed_at = models.DateTimeField(null=True, blank=True)
    cancel_review_note = models.CharField(max_length=500, null=True, blank=True)
    checked_in_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = "graduation_round_students"
        unique_together = [("round", "student")]

    @property
    def is_registered(self):
        """Đang giữ suất (kể cả chờ duyệt hủy — QR vẫn dùng được tới khi Phòng CTSV duyệt)."""
        return self.registration_status in (self.STATUS_REGISTERED, self.STATUS_CANCEL_REQUESTED)
