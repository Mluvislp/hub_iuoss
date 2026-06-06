# IUOSS Hub — Tổng quan & Hướng dẫn dev local

## Dự án là gì

Student portal tại `hub.iuoss.com` cho sinh viên HCMIU đăng nhập bằng tài khoản mạng nội bộ trường (LDAP) để:
- Theo dõi trạng thái yêu cầu/ticket đã gửi
- Nhận thông báo từ Phòng CTSV
- Gửi yêu cầu mới trực tiếp (roadmap)

## Quan hệ với các hệ thống khác

```
iuoss.com           WordPress  — sinh viên gửi ticket, dùng cùng LDAP
dashboard.iuoss.com Django     — nhân viên OSS quản lý nội bộ  (repo: iuoss_dashboard)
hub.iuoss.com       Django     — sinh viên tự phục vụ          (repo này)
                         └── cùng MySQL DB: iuoss_student_data
```

## Tính năng hiện có (MVP)

- Đăng nhập / đăng xuất bằng tài khoản LDAP trường (MSSV + mật khẩu mạng IU)
- Trang chủ hiển thị thông tin cơ bản: tên, MSSV, khoa, trạng thái học vụ
- Tự động liên kết tài khoản LDAP với hồ sơ sinh viên trong DB

## Stack

| Thành phần | Lựa chọn |
|---|---|
| Web framework | Django 5.2 |
| Database | MySQL 8.4 (shared với dashboard) |
| LDAP client | ldap3 2.x |
| WSGI server | Gunicorn |
| Frontend | Bootstrap 5.3 (CDN) |

---

## Setup môi trường dev local

### Yêu cầu

- Python 3.11+
- Quyền truy cập database `iuoss_student_data` (host `127.0.0.1:3306`)
- Kết nối tới LDAP server `ldap.hcmiu.edu.vn` (cần ở trong mạng trường hoặc VPN)

### Bước 1 — Clone và tạo venv

```bash
git clone https://github.com/Mluvislp/hub_iuoss.git
cd hub_iuoss
python3 -m venv .venv
source .venv/bin/activate          # macOS/Linux
# .venv\Scripts\activate           # Windows
pip install -r requirements.txt
```

### Bước 2 — Cấu hình `.env`

```bash
cp .env.example .env
```

Điền các giá trị sau vào `.env`:

```env
DEBUG=True
SECRET_KEY=<chuỗi ngẫu nhiên bất kỳ cho dev>
ALLOWED_HOSTS=127.0.0.1,localhost

DB_NAME=iuoss_student_data
DB_USER=iuoss_app
DB_PASSWORD=<password DB>
DB_HOST=127.0.0.1
DB_PORT=3306

LDAP_SERVER_URI=ldap://ldap.hcmiu.edu.vn:389
LDAP_BIND_DN=cn=ctsv,dc=hcmiu,dc=edu,dc=vn
LDAP_BIND_PASSWORD=<password service account CTSV>
LDAP_SEARCH_BASE=dc=hcmiu,dc=edu,dc=vn
LDAP_USER_ATTR=uid
```

> **Lưu ý:** `LDAP_BIND_PASSWORD` là **plain text** password của service account `cn=ctsv` — không phải chuỗi encrypted từ WordPress plugin.

### Bước 3 — Tạo bảng trong DB

Chạy SQL để tạo bảng `hub_students`:

```bash
mysql -u iuoss_app -p iuoss_student_data < docs/schema.sql
```

Chạy Django migrate để tạo bảng `django_session`:

```bash
python manage.py migrate
```

### Bước 4 — Chạy server dev

```bash
python manage.py runserver 127.0.0.1:8000
```

Mở `http://127.0.0.1:8000/login/` và đăng nhập bằng tài khoản LDAP trường.

---

## Cấu trúc URL

| URL | View | Mô tả |
|---|---|---|
| `/` | `home_view` | Trang chủ (yêu cầu đăng nhập) |
| `/login/` | `login_view` | Trang đăng nhập LDAP |
| `/logout/` | `logout_view` | Đăng xuất, redirect về `/login/` |

---

## Lưu ý quan trọng

- **Không dùng `django.contrib.auth`** — xem `CODEBASE.md` mục 1
- **Không chạy `makemigrations`** cho app `core` và `students` — schema quản lý thủ công
- **Không ghi** vào các bảng của `students/` app — chỉ đọc
- Để test login mà không cần LDAP server: xem `docs/AUTH_FLOW.md` phần "Dev bypass"

## Production Deployment

Xem [`docs/SERVER_SETUP.md`](SERVER_SETUP.md).
