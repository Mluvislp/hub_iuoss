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
            "class_code",
            "current_department",
            "current_degree_level",
            "current_status",
        ]


class HealthInsuranceCardSerializer(serializers.ModelSerializer):
    class Meta:
        model = HealthInsuranceCard
        fields = ["medical_insurance_code", "hospital_code", "valid_until", "is_current"]


class CivicActivitySerializer(serializers.ModelSerializer):
    class Meta:
        model = CivicActivity
        fields = [
            "id", "activity_code", "attempt_no",
            "result_value", "completed_at", "source_column",
        ]


class ConfirmationRequestSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConfirmationRequest
        fields = [
            "id", "request_type", "purpose", "note",
            "status", "staff_note", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "status", "staff_note", "created_at", "updated_at"]
