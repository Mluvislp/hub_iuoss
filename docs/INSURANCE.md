# BHYT — phía Hub

Luật nghiệp vụ, trạng thái, event, bảng, thư từ chối, đợt: `dashboard_iuoss/docs/HEALTH_INSURANCE.md`. File này chỉ
nói phần Hub làm.

## 1. Sinh viên làm được gì

| Trang | API |
|---|---|
| `/dashboard/bao-hiem-y-te` — thẻ + lịch sử | `GET /api/health-insurance/` |
| `…/dang-ky` — đăng ký theo đợt | `POST /api/health-insurance/registrations/` |
| chi tiết đơn, timeline, sửa, bổ sung | `GET/POST …/registrations/<id>/` · ảnh `…/<id>/images/<field>/` · minh chứng `…/<id>/evidence/<eid>/` |
| `…/khai-noi-khac` | `GET/POST /api/health-insurance/external/` + `<id>/` + `<id>/images/<field>/` |
| `…/doi-noi-kcb` | `GET/POST /api/health-insurance/hospital-change/` + `<id>/` + `<id>/images/<field>/` |

- **Nộp mới**: `request_key` bắt buộc; khoá SV và **chặn thêm đơn cùng SV/năm/đợt**, kể cả khi đơn cũ `rejected`.
- **Sửa** (`action=edit`, `request_key`, `row_version`) cập nhật **chính dòng đó** (ID, chủ, năm, đợt, `created_at`,
  trạng thái giữ nguyên). **Mỗi hồ sơ sửa thông thường một lần** trong đợt mở (mốc từ event `STUDENT_UPDATED`); không
  có diff ⇒ từ chối "Sinh viên không có chỉnh sửa". Sửa không đổi trạng thái. Hạn kiểm ở backend
  (`core/insurance_editing.py`), chỉ dùng cấu hình hiện hành nếu khớp **cả năm lẫn đợt**.
- **Bổ sung / gửi lại sau từ chối** (`action=resubmit`, multipart): một transaction, ghi `supplement_pending=1` +
  `supplemented_at` cùng event `RESUBMITTED` ⇒ Dashboard có tab "SV đã bổ sung"; cờ chỉ xoá khi staff xử lý tiếp hoặc
  bấm "Đã kiểm tra bổ sung".
- Cả 4 ảnh (kể cả CCCD 2 mặt) thay được khi sửa và gửi lại. Không tải ảnh mới ⇒ giữ ảnh cũ; ảnh cũ không xoá (đường
  dẫn còn trong diff event). Lỗi validate ⇒ cuộn tới ô lỗi đầu tiên (`permanent_*` → `permanent.*`).
- **Khai nơi khác**: mở theo **đợt khai nơi khác** — bảng riêng `hub_insurance_external_configs` (4 slot, Dashboard quản
  lý), độc lập với đợt đăng ký nên hết đợt đăng ký SV vẫn khai được. Sửa / gửi lại cập nhật chính bản khai (không
  snapshot thay thế); `intake_year`/`intake_period` lưu riêng với năm thẻ — **không suy từ hạn thẻ**. Có bảng event riêng
  `hub_external_insurance_events`.
- **Đổi nơi KCB** (`core/api/hospital_change_views.py`): form đăng ký ở `mode="hospital-change"`, chỉ mở chọn BV; POST
  chỉ nhận `hospital_code`, server tự chép phần còn lại.
- **Cột `note`** (≤ 1.000 ký tự, ô cuối thẻ Thông tin cá nhân của form đăng ký): sửa được như trường khác
  (`insurance_editing.FIELDS`).
- **`freshman_warning`**: SV có `academic_entry_year` = năm hiện tại thấy popup (`components/freshman-warning-modal.tsx`)
  khi mở form, phải bấm xác nhận.
- **Học viên cao học** (`is_graduate`): đăng ký tại trường xét hạn bằng `graduate_closes_at` qua
  `insurance_editing.closes_at` (mở form, nộp, `status`/`end_date`, cửa sổ sửa); đợt khai nơi khác có cột
  `graduate_closes_at` riêng (`api/external_insurance_views.py::closes_at`).
- Xem minh chứng / ảnh: JWT + kiểm sở hữu, frontend tải blob qua header `Authorization` (không đưa token vào URL).
- Detail API trả `config` hiện hành của đúng năm + đợt; slot đã chuyển năm thì trả `config_snapshot`.

## 2. Lịch đợt

Backend đọc `hub_insurance_configs` (4 slot) và kiểm cờ bật + khung giờ ở **cả GET form lẫn POST**. Frontend
`lib/insurance-periods.ts` chỉ là type + hiển thị (đợt đang mở + kế tiếp). Phí và tài khoản nhận tiền sửa ở trang quản lý
đợt của Dashboard (hoặc SQL); Hub không có UI sửa.

## 3. Lưu ảnh — chốt bảo mật

- File mới dưới `MEDIA_ROOT/insurance_private/` (khai nơi khác: `insurance_private/external`); ảnh legacy ở `insurance_data/`.
- CCCD 2 mặt + thẻ BHYT còn được lưu vào kho `student_images` (`dashboard_iuoss/docs/ARCHITECTURE.md` §10); cột
  `cccd_image`/`cccd_image_back`/`bhyt_image` + JSON `images` của đơn vẫn ghi **cùng storage_key** (bản ghi lúc nộp).
  Đơn cũ: `manage.py backfill_student_images` (mặc định chỉ xem trước).
- SHA-256 + MIME **xác minh từ nội dung**; nhận JPEG/PNG/WebP/HEIC (`pillow-heif`); mỗi ảnh ≤ **5 MB**
  (`insurance_files.MAX_BYTES`); bổ sung minh chứng **tối đa 1 ảnh mỗi lần gửi** (`insurance_workflow.supplement`).

## 4. File song sinh với Dashboard

`core/insurance_contract.py` (**giống hệt**) · `core/insurance_history.py` (giống hệt trừ chú thích) · `core/insurance_history_models.py`
(cố ý khác tên model FK). Sửa contract ⇒ chạy test **cả hai** app.

## 5. SQL trong `docs/`

Chạy **thủ công, trước khi deploy code**; DB dùng chung nên chạy **một lần** cho mỗi DB. Kiểm đã chạy chưa bằng
`SHOW COLUMNS` / `SHOW TABLES` trên DB đó.

| File | Việc |
|---|---|
| `insurance_config_upgrade.sql` | dựng 4 slot — **có `DELETE`, đừng chạy lại** |
| `insurance_card_bank_upgrade.sql` | cột ngân hàng trên thẻ/cấu hình |
| `insurance_workflow_{preflight,upgrade,production,verify}.sql` | schema workflow v2 (preflight/verify chỉ đọc) |
| `insurance_status_hotfix.sql` | vá trạng thái |
| `external_insurance_upgrade.sql` · `_review_upgrade.sql` · `_validity_fix.sql` | bảng khai nơi khác (review dùng **thay** file tạo nếu bảng đã có) |
| `insurance_external_config_upgrade.sql` | bảng đợt khai nơi khác riêng + seed từ `hub_insurance_configs` |
| `insurance_edit_{preflight,upgrade,verify}.sql` | sửa tại chỗ + hàng đợi bổ sung + cột `intake_*` (backfill chỉ ánh xạ khi khớp **đúng một** cấu hình) |
| `insurance_freshman_warning_upgrade.sql` · `insurance_graduate_deadline_upgrade.sql` · `insurance_hospital_lookup_url_upgrade.sql` | cột cấu hình đợt |
| `insurance_hospital_change_upgrade.sql` (+ `_status_`, `_card_source_`) · `insurance_doi_noi_kcb_production.sql` (gộp cả nhánh) | đổi nơi KCB |

`.gitignore` chặn `*.sql` và **whitelist từng file** — thêm SQL mới phải thêm `!docs/<tên>.sql`. `schema.sql` cho cài
mới, không thay SQL upgrade. Cùng nội dung bảng đợt khai nơi khác còn có bản `dashboard_iuoss/docs/sql/20261113_external_insurance_config.sql`.

## 6. Backfill đơn cũ

```bash
python manage.py backfill_insurance_workflow --after-id 0 --batch-size 200                          # xem trước
python manage.py backfill_insurance_workflow --apply --database-name <DB> --after-id 0 --batch-size 200
```

Lặp với `checkpoint` làm `--after-id` tới `processed=0`; chạy lại được. Tạo đúng một event `LEGACY_IMPORTED` — **không
dựng lịch sử giả**. `--map-statuses` là opt-in riêng.

## 7. Cờ & rollback

`INSURANCE_WORKFLOW_V2` (mặc định bật; `0` ở **cả hai app** để khoá mutation) · `INSURANCE_PRIORITY_TYPE_CODE` (prod
trống ⇒ không đánh dấu diện ưu tiên). Rollback: tắt cờ cả hai app trước; **không drop bảng/cột mới**, không tự đổi
`waiting_bhxh` về trạng thái cũ.

## 8. Kiểm thử

```bash
cd backend
python manage.py test core.test_insurance_workflow core.test_external_insurance core.test_insurance_editing \
  --settings=config.insurance_test_settings --noinput          # MySQL: insurance_mysql_test_settings + INSURANCE_TEST_*
cd ../frontend && npx tsc --noEmit && node scripts/test-insurance-periods.cjs && node scripts/test-insurance-editing.cjs
```

Test runner chỉ tạo schema unmanaged trong DB test (tiền tố `test_insurance_`) — đừng trỏ vào `DB_*` của app.
