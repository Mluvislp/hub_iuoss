-- Yêu cầu đổi nơi KCB ban đầu: đổi trạng thái sang 3 giai đoạn giống đơn đăng ký BHYT.
--   pending   → iu_processing (ĐHQT xử lý)
--   confirmed → issued        (Phát hành)
--   + waiting_bhxh (Chờ BHXH xử lý) nằm giữa; rejected giữ nguyên.
-- Chỉ cần chạy nếu đã chạy insurance_hospital_change_upgrade.sql bản cũ (mặc định 'pending').
-- Chạy trên database dùng chung TRƯỚC KHI deploy Hub và Dashboard. Chạy lại không sao.
UPDATE hub_insurance_hospital_change_requests SET status = 'iu_processing' WHERE status = 'pending';
UPDATE hub_insurance_hospital_change_requests SET status = 'issued' WHERE status = 'confirmed';
ALTER TABLE hub_insurance_hospital_change_requests ALTER COLUMN status SET DEFAULT 'iu_processing';
