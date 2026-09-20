-- Chỉ chạy nếu external_insurance_upgrade.sql phiên bản cũ đã được chạy.
-- Nếu chưa từng tạo bảng, chỉ cần chạy bản external_insurance_upgrade.sql hiện tại.
ALTER TABLE student_external_health_insurance_declarations
    MODIFY COLUMN participation_place VARCHAR(255) NULL,
    ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'pending' AFTER request_digest,
    ADD COLUMN review_note TEXT NULL AFTER status,
    ADD COLUMN reviewed_by_id BIGINT NULL AFTER review_note,
    ADD COLUMN reviewed_at DATETIME(6) NULL AFTER reviewed_by_id,
    ADD KEY idx_external_status_created (status, created_at);

-- Các dòng do phiên bản cũ tạo đã đồng thời tạo thẻ, nên giữ đúng trạng thái.
UPDATE student_external_health_insurance_declarations
SET status = 'confirmed', reviewed_at = updated_at
WHERE card_id IS NOT NULL;
