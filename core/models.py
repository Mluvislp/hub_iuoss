from django.db import models


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

    ldap_uid = models.CharField(max_length=64, unique=True)
    student_id = models.BigIntegerField(null=True, blank=True)  # soft ref → students.id
    last_login_at = models.DateTimeField(null=True, blank=True)
    login_count = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed = False
        db_table = "hub_students"

    def __str__(self):
        return self.ldap_uid
