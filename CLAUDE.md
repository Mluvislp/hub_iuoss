# CLAUDE.md — Context nhanh cho Claude Code

> Đọc file này trước. Sau đó đọc `CODEBASE.md` để hiểu sâu hơn.

---

## Đây là dự án gì

`iuoss_hub` là **student portal** tại `hub.iuoss.com` — nơi sinh viên HCMIU đăng nhập bằng tài khoản mạng trường (LDAP) để xem hồ sơ và theo dõi yêu cầu với Phòng CTSV.

**Repo này là 1 trong 2 Django projects của hệ thống IUOSS:**

| Repo | Domain | Người dùng | Trạng thái |
|---|---|---|---|
| `iuoss_hub` ← repo này | `hub.iuoss.com` | Sinh viên | MVP đang xây dựng |
| `dashboard_iuoss` | `dashboard.iuoss.com` | Nhân viên OSS | Production đang chạy |

Cả hai dùng chung **MySQL database** `iuoss_student_data`. Không có API giữa 2 app — đọc/ghi trực tiếp vào DB.

---

## Trạng thái hiện tại của hub_iuoss

### Đã có (MVP ban đầu)

- [x] Cấu trúc Django project: `config/`, `core/`, `students/`
- [x] **LDAP authentication** hoàn toàn tùy chỉnh — không dùng `django.contrib.auth`
- [x] Bảng `hub_students` — lưu lịch sử đăng nhập
- [x] Session management riêng (`core/session.py`, cookie `hub_sessionid`)
- [x] Decorator `@hub_login_required` thay thế Django's `@login_required`
- [x] Trang login + trang home cơ bản (Bootstrap 5)
- [x] Read-only models từ shared DB: `Student`, `Department`, `DegreeLevel`, `StudentStatus`

### Chưa có (roadmap)

- [ ] Xem danh sách ticket của sinh viên
- [ ] Gửi yêu cầu mới
- [ ] Thông báo từ phòng CTSV
- [ ] SSO với WordPress (`iuoss.com`)

---

## Những điều QUAN TRỌNG cần nhớ

### 1. Không dùng `django.contrib.auth` cho student login
`django.contrib.auth` **không có** trong `INSTALLED_APPS`. Không dùng `request.user`, `@login_required`, hay `auth.login()`.

```python
# Thay thế:
from core.session import current_student
from core.decorators import hub_login_required

student_session = current_student(request)  # dict hoặc None
# {"ldap_uid", "student_id", "student_code", "full_name"}
```

### 2. Không chạy `makemigrations`
`MIGRATION_MODULES = {"core": None, "students": None}` — schema quản lý thủ công.
Chỉ được chạy `manage.py migrate` (tạo bảng `django_session` cho sessions).
Thay đổi schema → viết SQL → chạy thủ công → cập nhật `docs/schema.sql`.

### 3. `students/` app là read-only
Chỉ đọc dữ liệu từ shared DB. **Không ghi** vào `students`, `departments`, hay bất kỳ bảng nào Dashboard sở hữu.

### 4. Hub chỉ ghi vào bảng `hub_*`
Bảng của hub: `hub_students` (và các bảng `hub_*` sẽ thêm sau).

---

## Cấu trúc file quan trọng

```
core/auth.py        ← LDAP verify — đây là trái tim của authentication
core/session.py     ← set/get/clear student session
core/decorators.py  ← @hub_login_required
core/models.py      ← HubStudent (hub_students table)
core/views.py       ← login_view, logout_view, home_view
students/models.py  ← read-only mirror từ shared DB
config/settings.py  ← LDAP config, SESSION config, MIGRATION_MODULES
docs/schema.sql     ← SQL tạo bảng hub_students
docs/ECOSYSTEM.md   ← sơ đồ quan hệ với dashboard + WordPress
```

---

## Trạng thái của dashboard_iuoss (repo liên quan)

Dashboard đang chạy production tại `dashboard.iuoss.com`. Các tính năng chính:

- Import hồ sơ sinh viên từ Excel (67 cột) → MySQL
- Sync ticket từ WordPress REST API (`iuoss.com`)
- Xuất giấy xác nhận PDF (docxtpl + Word COM trên Windows / LibreOffice trên Linux)
- Quản lý user/role (Django Groups)
- Export danh sách sinh viên ra Excel

**Schema DB quan trọng hub cần biết:**

| Bảng | Mô tả | Hub được đọc? |
|---|---|---|
| `students` | Hồ sơ sinh viên | ✅ |
| `departments` | Danh sách khoa | ✅ |
| `student_statuses` | Trạng thái học vụ | ✅ |
| `degree_levels` | Bậc đào tạo | ✅ |
| `tickets` | Ticket hỗ trợ (sync từ WP) | ✅ (tương lai) |
| `student_code_history` | Lịch sử MSSV cũ/mới | ✅ (tương lai) |
| `audit_auditlog` | Log thao tác | ❌ |
| `student_import_*` | Batch import Excel | ❌ |

---

## Biến môi trường cần thiết

```env
LDAP_BIND_PASSWORD=<plain text — hỏi admin>
DB_PASSWORD=<cùng password với dashboard>
SECRET_KEY=<sinh ngẫu nhiên>
```

Xem `.env.example` để đủ danh sách.

---

## Tài liệu đầy đủ

| Muốn biết | Đọc |
|---|---|
| Kiến trúc tổng thể, gotchas | `CODEBASE.md` |
| Quan hệ với dashboard + WordPress | `docs/ECOSYSTEM.md` |
| LDAP flow chi tiết, security | `docs/AUTH_FLOW.md` |
| Deploy lên server | `docs/SERVER_SETUP.md` |
| Setup local | `docs/README.md` |
