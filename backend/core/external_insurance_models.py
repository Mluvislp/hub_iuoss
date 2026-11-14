"""Shared current declarations; in-place changes are recorded in separate audit events."""
from django.db import models


class ExternalInsuranceConfig(models.Model):
    """Một trong bốn slot MAIN/Q2/Q3/Q4 nhận bản khai BHYT nơi khác, tách riêng với đợt đăng ký
    BHYT (HealthInsuranceConfig) để hết đợt đăng ký tại trường sinh viên vẫn khai được."""
    PERIOD_CHOICES = [("MAIN", "Đợt 1"), ("Q2", "Đợt 2"), ("Q3", "Đợt 3"), ("Q4", "Đợt 4")]

    external_period = models.CharField(max_length=32, choices=PERIOD_CHOICES, unique=True)
    external_year = models.IntegerField()
    opens_at = models.DateTimeField()
    closes_at = models.DateTimeField()
    # Hạn riêng cho học viên cao học; NULL thì dùng chung closes_at.
    graduate_closes_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=False)
    description = models.TextField(null=True, blank=True)
    hospital_lookup_url = models.CharField(max_length=500, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = 'hub_insurance_external_configs'
        ordering = ['external_period']


class ExternalInsuranceDeclaration(models.Model):
    STATUS_PENDING = 'pending'
    STATUS_CONFIRMED = 'confirmed'
    STATUS_REJECTED = 'rejected'

    id = models.BigAutoField(primary_key=True)
    student = models.ForeignKey('students.Student', on_delete=models.DO_NOTHING)
    card_id = models.BigIntegerField(null=True)
    full_name = models.CharField(max_length=255)
    student_code = models.CharField(max_length=64)
    social_insurance_code = models.CharField(max_length=15)
    medical_insurance_code = models.CharField(max_length=64)
    hospital_code = models.CharField(max_length=16)
    registration_type_id = models.BigIntegerField(null=True)
    valid_from = models.DateField()
    valid_until = models.DateField()
    registration_year = models.IntegerField()
    intake_year = models.IntegerField(null=True)
    intake_period = models.CharField(max_length=32, null=True)
    intake_snapshot = models.JSONField(null=True)
    row_version = models.PositiveIntegerField(default=0)
    supplement_pending = models.BooleanField(default=False)
    supplemented_at = models.DateTimeField(null=True)
    supplement_reviewed_at = models.DateTimeField(null=True)
    snapshot = models.JSONField()
    images = models.JSONField()
    request_key = models.CharField(max_length=80)
    request_digest = models.CharField(max_length=64)
    status = models.CharField(max_length=16, default=STATUS_PENDING)
    review_note = models.TextField(null=True)
    reviewed_by_id = models.BigIntegerField(null=True)
    reviewed_at = models.DateTimeField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = 'student_external_health_insurance_declarations'
        ordering = ['-id']
        unique_together = [('student', 'request_key')]


class ExternalInsuranceEvent(models.Model):
    declaration = models.ForeignKey(ExternalInsuranceDeclaration, on_delete=models.PROTECT, related_name='events')
    event_type = models.CharField(max_length=40)
    actor_id = models.BigIntegerField(null=True)
    source_app = models.CharField(max_length=16)
    request_key = models.CharField(max_length=96, null=True)
    payload = models.JSONField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed = False
        db_table = 'hub_external_insurance_events'
        unique_together = [('declaration', 'request_key')]
        ordering = ['id']
