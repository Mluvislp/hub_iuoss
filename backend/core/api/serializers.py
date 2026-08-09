from rest_framework import serializers
from students.models import (
    Department, DegreeLevel, StudentStatus,
    Student, HealthInsuranceCard, CivicActivity,
)
from core.models import ConfirmationRequest


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


class ConfirmationRequestSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConfirmationRequest
        fields = [
            "id", "request_type", "purpose", "note", "payload",
            "status", "staff_note", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "status", "staff_note", "payload", "created_at", "updated_at"]
