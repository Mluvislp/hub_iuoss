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
    # Lưu dạng `NN_tên` (`01_Kinh`) — xem core/api/views.py::ethnicity_name().
    # Cột ĐÃ tồn tại trong bảng `students`, khai thêm ở đây KHÔNG cần ALTER.
    ethnicity = models.CharField(max_length=120, null=True, blank=True)
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


class StudentCodeHistory(models.Model):
    """Lịch sử mã số sinh viên — Dashboard sở hữu, Hub CHỈ ĐỌC.

    Sinh viên chuyển ngành/chương trình được cấp mã mới, mã cũ lưu lại ở đây với
    `code_role='OLD'`. Hub dùng bảng này để nhận ra người đăng nhập bằng mã cũ và
    chỉ họ sang mã hiện tại. `student_code` UNIQUE trên toàn bảng nên tra ngược
    luôn ra đúng một sinh viên — đã đo: 0 trường hợp mã cũ trùng mã hiện tại của
    sinh viên khác.
    """

    student = models.ForeignKey(
        Student, on_delete=models.DO_NOTHING,
        db_column="student_id", related_name="code_history",
    )
    student_code = models.CharField(max_length=64, unique=True)
    code_role = models.CharField(max_length=16)

    class Meta:
        managed = False
        db_table = "student_code_history"

    def __str__(self):
        return f"{self.student_code} ({self.code_role})"


class Hospital(models.Model):
    """Danh mục cơ sở khám chữa bệnh (mã BHXH) — Dashboard sở hữu, Hub CHỈ ĐỌC.

    KHÔNG có FK từ `student_health_insurance_cards.hospital_code` sang đây; tra
    tên ở tầng hiển thị. Mã không có trong danh mục thì để nguyên mã, TUYỆT ĐỐI
    không thêm dòng vào bảng này (dữ liệu tham chiếu từ nguồn ngoài).
    """

    province_code = models.CharField(max_length=2)
    code = models.CharField(max_length=16, unique=True)
    name = models.CharField(max_length=500)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = "hospitals"
        ordering = ["province_code", "code"]

    def __str__(self):
        return f"{self.code} — {self.name}"


class HealthInsuranceRegistrationType(models.Model):
    """Diện/nơi đăng ký thẻ BHYT — danh mục do Dashboard quản lý, Hub chỉ đọc."""

    code = models.CharField(max_length=32, unique=True)
    name = models.CharField(max_length=255)
    sort_order = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = "student_health_insurance_registration_types"
        ordering = ["sort_order", "code"]

    def __str__(self):
        return self.name


class HealthInsuranceCard(models.Model):
    # Tên field giữ khớp Dashboard (students/models.py::StudentHealthInsuranceCard).
    student = models.ForeignKey(
        Student, on_delete=models.DO_NOTHING,
        db_column="student_id", related_name="health_insurance_cards",
    )
    social_insurance_code = models.CharField(max_length=15, null=True, blank=True)
    medical_insurance_code = models.CharField(max_length=64, null=True, blank=True)
    # Mã nơi đăng ký KCB — dữ liệu thô, còn nhiều biến thể ("79-036", "79036 Bệnh
    # viện…"). Hub chỉ hiển thị nguyên văn, KHÔNG tra tên bệnh viện: bảng
    # `hospitals` là danh mục của Dashboard và ~91 mã không khớp được.
    hospital_code = models.CharField(max_length=16, null=True, blank=True)
    registration_type = models.ForeignKey(
        HealthInsuranceRegistrationType, on_delete=models.DO_NOTHING,
        db_column="registration_type_id", related_name="cards",
        null=True, blank=True,
    )
    valid_from = models.DateField(null=True, blank=True)
    valid_until = models.DateField(null=True, blank=True)
    # ⚠️ is_current = "thẻ đang dùng", KHÔNG phải "còn hiệu lực".
    # Hiệu lực tính riêng theo valid_until so với hôm nay.
    is_current = models.BooleanField(default=False)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = "student_health_insurance_cards"
        ordering = ["-is_current", "-valid_until", "-id"]

    def __str__(self):
        return self.medical_insurance_code or f"card#{self.pk}"


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
    sequence_no = models.SmallIntegerField(default=1)
    full_address = models.TextField(null=True, blank=True)
    ward = models.CharField(max_length=255, null=True, blank=True)
    district = models.CharField(max_length=255, null=True, blank=True)
    province = models.CharField(max_length=255, null=True, blank=True)
    province_code = models.CharField(max_length=2, null=True, blank=True)
    ward_code = models.CharField(max_length=5, null=True, blank=True)
    is_current = models.BooleanField(default=True)
    # effective_from = ngày sinh viên khai; effective_to = ngày dòng này bị thay
    # thế. Dùng 2 cột này thay vì updated_at vì updated_at có ON UPDATE
    # CURRENT_TIMESTAMP nên bị ghi đè đúng lúc dòng bị hạ xuống lịch sử.
    effective_from = models.DateField(null=True, blank=True)
    effective_to = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = "student_addresses"

    def __str__(self):
        return f"{self.address_type}: {self.full_address}"


class StudentContactPoint(models.Model):
    TYPE_PERSONAL_EMAIL = "PERSONAL_EMAIL"
    TYPE_UNIVERSITY_EMAIL = "UNIVERSITY_EMAIL"
    TYPE_MOBILE_PHONE = "MOBILE_PHONE"

    student = models.ForeignKey(
        Student, on_delete=models.DO_NOTHING,
        db_column="student_id", related_name="contact_points",
    )
    contact_type = models.CharField(max_length=32)
    contact_value = models.CharField(max_length=255)
    normalized_contact_value = models.CharField(max_length=255)
    is_primary = models.BooleanField(default=False)
    is_current = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = "student_contact_points"

    def __str__(self):
        return f"{self.contact_type}: {self.contact_value}"


class ProfileChangeRequest(models.Model):
    """Đề xuất sửa hồ sơ do SV gửi từ Hub, chờ nhân viên duyệt bên Dashboard.

    ⚠️ Model này khai ở CẢ HAI repo (bản Dashboard nằm ở students/models.py).
    Sửa một bên thì sửa luôn bên kia.
    """

    STATUS_PENDING = "pending"
    STATUS_APPROVED = "approved"
    STATUS_REJECTED = "rejected"
    STATUS_CANCELLED = "cancelled"

    SOURCE_OFFCAMPUS = "ngoai_tru"

    student = models.ForeignKey(
        Student, on_delete=models.DO_NOTHING,
        db_column="student_id", related_name="profile_change_requests",
    )
    target = models.CharField(max_length=64)
    target_id = models.BigIntegerField(null=True, blank=True)
    old_value = models.TextField(null=True, blank=True)
    new_value = models.TextField()
    source = models.CharField(max_length=32)
    group_key = models.CharField(max_length=32, null=True, blank=True)
    status = models.CharField(max_length=16, default=STATUS_PENDING)
    review_note = models.CharField(max_length=255, null=True, blank=True)
    reviewed_by_id = models.IntegerField(null=True, blank=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = "hub_profile_change_requests"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.target} #{self.pk} — {self.status}"


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



class VnEthnicity(models.Model):
    code = models.CharField(max_length=2, unique=True)
    name = models.CharField(max_length=255)
    is_active = models.BooleanField(default=True)

    class Meta:
        managed = False
        db_table = "vn_ethnicities"
        ordering = ["code"]

    def __str__(self):
        return self.name
