# Hệ sinh thái IUOSS — Mối liên hệ giữa các hệ thống

> Tài liệu này mô tả toàn bộ hệ sinh thái gồm 3 ứng dụng do Phòng CTSV quản lý,
> cách chúng liên kết với nhau qua database chung, LDAP chung và server chung.
>
> Bản copy tồn tại ở cả 2 repo: `dashboard_iuoss` và `hub_iuoss`.

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
│     WordPress           │              │  Django API + Next.js    │
│     (student-facing)    │              │     (student-facing)     │
│                         │              │                          │
│  - Sinh viên login      │              │  - Sinh viên login LDAP  │
│  - Gửi ticket/yêu cầu  │              │  - Xem hồ sơ cá nhân     │
│  - Xem thông báo        │              │  - Theo dõi yêu cầu      │
└────────────┬────────────┘              └──────────────────────────┘
             │ REST API sync                           │
             │ (theo ngày)                             │ read-only
             ▼                                        ▼
┌─────────────────────────┐         ┌────────────────────────────────┐
│  dashboard.iuoss.com    │         │   MySQL: iuoss_student_data    │
│  Django (dashboard_iuoss│◄────────►   (shared database)           │
│  (staff-facing)         │  R/W    │                                │
│                         │         │  students, departments,        │
│  - Nhân viên OSS login  │         │  student_statuses, danh mục,   │
│  - Quản lý hồ sơ SV     │         │  hospitals, vn_provinces,      │
│  - Duyệt yêu cầu giấy tờ│         │  hub_students,                 │
│  - Duyệt đơn BHYT       │         │  hub_confirmation_requests,   │
│  - Xuất báo cáo          │         │  django_session (×2)          │
└─────────────────────────┘         └────────────────────────────────┘
```

---

## 2. Vai trò từng hệ thống

| Hệ thống | Domain | Repo | Người dùng | Auth |
|---|---|---|---|---|
| WordPress | `iuoss.com` | (không có) | Sinh viên | LDAP trường |
| Dashboard | `dashboard.iuoss.com` | `dashboard_iuoss` | Nhân viên OSS | Django auth (username/password nội bộ) |
| Hub | `hub.iuoss.com` | `hub_iuoss` | Sinh viên | LDAP trường (custom, không dùng Django auth) |

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
| `students` + **10 bảng con** ¹ | Dashboard | Hub (read-only) |
| Danh mục: `departments`, `majors`, `student_statuses`, `degree_levels`, `joint_programs`, `academic_terms`, `nationalities`, `vn_ethnicities`, `hospitals`, `relationship_types`, `vn_provinces`, `vn_wards` | Dashboard | Hub (read-only) |
| `audit_auditlog`, các bảng `*_batches` | Dashboard | — |
| `hub_confirmation_requests`, `hub_profile_change_requests`, `hub_insurance_registrations` | Hub tạo dòng · Dashboard đổi trạng thái ² | cả hai |
| `hub_students`, `hub_insurance_configs`, `hub_cccd_scans` | Hub | Dashboard (**chỉ đọc**) |
| `django_session` (×2) | Dashboard + Hub, mỗi bên session riêng, tên cookie khác | — |

¹ `student_academic_enrollments` · `student_addresses` · `student_civic_activities`
· `student_code_history` · `student_contact_points` · `student_family_members` ·
`student_health_insurance_cards` · `student_high_schools` ·
`student_identity_documents` · `student_tuition_exemptions`.

² Ba bảng này do Hub tạo dòng nhưng Dashboard **được phép** cập nhật trạng thái duyệt
— đó là bản chất của luồng yêu cầu giấy tờ và luồng duyệt đơn BHYT. Với đơn BHYT
ranh giới hẹp hơn: Dashboard **chỉ ghi** `status` · `rejection_reason` · `updated_at`,
mọi cột còn lại là của Hub.

> Các bảng `tickets` / `ticket_*` đã bị **gỡ bỏ hoàn toàn** (commit `ac82bc8` bên
> `dashboard_iuoss`, thay bằng luồng Yêu cầu giấy tờ). Không còn tồn tại trong DB.

### Quy tắc quan trọng

> **Hub chỉ được đọc dữ liệu từ các bảng do Dashboard sở hữu.**
> Hub không bao giờ ghi vào `students` hay bất kỳ bảng nào Dashboard quản lý.
> Hub chỉ ghi vào các bảng `hub_*` của riêng mình.

### Session cookies — tách biệt

Cả hai Django app đều dùng DB sessions nhưng **cookie name khác nhau**:

| App | Cookie name | Bảng session |
|---|---|---|
| Dashboard | `sessionid` (mặc định Django) | `django_session` (DB của dashboard) |
| Hub | `hub_sessionid` | `django_session` (cùng DB, nhưng session khác) |

Hai app chạy trên cùng parent domain `.iuoss.com`, tên cookie khác nhau đảm bảo không xung đột.

---

## 4. LDAP chung

Cả WordPress và Hub đều xác thực qua cùng LDAP server của trường:

| Thông số | Giá trị |
|---|---|
| Server | `ldap://ldap.hcmiu.edu.vn:389` |
| Service account | `cn=ctsv,dc=hcmiu,dc=edu,dc=vn` |
| Username attribute | `uid` (thường = MSSV, vd `ITCSIU24092`) |

**Dashboard KHÔNG dùng LDAP** — nhân viên OSS đăng nhập bằng Django auth (username/password được tạo qua `manage.py createsuperuser` hoặc trang quản lý User).

---

## 5. Luồng yêu cầu giấy tờ (thay cho ticket cũ)

> **Module ticket đã bị gỡ bỏ hoàn toàn** — commit `ac82bc8` bên `dashboard_iuoss`.
> Các bảng `tickets`, `ticket_statuses`, `ticket_wp_authors` không còn trong DB, và
> luồng đồng bộ từ WordPress cũng không còn code nào chạy (biến `IUOSS_WP_API_*` vẫn
> nằm trong `.env` của Dashboard nhưng là di sản chưa dọn, không Python nào đọc).
>
> Thay thế bằng luồng **Yêu cầu giấy tờ** dưới đây — sinh viên tạo thẳng trên Hub,
> không đi qua WordPress nữa.

```
Sinh viên đăng nhập hub.iuoss.com
    │
    ▼ Tạo yêu cầu (5 loại: lý do khác · hoãn NVQS · thương binh ·
    │                vay vốn ngân hàng · mẫu tiếng Anh)
    │  POST /api/requests/<loại>/form/
    │
    ▼ MySQL — bảng hub_confirmation_requests
    │
    ▼ dashboard.iuoss.com — nhân viên OSS duyệt
    │  Đọc bảng, đổi trạng thái, sinh file DOCX/PDF
    │
    ▼ Sinh viên theo dõi trạng thái trên Hub
```

Không có API giữa hai app — trao đổi hoàn toàn qua bảng dùng chung.

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
Internet (HTTPS) → Cloudflare Edge
                     │ Cloudflare Tunnel e0dcace8 (QUIC/TLS)
                     ▼
              cloudflared (appctsv)
                     │ HTTP → 127.0.0.1:80
                     ▼
              Nginx :80  ── định tuyến theo server_name ──┐
                     │                                    │
        dashboard.iuoss.com                       hub.iuoss.com
          /static/ → staticfiles/                  /static/ → backend/staticfiles/
          /        → :8001 Gunicorn                /api/    → :8002 Gunicorn
                     (systemd: iuoss_app)          /        → :3000 Next.js PM2
                                                             (pm2: iuoss_hub_front)
                     │                                    │
                     └──── MySQL :3306 (iuoss_student_data) ────┘
```

| | Dashboard | Hub |
|---|---|---|
| Domain | `dashboard.iuoss.com` | `hub.iuoss.com` |
| Gunicorn port | 8001 | 8002 |
| Frontend | Django templates (monolith) | Next.js :3000 (PM2: `iuoss_hub_front`) |
| systemd service | `iuoss_app` | `iuoss_hub` |
| PM2 process | — | `iuoss_hub_front` |
| App path | `/var/www/apps/dashboard_iuoss/` | `/var/www/apps/hub_iuoss/` |
| Deploy command | `bash deploy.sh` | `bash deploy.sh` |

**Port map đầy đủ server:**

| Port | Bind | Dịch vụ |
|---|---|---|
| 80 | 0.0.0.0 | Nginx (router cả 2 app) |
| 8001 | 127.0.0.1 | Gunicorn `iuoss_app` |
| 8002 | 127.0.0.1 | Gunicorn `iuoss_hub` |
| 3000 | 127.0.0.1 | Next.js PM2 `iuoss_hub_front` |
| 3306 | 127.0.0.1 | MySQL 8.4.9 |
| 8888 | 0.0.0.0 | phpMyAdmin (LAN only) |
| 9090 | 0.0.0.0 | Cockpit (LAN only) |

Chi tiết vận hành: `docs/SERVER_INFRASTRUCTURE.md` (dashboard repo) · `docs/SERVER_SETUP.md` (hub repo).

---

## 8. Sơ đồ phụ thuộc khi thay đổi code

Khi thay đổi **schema DB** (thêm/sửa/xóa cột bảng dùng chung):

```
Thay đổi bảng students/* hoặc danh mục dùng chung
    │
    ├─► dashboard_iuoss: cập nhật model trong students/models.py
    └─► hub_iuoss:        cập nhật model trong students/models.py (nếu field đó được dùng)
```

Khi thay đổi **bảng hub_*** (chỉ Hub sở hữu):
```
    └─► hub_iuoss: cập nhật core/models.py + docs/schema.sql (chỉ cần sửa 1 repo)
```

---

## 9. Roadmap tích hợp

| Tính năng | Hiện tại | Kế hoạch |
|---|---|---|
| Sinh viên gửi yêu cầu giấy tờ | ✅ Gửi thẳng từ Hub vào `hub_confirmation_requests` (5 loại) | — |
| Sinh viên đăng ký BHYT trực tuyến | ✅ `hub_insurance_registrations`, Dashboard duyệt | — |
| Khai báo ngoại trú | ✅ Hub ghi vào bảng địa chỉ của SV | — |
| Sinh viên sửa CCCD / email / SĐT | ✅ `hub_profile_change_requests`, Dashboard duyệt | — |
| Thông báo từ phòng CTSV | ❌ | Bảng `hub_announcements` mới |
| SSO WordPress ↔ Hub | ❌ (login riêng) | OAuth2 hoặc JWT Cookie |
| Staff reply cho sinh viên | ❌ | Dashboard ghi → Hub đọc |

> Ba dòng đầu trước đây nằm ở cột "Kế hoạch" và đi qua WordPress. Nay đã ship và
> chạy thẳng Hub → DB, không qua WordPress nữa.
