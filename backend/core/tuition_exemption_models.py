"""Miễn giảm học phí — 4 bảng Hub sở hữu (bản đối ứng: `dashboard_iuoss/tuition/models.py`).

Schema: `dashboard_iuoss/docs/sql/20260930_mghp_schema.sql` (+ `_add_guardian.sql`).
Đổi cột phải sửa cả hai repo, ALTER trước rồi mới deploy.

Hub tạo dòng và ghi mọi cột, TRỪ các cột Dashboard giữ (review/verify) — Hub không
bao giờ ghi đè chúng sau khi đơn đã vào tay cán bộ. Danh sách cột của Dashboard nằm
ở `DASHBOARD_WRITABLE_FIELDS` bên Dashboard.
"""
from django.db import models


class TuitionExemptionApplication(models.Model):
    """Một đơn MGHP: một SV, một đợt, nhiều đối tượng (`categories`).

    Các cột thông tin là ẢNH CHỤP lúc nộp — Hub điền sẵn từ hồ sơ, SV xác nhận/sửa.
    Tuyệt đối không ghi ngược vào `students*` / `student_bank_accounts` từ đây.
    """

    id = models.BigAutoField(primary_key=True)
    student = models.ForeignKey("students.Student", on_delete=models.DO_NOTHING,
                                related_name="tuition_exemption_applications")
    round = models.ForeignKey("students.TuitionExemptionRound", on_delete=models.DO_NOTHING,
                              related_name="applications")
    # Thông tin cá nhân
    student_code = models.CharField(max_length=64)
    full_name = models.CharField(max_length=255)
    date_of_birth = models.DateField(null=True, blank=True)
    citizen_id = models.CharField(max_length=20, null=True, blank=True)
    citizen_id_issued_on = models.DateField(null=True, blank=True)
    class_code = models.CharField(max_length=64, null=True, blank=True)
    department_code = models.CharField(max_length=32, null=True, blank=True)
    department_name = models.CharField(max_length=255, null=True, blank=True)
    phone_number = models.CharField(max_length=20, null=True, blank=True)
    # Tài khoản nhận hoàn tiền (ảnh chụp — phương án A)
    bank_account_number = models.CharField(max_length=64, null=True, blank=True)
    bank_account_holder = models.CharField(max_length=255, null=True, blank=True)
    bank_name = models.CharField(max_length=255, null=True, blank=True)
    # Cha mẹ
    father_full_name = models.CharField(max_length=255, null=True, blank=True)
    father_phone = models.CharField(max_length=20, null=True, blank=True)
    mother_full_name = models.CharField(max_length=255, null=True, blank=True)
    mother_phone = models.CharField(max_length=20, null=True, blank=True)
    # Người giám hộ (SV mồ côi / không sống cùng cha mẹ) — 20260930_mghp_add_guardian.sql
    guardian_full_name = models.CharField(max_length=255, null=True, blank=True)
    guardian_phone = models.CharField(max_length=20, null=True, blank=True)
    guardian_relationship = models.CharField(max_length=64, null=True, blank=True)
    # Địa chỉ thường trú
    permanent_address = models.CharField(max_length=500, null=True, blank=True)
    permanent_ward_code = models.CharField(max_length=5, null=True, blank=True)
    # Phân loại: first_time | previously_reviewed
    submission_kind = models.CharField(max_length=20)
    previous_review_note = models.CharField(max_length=500, null=True, blank=True)
    # Thông tin riêng theo đối tượng (TSKK, KHAC…) — 20261001_mghp_official_categories.sql.
    category_details = models.JSONField(null=True, blank=True)
    # Workflow — cột status..bank_synced_by_id do Dashboard ghi, Hub chỉ đọc
    # (trừ lúc tạo đơn và lúc SV gửi bổ sung, theo tuition_exemption_contract.py).
    status = models.CharField(max_length=24, default="submitted")
    rejection_reason_code = models.CharField(max_length=32, null=True, blank=True)
    review_note = models.TextField(null=True, blank=True)
    supplement_deadline = models.DateTimeField(null=True, blank=True)
    reviewed_by_id = models.IntegerField(null=True, blank=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    bank_synced_at = models.DateTimeField(null=True, blank=True)
    bank_synced_by_id = models.IntegerField(null=True, blank=True)
    workflow_version = models.PositiveSmallIntegerField(default=1)
    row_version = models.PositiveIntegerField(default=0)
    submitted_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = "hub_tuition_exemption_applications"
        ordering = ["-submitted_at", "-id"]
        unique_together = [("student", "round")]

    def __str__(self):
        return f"MGHP #{self.pk} — {self.student_code}"


class TuitionExemptionApplicationCategory(models.Model):
    """Đối tượng SV chọn trong đơn. Cột review_* do Dashboard ghi."""

    id = models.BigAutoField(primary_key=True)
    application = models.ForeignKey(TuitionExemptionApplication, on_delete=models.DO_NOTHING,
                                    related_name="categories")
    category = models.ForeignKey("students.TuitionExemptionCategory", on_delete=models.DO_NOTHING,
                                 related_name="+")
    review_status = models.CharField(max_length=16, default="pending")
    review_note = models.CharField(max_length=1000, null=True, blank=True)
    reviewed_by_id = models.IntegerField(null=True, blank=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = "hub_tuition_exemption_application_categories"
        unique_together = [("application", "category")]


class AppendOnlyEvents(models.QuerySet):
    def update(self, **kwargs):
        raise ValueError("MGHP events are append-only.")

    def delete(self):
        raise ValueError("MGHP events are append-only.")


class TuitionExemptionEvent(models.Model):
    """Timeline append-only — cùng khuôn `InsuranceEvent`. Cả hai app ghi."""

    objects = AppendOnlyEvents.as_manager()

    id = models.BigAutoField(primary_key=True)
    application = models.ForeignKey(TuitionExemptionApplication, on_delete=models.DO_NOTHING,
                                    related_name="events")
    event_no = models.PositiveIntegerField()
    event_type = models.CharField(max_length=40)
    from_status = models.CharField(max_length=24, null=True)
    to_status = models.CharField(max_length=24, null=True)
    reason_code = models.CharField(max_length=32, null=True)
    reason_text = models.TextField(null=True)
    actor_type = models.CharField(max_length=16)
    actor_id = models.BigIntegerField(null=True)
    source_app = models.CharField(max_length=16)
    request_key = models.CharField(max_length=96, null=True)
    batch_id = models.CharField(max_length=36, null=True)
    payload = models.JSONField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ValueError("MGHP events are append-only.")
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValueError("MGHP events are append-only.")

    class Meta:
        managed = False
        db_table = "hub_tuition_exemption_events"
        ordering = ["event_no"]
        unique_together = [("application", "event_no"), ("application", "request_key")]


class TuitionExemptionDocument(models.Model):
    """Một file giấy tờ, lưu dưới HUB_MEDIA_ROOT/tuition_private/ (không public).
    Thay file = dòng mới + đặt `is_superseded=True` cho dòng cũ. Cột verified_* và
    `expires_at` sau khi cán bộ xác nhận là của Dashboard."""

    id = models.BigAutoField(primary_key=True)
    application = models.ForeignKey(TuitionExemptionApplication, on_delete=models.DO_NOTHING,
                                    related_name="documents")
    application_category = models.ForeignKey(TuitionExemptionApplicationCategory,
                                             on_delete=models.DO_NOTHING, null=True, blank=True,
                                             related_name="documents")
    event = models.ForeignKey(TuitionExemptionEvent, on_delete=models.DO_NOTHING,
                              related_name="documents")
    doc_type = models.CharField(max_length=40)
    storage_key = models.CharField(max_length=500)
    original_filename = models.CharField(max_length=255)
    mime_type = models.CharField(max_length=64)
    file_size_bytes = models.BigIntegerField()
    sha256 = models.CharField(max_length=64)
    issued_on = models.DateField(null=True, blank=True)
    expires_at = models.DateField(null=True, blank=True)
    is_superseded = models.BooleanField(default=False)
    verified_status = models.CharField(max_length=16, null=True, blank=True)
    verified_note = models.CharField(max_length=500, null=True, blank=True)
    verified_by_id = models.IntegerField(null=True, blank=True)
    verified_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed = False
        db_table = "hub_tuition_exemption_documents"
        ordering = ["id"]
