"""Kho ảnh cố định (profile) của SV — bảng dùng chung; imported by models.py for Django discovery.

Schema + quy ước: dashboard_iuoss/docs/sql/20261004_student_images.sql.
Ghi qua `core.student_images`, đừng `objects.create` trực tiếp.
"""
from django.db import models


class StudentImage(models.Model):
    SUBJECT_SELF = 'SELF'
    SUBJECT_FATHER = 'FATHER'
    SUBJECT_MOTHER = 'MOTHER'
    SUBJECT_GUARDIAN = 'GUARDIAN'

    id = models.BigAutoField(primary_key=True)
    student = models.ForeignKey('students.Student', on_delete=models.DO_NOTHING,
                                related_name='images')
    kind = models.CharField(max_length=32)
    subject = models.CharField(max_length=16, default=SUBJECT_SELF)
    storage_key = models.CharField(max_length=500)
    original_filename = models.CharField(max_length=255)
    mime_type = models.CharField(max_length=64)
    file_size_bytes = models.BigIntegerField()
    sha256 = models.CharField(max_length=64)
    source = models.CharField(max_length=32)
    # 1 = ảnh đang dùng của ô (kind, subject); 0 = đã bị ảnh mới thay. Xem docs/sql/20261004_student_images.sql.
    is_current = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed = False
        db_table = 'student_images'
        ordering = ['id']

    def __str__(self):
        return f'{self.student_id} {self.kind}/{self.subject} #{self.pk}'
