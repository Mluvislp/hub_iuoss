# IUOSS Hub — Triển khai production (appctsv)

> Server production chung với `dashboard.iuoss.com`.
> Tổng quan hạ tầng nằm ở `docs/DEPLOY.md` trong repo `dashboard_iuoss`.
>
> Từ 29/08/2026 trên **cùng server** còn có môi trường **sandbox** (`hub-sandbox` /
> `dashboard-sandbox`, database riêng) — xem §Sandbox ở cuối file. File này nói về
> production.

---

## Kiến trúc trên appctsv

```
Internet (HTTPS :443)
  │
  ▼ Cloudflare Tunnel  (MỘT tunnel, 4 hostname)
cloudflared
  │ HTTP → 127.0.0.1:80
  ▼
Nginx :80  ── phân biệt bằng server_name ──
  │
  ├─ dashboard.iuoss.com          →  :8001  Gunicorn   (dashboard — không đụng)
  │
  ├─ hub.iuoss.com                                              [PRODUCTION]
  │    ├─ /api/                   →  :8002  Gunicorn   (Django REST API)
  │    ├─ /static/                →  backend/staticfiles/
  │    └─ /                       →  :3000  PM2        (Next.js)
  │
  ├─ dashboard-sandbox.iuoss.com  →  :8003  Gunicorn      [SANDBOX]
  │
  └─ hub-sandbox.iuoss.com                                      [SANDBOX]
       ├─ /api/                   →  :8004  Gunicorn
       └─ /                       →  :3001  PM2

Gunicorn :8002   (systemd: iuoss_hub)          — 6 worker
PM2      :3000   (iuoss_hub_front)
MySQL    :3306   (iuoss_student_data — shared với dashboard)
```

---

## File paths trên server

| Mục | Path |
|---|---|
| Monorepo root | `/var/www/apps/hub_iuoss/` |
| Backend (Django) | `/var/www/apps/hub_iuoss/backend/` |
| Frontend (Next.js) | `/var/www/apps/hub_iuoss/frontend/` |
| Python venv | `/var/www/apps/hub_iuoss/backend/venv/` |
| Backend .env | `/var/www/apps/hub_iuoss/backend/.env` |
| Django staticfiles | `/var/www/apps/hub_iuoss/backend/staticfiles/` |
| App logs | `/var/log/apps/hub_iuoss/` |
| Systemd service | `/etc/systemd/system/iuoss_hub.service` |
| Nginx config | `/etc/nginx/sites-enabled/iuoss_hub` |
| PM2 config | `/var/www/apps/hub_iuoss/frontend/ecosystem.config.js` |

---

## Cài đặt lần đầu

### Bước 1 — Cài Node.js 20 LTS trở lên (nếu chưa có)

Server appctsv hiện đang chạy Node.js v24. Phiên bản v20 LTS trở lên đều được.

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # phải >= 20.x
sudo npm install -g pm2
```

### Bước 2 — Clone repo và setup backend

```bash
cd /var/www/apps
git clone https://github.com/Mluvislp/hub_iuoss.git hub_iuoss
cd hub_iuoss/backend

python3.12 -m venv venv
venv/bin/pip install --upgrade pip
venv/bin/pip install -r requirements.txt
```

### Bước 3 — Cấu hình backend `.env`

```bash
cp .env.example .env
nano .env
```

Nội dung production:

```env
DJANGO_ENV=production
SECRET_KEY=<RANDOM_SECRET_KEY>
ALLOWED_HOSTS=hub.iuoss.com,10.8.20.33,127.0.0.1

# Origin frontend — dùng cho CORS + CSRF (cùng domain qua Nginx)
FRONTEND_ORIGINS=https://hub.iuoss.com

DB_NAME=iuoss_student_data
DB_USER=iuoss_app
DB_PASSWORD=<DB_PASSWORD>
DB_HOST=127.0.0.1
DB_PORT=3306
DB_CONN_MAX_AGE=60

TIME_ZONE=Asia/Ho_Chi_Minh

LDAP_SERVER_URI=ldap://ldap.hcmiu.edu.vn:389
LDAP_BIND_DN=cn=ctsv,dc=hcmiu,dc=edu,dc=vn
LDAP_BIND_PASSWORD=<PLAIN_TEXT_LDAP_PASSWORD>
LDAP_SEARCH_BASE=dc=hcmiu,dc=edu,dc=vn
LDAP_USER_ATTR=uid

# HSTS — bật sau khi xác nhận toàn site HTTPS ổn định (tùy chọn):
# SECURE_HSTS_SECONDS=31536000
# SECURE_HSTS_INCLUDE_SUBDOMAINS=True
# SECURE_HSTS_PRELOAD=True
```

> `DJANGO_ENV=production` tự đặt `DEBUG=False`. Không cần khai báo `DEBUG` riêng.

> **Frontend build (footgun):** KHÔNG tạo `frontend/.env.local` trên server production.
> `NEXT_PUBLIC_*` bị đông cứng vào bundle lúc `npm run build`. Để trống → API gọi
> `/api` (relative) → Nginx định tuyến. `deploy.sh` sẽ chặn build nếu phát hiện
> `.env.local` còn `NEXT_PUBLIC_API_URL`.

Tạo `SECRET_KEY`:
```bash
venv/bin/python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"
```

### Bước 4 — Tạo bảng DB

```bash
# Tạo bảng hub_* (chỉ lần đầu)
mysql -u iuoss_app -p iuoss_student_data < ../docs/schema.sql

# Tạo bảng django_session
venv/bin/python manage.py migrate

# Thu thập static files
venv/bin/python manage.py collectstatic --noinput
```

### Bước 5 — Tạo thư mục log

```bash
sudo mkdir -p /var/log/apps/hub_iuoss
sudo chown hhdang:hhdang /var/log/apps/hub_iuoss
```

### Bước 6 — Systemd service (Django API)

```bash
sudo nano /etc/systemd/system/iuoss_hub.service
```

```ini
[Unit]
Description=IUOSS Hub API (Gunicorn)
After=network.target mysql.service
Requires=mysql.service

[Service]
Type=simple
User=hhdang
WorkingDirectory=/var/www/apps/hub_iuoss/backend
ExecStart=/var/www/apps/hub_iuoss/backend/venv/bin/gunicorn \
    config.wsgi:application \
    --bind 127.0.0.1:8002 \
    --workers 6 \
    --timeout 60 \
    --access-logfile /var/log/apps/hub_iuoss/access.log \
    --error-logfile /var/log/apps/hub_iuoss/error.log
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable iuoss_hub
sudo systemctl start iuoss_hub
sudo systemctl status iuoss_hub
```

### Bước 7 — PM2 (Next.js frontend)

```bash
cd /var/www/apps/hub_iuoss/frontend
npm install
npm run build

# Khởi động
pm2 start ecosystem.config.js

# Đăng ký autostart khi server reboot
pm2 save
pm2 startup   # chạy lệnh mà nó in ra (có dạng: sudo env PATH=... pm2 startup ...)
```

### Bước 8 — Nginx config

```bash
sudo nano /etc/nginx/sites-available/iuoss_hub
```

> ⚠️ **QUAN TRỌNG — X-Forwarded-Proto:** Cloudflare Tunnel forward tới `localhost:80`
> bằng **HTTP**, nên `$scheme` = `http`. Nếu truyền thẳng `$scheme`, Django (có
> `SECURE_PROXY_SSL_HEADER`) tưởng request không bảo mật → secure-cookie hỏng / redirect
> loop. Dùng `map` bên dưới: ưu tiên proto gốc từ cloudflared, mặc định `https`.

```nginx
# Ưu tiên X-Forwarded-Proto cloudflared gửi; nếu rỗng → https (site luôn HTTPS ra ngoài).
map $http_x_forwarded_proto $hub_forwarded_proto {
    default $http_x_forwarded_proto;
    ""      https;
}

server {
    listen 80;
    server_name hub.iuoss.com;

    # Django static files
    location /static/ {
        alias /var/www/apps/hub_iuoss/backend/staticfiles/;
        expires 7d;
        add_header Cache-Control "public";
    }

    # Django REST API
    location /api/ {
        proxy_pass         http://127.0.0.1:8002;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $hub_forwarded_proto;
        proxy_read_timeout 60;
    }

    # Next.js frontend — tất cả request còn lại
    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $hub_forwarded_proto;
        proxy_set_header   Upgrade           $http_upgrade;
        proxy_set_header   Connection        "upgrade";
        proxy_http_version 1.1;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/iuoss_hub /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Bước 9 — Cloudflare Tunnel (giữ nguyên)

```bash
cloudflared tunnel route dns <TUNNEL_ID> hub.iuoss.com
```

Cập nhật `/etc/cloudflared/config.yml`:

Trạng thái hiện tại của `/etc/cloudflared/config.yml` — 4 hostname, 1 tunnel:

```yaml
ingress:
  # --- PRODUCTION ---
  - hostname: dashboard.iuoss.com
    service: http://127.0.0.1:80
  - hostname: hub.iuoss.com
    service: http://127.0.0.1:80
  # --- SANDBOX ---
  - hostname: dashboard-sandbox.iuoss.com
    service: http://127.0.0.1:80
  - hostname: hub-sandbox.iuoss.com
    service: http://127.0.0.1:80
  - service: http_status:404           # PHẢI là rule cuối cùng
```

```bash
sudo systemctl restart cloudflared
```

> ⚠️ Còn một file thừa `~/.cloudflared/config.yml` là bản cũ chỉ có 1 hostname.
> systemd dùng bản ở `/etc/cloudflared/`, nhưng ai chạy tay `cloudflared tunnel run`
> bằng user `hhdang` sẽ bốc nhầm bản cũ và 3 hostname còn lại thành 404.

---

## Deploy khi có code mới

### Deploy tất cả (khuyến nghị)

```bash
cd /var/www/apps/hub_iuoss
bash deploy.sh
```

> ⚠️ **`deploy.sh` hardcode `APP_ROOT="/var/www/apps/hub_iuoss"` và `cd` vào đó ngay
> đầu script.** Đứng ở thư mục sandbox gõ `bash deploy.sh` **vẫn deploy PRODUCTION**,
> không báo lỗi gì. Bản clone sandbox có cùng file này nên bẫy càng dễ dính.
> Deploy sandbox phải dùng `deploy-sandbox.sh` — xem §Sandbox.

### Deploy từng phần

```bash
bash deploy.sh backend   # chỉ Django
bash deploy.sh frontend  # chỉ Next.js
```

### Deploy thủ công (nếu cần)

```bash
# Backend
cd /var/www/apps/hub_iuoss
git pull origin main
cd backend
venv/bin/pip install -r requirements.txt -q
venv/bin/python manage.py migrate
venv/bin/python manage.py collectstatic --noinput --clear
sudo systemctl restart iuoss_hub

# Frontend
cd /var/www/apps/hub_iuoss/frontend
npm install
npm run build
pm2 restart iuoss_hub_front
```

---

## Vận hành hàng ngày

### Xem log

```bash
# Gunicorn logs
sudo journalctl -u iuoss_hub -f
tail -f /var/log/apps/hub_iuoss/error.log

# App logs (auth + errors)
tail -f /var/www/apps/hub_iuoss/backend/logs/auth.log
tail -f /var/www/apps/hub_iuoss/backend/logs/app.log

# PM2 logs (Next.js)
pm2 logs iuoss_hub_front
```

### Kiểm tra services

```bash
systemctl is-active iuoss_hub
pm2 status iuoss_hub_front

# Health check backend — trả {"status":"ok","environment":"production","database":true}
curl -s http://127.0.0.1:8002/api/health/

# Frontend
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/login
```

### Monitor PM2

```bash
pm2 monit
```

### Dọn dẹp session cũ

```bash
cd /var/www/apps/hub_iuoss/backend
venv/bin/python manage.py clearsessions
```

---

## Troubleshooting

| Triệu chứng | Nguyên nhân | Fix |
|---|---|---|
| `502 Bad Gateway` trên tất cả | Gunicorn chết | `sudo systemctl restart iuoss_hub` |
| `502` chỉ ở `/` (không phải `/api/`) | PM2 Next.js chết | `pm2 restart iuoss_hub_front` |
| Login lỗi "Tài khoản không đúng" | Không kết nối LDAP | `ldapsearch -H ldap://ldap.hcmiu.edu.vn -x -b dc=hcmiu,dc=edu,dc=vn` |
| `400 Bad Request` | `hub.iuoss.com` chưa trong `ALLOWED_HOSTS` | Thêm vào `backend/.env` → restart |
| Login OK nhưng bị đá ra liên tục / `ERR_TOO_MANY_REDIRECTS` | Django tưởng request là HTTP (thiếu/sai `X-Forwarded-Proto`) | Kiểm tra Nginx dùng `map $hub_forwarded_proto` (xem Bước 8); xác nhận `curl -s http://127.0.0.1:8002/api/health/` trả 200 |
| Mở `:8002/` hoặc `:8002/login/` ra **404** | Đúng như thiết kế — Django chỉ phục vụ `/api/`, giao diện ở Next.js `:3000` | Mở `:3000/login` (local) hoặc `hub.iuoss.com` (prod) |
| Frontend gọi API ra IP `127.0.0.1:8000` | Build dính `NEXT_PUBLIC_API_URL` dev | Xoá `frontend/.env.local` → `npm run build` lại |
| Static files không load | Chưa collectstatic | `python manage.py collectstatic --noinput --clear` |
| Next.js build fail | node_modules cũ | `cd frontend && rm -rf node_modules .next && npm install && npm run build` |
| PM2 không autostart sau reboot | Chưa `pm2 save` + `pm2 startup` | Chạy lại `pm2 save` và lệnh `pm2 startup` in ra |

---

## So sánh với setup cũ (Django monolith)

| | Cũ | Mới |
|---|---|---|
| App path | `hub_iuoss/` (root) | `hub_iuoss/backend/` |
| Frontend | Django templates | Next.js :3000 (PM2) |
| Nginx `/` | → Gunicorn | → Next.js |
| Nginx `/api/` | không có | → Gunicorn |
| Node.js | không cần | v20 LTS |
| Dashboard | không đụng | không đụng |

---

## Sandbox

Dựng 29/08/2026 trên **chính server này**, chạy song song production, bám nhánh
**`sandbox`** (đổi từ `main` ngày 02/09/2026), nhưng **database riêng**. Mục đích:
xem trước và kiểm thử trước khi deploy production.

```
feature/*  →  sandbox  →  (kiểm thử trên hub-sandbox.iuoss.com)  →  main  →  deploy prod
```

> Trước đây sandbox bám `main` nên code chỉ tới sandbox *sau khi* đã vào nhánh đem
> deploy prod — sandbox luôn đi sau, ngược với mục đích của nó. Ngày 02/09/2026
> sandbox từng tụt 4 commit so với production.

> Tài liệu đầy đủ nằm ở **`docs/SANDBOX.md` trong repo `dashboard_iuoss`** — sandbox
> là *một* môi trường trải trên *hai* repo, tách đôi tài liệu là tự tạo ra cặp file
> phải sửa song song. Dưới đây chỉ là phần liên quan tới Hub.

| | Production | Sandbox |
|---|---|---|
| Domain | `hub.iuoss.com` | `hub-sandbox.iuoss.com` |
| Code | `/var/www/apps/hub_iuoss/` | `/var/www/apps/hub_sandbox/` |
| Gunicorn | `127.0.0.1:8002`, 6 worker | `127.0.0.1:8004`, **2 worker** |
| systemd | `iuoss_hub` | `iuoss_hub_sandbox` |
| PM2 | `iuoss_hub_front` — `:3000` | `iuoss_hub_front_sandbox` — `:3001` |
| Nginx | `sites-available/iuoss_hub` | `sites-available/iuoss_hub_sandbox` |
| Log | `/var/log/apps/hub_iuoss/` | `/var/log/apps/hub_sandbox/` |
| `DJANGO_ENV` | `production` | **`staging`** |
| `DB_NAME` | `iuoss_student_data` | `iuoss_student_data_sandbox` |
| `DB_USER` | `iuoss_app` | `iuoss_sandbox` |
| Nhánh git | `main` | **`sandbox`** |

### Chốt an toàn của database

User `iuoss_sandbox` **cố ý không được cấp quyền nào trên DB production**. Hub và
Dashboard trao đổi hoàn toàn qua DB dùng chung chứ không gọi API của nhau, nên chỉ
cần **một dòng `DB_NAME` sai** trong `.env` là app sandbox ghi thẳng vào dữ liệu
thật. Cách phân quyền này biến cấu hình sai thành lỗi permission tức thì thay vì
hỏng dữ liệu âm thầm. **Đừng cấp thêm quyền cho user này.**

DB sandbox chỉ giữ dữ liệu nền đầy đủ + hồ sơ của **5 sinh viên** mẫu.

### Biết mình đang gọi vào môi trường nào

```bash
curl -s https://hub-sandbox.iuoss.com/api/health/
# {"status":"ok","environment":"staging","database":true}     ← sandbox
# {"status":"ok","environment":"production","database":true}  ← prod
```

Giá trị `environment` lấy thẳng từ `settings.DJANGO_ENV` — nhìn response là biết, không
phải đoán theo hostname.

### PM2 config của sandbox nằm NGOÀI repo

`/home/hhdang/sandbox-tools/ecosystem.sandbox.config.js`.

`frontend/ecosystem.config.js` là file được git theo dõi và thuộc về production
(port 3000). Sửa nó trong bản clone sandbox thì mỗi lần `git pull` sẽ xung đột.

### Bẫy: đừng thêm `--hostname 127.0.0.1` cho Next.js

Cờ này **làm hỏng ứng dụng**. `middleware.ts` dựng redirect bằng
`new URL('/login', request.url)`; khi có `--hostname`, Next.js lấy origin từ cờ đó
chứ không từ header `Host`, nên trả `Location: http://localhost:3001/login` thay vì
đường dẫn tương đối — trình duyệt từ internet đi không tới.

Triệu chứng đáng nhớ: **health check nội bộ vẫn xanh**, chỉ lộ khi test qua HTTPS
công khai. Muốn chặn truy cập thẳng vào port thì dùng firewall, không dùng cờ này.

### Cập nhật code sandbox

```bash
bash /home/hhdang/sandbox-tools/deploy-sandbox.sh hub          # chỉ hub
bash /home/hhdang/sandbox-tools/deploy-sandbox.sh all          # cả hai app
bash /home/hhdang/sandbox-tools/deploy-sandbox.sh all --dry-run  # xem trước
```

Từ máy Windows:

```bat
ssh hhdang@10.8.20.33 "bash /home/hhdang/sandbox-tools/deploy-sandbox.sh all"
```

> ⛔ **Không dùng `bash deploy.sh`** — nó hardcode `APP_ROOT="/var/www/apps/hub_iuoss"`
> nên sẽ deploy **production** dù bạn đang đứng trong thư mục sandbox. Xem cảnh báo
> ở §Deploy.

Script tự bỏ qua bước không cần (chỉ `npm ci` khi `package-lock.json` đổi, chỉ restart
Gunicorn khi có `.py` đổi…), và có 4 chốt chặn kiểm trước khi chạy — quan trọng nhất
là **`.env` phải trỏ đúng `iuoss_student_data_sandbox`**. Chi tiết ở `docs/SANDBOX.md §4`
trong repo `dashboard_iuoss`.
