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
