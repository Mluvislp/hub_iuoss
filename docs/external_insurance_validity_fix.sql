-- Chạy một lần nếu đã có thẻ BHYT ngoài trường bị suy valid_from về đầu năm.
-- Chỉ sửa thẻ được tạo từ một khai báo ngoài trường đã xác nhận và có card_id.
-- Ngày trong snapshot là giá trị nguyên gốc sinh viên gửi; nếu snapshot cũ thiếu
-- ngày thì giữ ngày ở cột của khai báo làm phương án dự phòng.

START TRANSACTION;

UPDATE student_health_insurance_cards AS card
JOIN student_external_health_insurance_declarations AS declaration
  ON declaration.card_id = card.id
 AND declaration.status = 'confirmed'
SET
  card.valid_from = COALESCE(
    STR_TO_DATE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(declaration.snapshot, '$.valid_from')), ''), '%Y-%m-%d'),
    declaration.valid_from
  ),
  card.valid_until = COALESCE(
    STR_TO_DATE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(declaration.snapshot, '$.valid_until')), ''), '%Y-%m-%d'),
    declaration.valid_until
  ),
  card.registration_year = YEAR(COALESCE(
    STR_TO_DATE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(declaration.snapshot, '$.valid_from')), ''), '%Y-%m-%d'),
    declaration.valid_from
  )),
  card.updated_at = CURRENT_TIMESTAMP(6)
WHERE
  card.valid_from <> COALESCE(
    STR_TO_DATE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(declaration.snapshot, '$.valid_from')), ''), '%Y-%m-%d'),
    declaration.valid_from
  )
  OR card.valid_until <> COALESCE(
    STR_TO_DATE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(declaration.snapshot, '$.valid_until')), ''), '%Y-%m-%d'),
    declaration.valid_until
  );

COMMIT;
