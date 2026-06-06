-- IUOSS Hub — schema SQL
-- Chạy trên database iuoss_student_data (cùng DB với dashboard)
-- Tất cả bảng hub_ để tránh xung đột với schema hiện có

-- Bảng lưu thông tin đăng nhập student hub
CREATE TABLE IF NOT EXISTS `hub_students` (
  `id`             BIGINT       NOT NULL AUTO_INCREMENT,
  `ldap_uid`       VARCHAR(64)  NOT NULL,
  `student_id`     BIGINT       NULL,          -- soft ref → students.id
  `last_login_at`  DATETIME(6)  NULL,
  `login_count`    INT          NOT NULL DEFAULT 0,
  `created_at`     DATETIME(6)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_hub_students_uid` (`ldap_uid`),
  KEY `idx_hub_student_id` (`student_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bảng session cho hub (tách biệt với dashboard sessions)
-- Django tự tạo bảng này khi chạy: python manage.py migrate
-- (django.contrib.sessions dùng migration riêng, không bị tắt bởi MIGRATION_MODULES)
