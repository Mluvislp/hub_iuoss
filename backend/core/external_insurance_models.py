"""Shared, append-only snapshots of insurance declared outside the university."""
from django.db import models


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
