# BHYT — phía Hub

> **Trạng thái: đã chạy thật trên production** (205 đơn / 205 event, đo 23/09/2026).
> Tài liệu này từng là ba file bàn giao viết ở thì "chưa deploy"
> (`INSURANCE_WORKFLOW_V2.md`, `INSURANCE_WORKFLOW_FILES.md`, `external_insurance.md`);
> gộp và cập nhật theo hiện trạng ngày 23/09/2026.
>
> **Luật nghiệp vụ, trạng thái, event, bảng, thư từ chối** mô tả một lần ở
> `dashboard_iuoss/docs/HEALTH_INSURANCE.md`. File này chỉ nói phần Hub làm.

> Cập nhật 25/09/2026: [Chỉnh sửa tại chỗ, hạn khai báo và hàng đợi bổ sung](INSURANCE_EDIT_ROLLOUT.md).
> SQL trong tài liệu mới chưa chạy trên production; cần nâng cấp trước deploy.

## 1. Sinh viên làm được gì

| Trang | API |
|---|---|
| `/dashboard/bao-hiem-y-te` — xem thẻ + lịch sử thẻ | `GET /api/health-insurance/` |
| `/dashboard/bao-hiem-y-te/dang-ky` — đăng ký theo đợt | `POST /api/health-insurance/registrations/` |
| chi tiết đơn + timeline + bổ sung | `GET`/`POST /api/health-insurance/registrations/<id>/` |
| xem minh chứng đã nộp | `GET …/<id>/evidence/<evidence-id>/` |
| `/dashboard/bao-hiem-y-te/khai-noi-khac` — khai BHYT nơi khác | `GET/POST /api/health-insurance/external/` |
| `/dashboard/bao-hiem-y-te/doi-noi-kcb` — yêu cầu đổi nơi KCB ban đầu | `GET/POST /api/health-insurance/hospital-change/` + `<id>/` + `<id>/images/<field>/` |

**Nộp đơn mới:** `request_key` bắt buộc; backend khóa sinh viên và **chặn tạo thêm đơn
cùng SV/năm/đợt**, kể cả khi đơn cũ đang `rejected`.

**Bổ sung và gửi lại** (multipart, cùng URL chi tiết): `request_key` + `row_version` +
`hospital_code`/`province_code` hoặc nhiều file `evidences`. Bổ sung và gửi lại là
**một transaction**. Lịch sử luôn giữ lại ảnh trước đó.

**Xem minh chứng:** xác thực JWT + kiểm tra sở hữu. Frontend tải blob qua header
`Authorization`, **không** đưa token vào URL.

**Khai BHYT nơi khác:** tạo mới và sửa trong cùng thời gian đợt đăng ký BHYT.
Năm/đợt tiếp nhận lưu riêng với năm thẻ. Chỉnh sửa và gửi lại sau từ chối cập nhật
chính bản khai cũ; không tạo snapshot thay thế. Chi tiết triển khai/backfill ở tài liệu trên.

**Ghi chú thông tin BHYT bị sai** (`info_correction_note`, không bắt buộc, ≤1000 ký tự): ô
cuối thẻ Thông tin cá nhân của form đăng ký tại trường, dành cho SV có thẻ BHYT/BHXH lệch hồ
sơ (đổi CCCD, đổi khai sinh, ngày sinh, họ tên…). Lưu khi nộp và sửa được như các trường khác
(`insurance_editing.FIELDS`). Khai ngoài trường không có ô này; yêu cầu đổi nơi KCB chép
nguyên ghi chú của đơn gốc vào snapshot và chỉ hiển thị.

**Đổi nơi KCB ban đầu** (`core/api/hospital_change_views.py`): form đăng ký dùng chung ở
chế độ `mode="hospital-change"` — mọi thông tin lấy từ đơn tại trường mới nhất đã
`waiting_bhxh`/`issued`, khóa hết, chỉ mở chọn bệnh viện. POST chỉ nhận `hospital_code`;
server tự chép phần còn lại. Đợt nhận yêu cầu là bảng riêng
`hub_insurance_hospital_change_configs` (4 slot, staff quản lý trên Dashboard). Nghiệp vụ
duyệt: `dashboard_iuoss/docs/HEALTH_INSURANCE.md` §3b.

**Chỉnh sửa:** mỗi đơn/bản khai chỉ được sửa thông thường một lần. Detail API trả
`edited_at`, `can_edit`, tên tỉnh/phường/bệnh viện và URL ảnh riêng tư để frontend
hiển thị đúng hồ sơ đã nộp. Gửi form không có thay đổi thực tế bị từ chối.

## 2. Lịch đợt nằm ở hai nơi — nhớ kỹ

Backend đọc `hub_insurance_configs` (4 slot `MAIN/Q2/Q3/Q4`) và kiểm lại cờ bật + khung
giờ ở **cả GET form lẫn POST**, nên không truy cập thẳng hay nộp ngoài đợt được.

Frontend còn `lib/insurance-periods.ts` để hiển thị: trang BHYT hiện **đợt đang mở +
đợt kế tiếp**; không có đợt mở thì hiện đợt vừa hết hạn + kế tiếp. Đợt đang mở luôn
hiện hạn cuối.

**Học viên cao học có hạn đóng riêng.** Mỗi slot có cột `graduate_closes_at` (NULL = dùng
chung `registration_closes_at`), staff nhập trên trang quản lý đợt của Dashboard. Với người
`is_graduate` (MASTER/DOCTOR), mọi chỗ xét hạn đều dùng hạn riêng này qua
`core/insurance_editing.py::closes_at` — mở form, nộp đơn, `status`/`end_date` trả về
frontend, cửa sổ sửa đơn (`window`) và khai BHYT nơi khác (`active_config`). Hết hạn riêng là
học viên không nộp và **không sửa đơn** được nữa. Giờ mở, cờ bật, phí, tài khoản và thời hạn
thẻ vẫn dùng chung với sinh viên đại học.

Nếu `academic_entry_year` của sinh viên trùng năm hiện tại (`timezone.localdate().year`), Hub hiển thị
`freshman_warning` của slot trong popup đỏ nhạt cùng tông RejectionNotice (`components/freshman-warning-modal.tsx`,
bottom sheet trên mobile) ngay khi mở form đăng ký; sinh viên phải bấm xác nhận để đóng.

> ⚠️ Mức phí và tài khoản nhận tiền chỉ sửa được bằng **SQL trên
> `hub_insurance_configs`** hoặc trang quản lý đợt của Dashboard — Hub không có UI sửa.
> `hub_insurance_bank_accounts` trên prod đang **0 dòng**.

## 3. File phải giữ đồng bộ với Dashboard

| File Hub | Bản đối ứng |
|---|---|
| `core/insurance_contract.py` | `students/insurance_contract.py` — **hiện giống hệt, phải giữ vậy** |
| `core/insurance_history.py` | `students/insurance_history.py` — chỉ lệch 2 dòng import |
| `core/insurance_history_models.py` | `students/insurance_history_models.py` — cố ý khác tên model FK |

Sửa contract là phải chạy test **cả hai** app.

## 4. Lưu ảnh — chốt bảo mật

- File mới nằm dưới `MEDIA_ROOT/insurance_private/` (khai ngoài trường:
  `insurance_private/external`); ảnh legacy vẫn ở `insurance_data/`.
- **Từ 04/10/2026, CCCD hai mặt + thẻ BHYT** (cả đơn đăng ký lẫn khai ngoài trường, lúc nộp
  và lúc sửa) được lưu vào kho ảnh profile `student_images` (`insurance_private/student_images/…`,
  xem `dashboard_iuoss/docs/ARCHITECTURE.md` §10) để các luồng khác dùng lại. Cột
  `cccd_image`/`cccd_image_back`/`bhyt_image` và JSON `images` của đơn vẫn được ghi **cùng
  storage_key** và là bản ghi lúc nộp của đơn — Dashboard đọc các cột này, không đổi gì.
  Biên lai và minh chứng thanh toán vẫn lưu theo đơn. Ảnh của đơn cũ nạp vào kho bằng
  `manage.py backfill_student_images` (mặc định chỉ xem trước).
- Mỗi file lưu SHA-256 và MIME **xác minh từ nội dung**, không tin đuôi file. Nhận
  JPEG/PNG/WebP và **HEIC của iPhone** (nhờ `Pillow` + `pillow-heif` trong
  `requirements.txt`). Thiếu gói thì HEIC bị từ chối chứ không sập.
- Giới hạn upload **8 file × 5 MB** (+ overhead multipart) — cấu hình giới hạn
  request/proxy cho khớp, đừng nới toàn hệ thống.

## 5. Các file SQL trong `docs/`

Chạy **thủ công, trước khi deploy code**. Đều đã chạy trên prod + sandbox.

| File | Việc |
|---|---|
| `insurance_config_upgrade.sql` | dựng 4 slot cấu hình. **Có `DELETE`** — đừng chạy lại. |
| `insurance_card_bank_upgrade.sql` | cột ngân hàng trên thẻ/cấu hình |
| `insurance_workflow_preflight.sql` | kiểm kê trước khi nâng cấp v2 (chỉ đọc) |
| `insurance_workflow_upgrade.sql` | expand schema v2 — kiểm tra trước khi thêm, chạy lại được |
| `insurance_workflow_production.sql` | bản đã dùng cho prod |
| `insurance_workflow_verify.sql` | đối chiếu sau khi chạy |
| `insurance_status_hotfix.sql` | vá trạng thái |
| `external_insurance_upgrade.sql` | tạo bảng khai ngoài trường |
| `external_insurance_review_upgrade.sql` | dùng **thay** file tạo bảng nếu bảng đã có từ bản trước |
| `external_insurance_validity_fix.sql` | sửa thời hạn |
| `insurance_graduate_deadline_upgrade.sql` | cột `graduate_closes_at` (hạn riêng học viên cao học) — chạy lại được |
| `insurance_info_correction_note_upgrade.sql` | cột `info_correction_note` trên `hub_insurance_registrations` — chạy lại được. **Chưa chạy trên prod/sandbox (07/10/2026).** |
| `insurance_hospital_change_upgrade.sql` | 3 bảng đổi nơi KCB ban đầu + 4 slot đợt (tắt sẵn) — chạy lại được. **Chưa chạy trên prod/sandbox (07/10/2026).** |

`.gitignore` chặn `*.sql` (dump chứa dữ liệu thật) và **whitelist từng file** ở trên —
thêm file SQL mới phải thêm một dòng `!docs/<tên>.sql`, nếu không git bỏ qua im lặng.

## 6. Backfill đơn cũ

```bash
cd backend
python manage.py backfill_insurance_workflow --after-id 0 --batch-size 200
python manage.py backfill_insurance_workflow --apply --database-name <DB> --after-id 0 --batch-size 200
# Ánh xạ trạng thái cũ là opt-in riêng, chỉ chạy sau khi đã rà ý nghĩa:
python manage.py backfill_insurance_workflow --apply --database-name <DB> --map-statuses …
```

Mỗi lần xử lý một batch; lấy `checkpoint` làm `--after-id` lần sau, tới khi
`processed=0`. Chạy lại từ 0 được. Mỗi đơn khóa và commit riêng. Tạo đúng một event
`LEGACY_IMPORTED` ghi trạng thái quan sát được — **không dựng lịch sử giả**; ảnh cũ chỉ
thêm làm evidence nếu file tồn tại và xác minh hợp lệ. Phí legacy giữ `NULL`.

## 7. Cờ và biến môi trường

| Biến | Hiện trạng prod |
|---|---|
| `INSURANCE_WORKFLOW_V2` | **không khai** → mặc định `1` = bật. Đặt `0` ở **cả hai app** chỉ khi cần khóa mutation lúc bảo trì. |
| `INSURANCE_PRIORITY_TYPE_CODE` | **không khai** → rỗng → không đánh dấu diện ưu tiên |
| `HUB_MEDIA_ROOT` (Dashboard) | `/var/www/apps/hub_iuoss/backend/media` |

Rollback: tắt cờ ở cả hai app trước. **Không drop bảng/cột mới**, không tự đổi
`waiting_bhxh` về trạng thái cũ — không có ánh xạ ngược bảo toàn đầy đủ.

## 8. Kiểm thử

```bash
cd backend
python manage.py test --settings=config.insurance_test_settings --noinput      # SQLite
python manage.py test --settings=config.insurance_mysql_test_settings --noinput # MySQL cách ly
cd ../frontend && npx tsc --noEmit
```

Lần chạy gần nhất của tác giả: **26 test Hub pass trên SQLite** (nộp mới, retry,
rollback file, timeline, QR, ownership/path traversal, backfill chạy lại, append-only).
Bộ test Hub trên MySQL **chưa bao giờ chạy được** — lượt thực thi bị từ chối vì hết
quota xét duyệt. Test runner chỉ tạo schema unmanaged trong DB test; MySQL test chỉ
nhận biến `INSURANCE_TEST_*` và tên DB có tiền tố `test_insurance_`. **Đừng dùng test
runner này thay migration, đừng trỏ vào `DB_*` của app.**
