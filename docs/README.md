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

- Python 3.11+
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

Nội dung mặc định cho dev:
```env
DJANGO_API_URL=http://127.0.0.1:8000
```

### Bước 3 — Chạy dev server

```bash
npm run dev
```

Mở `http://localhost:3000`. Next.js tự proxy `/api/*` về Django `:8000` qua `next.config.ts`.

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
