"""Sự kiện cộng tác viên — bảng dùng chung với Dashboard; imported by models.py for Django discovery.

Schema: dashboard_iuoss/docs/sql/20261124_volunteer_events.sql. Bản đối ứng: dashboard_iuoss/volunteers/models.py
(Dashboard có thêm bảng staff) — đổi cột phải sửa cả hai. Nghiệp vụ: dashboard_iuoss/docs/VOLUNTEER_EVENTS.md.
Hub chỉ ĐỌC 3 bảng sự kiện / đối tượng; GHI `volunteer_registrations` (SV đăng ký, sửa, hủy).
"""
from django.db import models

from students.models import Student


class VolunteerEvent(models.Model):
    MODE_ALL, MODE_LIST = 'all', 'list'

    id = models.BigAutoField(primary_key=True)
    title = models.CharField(max_length=255)
    description = models.TextField(null=True, blank=True)
    cover_image_key = models.CharField(max_length=255, null=True, blank=True)
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField()
    location = models.CharField(max_length=255, null=True, blank=True)
    audience_mode = models.CharField(max_length=8, null=True, blank=True)
    capacity = models.PositiveSmallIntegerField(null=True, blank=True)
    registration_opens_at = models.DateTimeField(null=True, blank=True)
    registration_closes_at = models.DateTimeField(null=True, blank=True)
    form_schema = models.JSONField(null=True, blank=True)
    published_at = models.DateTimeField(null=True, blank=True)
    created_by_id = models.IntegerField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = 'volunteer_events'


class VolunteerEventStudent(models.Model):
    id = models.BigAutoField(primary_key=True)
    event = models.ForeignKey(VolunteerEvent, on_delete=models.DO_NOTHING, related_name='audience')
    student = models.ForeignKey(Student, on_delete=models.DO_NOTHING, related_name='+')
    student_code = models.CharField(max_length=64)
    source = models.CharField(max_length=8)
    added_by_id = models.IntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed = False
        db_table = 'volunteer_event_students'


class VolunteerRegistration(models.Model):
    PENDING, APPROVED, WAITLIST, REJECTED, CANCELLED = 'pending', 'approved', 'waitlist', 'rejected', 'cancelled'
    # Cùng nhãn Dashboard (volunteers/models.py) — SV và staff đọc cùng một chữ.
    STATUS_LABELS = {
        PENDING: 'Chờ duyệt', APPROVED: 'Được chọn', WAITLIST: 'Danh sách chờ',
        REJECTED: 'Không được chọn', CANCELLED: 'Đã hủy',
    }

    id = models.BigAutoField(primary_key=True)
    event = models.ForeignKey(VolunteerEvent, on_delete=models.DO_NOTHING, related_name='registrations')
    student = models.ForeignKey(Student, on_delete=models.DO_NOTHING, related_name='+')
    student_code = models.CharField(max_length=64)
    status = models.CharField(max_length=12, default=PENDING)
    answers = models.JSONField(default=dict)
    review_note = models.CharField(max_length=500, null=True, blank=True)
    reviewed_by_id = models.IntegerField(null=True, blank=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    submitted_at = models.DateTimeField()
    cancelled_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = 'volunteer_registrations'
