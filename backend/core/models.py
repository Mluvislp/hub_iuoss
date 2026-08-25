from django.db import models
from django.utils import timezone


class ConfirmationRequest(models.Model):
    REQUEST_TYPES = [
        ("enrollment", "Xác nhận đang học"),
        ("graduation", "Xác nhận tốt nghiệp"),
        ("deferment", "Hoãn nghĩa vụ quân sự"),
        ("other", "Khác"),
    ]
    STATUS_CHOICES = [
        ("pending", "Chờ xử lý"),
        ("processing", "Đang xử lý"),
        ("done", "Hoàn thành"),
        ("rejected", "Từ chối"),
    ]
    STATUS_BADGE = {
        "pending": "warning",
        "processing": "info",
        "done": "success",
        "rejected": "danger",
    }

    student_id = models.BigIntegerField()
    ldap_uid = models.CharField(max_length=64)
    request_type = models.CharField(max_length=64, choices=REQUEST_TYPES)
    purpose = models.CharField(max_length=255)
    note = models.TextField(null=True, blank=True)
    payload = models.JSONField(null=True, blank=True)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="pending")
    staff_note = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = "hub_confirmation_requests"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.ldap_uid} — {self.get_request_type_display()}"

    @property
    def status_badge(self):
        return self.STATUS_BADGE.get(self.status, "secondary")


class HubStudent(models.Model):
    """
    Lưu thông tin student đã từng đăng nhập hub.
    Không liên quan tới django.contrib.auth.
    Tạo/update tự động khi login thành công lần đầu.

    SQL tạo bảng:
        CREATE TABLE hub_students (
            id           BIGINT       NOT NULL AUTO_INCREMENT,
            ldap_uid     VARCHAR(64)  NOT NULL UNIQUE,
            student_id   BIGINT       NULL,
            last_login_at DATETIME(6) NULL,
            login_count  INT          NOT NULL DEFAULT 0,
            created_at   DATETIME(6)  NOT NULL,
            PRIMARY KEY (id),
            KEY idx_hub_student_id (student_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    """

    # ⚠️ Tên cột là di sản: từ 2026-08-09 nó lưu **MSSV hiện tại**, không phải
    # chuỗi người dùng gõ và cũng không riêng gì LDAP — đăng nhập bằng Microsoft
    # cũng ghi vào đây (MSSV lấy từ tiền tố email, mã cũ đã được ánh xạ sang mã
    # mới). Không đổi tên vì model managed=False: đổi cột phải ALTER trên prod
    # TRƯỚC rồi mới deploy, đắt hơn giá trị thu được. Xem docs/AUTH_FLOW.md.
    CHANNEL_LDAP = "LDAP"
    CHANNEL_MICROSOFT = "Microsoft"

    # Kênh đăng nhập → cột giữ mốc thời gian của kênh đó. Bảng ánh xạ này là nơi
    # DUY NHẤT biết chuyện đó; thêm kênh thứ ba = thêm 1 dòng ở đây + 1 cột.
    _CHANNEL_FIELD = {
        CHANNEL_LDAP: "last_login_ldap_at",
        CHANNEL_MICROSOFT: "last_login_ms_at",
    }

    ldap_uid = models.CharField(max_length=64, unique=True)
    # NULL chỉ còn ở các dòng cũ: từ khi có login_policy, đăng nhập được nghĩa là
    # chắc chắn có hồ sơ sinh viên.
    student_id = models.BigIntegerField(null=True, blank=True)  # soft ref → students.id
    last_login_at = models.DateTimeField(null=True, blank=True)   # lần cuối, kênh nào cũng tính
    last_login_ldap_at = models.DateTimeField(null=True, blank=True)
    last_login_ms_at = models.DateTimeField(null=True, blank=True)
    login_count = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed = False
        db_table = "hub_students"

    def __str__(self):
        return self.ldap_uid

    @classmethod
    def record_login(cls, *, student_code: str, student_id: int, channel: str) -> "HubStudent":
        """Ghi nhận một lần đăng nhập thành công. Đường DUY NHẤT chạm vào bảng này.

        `student_code` phải là MSSV HIỆN TẠI (xem ghi chú ở `ldap_uid`), không phải
        chuỗi người dùng gõ hay tiền tố email.
        """
        field = cls._CHANNEL_FIELD[channel]  # kênh lạ = lỗi lập trình, để nó nổ
        now = timezone.now()

        row, _ = cls.objects.get_or_create(ldap_uid=student_code)
        row.student_id = student_id
        row.last_login_at = now
        setattr(row, field, now)
        row.login_count = (row.login_count or 0) + 1
        row.save(update_fields=["student_id", "last_login_at", field, "login_count"])
        return row


class HealthInsuranceRegistration(models.Model):
    PERIOD_CHOICES = [
        ("MAIN", "Đợt chính (Tháng 9)"),
        ("Q2", "Đợt phụ Quý 2"),
        ("Q3", "Đợt phụ Quý 3"),
        ("Q4", "Đợt phụ Quý 4"),
    ]
    STATUS_CHOICES = [
        ("pending", "Chờ xử lý"),
        ("processing", "Đang xử lý"),
        ("done", "Hoàn thành"),
        ("rejected", "Từ chối"),
    ]

    student = models.ForeignKey(
        "students.Student", on_delete=models.DO_NOTHING,
        db_column="student_id"
    )
    
    registration_year = models.IntegerField()
    registration_period = models.CharField(max_length=32, choices=PERIOD_CHOICES)

    hospital_code = models.CharField(max_length=16)

    cccd_image = models.FileField(upload_to="insurance_data/%Y/%m/", blank=True, null=True)
    bhyt_image = models.FileField(upload_to="insurance_data/%Y/%m/", blank=True, null=True)
    payment_receipt_image = models.FileField(upload_to="insurance_data/%Y/%m/")

    change_log = models.JSONField(blank=True, null=True)
    
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="pending")
    rejection_reason = models.TextField(blank=True, null=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = "hub_insurance_registrations"
        ordering = ["-created_at"]

    def __str__(self):
        return f"Student {self.student_id} — {self.get_registration_period_display()} {self.registration_year} ({self.status})"

class HealthInsuranceConfig(models.Model):
    description = models.TextField(blank=True, null=True)
    bank_name = models.CharField(max_length=255)
    bank_account_number = models.CharField(max_length=64)
    bank_account_name = models.CharField(max_length=255)
    insurance_fee = models.IntegerField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = "hub_insurance_configs"

