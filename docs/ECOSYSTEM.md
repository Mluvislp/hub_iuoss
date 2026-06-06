# Hệ sinh thái IUOSS — Mối liên hệ giữa các hệ thống

> Tài liệu này mô tả toàn bộ hệ sinh thái gồm 3 ứng dụng do Phòng CTSV quản lý,
> cách chúng liên kết với nhau qua database chung, LDAP chung và server chung.
>
> Bản copy tồn tại ở cả 2 repo: `iuoss_dashboard` và `iuoss_hub`.

---

## 1. Tổng quan hệ sinh thái

```
                        LDAP Server (trường HCMIU)
                        ldap://ldap.hcmiu.edu.vn:389
                               │            │
                    ┌──────────┘            └──────────┐
                    │ xác thực                          │ xác thực
                    ▼                                   ▼
┌─────────────────────────┐              ┌──────────────────────────┐
│     iuoss.com           │              │     hub.iuoss.com        │
│     WordPress           │              │     Django (iuoss_hub)   │
│     (student-facing)    │              │     (student-facing)     │
│                         │              │                          │
│  - Sinh viên login      │              │  - Sinh viên login LDAP  │
│  - Gửi ticket/yêu cầu  │              │  - Xem hồ sơ cá nhân     │
│  - Xem thông báo        │              │  - Theo dõi ticket       │
└────────────┬────────────┘              └──────────────────────────┘
             │ REST API sync                           │
             │ (theo ngày)                             │ read-only
             ▼                                        ▼
┌─────────────────────────┐         ┌────────────────────────────────┐
│  dashboard.iuoss.com    │         │   MySQL: iuoss_student_data    │
│  Django (iuoss_dashboard│◄────────►   (shared database)           │
│  (staff-facing)         │  R/W    │                                │
│                         │         │  students, departments,        │
│  - Nhân viên OSS login  │         │  student_statuses, tickets,    │
│  - Quản lý hồ sơ SV     │         │  ticket_*, imports_*,          │
│  - Xử lý ticket         │         │  hub_students,                 │
│  - Import Excel          │         │  django_session (×2)          │
│  - Xuất báo cáo          │         └────────────────────────────────┘
└─────────────────────────┘
```

---

## 2. Vai trò từng hệ thống

| Hệ thống | Domain | Repo | Người dùng | Auth |
|---|---|---|---|---|
| WordPress | `iuoss.com` | (không có) | Sinh viên | LDAP trường |
| Dashboard | `dashboard.iuoss.com` | `iuoss_dashboard` | Nhân viên OSS | Django auth (username/password nội bộ) |
| Hub | `hub.iuoss.com` | `iuoss_hub` | Sinh viên | LDAP trường (custom, không dùng Django auth) |

**Nguyên tắc phân tách:**
- **WordPress + Hub** — hướng ra ngoài, sinh viên dùng
- **Dashboard** — hướng vào trong, chỉ nhân viên OSS dùng
- Dashboard và Hub **không bao giờ dùng chung session hay auth backend**

---

## 3. Database chung

Cả Dashboard và Hub đều kết nối vào **cùng một MySQL database**: `iuoss_student_data` trên `127.0.0.1:3306` (server appctsv).

### Phân chia quyền sở hữu bảng

| Nhóm bảng | Chủ sở hữu (ghi) | Người đọc |
|---|---|---|
| `students`, `departments`, `degree_levels`, `joint_programs`, `academic_terms`, `student_statuses` | Dashboard (qua import Excel) | Hub (read-only) |
| `student_*` (12 bảng con) | Dashboard | Hub (read-only, tương lai) |
| `tickets`, `ticket_*` | Dashboard (sync từ WordPress) | Hub (tương lai) |
| `student_import_batches`, `student_import_rows`, `student_import_row_errors` | Dashboard | — |
| `audit_auditlog` | Dashboard | — |
| `hub_students` | Hub | — |
| `django_session` (×2) | Dashboard (session riêng) + Hub (session riêng, tên cookie khác) | — |
| `majors` | Dashboard (seed command) | Hub (read-only, tương lai) |

### Quy tắc quan trọng

> **Hub chỉ được đọc dữ liệu từ các bảng do Dashboard sở hữu.**
> Hub không bao giờ ghi vào `students`, `tickets`, hay bất kỳ bảng nào Dashboard quản lý.
> Hub chỉ ghi vào các bảng `hub_*` của riêng mình.

### Session cookies — tách biệt

Cả hai Django app đều dùng DB sessions nhưng **cookie name khác nhau**:

| App | Cookie name | Bảng session |
|---|---|---|
| Dashboard | `sessionid` (mặc định Django) | `django_session` (DB của dashboard) |
| Hub | `hub_sessionid` | `django_session` (cùng DB, nhưng session khác) |

Nếu sau này hai app chạy trên cùng parent domain `.iuoss.com`, tên cookie khác nhau đảm bảo không xung đột.

---

## 4. LDAP chung

Cả WordPress và Hub đều xác thực qua cùng LDAP server của trường:

| Thông số | Giá trị |
|---|---|
| Server | `ldap://ldap.hcmiu.edu.vn:389` |
| Service account | `cn=ctsv,dc=hcmiu,dc=edu,dc=vn` |
| Username attribute | `uid` (thường = MSSV, vd `BABAWE21603`) |

**Dashboard KHÔNG dùng LDAP** — nhân viên OSS đăng nhập bằng Django auth (username/password được tạo qua `manage.py createsuperuser` hoặc trang quản lý User).

---

## 5. Luồng dữ liệu ticket

```
Sinh viên gửi yêu cầu
    │
    ▼ iuoss.com (WordPress)
    │  Lưu vào WordPress DB (wp_posts, wp_postmeta)
    │
    ▼ Nhân viên OSS bấm "Đồng bộ" trên Dashboard
    │
    ▼ dashboard.iuoss.com → tickets/services.py
    │  GET https://iuoss.com/wp-json/iuoss/v1/tickets?date=...
    │  → upsert vào MySQL: tickets, ticket_statuses, ticket_wp_authors, ...
    │
    ▼ MySQL (iuoss_student_data) — source of truth mới
    │
    ▼ hub.iuoss.com (tương lai)
       Sinh viên xem trạng thái ticket của mình
```

**Lưu ý:** Hub hiện tại chưa hiển thị ticket — đây là tính năng roadmap. Khi implement, Hub đọc trực tiếp từ bảng `tickets` trong MySQL (không cần API).

---

## 6. Luồng dữ liệu hồ sơ sinh viên

```
File Excel (.xlsx)
    │
    ▼ dashboard.iuoss.com → imports/services.py
    │  Validate → Preview → Confirm (100 rows/chunk)
    │
    ▼ MySQL: students + 11 bảng con
    │
    ▼ hub.iuoss.com (read-only)
       Sinh viên xem thông tin hồ sơ của mình
```

---

## 7. Hạ tầng chung (appctsv)

Cả hai Django app chạy trên cùng server `appctsv` (Ubuntu 24.04, IP LAN `10.8.20.33`):

```
Nginx :80
  ├─ dashboard.iuoss.com  →  Gunicorn :8001  (iuoss_app)
  └─ hub.iuoss.com        →  Gunicorn :8002  (iuoss_hub)
           │
           └── MySQL 127.0.0.1:3306  (iuoss_student_data)
```

| | Dashboard | Hub |
|---|---|---|
| Gunicorn port | 8001 | 8002 |
| systemd service | `iuoss_app` | `iuoss_hub` |
| App path | `/var/www/apps/iuoss_app/` | `/var/www/apps/iuoss_hub/` |
| Deploy command | `bash deploy.sh` | `bash deploy.sh` (tương lai) |

Chi tiết hạ tầng: xem `docs/SERVER_INFRASTRUCTURE.md` trong repo `iuoss_dashboard`.

---

## 8. Sơ đồ phụ thuộc khi thay đổi code

Khi thay đổi **schema DB** (thêm/sửa/xóa cột bảng dùng chung):

```
Thay đổi bảng students/* hoặc tickets/*
    │
    ├─► iuoss_dashboard: cập nhật model trong students/models.py hoặc tickets/models.py
    └─► iuoss_hub:       cập nhật model trong students/models.py (nếu field đó được dùng)
```

Khi thay đổi **bảng hub_*** (chỉ Hub sở hữu):
```
    └─► iuoss_hub: cập nhật core/models.py + docs/schema.sql (chỉ cần sửa 1 repo)
```

---

## 9. Roadmap tích hợp

| Tính năng | Hiện tại | Kế hoạch |
|---|---|---|
| Sinh viên xem ticket của mình | ❌ | Đọc bảng `tickets` từ Hub |
| Sinh viên gửi yêu cầu mới | Qua WordPress | Gửi trực tiếp từ Hub vào DB |
| Thông báo từ phòng CTSV | ❌ | Bảng `hub_announcements` mới |
| SSO WordPress ↔ Hub | ❌ (login riêng) | OAuth2 hoặc JWT Cookie |
| Staff reply cho sinh viên | ❌ | Dashboard ghi → Hub đọc |
