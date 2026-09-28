# Chỉnh sửa BHYT và hàng đợi bổ sung — 25/09/2026

## Kiến trúc và hành vi

Hub (Django/DRF + Next.js) và Dashboard (Django + DataTables) dùng chung MySQL và
đường dẫn ảnh, không gọi API của nhau. Các model vẫn `managed=False`; nâng cấp bằng
SQL thủ công, không dùng `makemigrations`.

- Đăng ký tại trường: POST chi tiết với `action=edit`, `request_key`, `row_version`
  cập nhật chính `hub_insurance_registrations`. ID, chủ sở hữu, MSSV đã lưu, năm,
  đợt, `created_at`, trạng thái và phản hồi từ chối được giữ nguyên.
- Bản khai ngoài trường: POST `/health-insurance/external/<id>/` cập nhật chính
  `student_external_health_insurance_declarations`. POST collection chỉ tạo mới
  trong thời gian mở và khi chưa có bản khai cùng sinh viên/năm tiếp nhận/đợt.
- Form chỉnh sửa lấy dữ liệu đã nộp từ detail API. Hồ sơ sinh viên chỉ được đọc để
  cập nhật bảng so sánh của staff, không dùng để điền đè đơn. Bảng so sánh cũ được
  giữ trong payload audit khi thay bằng bảng so sánh tại lần lưu mới.
- Hạn được kiểm ở backend. Chỉ dùng cấu hình hiện hành nếu cả năm và mã đợt khớp;
  slot tái sử dụng cho năm khác không mở lại đơn cũ. Snapshot giữ mốc cũ để hiển thị.
  Metadata không xác định được: cho xem, khóa chỉnh sửa thông thường.
- Mỗi hồ sơ chỉ được chỉnh sửa thông thường **một lần** trong đợt mở; mốc này lấy
  từ event `STUDENT_UPDATED`, không lấy `row_version`. Request không có diff hoặc
  ảnh mới bị từ chối với thông báo “Sinh viên không có chỉnh sửa”.
- Sửa trong đợt mở không đổi trạng thái. Đơn tại trường bị từ chối tiếp tục dùng
  workflow bổ sung có sẵn. Bản khai ngoài trường bị từ chối có lối “Gửi lại sau từ
  chối”; ngoài hạn, lưu bản khai bị từ chối là bổ sung và đưa về `pending`.
- Mỗi lần cập nhật tăng phiên bản, cập nhật thời điểm, ghi actor/nguồn Hub và diff.
  Khóa record trong transaction; request lặp cùng khóa/nội dung không ghi lần hai;
  phiên bản cũ trả 409. Staff xử lý bản khai ngoài trường cũng phải gửi phiên bản.
- Trang sửa trên Hub mở hồ sơ đã nộp ở chế độ chỉ xem (4 ảnh đã nộp hiện sẵn, ẩn QR
  và thông tin chuyển khoản); sinh viên bấm "Chỉnh sửa" mới mở khóa các ô.
- Cả 4 ảnh, kể cả CCCD hai mặt, đều thay được khi sửa (`action=edit`) và khi gửi
  lại sau từ chối (`action=resubmit`). Bỏ khóa CCCD ngày 28/09/2026. Ảnh cũ không
  bị xóa, đường dẫn cũ còn trong diff của event.
- Gửi form mà frontend validation (zod) hoặc backend (400) báo lỗi thì trang cuộn tới
  ô lỗi đầu tiên. Lỗi theo trường của DRF được gắn vào đúng ô
  (`permanent_*` → `permanent.*`). Không có lỗi theo ô thì cuộn tới thông báo lỗi chung.
- `config` trong detail API đơn tại trường lấy cấu hình **hiện hành** của đúng
  năm + đợt của đơn (mô tả đi theo bản Phòng CTSV đang sửa); slot đã chuyển sang năm
  khác thì trả lại `config_snapshot` lúc nộp.
- Không tải ảnh mới thì giữ ảnh cũ; ảnh mới lưu trước khi đổi đường dẫn, rollback
  chỉ dọn file mới của request. Ảnh cũ không bị xóa. Endpoint ảnh kiểm tra quyền.
- Dashboard đọc record hiện hành. Export tại trường đọc theo lô 500, tra địa danh/
  bệnh viện theo lô, không dùng giá trị lịch sử. Export ngoài trường đọc snapshot
  hiện hành của chính bản khai, không đọc event. Cả hai xuất liên kết ảnh hiện hành.

## Schema bổ sung

| Bảng | Bổ sung |
|---|---|
| `hub_insurance_registrations` | `note`, `supplement_pending` mặc định 0, `supplemented_at`, `supplement_reviewed_at` nullable |
| `student_external_health_insurance_declarations` | `intake_year`, `intake_period`, `intake_snapshot` nullable; `row_version` mặc định 0; ba cột bổ sung như trên |
| `hub_external_insurance_events` | event type, actor, nguồn, request key, JSON diff và thời điểm; unique `(declaration_id,request_key)` |
| `hub_insurance_configs` | `freshman_warning` nullable; chỉ hiện khi năm nhập học trùng năm hưởng BHYT |

`registration_year` có sẵn trên bản khai ngoài trường giữ nguyên ý nghĩa và giá trị
năm thẻ. Năm tiếp nhận nằm ở `intake_year`, tuyệt đối không suy từ hạn thẻ.

Hai bảng chính có index `(supplement_pending,supplemented_at,id)` phục vụ hàng đợi.
Bản khai có thêm index `(student_id,intake_year,intake_period)`, event có index timeline.
Các model đối ứng trong hai repo đã bổ sung cùng cột.

## Backfill và triển khai

SQL chính thức nằm trong repo Hub, chạy **một lần cho database dùng chung**, không
chạy riêng lần nữa chỉ vì deploy Dashboard. SQL có thể chạy lại an toàn.

1. Sao lưu database và ảnh. Tạm dừng mutation BHYT của cả hai ứng dụng khi nâng cấp.
   Xác nhận schema workflow v2 và bản khai ngoài trường hiện hành đã tồn tại.
2. Chạy [insurance_edit_preflight.sql](insurance_edit_preflight.sql), lưu kết quả số
   dòng/min/max ID và báo cáo số cấu hình khớp. Kiểm tra timestamp DB theo UTC như
   cấu hình `USE_TZ` của Django; SQL chụp thời gian dạng UTC.
3. Chạy [insurance_edit_upgrade.sql](insurance_edit_upgrade.sql). Chỉ thêm cột/bảng/
   index; không xóa hoặc tái tạo bảng đăng ký. DDL MySQL có implicit commit nên
   phải theo dõi hết kết quả, không dùng `--force` để bỏ qua lỗi.
4. Backfill chỉ ánh xạ khi `created_at BETWEEN registration_opens_at AND
   registration_closes_at` khớp **đúng một** cấu hình. Không đổi ID, `created_at`,
   `updated_at`, trạng thái, snapshot nội dung, ảnh hoặc năm thẻ.
5. Chạy [insurance_edit_verify.sql](insurance_edit_verify.sql). Đối chiếu số dòng và
   ID với preflight. Các dòng chưa ánh xạ hoặc trùng sinh viên/năm tiếp nhận/đợt
   được báo cáo; không gộp, xóa, hoặc tự đoán. Nếu thời gian cấu hình đã bị sửa
   khiến không thể xác định chắc chắn, cần đối chiếu nguồn lịch sử trước khi gán.
6. Deploy cả hai backend rồi frontend; smoke-test bằng một record cũ đã ánh xạ.
   Mở lại mutation sau khi kiểm tra detail/edit/export và hàng đợi trên staging.

`schema.sql` mô tả định nghĩa mới cho cài đặt mới; không thay cho SQL upgrade đối
với database đang có dữ liệu. Không chạy lại `insurance_config_upgrade.sql` cũ.

Rollback code không được drop cột/bảng mới. Giữ dữ liệu và ảnh; dừng mutation nếu
rollback Hub cũ, vì Hub cũ chưa thực thi giới hạn thời gian mới cho bản khai ngoài trường.

## Hàng đợi “SV đã bổ sung”

Hub ghi `supplement_pending=1` và `supplemented_at` trong cùng transaction với
`RESUBMITTED`. Sửa thông thường trong thời gian mở không tạo cảnh báo này.

Dashboard lọc/đếm trên bảng chính, không đọc timeline của toàn danh sách. Tab ưu
tiên thời điểm bổ sung mới nhất. GET detail không cập nhật cờ. Thao tác xử lý tiếp
theo hoặc “Đã kiểm tra bổ sung” mới xóa cờ, ghi thời điểm, tăng phiên bản và ghi
event có actor staff; các endpoint yêu cầu quyền BHYT-change.

Upgrade cũng dựng cờ cho các event `RESUBMITTED` của Hub đã có trước khi nâng cấp
mà chưa có event Dashboard phía sau. Chạy lại không bật lại cờ đã xác nhận.

## Kiểm thử đã chạy

- Hub: **49/49 test MySQL 8.0.44 đạt** (`test_insurance_workflow`,
  `test_external_insurance`, `test_insurance_editing`). Có hai cuộc đua request thật
  trên hai connection cho đăng ký và bản khai: một thành công, một 409.
- Hub SQLite trước khi thêm hai test concurrency: **47/47 đạt**.
- Dashboard MySQL: **30/30 đạt** (`test_insurance_editing`,
  `test_external_insurance`, `test_insurance_email`, `insurance_mysql_checks`).
- Dashboard SQLite bộ rộng: **65/67 đạt**, gồm kiểm tra endpoint Dashboard đọc đúng
  đường dẫn ảnh vừa được thay trong record chung. Hai test sẵn có thất bại là
  `test_other_type_preserves_records_across_years` và
  `test_priority_keeps_medical_code_but_never_copies_coverage_or_social_code`.
  Cả hai cũng thất bại khi nạp service nguyên gốc từ `git show HEAD`, trước thay
  đổi của tính năng này. Không thay workflow phát hành thẻ để làm xanh hai test.
- SQL: script `backend/scripts/verify_insurance_edit_sql.py` đã chạy preflight,
  upgrade, verify và chạy lại upgrade trên database MySQL giả lập riêng. Đã kiểm
  tra ánh xạ duy nhất, mơ hồ, không khớp, bảo toàn dữ liệu, và hàng đợi legacy.
- Frontend: `npx tsc --noEmit`, 9 tình huống lịch đợt và 6 tình huống render chi tiết
  đều đạt. `scripts/test-insurance-ui.cjs` của Dashboard kiểm tra bốn thao tác gửi
  đúng phiên bản; các script từ HTML Django đã render được kiểm tra cú pháp bằng Node.
- Test kiểm tra query count danh sách, giá trị export hiện hành, quyền sở hữu,
  giữ/thay ảnh, rollback file, trạng thái không đổi khi sửa, retry, hết hạn,
  bổ sung sau từ chối và xác nhận bổ sung có lưu database.

Lệnh chuẩn:

```sh
# Hub/backend
python manage.py test core.test_insurance_workflow core.test_external_insurance core.test_insurance_editing --settings=config.insurance_test_settings --noinput
# Thay settings bằng config.insurance_mysql_test_settings và cung cấp INSURANCE_TEST_*
# để chạy trên MySQL test riêng; không dùng biến DB_* của ứng dụng.

# Dashboard
python manage.py test students.test_insurance_editing students.test_external_insurance students.test_insurance_email students.insurance_mysql_checks --settings=config.insurance_mysql_test_settings --noinput
node scripts/test-insurance-ui.cjs

# Hub/frontend
npx tsc --noEmit
node scripts/test-insurance-periods.cjs
node scripts/test-insurance-editing.cjs
```

Chưa chạy SQL trên database hiện có hoặc production. Cần xem báo cáo ánh xạ dữ liệu
thật và kiểm tra trên staging trước khi triển khai. Môi trường test là MySQL cục bộ
riêng, chỉ dùng dữ liệu giả lập; không gửi email thật.

## File thay đổi

Hub:

- `backend/core/insurance_editing.py`; `insurance_workflow.py`; `insurance_history.py`;
  `insurance_contract.py`; `models.py`; `external_insurance_models.py`.
- `backend/core/api/insurance_views.py`; `external_insurance_views.py`; `views.py`;
  `serializers.py`; `urls.py`.
- `frontend/components/insurance-registration-form.tsx`; `insurance-supplement.tsx`;
  `submitted-insurance-info.tsx`; `frontend/app/(dashboard)/dashboard/bao-hiem-y-te/page.tsx`;
  `frontend/lib/api.ts`; `frontend/lib/types.ts`.
- `backend/core/test_insurance_editing.py`; `test_external_insurance.py`;
  `backend/scripts/verify_insurance_edit_sql.py`; `frontend/scripts/test-insurance-editing.cjs`.
- `.gitignore`; `docs/schema.sql`; ba SQL `insurance_edit_*`; `docs/INSURANCE.md`;
  tài liệu này.

Dashboard:

- `students/models.py`; `external_insurance_models.py`; `insurance_contract.py`;
  `insurance_history.py`; `insurance_workflow.py`; `bhyt_registration_service.py`;
  `external_insurance_views.py`; `views.py`; `urls.py`.
- `students/templates/students/bhyt_registration/list.html`; `_workflow.js.html`;
  `students/templates/students/external_insurance/list.html`; `detail.html`.
- `students/test_insurance_editing.py`; `test_external_insurance.py`;
  `test_insurance_email.py`; `scripts/test-insurance-ui.cjs`; `docs/HEALTH_INSURANCE.md`.

Thay đổi có sẵn của người dùng trong `Hub/backend/core/auth.py` được giữ nguyên.
