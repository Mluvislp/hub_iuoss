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


class AcademicTerm(models.Model):
    term_code = models.CharField(max_length=5)
    academic_year = models.PositiveSmallIntegerField()
    semester = models.PositiveSmallIntegerField()

    class Meta:
        managed = False
        db_table = "academic_terms"

    def __str__(self):
        return self.term_code


class Student(models.Model):
    current_student_code = models.CharField(max_length=64)
    full_name = models.CharField(max_length=255)
    sex = models.CharField(max_length=20, null=True, blank=True)
    date_of_birth = models.DateField(null=True, blank=True)
    academic_entry_year = models.PositiveSmallIntegerField(null=True, blank=True)
    # class_code đã bỏ khỏi bảng students — mã lớp giờ ở student_academic_enrollments.
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
    admission_term = models.ForeignKey(
        AcademicTerm, on_delete=models.SET_NULL,
        null=True, blank=True, db_column="admission_term_id",
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
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = "student_civic_activities"
        ordering = ["activity_code", "attempt_no"]

    def __str__(self):
        return f"{self.activity_code} - lần {self.attempt_no}"


class Major(models.Model):
    code = models.CharField(max_length=32)
    name_vi = models.CharField(max_length=255)
    department_code = models.CharField(max_length=8, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        managed = False
        db_table = "majors"

    def __str__(self):
        return f"{self.code} — {self.name_vi}"


class MajorTrainingDuration(models.Model):
    """Thời gian đào tạo (tháng) của một ngành theo khóa nhập học."""
    major_code = models.CharField(max_length=32)
    effective_from_year = models.PositiveSmallIntegerField()
    training_months = models.PositiveSmallIntegerField()
    max_training_months = models.PositiveSmallIntegerField()

    class Meta:
        managed = False
        db_table = "major_training_durations"

    def __str__(self):
        return f"{self.major_code} (≥{self.effective_from_year})"


class StudentIdentityDocument(models.Model):
    TYPE_CCCD = "CCCD"

    student = models.ForeignKey(
        Student, on_delete=models.DO_NOTHING,
        db_column="student_id", related_name="identity_documents",
    )
    document_type = models.CharField(max_length=16)
    document_number = models.CharField(max_length=50)
    issue_date = models.DateField(null=True, blank=True)
    issue_place = models.CharField(max_length=255, null=True, blank=True)
    is_current = models.BooleanField(default=True)

    class Meta:
        managed = False
        db_table = "student_identity_documents"

    def __str__(self):
        return f"{self.document_type}: {self.document_number}"


class StudentAddress(models.Model):
    TYPE_CURRENT = "CURRENT"          # thường trú (dữ liệu cũ, có thể chưa chuẩn)
    TYPE_TEMPORARY = "TEMPORARY"
    TYPE_PERMANENT = "PERMANENT"
    TYPE_OTHER = "OTHER"
    TYPE_CURRENT_STD = "CURRENT_STD"  # thường trú đã chuẩn hóa theo cơ cấu 2025

    student = models.ForeignKey(
        Student, on_delete=models.DO_NOTHING,
        db_column="student_id", related_name="addresses",
    )
    address_type = models.CharField(max_length=16)
    full_address = models.TextField(null=True, blank=True)
    ward = models.CharField(max_length=255, null=True, blank=True)
    district = models.CharField(max_length=255, null=True, blank=True)
    province = models.CharField(max_length=255, null=True, blank=True)
    province_code = models.CharField(max_length=2, null=True, blank=True)
    ward_code = models.CharField(max_length=5, null=True, blank=True)
    is_current = models.BooleanField(default=True)

    class Meta:
        managed = False
        db_table = "student_addresses"

    def __str__(self):
        return f"{self.address_type}: {self.full_address}"


class VnProvince(models.Model):
    """Tỉnh/thành theo cơ cấu hành chính 2025 (managed=False)."""
    code = models.CharField(max_length=2, unique=True)
    name = models.CharField(max_length=255)
    name_en = models.CharField(max_length=255, null=True, blank=True)
    unit_type = models.CharField(max_length=50)
    is_active = models.BooleanField(default=True)

    class Meta:
        managed = False
        db_table = "vn_provinces"
        ordering = ["name"]

    def __str__(self):
        return self.name


class VnWard(models.Model):
    """Phường/xã/đặc khu (cấp trực thuộc tỉnh, cơ cấu 2025). managed=False."""
    code = models.CharField(max_length=5, unique=True)
    name = models.CharField(max_length=255)
    name_en = models.CharField(max_length=255, null=True, blank=True)
    unit_type = models.CharField(max_length=50)
    province_code = models.CharField(max_length=2)
    is_active = models.BooleanField(default=True)

    class Meta:
        managed = False
        db_table = "vn_wards"
        ordering = ["name"]

    def __str__(self):
        return self.name
