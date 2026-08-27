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


import os
import re
from django.db import models
from django.utils import timezone

# 1. Hàm hỗ trợ xóa dấu tiếng Việt
def remove_vietnamese_accents(s):
    if not s:
        return ""
    s = re.sub(r'[àáạảãâầấậẩẫăằắặẳẵ]', 'a', s)
    s = re.sub(r'[ÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴ]', 'A', s)
    s = re.sub(r'[èéẹẻẽêềếệểễ]', 'e', s)
    s = re.sub(r'[ÈÉẸẺẼÊỀẾỆỂỄ]', 'E', s)
    s = re.sub(r'[òóọỏõôồốộổỗơờớợởỡ]', 'o', s)
    s = re.sub(r'[ÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠ]', 'O', s)
    s = re.sub(r'[ìíịỉĩ]', 'i', s)
    s = re.sub(r'[ÌÍỊỈĨ]', 'I', s)
    s = re.sub(r'[ùúụủũưừứựửữ]', 'u', s)
    s = re.sub(r'[ÙÚỤỦŨƯỪỨỰỬỮ]', 'U', s)
    s = re.sub(r'[ỳýỵỷỹ]', 'y', s)
    s = re.sub(r'[ỲÝỴỶỸ]', 'Y', s)
    s = re.sub(r'[đ]', 'd', s)
    s = re.sub(r'[Đ]', 'D', s)
    return s

# 2. Hàm định dạng tên file chuẩn
def get_registration_filename(instance, filename, suffix):
    ext = filename.split('.')[-1]
    
    # Lấy thông tin gốc từ Student
    name = instance.student.full_name if instance.student else "Khach"
    dob_formatted = "01012000"
    if instance.student and instance.student.date_of_birth:
        dob_formatted = instance.student.date_of_birth.strftime('%d%m%Y')
    cccd = "NO_CCCD"
    
    # Ưu tiên lấy từ change_log nếu sinh viên có sửa trên form
    cl = instance.change_log or {}
    if cl.get('full_name', {}).get('to'):
        name = cl.get('full_name')['to']
        
    if cl.get('dob', {}).get('to'):
        try:
            from datetime import datetime
            dob_formatted = datetime.strptime(cl.get('dob')['to'], '%Y-%m-%d').strftime('%d%m%Y')
        except:
            pass
            
    if cl.get('citizen_id', {}).get('to'):
        cccd = cl.get('citizen_id')['to']
    elif instance.student:
        # Nếu form không đổi CCCD, truy vấn CCCD hiện tại dưới DB
        doc = instance.student.identity_documents.filter(document_type="CCCD", is_current=True).first()
        if doc:
            cccd = doc.document_number

    # Xử lý tên: Bỏ dấu và viết liền
    name_clean = remove_vietnamese_accents(name).replace(" ", "")
    
    # Lắp ghép: {CCCD}_{HoTen}_{ddmmyyyy}_{LoaiAnh}.{ext}
    new_filename = f"{cccd}_{name_clean}_{dob_formatted}_{suffix}.{ext}"
    
    # Lưu vào thư mục theo năm/tháng
    now = timezone.now()
    return f"insurance_data/{now.strftime('%Y/%m')}/{new_filename}"

# 3. Các hàm con gắn vào từng FileField
def cccd_front_path(instance, filename): return get_registration_filename(instance, filename, "CCCD_Front")
def cccd_back_path(instance, filename): return get_registration_filename(instance, filename, "CCCD_Back")
def receipt_path(instance, filename): return get_registration_filename(instance, filename, "Bill")
def bhyt_path(instance, filename): return get_registration_filename(instance, filename, "BHYT")

# ==========================================
# MODEL CHÍNH
# ==========================================
class HealthInsuranceRegistration(models.Model):
    PERIOD_CHOICES = [
        ("MAIN", "Đăng ký BHYT cho năm sau"),
        ("Q2", "Đăng ký Quý 2"),
        ("Q3", "Đăng ký Quý 3"),
        ("Q4", "Đăng ký Quý 4"),
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

    # Thay đường dẫn tĩnh bằng các hàm sinh tên tự động
    cccd_image = models.FileField(upload_to=cccd_front_path, blank=True, null=True)
    cccd_image_back = models.FileField(upload_to=cccd_back_path, blank=True, null=True)
    bhyt_image = models.FileField(upload_to=bhyt_path, blank=True, null=True)
    payment_receipt_image = models.FileField(upload_to=receipt_path)

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

class CccdScan(models.Model):
    """Dữ liệu đọc từ mã QR trên thẻ CCCD, gom từ mọi luồng có thu thập.

    Bảng dùng CHUNG: `source` cho biết dòng này thu được ở đâu, `source_ref_id`
    trỏ về bản ghi ở luồng đó. Thêm luồng mới KHÔNG được xin thêm bảng.

    Ghi thêm dòng mỗi lần quét, không sửa đè — hai lần quét lệch nhau là thông
    tin đáng giá (đổi thẻ, quét nhầm thẻ người khác), gộp lại là mất.
    """

    SOURCE_BHYT_REGISTRATION = "bhyt_registration"

    student = models.ForeignKey(
        "students.Student", on_delete=models.DO_NOTHING, db_column="student_id",
        related_name="cccd_scans",
    )
    source = models.CharField(max_length=32)
    source_ref_id = models.BigIntegerField(null=True, blank=True)

    citizen_id = models.CharField(max_length=12)
    old_id_number = models.CharField(max_length=12, blank=True, null=True)
    full_name = models.CharField(max_length=255)
    date_of_birth = models.DateField(null=True, blank=True)
    gender = models.CharField(max_length=10, blank=True, null=True)
    # Nguyên văn trên thẻ, cơ cấu hành chính TRƯỚC sáp nhập 2025.
    # KHÔNG ánh xạ sang vn_provinces/vn_wards — xem core/cccd.py.
    residence_address = models.CharField(max_length=255, blank=True, null=True)
    issue_date = models.DateField(null=True, blank=True)
    # Giữ chuỗi gốc để dựng lại được nếu sau này phát hiện bộ đọc sai.
    raw_payload = models.CharField(max_length=512, blank=True, null=True)
    scanned_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed = False
        db_table = "hub_cccd_scans"
        ordering = ["-scanned_at"]

    def __str__(self):
        return f"{self.citizen_id} — {self.full_name}"


class HealthInsuranceConfig(models.Model):
    description = models.TextField(blank=True, null=True)
    bank_name = models.CharField(max_length=255)
    # Mã BIN 6 số của Napas, dùng dựng VietQR. Bỏ trống thì frontend dò theo
    # `bank_name`; điền vào đây thì khỏi phải đoán.
    bank_bin = models.CharField(max_length=6, blank=True, null=True)
    bank_account_number = models.CharField(max_length=64)
    bank_account_name = models.CharField(max_length=255)
    insurance_fee = models.IntegerField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = "hub_insurance_configs"

