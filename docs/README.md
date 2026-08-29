# IUOSS Hub — Setup môi trường dev local

## Tổng quan

Monorepo gồm 2 project:

| | Backend | Frontend |
|---|---|---|
| Folder | `backend/` | `frontend/` |
| Stack | Django 5.2 + MySQL | Next.js 14 + TypeScript |
| Dev port | `:8000` | `:3000` |
| Cần | Python 3.12+, MySQL | Node.js 20+ |

---

## Backend — Django

### Yêu cầu

- Python 3.11+ — nhưng **server production chạy 3.12**, và `SERVER_SETUP.md` dựng
  venv bằng `python3.12`. Nên dùng 3.12 khi dev để khớp môi trường thật.
- Quyền đọc database `iuoss_student_data` (host `127.0.0.1:3306`)
- Kết nối tới LDAP server `ldap.hcmiu.edu.vn` (cần ở trong mạng trường hoặc VPN)

### Bước 1 — Tạo venv

```bash
cd backend
python3 -m venv venv
source venv/bin/activate          # macOS/Linux
# venv\Scripts\activate           # Windows
pip install -r requirements.txt
```

### Bước 2 — Cấu hình `.env`

```bash
cp .env.example .env
nano .env
```

```env
DEBUG=True
SECRET_KEY=any-random-string-for-dev
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

### Bước 3 — Tạo bảng

```bash
# Chạy schema hub (lần đầu)
mysql -u iuoss_app -p iuoss_student_data < ../docs/schema.sql

# Tạo django_session
python manage.py migrate
```

### Bước 4 — Chạy Django dev server

```bash
python manage.py runserver 127.0.0.1:8000
```

Truy cập `http://127.0.0.1:8000/login/` để test Django templates (cũ).  
API endpoints `/api/*` sẽ có sau khi thêm DRF.

---

## Frontend — Next.js

### Yêu cầu

- Node.js 20+
- Backend Django đang chạy trên `:8000` (để `/api/` hoạt động)

### Bước 1 — Cài dependencies

```bash
cd frontend
npm install
```

### Bước 2 — Cấu hình `.env.local`

```bash
cp .env.example .env.local
```

Nội dung cho dev:
```env
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000/api
```

> Biến đúng là **`NEXT_PUBLIC_API_URL`**, không phải `DJANGO_API_URL`. Cái tên cũ
> gắn với cơ chế rewrite trong `next.config` đã bị gỡ — hiện **không code nào đọc**
> `DJANGO_API_URL`, đặt nó vào chỉ vô nghĩa. Chỉ biến có tiền tố `NEXT_PUBLIC_` mới
> tới được trình duyệt, mà `lib/api.ts` lại chạy phía client.

### Bước 3 — Chạy dev server

```bash
npm run dev
```

Mở `http://localhost:3000`.

> **Next.js KHÔNG proxy `/api/*`** — `next.config.mjs` cố ý bỏ rewrite (gây redirect
> loop với POST). Khi dev phải tạo `frontend/.env.local` với
> `NEXT_PUBLIC_API_URL=http://127.0.0.1:8000/api` để trình duyệt gọi thẳng Django;
> CORS đã mở sẵn cho `localhost:3000`. Thiếu biến này thì frontend gọi `/api` tương
> đối và không có gì phục vụ. Xem [`CODEBASE.md §7`](../CODEBASE.md).

---

## Chạy cả 2 cùng lúc

Mở 2 terminal:

```bash
# Terminal 1 — Backend
cd backend && source venv/bin/activate && python manage.py runserver

# Terminal 2 — Frontend
cd frontend && npm run dev
```

---

## Lưu ý quan trọng

- **Backend:** Không dùng `django.contrib.auth` — xem `CODEBASE.md` mục 1
- **Backend:** Không chạy `makemigrations` cho `core` và `students`
- **Backend:** Không ghi vào các bảng của `students/` app — chỉ đọc
- **Frontend:** API `/api/*` chưa hoạt động hoàn toàn cho đến khi DRF được thêm vào backend
- **Frontend:** Auth token lưu trong cookie `hub_token` — xem `frontend/lib/auth.ts`

---

## Production Deployment

Xem [`docs/SERVER_SETUP.md`](SERVER_SETUP.md).


### Migration Script cho hub_insurance_registrations
Do bảng này dùng managed=False nên cần chạy query ALTER TABLE trên MySQL:

`sql
ALTER TABLE hub_insurance_registrations
  DROP COLUMN ldap_uid,
  DROP COLUMN period,
  DROP COLUMN full_name,
  DROP COLUMN student_code,
  DROP COLUMN gender,
  DROP COLUMN dob,
  DROP COLUMN ethnicity,
  DROP COLUMN phone_number,
  DROP COLUMN social_insurance_number,
  DROP COLUMN citizen_id,
  DROP COLUMN permanent_province,
  DROP COLUMN permanent_ward,
  DROP COLUMN permanent_street,
  DROP COLUMN temporary_province,
  DROP COLUMN temporary_ward,
  DROP COLUMN temporary_street,
  DROP COLUMN note;

ALTER TABLE hub_insurance_registrations
  ADD COLUMN registration_year INT NOT NULL AFTER student_id,
  ADD COLUMN registration_period VARCHAR(32) NOT NULL AFTER registration_year,
  ADD COLUMN payment_receipt_image VARCHAR(500) NOT NULL AFTER bhyt_image,
  ADD COLUMN change_log JSON NULL AFTER payment_receipt_image,
  ADD COLUMN rejection_reason TEXT NULL AFTER status,
  ADD KEY idx_hir_period_year (registration_year, registration_period);


  CREATE TABLE hub_insurance_configs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    description TEXT,
    bank_name VARCHAR(255) NOT NULL,
    bank_account_number VARCHAR(64) NOT NULL,
    bank_account_name VARCHAR(255) NOT NULL,
    insurance_fee INT NOT NULL,
    created_at DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
);

-- Tạo sẵn 1 dòng dữ liệu cấu hình mặc định để lúc GET API không bị rỗng:
INSERT INTO hub_insurance_configs (description, bank_name, bank_account_number, bank_account_name, insurance_fee) 
VALUES ('<p>Sinh viên cung cấp đầy đủ thông tin vào biểu mẫu...</p>', 'Vietcombank', '0123456789', 'ĐẠI HỌC QUỐC TẾ', 631800);
`
**Lưu ý:** Việc lưu trữ hình ảnh sẽ nằm ở thư mục media/insurance_data/%Y/%m/ theo cấu trúc hệ thống.
