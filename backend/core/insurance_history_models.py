"""Unmanaged shared tables; imported by models.py for Django discovery."""
from django.db import models


class AppendOnlyEvents(models.QuerySet):
    def update(self, **kwargs):
        raise ValueError('BHYT events are append-only.')

    def delete(self):
        raise ValueError('BHYT events are append-only.')


class InsuranceEvent(models.Model):
    objects = AppendOnlyEvents.as_manager()
    id = models.BigAutoField(primary_key=True)
    registration = models.ForeignKey('HealthInsuranceRegistration', on_delete=models.PROTECT, related_name='events')
    event_no = models.PositiveIntegerField()
    event_type = models.CharField(max_length=40)
    from_status = models.CharField(max_length=16, null=True)
    to_status = models.CharField(max_length=16, null=True)
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
            raise ValueError('BHYT events are append-only.')
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValueError('BHYT events are append-only.')

    class Meta:
        managed = False
        db_table = 'hub_insurance_registration_events'
        ordering = ['event_no']
        unique_together = [('registration', 'event_no'), ('registration', 'request_key')]


class InsuranceAssessment(models.Model):
    id = models.BigAutoField(primary_key=True)
    registration = models.ForeignKey('HealthInsuranceRegistration', on_delete=models.PROTECT, related_name='assessments')
    event = models.OneToOneField(InsuranceEvent, on_delete=models.PROTECT, related_name='assessment')
    assessment_no = models.PositiveIntegerField()
    required_amount_vnd = models.BigIntegerField()
    confirmed_paid_total_vnd = models.BigIntegerField()
    missing_amount_vnd = models.BigIntegerField()
    note = models.TextField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed = False
        db_table = 'hub_insurance_payment_assessments'
        unique_together = [('registration', 'assessment_no')]


class InsuranceEvidence(models.Model):
    id = models.BigAutoField(primary_key=True)
    registration = models.ForeignKey('HealthInsuranceRegistration', on_delete=models.PROTECT, related_name='evidences')
    event = models.ForeignKey(InsuranceEvent, on_delete=models.PROTECT, related_name='evidences')
    storage_key = models.CharField(max_length=500)
    original_filename = models.CharField(max_length=255)
    mime_type = models.CharField(max_length=64)
    file_size_bytes = models.BigIntegerField()
    sha256 = models.CharField(max_length=64)
    declared_amount_vnd = models.BigIntegerField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed = False
        db_table = 'hub_insurance_payment_evidences'
        ordering = ['id']
