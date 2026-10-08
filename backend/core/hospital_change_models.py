"""Yêu cầu đổi nơi KCB ban đầu — bảng dùng chung với Dashboard, DDL ở
docs/insurance_hospital_change_upgrade.sql. Bản đối ứng: dashboard_iuoss/students/hospital_change_models.py."""
from django.db import models


class HospitalChangeConfig(models.Model):
    """Một trong bốn slot MAIN/Q2/Q3/Q4 nhận yêu cầu, tách riêng với đợt đăng ký BHYT."""
    PERIOD_CHOICES = [("MAIN", "Đợt 1"), ("Q2", "Đợt 2"), ("Q3", "Đợt 3"), ("Q4", "Đợt 4")]

    change_period = models.CharField(max_length=32, choices=PERIOD_CHOICES, unique=True)
    change_year = models.IntegerField()
    opens_at = models.DateTimeField()
    closes_at = models.DateTimeField()
    is_active = models.BooleanField(default=False)
    description = models.TextField(null=True, blank=True)
    hospital_lookup_url = models.CharField(max_length=500, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = 'hub_insurance_hospital_change_configs'
        ordering = ['change_period']


class HospitalChangeRequest(models.Model):
    # Cùng 3 giai đoạn đơn đăng ký BHYT (insurance_contract.STATUS_LABELS) + Từ chối.
    STATUS_IU_PROCESSING = 'iu_processing'
    STATUS_WAITING_BHXH = 'waiting_bhxh'
    STATUS_ISSUED = 'issued'
    STATUS_REJECTED = 'rejected'

    id = models.BigAutoField(primary_key=True)
    student = models.ForeignKey('students.Student', on_delete=models.DO_NOTHING)
    # Đơn đăng ký BHYT tại trường làm nguồn; mọi thông tin khác chép từ đơn này. Trống khi
    # nguồn là thẻ diện ĐHQT còn hạn không có đơn (card_id = thẻ đó, thông tin từ hồ sơ SV).
    registration = models.ForeignKey('core.HealthInsuranceRegistration', on_delete=models.DO_NOTHING,
                                     db_constraint=False, null=True, related_name='hospital_changes')
    card_id = models.BigIntegerField(null=True)
    full_name = models.CharField(max_length=255)
    student_code = models.CharField(max_length=64)
    social_insurance_code = models.CharField(max_length=20, default='')
    old_hospital_code = models.CharField(max_length=16, default='')
    hospital_code = models.CharField(max_length=16)
    intake_year = models.IntegerField()
    intake_period = models.CharField(max_length=32)
    intake_snapshot = models.JSONField(null=True)
    row_version = models.PositiveIntegerField(default=0)
    supplement_pending = models.BooleanField(default=False)
    supplemented_at = models.DateTimeField(null=True)
    supplement_reviewed_at = models.DateTimeField(null=True)
    snapshot = models.JSONField()
    images = models.JSONField()
    request_key = models.CharField(max_length=80)
    request_digest = models.CharField(max_length=64)
    status = models.CharField(max_length=16, default=STATUS_IU_PROCESSING)
    review_note = models.TextField(null=True)
    reviewed_by_id = models.BigIntegerField(null=True)
    reviewed_at = models.DateTimeField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = 'hub_insurance_hospital_change_requests'
        ordering = ['-id']
        unique_together = [('student', 'request_key')]


class HospitalChangeEvent(models.Model):
    change_request = models.ForeignKey(HospitalChangeRequest, on_delete=models.PROTECT, related_name='events')
    event_type = models.CharField(max_length=40)
    actor_id = models.BigIntegerField(null=True)
    source_app = models.CharField(max_length=16)
    request_key = models.CharField(max_length=96, null=True)
    payload = models.JSONField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed = False
        db_table = 'hub_insurance_hospital_change_events'
        unique_together = [('change_request', 'request_key')]
        ordering = ['id']
