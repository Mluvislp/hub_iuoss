"""
Read-only models trỏ vào shared MySQL DB (iuoss_student_data).
Tất cả managed=False — không tạo/sửa bảng qua Django.
"""
from django.db import models


class Department(models.Model):
    code = models.CharField(max_length=32)
    name_vi = models.CharField(max_length=255)
    is_active = models.BooleanField(default=True)

    class Meta:
        managed = False
        db_table = "departments"

    def __str__(self):
        return f"{self.code} - {self.name_vi}"


class DegreeLevel(models.Model):
    code = models.CharField(max_length=32)
    name = models.CharField(max_length=120)
    is_active = models.BooleanField(default=True)

    class Meta:
        managed = False
        db_table = "degree_levels"

    def __str__(self):
        return self.name


class StudentStatus(models.Model):
    code = models.CharField(max_length=64)
    name_vi = models.CharField(max_length=255)
    status_group = models.CharField(max_length=16)

    class Meta:
        managed = False
        db_table = "student_statuses"

    def __str__(self):
        return self.name_vi


class Student(models.Model):
    current_student_code = models.CharField(max_length=64)
    full_name = models.CharField(max_length=255)
    date_of_birth = models.DateField(null=True, blank=True)
    academic_entry_year = models.PositiveSmallIntegerField(null=True, blank=True)
    class_code = models.CharField(max_length=64, null=True, blank=True)
    current_department = models.ForeignKey(
        Department, on_delete=models.SET_NULL,
        null=True, blank=True, db_column="current_department_id",
    )
    current_degree_level = models.ForeignKey(
        DegreeLevel, on_delete=models.SET_NULL,
        null=True, blank=True, db_column="current_degree_level_id",
    )
    current_status = models.ForeignKey(
        StudentStatus, on_delete=models.SET_NULL,
        null=True, blank=True, db_column="current_status_id",
    )

    class Meta:
        managed = False
        db_table = "students"

    def __str__(self):
        return f"{self.current_student_code} - {self.full_name}"


class HealthInsuranceCard(models.Model):
    student = models.ForeignKey(
        Student, on_delete=models.DO_NOTHING,
        db_column="student_id", related_name="health_insurance_cards",
    )
    medical_insurance_code = models.CharField(max_length=64)
    hospital_code = models.CharField(max_length=255)
    valid_until = models.DateField(null=True, blank=True)
    is_current = models.BooleanField(default=False)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = "student_health_insurance_cards"

    def __str__(self):
        return self.medical_insurance_code


class CivicActivity(models.Model):
    RESULT_CHOICES = [
        ("YES", "Đạt"),
        ("NO", "Không đạt"),
        ("UNKNOWN", "Chưa có kết quả"),
    ]

    student = models.ForeignKey(
        Student, on_delete=models.DO_NOTHING,
        db_column="student_id", related_name="civic_activities",
    )
    activity_code = models.CharField(max_length=32)
    attempt_no = models.SmallIntegerField()
    result_value = models.CharField(max_length=10, choices=RESULT_CHOICES)
    completed_at = models.DateField(null=True, blank=True)
    source_column = models.CharField(max_length=80)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = "student_civic_activities"
        ordering = ["activity_code", "attempt_no"]

    def __str__(self):
        return f"{self.activity_code} - lần {self.attempt_no}"
