from rest_framework import serializers
from students.models import (
    Department, DegreeLevel, StudentStatus,
    Student, HealthInsuranceCard, CivicActivity,
    Hospital, VnProvince, VnWard, VnEthnicity,
)
from core.models import ConfirmationRequest, ConfirmationRequestComment, HealthInsuranceRegistration


class DepartmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Department
        fields = ["id", "code", "name_vi"]


class DegreeLevelSerializer(serializers.ModelSerializer):
    class Meta:
        model = DegreeLevel
        fields = ["id", "code", "name"]


class StudentStatusSerializer(serializers.ModelSerializer):
    class Meta:
        model = StudentStatus
        fields = ["id", "code", "name_vi", "status_group"]


class StudentSerializer(serializers.ModelSerializer):
    current_department = DepartmentSerializer(read_only=True)
    current_degree_level = DegreeLevelSerializer(read_only=True)
    current_status = StudentStatusSerializer(read_only=True)

    class Meta:
        model = Student
        fields = [
            "id",
            "current_student_code",
            "full_name",
            "date_of_birth",
            "academic_entry_year",
            "current_department",
            "current_degree_level",
            "current_status",
        ]


class HealthInsuranceCardSerializer(serializers.ModelSerializer):
    registration_type_code = serializers.CharField(source="registration_type.code", read_only=True, default=None)
    # Phẳng hoá diện đăng ký: SV chỉ cần cái tên, không cần cả object danh mục.
    registration_type = serializers.CharField(
        source="registration_type.name", read_only=True, default=None,
    )
    hospital_name = serializers.SerializerMethodField()

    class Meta:
        model = HealthInsuranceCard
        fields = [
            "id",
            "social_insurance_code",
            "medical_insurance_code",
            "hospital_code",
            "hospital_name",
            "registration_type",
            "registration_type_code",
            "registration_year",
            "valid_from",
            "valid_until",
            "is_current",
        ]

    def get_hospital_name(self, obj):
        """Tên cơ sở KCB tra từ danh mục `hospitals` (không FK).

        View nạp sẵn map {code: name} vào context để tránh N+1. Thiếu context
        hoặc mã không có trong danh mục → None; frontend hiển thị mã thô.
        """
        if not obj.hospital_code:
            return None
        return (self.context.get("hospital_names") or {}).get(obj.hospital_code)


class CivicActivitySerializer(serializers.ModelSerializer):
    class Meta:
        model = CivicActivity
        fields = [
            "id", "activity_code", "attempt_no",
            "result_value", "completed_at",
        ]


class RequestCommentSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConfirmationRequestComment
        fields = ["id", "author_role", "author_name", "body", "event", "created_at"]
        read_only_fields = fields


class ConfirmationRequestSerializer(serializers.ModelSerializer):
    """Dữ liệu yêu cầu trả cho sinh viên.

    `staff_note` CỐ Ý không có ở đây: Dashboard ghi nhãn ô đó là "ghi chú nội bộ"
    nhưng trước 2026-09 nó vẫn được trả ra và Hub hiện thẳng cho sinh viên. Kênh
    nói với sinh viên nay là `comments`.
    """

    comment_count = serializers.SerializerMethodField()
    student_can_comment = serializers.BooleanField(read_only=True)

    class Meta:
        model = ConfirmationRequest
        fields = [
            "id", "request_type", "purpose", "note", "payload",
            "status", "portal_code", "comment_count", "student_can_comment",
            "created_at", "updated_at",
        ]
        read_only_fields = fields

    def get_comment_count(self, obj):
        # Đã prefetch ở view danh sách nên không sinh thêm query mỗi dòng.
        return len(obj.comments.all())


class ConfirmationRequestDetailSerializer(ConfirmationRequestSerializer):
    comments = RequestCommentSerializer(many=True, read_only=True)

    class Meta(ConfirmationRequestSerializer.Meta):
        fields = ConfirmationRequestSerializer.Meta.fields + ["comments"]
        read_only_fields = fields


class InsuranceRegistrationSerializer(serializers.Serializer):
    """Serializer kiêm validator cho form đăng ký BHYT (v2 — normalized).

    Frontend gửi multipart/form-data gồm:
    - Thông tin đợt: registration_year, registration_period
    - Thông tin cá nhân (để diff): full_name, student_code, gender, dob,
      ethnicity, phone_number, social_insurance_number, citizen_id,
      permanent_*, temporary_*
    - Bệnh viện KCB: hospital_code
    - Bốn ảnh bắt buộc: hai mặt CCCD, thẻ BHYT cũ và biên lai thanh toán.
    """

    registration_year = serializers.IntegerField(
        error_messages={"invalid": "Năm đăng ký không hợp lệ."}
    )
    registration_period = serializers.ChoiceField(
        choices=HealthInsuranceRegistration.PERIOD_CHOICES,
        error_messages={"invalid_choice": "Đợt đăng ký không hợp lệ."},
    )
    full_name = serializers.CharField(max_length=255, error_messages={
        "blank": "Vui lòng nhập họ tên.", "required": "Vui lòng nhập họ tên.",
    })
    student_code = serializers.CharField(max_length=64, error_messages={
        "blank": "Vui lòng nhập MSSV.", "required": "Vui lòng nhập MSSV.",
    })
    gender = serializers.ChoiceField(
        choices=[("Nam", "Nam"), ("Nữ", "Nữ")],
        error_messages={"invalid_choice": "Giới tính không hợp lệ."},
    )
    dob = serializers.DateField(error_messages={
        "invalid": "Ngày sinh không hợp lệ (yyyy-mm-dd).",
        "required": "Vui lòng nhập ngày sinh.",
    })
    ethnicity = serializers.CharField(max_length=255, error_messages={
        "blank": "Vui lòng chọn dân tộc.", "required": "Vui lòng chọn dân tộc.",
    })
    phone_number = serializers.CharField(max_length=32, error_messages={
        "blank": "Vui lòng nhập số điện thoại.",
        "required": "Vui lòng nhập số điện thoại.",
    })
    social_insurance_number = serializers.CharField(
        max_length=32, required=False, allow_blank=True,
    )
    citizen_id = serializers.CharField(max_length=32, error_messages={
        "blank": "Vui lòng nhập số CCCD.",
        "required": "Vui lòng nhập số CCCD.",
    })
    permanent_province = serializers.CharField(max_length=2)
    permanent_ward = serializers.CharField(max_length=5)
    permanent_street = serializers.CharField(max_length=255)
    hospital_code = serializers.CharField(max_length=16, error_messages={
        "blank": "Vui lòng chọn bệnh viện KCB ban đầu.",
        "required": "Vui lòng chọn bệnh viện KCB ban đầu.",
    })
    cccd_image = serializers.FileField(required=True, error_messages={
        "required": "Vui lòng đính kèm ảnh CCCD mặt trước.",
        "null": "Vui lòng đính kèm ảnh CCCD mặt trước.",
        "invalid": "Vui lòng đính kèm ảnh CCCD mặt trước.",
    })
    cccd_image_back = serializers.FileField(required=True, error_messages={
        "required": "Vui lòng đính kèm ảnh CCCD mặt sau.",
        "null": "Vui lòng đính kèm ảnh CCCD mặt sau.",
        "invalid": "Vui lòng đính kèm ảnh CCCD mặt sau.",
    })
    bhyt_image = serializers.FileField(required=True, error_messages={
        "required": "Vui lòng đính kèm ảnh thẻ BHYT.",
        "null": "Vui lòng đính kèm ảnh thẻ BHYT.",
        "invalid": "Vui lòng đính kèm ảnh thẻ BHYT.",
    })
    # Chuỗi thô đọc từ mã QR trên ảnh CCCD, do trình duyệt giải mã. Trình duyệt
    # thử cả hai mặt (CCCD gắn chip in ở mặt trước, thẻ Căn cước mẫu mới in ở
    # mặt sau). Không bắt buộc: ảnh mờ thì vẫn phải nộp đơn được.
    cccd_qr_raw = serializers.CharField(
        required=False, allow_blank=True, max_length=512, trim_whitespace=True,
    )
    payment_receipt_image = serializers.FileField(required=True, error_messages={
        "required": "Vui lòng đính kèm ảnh biên lai thanh toán.",
        "null": "Vui lòng đính kèm ảnh biên lai thanh toán.",
        "invalid": "Vui lòng đính kèm ảnh biên lai thanh toán."
    })
    note = serializers.CharField(required=False, allow_blank=True, max_length=1000)

    def validate_phone_number(self, value):
        import re
        cleaned = re.sub(r"[\s\-\.]", "", value)
        if not re.match(r"^(0|\+84)\d{9,10}$", cleaned):
            raise serializers.ValidationError("Số điện thoại không hợp lệ.")
        return cleaned

    def validate_citizen_id(self, value):
        import re
        cleaned = value.strip()
        if not re.match(r"^\d{9,12}$", cleaned):
            raise serializers.ValidationError("Số CCCD phải từ 9 đến 12 chữ số.")
        return cleaned

    def validate_hospital_code(self, value):
        if not Hospital.objects.filter(code=value, is_active=True).exists():
            raise serializers.ValidationError("Mã bệnh viện không hợp lệ.")
        return value

    def validate_permanent_province(self, value):
        if not VnProvince.objects.filter(code=value, is_active=True).exists():
            raise serializers.ValidationError("Tỉnh/thành thường trú không hợp lệ.")
        return value

    def validate_permanent_ward(self, value):
        if not VnWard.objects.filter(code=value, is_active=True).exists():
            raise serializers.ValidationError("Phường/xã thường trú không hợp lệ.")
        return value

    def validate_ethnicity(self, value):
        if not VnEthnicity.objects.filter(name=value, is_active=True).exists():
            raise serializers.ValidationError("Dân tộc không hợp lệ.")
        return value

    def _validate_file(self, f, label):
        if f is None:
            return f
        from core.insurance_files import inspect_upload, normalized_upload
        from core.insurance_contract import WorkflowError
        try:
            data, ext, mime, _ = inspect_upload(f)
        except WorkflowError as exc:
            raise serializers.ValidationError(str(exc)) from exc
        # Trả về file ĐÃ chuẩn hoá chứ không phải file gốc: FileField lưu nguyên
        # bytes nó nhận được và lấy đuôi từ tên client gửi, nên trả `f` là ảnh
        # HEIC nằm trên đĩa dưới tên .jpg và chuyên viên mở ra thấy ảnh vỡ.
        return normalized_upload(f, data, ext, mime)

    def validate_cccd_image(self, value):
        return self._validate_file(value, "Ảnh CCCD mặt trước")

    def validate_cccd_image_back(self, value):
        return self._validate_file(value, "Ảnh CCCD mặt sau")

    def validate_bhyt_image(self, value):
        return self._validate_file(value, "Ảnh thẻ BHYT")

    def validate_payment_receipt_image(self, value):
        return self._validate_file(value, "Ảnh biên lai thanh toán")
