# BHYT workflow v2 — triển khai và bàn giao

## Kiến trúc và phạm vi

Hai ứng dụng trao đổi qua shared database; không gọi API chéo. Model liên quan vẫn `managed=False`. Theo `docs/ECOSYSTEM.md`, môi trường triển khai dùng MySQL 8.4.9/InnoDB. Chưa truy vấn production để xác nhận phiên bản/schema thực tế.

Giữ nguyên `hub_insurance_registrations.id`, các cột ảnh ban đầu, snapshot cấu hình và ý nghĩa `change_log`. Bổ sung `workflow_version`, `row_version`, `fee_amount_vnd`, `rejection_reason_code` và ba bảng phụ:

- `hub_insurance_registration_events`: timeline append-only; số sự kiện tăng theo đơn; request key duy nhất theo đơn.
- `hub_insurance_payment_assessments`: snapshot tổng tiền lũy kế, không cộng các lần đối soát; mỗi event tối đa một assessment.
- `hub_insurance_payment_evidences`: mỗi file một record, gắn event, đường dẫn riêng, SHA-256 và MIME xác minh từ nội dung.

Contract và helper lịch sử có hai bản tương ứng trong `backend/core/` và `students/`: `insurance_contract.py`, `insurance_history.py`, `insurance_history_models.py`. Hai file đầu phải giống nhau; model history khác tên model đăng ký FK. Thay contract phải kiểm thử cả hai ứng dụng.

Các service ghi dữ liệu trong transaction, khóa parent registration; Dashboard khóa sinh viên trước rồi các đơn theo ID để tuần tự hóa phát hành trên cùng sinh viên. Hub khóa sinh viên khi tạo đơn mới. Request key kiểm tra cả fingerprint nội dung, nguồn và actor. Retry thành công được nhận trước khi kiểm tra phiên bản UI. Các thao tác mới bắt buộc `row_version` phù hợp; xung đột trả 409. Bulk tối đa 200 đơn, all-or-nothing, chung `batch_id`.

## State machine

```text
Nộp đơn → iu_processing (ĐHQT xử lý)
iu_processing → waiting_bhxh (Chờ BHXH xử lý) → issued (Phát hành)
iu_processing → rejected (Từ chối)
rejected → bổ sung bệnh viện/minh chứng + RESUBMITTED → iu_processing
rejected → cán bộ tiếp nhận lại + REOPENED → iu_processing
issued → quản trị viên mở lại, bắt buộc lý do + REOPENED → iu_processing
```

Không có đường phát hành trực tiếp từ `iu_processing`. Đối soát lại là event `PAYMENT_ASSESSED`, không tự chuyển trạng thái. Upload không xác nhận tiền. `OTHER`/lý do legacy chưa có code được hướng dẫn liên hệ CTSV, cán bộ có nút tiếp nhận lại.

`UNPAID`: xác nhận 0. `UNDERPAID`: 0 < đã xác nhận < phí. Mọi số tiền là số nguyên không âm, tối đa 15 chữ số. Đơn chưa biết phí yêu cầu cán bộ nhập phí đã xác minh kèm ghi chú căn cứ; backfill không suy mức phí từ ảnh hoặc cấu hình hiện hành.

Phát hành diện trường dùng `DHQT`, năm lấy từ đơn: MAIN 01/01, Q2 01/04, Q3 01/07, Q4 01/10 đến 31/12. Thẻ gắn `source_registration_id`, khóa và cập nhật cùng event/status/AuditLog. Diện ưu tiên không sao chép mã thẻ, bệnh viện, thời hạn hoặc mã BHXH của diện trường; cán bộ cập nhật thông tin phản hồi sau qua chức năng quản lý thẻ hiện có.

## API và giao diện

Dashboard giữ URL danh sách, detail, status, bulk-status, reopen hiện có. POST nhận `request_key`, `reason_code`, `reason`, `issue_type`; single nhận `row_version`, số tiền; bulk nhận `rows` JSON theo ID, chứa phiên bản và số tiền riêng từng đơn. `status` nhận `waiting_bhxh`, `rejected`, `issued`; thao tác riêng `assess`, `reopen` cũng vào cùng service có kiểm tra permission. Người thiếu quyền thay đổi BHYT không được gọi mutation. Mở lại issued chỉ superuser.

`GET /students/bhyt-registrations/<id>/detail/` giữ student, declared, changes, QR CCCD và images ban đầu; thêm timeline, assessment/evidences lồng theo event, fee/version. `GET /students/bhyt-registrations/<id>/evidence/<evidence-id>/` yêu cầu quyền xem BHYT.

Hub:

- `POST /api/health-insurance/registrations/`: nộp mới, request key bắt buộc, khóa sinh viên và chống tạo thêm đơn cùng sinh viên/năm/đợt kể cả đơn rejected.
- `GET /api/health-insurance/registrations/<id>/`: detail/timeline và thông tin thanh toán từ snapshot cùng assessment mới nhất.
- `POST` cùng URL, multipart: `request_key`, `row_version`, `hospital_code` + `province_code` hoặc nhiều file `evidences`. Bổ sung và gửi lại là một transaction.
- `GET /api/health-insurance/registrations/<id>/evidence/<evidence-id>/`: xác thực JWT và kiểm tra sở hữu. Frontend tải blob qua Authorization, không đưa token vào URL.

Giao diện hoàn thiện trong code (chưa chụp/kiểm tra trình duyệt đăng nhập):

- Dashboard: bốn bộ lọc; chọn nhiều đơn; nút Chuyển BHXH/Từ chối/Phát hành. Modal từ chối có bốn lý do và bảng phí/tổng xác nhận/còn thiếu từng đơn. Modal chi tiết giữ các phần cũ, timeline nằm dưới ảnh ban đầu, hiển thị nhiều ảnh cùng lần, bệnh viện trước/sau, tiền và diện phát hành. Có đối soát lại/tiếp nhận lại và nút mở lại quản trị.
- Hub: trạng thái mới, nút Chi tiết/bổ sung; lý do và hướng dẫn; chọn tỉnh/bệnh viện; QR và tiền từ backend; nhiều file; nút Lưu và gửi lại/Gửi minh chứng bổ sung và gửi lại. Lịch sử luôn giữ ảnh trước đó.

## Rollout thủ công

### 1. Preflight và backup

1. Xác nhận tên DB/host và quyền thực tế; không dùng tài khoản production để chạy test. Chạy `insurance_workflow_preflight.sql` trên môi trường được IT chỉ định, lưu kết quả có kiểm soát truy cập.
2. Backup database nhất quán và toàn bộ media; giữ manifest số lượng đơn/thẻ/ảnh, lưu binlog/PITR nếu có; thử restore trên staging. Backup chứa dữ liệu cá nhân, không đưa vào Git.
3. Đối chiếu `SHOW CREATE TABLE`: BIGINT signed cho các FK, InnoDB, các cột snapshot/card-source từ release trước. Xác nhận unique `source_registration_id` đã tồn tại. Không tạo unique sinh viên/năm/đợt vì chưa kiểm kê trùng production.
4. Kiểm tra duplicate, orphan, nhiều thẻ current, done chưa liên kết thẻ, snapshot/ảnh thiếu, trạng thái lạ. Không sửa/xóa các đơn trùng hoặc tự tạo thẻ cho done thiếu thẻ trong backfill.
5. Mapping được code cũ chứng minh: pending/processing → iu_processing; done → issued; rejected giữ nguyên. Nếu kiểm kê cho thấy ý nghĩa khác, chưa dùng `--map-statuses`, ghi lại các ID và xử lý nghiệp vụ riêng.
6. Kiểm tra dung lượng, metadata locks, replica lag, thời gian DDL trên staging. Không giả định ALTER không khóa.
7. Đối chiếu danh mục phát hành: Dashboard cho chọn mọi dòng `is_active=1` trong `student_health_insurance_registration_types` và ghi loại đã chọn vào thẻ. IT chỉ đặt `INSURANCE_PRIORITY_TYPE_CODE=<mã đã xác minh>` để đánh dấu loại ưu tiên không sao chép thông tin diện trường. Không tự seed một loại mới hoặc đổi nghĩa loại cũ.

### 2. Expand schema

Chạy **riêng** `insurance_workflow_upgrade.sql` sau review/backup. Script kiểm tra cột/index trước khi thêm, `CREATE TABLE IF NOT EXISTS`; có thể chạy lại sau DDL dở dang. Cần quyền CREATE ROUTINE để chạy helper procedure. So sánh shape các bảng đã tồn tại: IF NOT EXISTS không chứng minh bảng đúng schema. Script không sửa trạng thái và không xóa cột/dữ liệu.

Không chạy lại `insurance_config_upgrade.sql` cũ: file đó có DELETE cấu hình và không phải migration của release này. Thiếu prerequisite thì dừng expand, thiết kế bổ sung có bảo toàn dữ liệu theo schema thực tế.

### 3. Deploy code tương thích trong cửa sổ bảo trì

Deploy cả backend Hub và Dashboard cùng frontend sau expand; cài requirements Hub có Pillow. Để `INSURANCE_WORKFLOW_V2=0` ở cả hai backend trong lúc chuyển đổi: đọc legacy/new được, mọi mutation BHYT mới tạm chặn. Không để backend cũ tiếp tục ghi sau khi bắt đầu mapping. Hai ứng dụng đọc được đơn chưa có timeline/backfill.

Media: Dashboard `HUB_MEDIA_ROOT` phải trỏ đúng Hub `MEDIA_ROOT`. File mới lưu `insurance_private/`, ảnh legacy vẫn nguyên `insurance_data/`. Không public cả hai thư mục. Django đã chặn raw URLs; Nginx phục vụ static trực tiếp phải thêm, trên mọi vhost đang expose cùng media:

```nginx
location ^~ /media/insurance_private/ { return 404; }
location ^~ /media/insurance_data/ { return 404; }
```

Kiểm tra alias/CDN khác cũng không public file. `nginx -t`, rồi reload theo quy trình IT. Request upload tối đa 8 × 5 MB (thêm overhead multipart); cấu hình giới hạn request/proxy phù hợp, không nới toàn hệ thống nếu không cần. MIME nhận JPEG/PNG/WebP; HEIC/ảnh cũ không đọc được vẫn giữ cột/ảnh ban đầu và báo kiểm kê, không xóa.

### 4. Backfill có checkpoint

Chạy tại thư mục backend Hub trên host đọc được media:

```bash
python manage.py backfill_insurance_workflow --after-id 0 --batch-size 200
# Chỉ sau review dry-run, thay NAME bằng tên DB thực sự đã xác minh:
python manage.py backfill_insurance_workflow --apply --database-name NAME --after-id 0 --batch-size 200
# Mapping là opt-in riêng, chỉ sau khi review ý nghĩa trạng thái:
python manage.py backfill_insurance_workflow --apply --database-name NAME --map-statuses --after-id 0 --batch-size 200
```

Mỗi lần xử lý tối đa một batch; lấy `checkpoint` làm `--after-id` lần tiếp theo, đến processed=0. Có thể chạy lại từ 0. Mỗi đơn được khóa và commit riêng. Tạo đúng một `LEGACY_IMPORTED` ghi trạng thái quan sát, không dựng lịch sử giả; evidence ảnh cũ chỉ được thêm nếu file tồn tại và xác minh hợp lệ. Nếu media thiếu, sửa mount rồi chạy lại từ 0 để bổ sung file. Phí legacy giữ NULL. Các ID lỗi/thiếu phải ghi vào biên bản staging; không bỏ qua khi nghiệm thu.

### 5. Verify

Chạy `insurance_workflow_verify.sql`; so sánh count tổng với preflight và backup manifest. Mọi đơn/thẻ/ảnh trước nâng cấp vẫn còn. Phân loại rõ các issued thiếu thẻ có từ legacy; không giả phát hành để làm sạch báo cáo. Kiểm tra một đơn từng trạng thái và từng năm/đợt, đơn thiếu snapshot, timeline và ảnh cũ, hai lần bổ sung, đổi danh mục bệnh viện sau khi bổ sung, đối soát lại, permission staff/sinh viên khác và URL raw bị 404. Kiểm thử trên MySQL 8.4.9 staging; dữ liệu mẫu không dùng thông tin cá nhân thật.

### 6. Activate và rollback

Đặt `INSURANCE_WORKFLOW_V2=1` trên **cả hai backend** và restart theo quy trình IT sau verify. Frontend dùng request key và row_version mới. IT có thể chạy câu `ALTER TABLE hub_insurance_registrations ALTER COLUMN status SET DEFAULT 'iu_processing';` khi chắc chắn không còn writer cũ; application đã gửi trạng thái tường minh nên không phụ thuộc thay đổi default này.

Rollback application an toàn: trước tiên tắt flag ở cả hai ứng dụng và giữ bản đọc được schema/status v2 để tra cứu. Không drop bảng/cột mới và không tự đổi waiting_bhxh về trạng thái cũ: không có ánh xạ ngược bảo toàn đầy đủ. Muốn dùng bản trước v2 phải có bản hotfix đọc mã mới hoặc kế hoạch chuyển đổi được nghiệp vụ duyệt. Restore toàn DB chỉ trong phương án khôi phục đã đối soát mọi ghi mới và media tương ứng; không ghi đè dữ liệu phát sinh để rollback giao diện.

## Kiểm thử và giới hạn

- Hub: 26 tests pass trên SQLite memory, gồm tests cũ và tests workflow mới, nộp mới, retry, rollback file, timeline, QR, ownership/path traversal, backfill chạy lại, append-only.
- Dashboard: 28 tests pass trên SQLite; 31 tests pass trên MySQL 8.0.44 cách ly, bao gồm 3 test cạnh tranh thật bằng hai connection: hai staff cùng đơn, cùng request phát hành, hai đơn cùng sinh viên. Không dùng DB live.
- Frontend: TypeScript `tsc --noEmit`, production `next build` pass (17 trang), ESLint phạm vi file frontend thay đổi pass.
- Chưa chạy bộ test Hub trên MySQL: lượt thực thi bị automatic approval review từ chối vì quota xét duyệt đã hết. Chưa chạy upgrade SQL trên MySQL; chưa xác minh SQL/DDL trên MySQL 8.4.9 staging; chưa QA trình duyệt có đăng nhập. Đây là các gate trước production, không phải kết quả đã pass.

Lệnh tái chạy (venv có dependencies của từng dự án):

```bash
python manage.py test --settings=config.insurance_test_settings --noinput
# MySQL: server/database dùng riêng để test; không dùng DB_* của app.
# Đặt INSURANCE_TEST_DB=test_insurance_dashboard (Hub: test_insurance_hub),
# INSURANCE_TEST_USER, INSURANCE_TEST_PASSWORD, INSURANCE_TEST_HOST, INSURANCE_TEST_PORT.
python manage.py test students.tests students.test_insurance_workflow students.insurance_mysql_checks --settings=config.insurance_mysql_test_settings --noinput
# Hub:
python manage.py test --settings=config.insurance_mysql_test_settings --noinput
# Frontend:
npx tsc --noEmit
npm run build
```

Test runner chỉ tạo schema unmanaged trong database test. Settings SQLite ghi đè hoàn toàn cấu hình DB; MySQL test chỉ nhận biến INSURANCE_TEST_* và tên database có prefix test_insurance_. Không dùng test runner này làm migration.

## Giả định và rủi ro staging còn lại

- Xác nhận version và shape thật, mã diện ưu tiên, duplicate và done thiếu thẻ; không có truy cập production trong lượt làm việc này.
- Giới hạn upload, Pillow trên host production, storage permissions/mount, chặn static URLs và ảnh legacy HEIC cần kiểm tra IT.
- Backend hiện chấp nhận một đơn mỗi sinh viên/năm/đợt bằng khóa sinh viên; không thêm unique constraint khi chưa kiểm kê legacy.
- Các writer thẻ thủ công/import ngoài workflow BHYT vẫn cần đánh giá cạnh tranh với phát hành ở staging; ba test MySQL kiểm tra các request qua service workflow mới.
- Các lỗi crash hệ điều hành giữa ghi file và commit có thể để file mồ côi; exception bình thường đã cleanup. Không tự xóa file mồ côi khi chưa đối chiếu DB/backup.
- Giữ flag tắt cho tới khi SQL, gate bảo mật media và các kiểm tra staging còn lại được xác nhận.

Danh sách file thay đổi: xem `INSURANCE_WORKFLOW_FILES.md`. Chưa deploy, chưa chạy migration production.
