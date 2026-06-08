# Runbook — Triển khai iuoss_hub trên server appctsv

> **File này là CONTEXT cho AI thực thi cài đặt.** Đọc toàn bộ trước khi chạy lệnh.
> Mỗi PHASE có **GATE kiểm tra** — không qua GATE thì DỪNG, không sang phase sau.
> Viết cho người/AI có quyền `sudo` trên `appctsv`.

---

## 0. Bối cảnh & Nguyên tắc bất biến

`iuoss_hub` (`hub.iuoss.com`) là **ứng dụng THỨ HAI** trên server `appctsv`, chạy **song song**
với dashboard hiện có (`dashboard.iuoss.com` / service `iuoss_app`). Cả hai dùng **chung 1 MySQL**
và **chung 1 Cloudflare Tunnel**.

```
                    Cloudflare Edge  (Tunnel ID: e0dcace8)
                              │  QUIC/TLS
                    cloudflared (trên appctsv)
                              │  HTTP → 127.0.0.1:80
                         Nginx :80   ──► định tuyến theo server_name (Host header)
        ┌─────────────────────────────────┴─────────────────────────────────┐
        │ dashboard.iuoss.com (CÓ SẴN — KHÔNG ĐỘNG VÀO)                       │
        │   /static/ → /var/www/apps/iuoss_app/staticfiles/                   │
        │   /        → 127.0.0.1:8001  (Gunicorn, systemd: iuoss_app)         │
        ├─────────────────────────────────────────────────────────────────────┤
        │ hub.iuoss.com  (CÀI MỚI — nội dung runbook này)                      │
        │   /static/ → /var/www/apps/iuoss_hub/backend/staticfiles/           │
        │   /api/    → 127.0.0.1:8002  (Gunicorn, systemd: iuoss_hub)          │
        │   /        → 127.0.0.1:3000  (Next.js,  PM2: iuoss_hub_front)        │
        └─────────────────────────────────────────────────────────────────────┘
                              │
                    MySQL 8.4.9 @ 127.0.0.1:3306  (DB: iuoss_student_data — DÙNG CHUNG)
```

### Nguyên tắc — đọc kỹ, vi phạm là hỏng production

1. **KHÔNG sửa/khởi động lại** `iuoss_app`, file Nginx của dashboard, hay cấu hình dashboard.
2. **KHÔNG chạy `makemigrations`.** Hub quản lý schema thủ công (`MIGRATION_MODULES` tắt cho `core`, `students`).
   Chỉ chạy `migrate` (tạo `django_session`) và `docs/schema.sql` (tạo bảng `hub_*`).
3. **KHÔNG ghi** vào bảng do dashboard sở hữu (`students`, `departments`, `tickets`, …). Hub chỉ ghi `hub_*`.
4. **Bám convention dashboard:** cùng user deploy, cùng phiên bản Python, cùng kiểu systemd/Nginx.
   Phase 1 sẽ KHẢO SÁT dashboard để lấy các giá trị này — không đoán.
5. Hub dùng **port mới 8002 (Gunicorn) + 3000 (Next.js)**, cả hai **bind 127.0.0.1** → không mở cổng public, không đụng firewall.

### Port map sau khi cài xong (tham chiếu)

| Port | Bind | Dịch vụ | Trạng thái |
|---|---|---|---|
| 80 | 0.0.0.0 | Nginx | có sẵn, thêm server block |
| 8001 | 127.0.0.1 | Gunicorn dashboard (`iuoss_app`) | có sẵn — KHÔNG đụng |
| **8002** | **127.0.0.1** | **Gunicorn hub (`iuoss_hub`)** | **MỚI** |
| **3000** | **127.0.0.1** | **Next.js hub (PM2 `iuoss_hub_front`)** | **MỚI** |
| 3306 | 127.0.0.1 | MySQL | dùng chung |
| 8888 | 0.0.0.0 | phpMyAdmin | KHÔNG đụng |
| 9090 | 0.0.0.0 | Cockpit | KHÔNG đụng |

---

## 1. PHASE 1 — Khảo sát hiện trạng (chạy TRƯỚC, không cài gì)

Mục tiêu: lấy giá trị thật để mirror dashboard. Chạy và GHI LẠI kết quả.

```bash
# 1.1 User deploy + cấu hình systemd của dashboard (mirror User=, ExecStart, venv path)
systemctl cat iuoss_app | grep -E 'User=|WorkingDirectory=|ExecStart='

# 1.2 Chủ sở hữu thư mục app (deploy user)
stat -c '%U:%G' /var/www/apps/iuoss_app
ls -la /var/www/apps/

# 1.3 Python version dashboard đang dùng (phải khớp khi tạo venv hub)
/var/www/apps/iuoss_app/venv/bin/python --version

# 1.4 Node.js đã có chưa? (dashboard thuần Django nên thường CHƯA có)
node --version 2>/dev/null || echo "NODE: CHƯA CÀI"
pm2 --version 2>/dev/null || echo "PM2: CHƯA CÀI"

# 1.5 Cấu hình Nginx dashboard (mirror pattern proxy/header)
ls /etc/nginx/sites-enabled/
grep -Rn 'dashboard.iuoss.com' /etc/nginx/sites-enabled/ /etc/nginx/sites-available/ 2>/dev/null

# 1.6 Cấu hình cloudflared (tìm file config + ingress hiện tại)
sudo cloudflared tunnel list
sudo find /etc/cloudflared /root/.cloudflared /home/*/.cloudflared -name '*.yml' 2>/dev/null
# Mở file config tìm được, xem khối ingress của dashboard.iuoss.com:
#   sudo cat <ĐƯỜNG_DẪN_CONFIG>

# 1.7 Thông tin DB dùng chung (đọc từ .env dashboard — KHÔNG in password ra chỗ công cộng)
sudo grep -E '^DB_' /var/www/apps/iuoss_app/.env

# 1.8 Hai port mới phải còn trống
ss -ltnp | grep -E ':(8002|3000)' || echo "8002 & 3000 ĐỀU TRỐNG — OK"
```

> 📝 **GHI LẠI:** `DEPLOY_USER` (1.1/1.2), `PYTHON_BIN` (1.3), `NODE đã có?` (1.4),
> `NGINX_DIR` (1.5), `CLOUDFLARED_CONFIG` path + nội dung ingress (1.6), `DB_NAME/USER/PASSWORD` (1.7).
> Các phase sau dùng `<DEPLOY_USER>`, `<PYTHON_BIN>`, `<CLOUDFLARED_CONFIG>` — thay bằng giá trị thật.

### ✅ GATE 1
- [ ] Biết `<DEPLOY_USER>` (vd `hhdang`) và Python version (kỳ vọng 3.12 trên Ubuntu 24.04)
- [ ] Biết đường dẫn file cloudflared config + thấy ingress `dashboard.iuoss.com`
- [ ] Có DB credentials dùng chung
- [ ] Port 8002 và 3000 đều trống

---

## 2. PHASE 2 — Bí mật cần con người cung cấp (KHÔNG có sẵn trên server)

Hub cần các bí mật mà dashboard KHÔNG có. Hỏi quản trị viên TRƯỚC khi tiếp tục:

| Biến | Lấy từ đâu |
|---|---|
| `LDAP_BIND_PASSWORD` | Mật khẩu **plain text** của service account `cn=ctsv`. Dashboard không dùng LDAP → server chưa có. **Bắt buộc hỏi admin.** |
| `SECRET_KEY` | Sinh mới ở Phase 4 (không tái dùng của dashboard) |
| `DB_PASSWORD` | Dùng lại của dashboard (lấy ở bước 1.7) |

### ✅ GATE 2
- [ ] Đã có `LDAP_BIND_PASSWORD` trong tay. Nếu chưa → DỪNG, chờ admin.

---

## 3. PHASE 3 — Lấy source code lên server

Repo: `https://github.com/Mluvislp/hub_iuoss.git` — monorepo `backend/` + `frontend/`.
Clone vào `/var/www/apps/iuoss_hub` (cùng cấp với `iuoss_app`), chủ sở hữu = `<DEPLOY_USER>`.

### Cách bố trí quyền truy cập git (chọn 1)

**Cách A — SSH deploy key (khuyến nghị: read-only, riêng cho repo này):**
```bash
sudo -u <DEPLOY_USER> ssh-keygen -t ed25519 -f /home/<DEPLOY_USER>/.ssh/id_hub_deploy -N "" -C "appctsv-hub-deploy"
sudo -u <DEPLOY_USER> cat /home/<DEPLOY_USER>/.ssh/id_hub_deploy.pub
# → Dán public key này vào: GitHub repo hub_iuoss → Settings → Deploy keys → Add (KHÔNG tick write).
# Cấu hình SSH dùng đúng key cho host này:
sudo -u <DEPLOY_USER> bash -c 'cat >> ~/.ssh/config <<EOF

Host github-hub
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_hub_deploy
  IdentitiesOnly yes
EOF'
# Clone qua alias:
cd /var/www/apps
sudo -u <DEPLOY_USER> git clone git@github-hub:Mluvislp/hub_iuoss.git iuoss_hub
```

**Cách B — HTTPS + Personal Access Token (nhanh, nếu đã quen):**
```bash
cd /var/www/apps
sudo -u <DEPLOY_USER> git clone https://<PAT>@github.com/Mluvislp/hub_iuoss.git iuoss_hub
```

```bash
# Quyền thư mục (mirror iuoss_app)
sudo chown -R <DEPLOY_USER>:<DEPLOY_USER> /var/www/apps/iuoss_hub
ls /var/www/apps/iuoss_hub   # phải thấy: backend  frontend  docs  deploy.sh  CLAUDE.md
```

### ✅ GATE 3
- [ ] `/var/www/apps/iuoss_hub/{backend,frontend,docs,deploy.sh}` tồn tại, owner = `<DEPLOY_USER>`
- [ ] `git -C /var/www/apps/iuoss_hub pull` chạy không lỗi auth

---

## 4. PHASE 4 — Backend (Django API, :8002)

```bash
cd /var/www/apps/iuoss_hub/backend

# 4.1 venv — dùng ĐÚNG python như dashboard (vd python3.12)
<PYTHON_BIN> -m venv venv      # <PYTHON_BIN> = python từ bước 1.3, vd /usr/bin/python3.12
venv/bin/pip install --upgrade pip
venv/bin/pip install -r requirements.txt

# 4.2 Sinh SECRET_KEY (chuỗi 50 ký tự — đủ dài cho ký JWT)
venv/bin/python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"
```

**4.3 Tạo `/var/www/apps/iuoss_hub/backend/.env`** (điền giá trị thật):
```env
DJANGO_ENV=production
SECRET_KEY=<dán chuỗi vừa sinh ở 4.2>
ALLOWED_HOSTS=hub.iuoss.com,10.8.20.33,127.0.0.1
FRONTEND_ORIGINS=https://hub.iuoss.com

DB_NAME=iuoss_student_data
DB_USER=iuoss_app
DB_PASSWORD=<DB_PASSWORD dùng chung — bước 1.7>
DB_HOST=127.0.0.1
DB_PORT=3306
DB_CONN_MAX_AGE=60

TIME_ZONE=Asia/Ho_Chi_Minh

LDAP_SERVER_URI=ldap://ldap.hcmiu.edu.vn:389
LDAP_BIND_DN=cn=ctsv,dc=hcmiu,dc=edu,dc=vn
LDAP_BIND_PASSWORD=<LDAP_BIND_PASSWORD — Phase 2>
LDAP_SEARCH_BASE=dc=hcmiu,dc=edu,dc=vn
LDAP_USER_ATTR=uid
```
> `DJANGO_ENV=production` tự đặt `DEBUG=False` + bật secure-cookie + `SECURE_PROXY_SSL_HEADER`.

```bash
# 4.4 Tạo bảng hub_* (CHỈ bảng hub_*, KHÔNG đụng bảng dashboard). An toàn vì dùng CREATE TABLE IF NOT EXISTS.
mysql -u iuoss_app -p iuoss_student_data < /var/www/apps/iuoss_hub/docs/schema.sql

# 4.5 Tạo bảng django_session (migration sessions; core/students đã bị tắt migration)
venv/bin/python manage.py migrate

# 4.6 Static cho Django (DRF/admin). Tạo thư mục static gốc nếu chưa có để tránh warning.
venv/bin/python manage.py collectstatic --noinput

# 4.7 Kiểm tra cấu hình production
venv/bin/python manage.py check --deploy   # chỉ cảnh báo HSTS/SSL-redirect là OK; KHÔNG được có ERROR
```

**4.8 Thư mục log** (mirror dashboard nếu dashboard log ở `/var/log/apps/...`):
```bash
sudo mkdir -p /var/log/apps/iuoss_hub
sudo chown <DEPLOY_USER>:<DEPLOY_USER> /var/log/apps/iuoss_hub
```

**4.9 systemd `iuoss_hub`** — `sudo nano /etc/systemd/system/iuoss_hub.service`:
```ini
[Unit]
Description=IUOSS Hub API (Gunicorn)
After=network.target mysql.service
Requires=mysql.service

[Service]
Type=simple
User=<DEPLOY_USER>
WorkingDirectory=/var/www/apps/iuoss_hub/backend
ExecStart=/var/www/apps/iuoss_hub/backend/venv/bin/gunicorn \
    config.wsgi:application \
    --bind 127.0.0.1:8002 \
    --workers 3 \
    --timeout 60 \
    --access-logfile /var/log/apps/iuoss_hub/access.log \
    --error-logfile /var/log/apps/iuoss_hub/error.log
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now iuoss_hub
sudo systemctl status iuoss_hub --no-pager
```

### ✅ GATE 4
```bash
curl -s http://127.0.0.1:8002/api/health/
# Kỳ vọng: {"status":"ok","environment":"production","database":true}
```
- [ ] Health trả `"database":true` và HTTP 200
- [ ] `systemctl is-active iuoss_hub` = `active`
- [ ] `check --deploy` không có dòng `ERROR`
- [ ] `iuoss_app` (dashboard) VẪN `active` — chưa đụng gì tới nó

---

## 5. PHASE 5 — Node.js + Frontend (Next.js, :3000)

```bash
# 5.1 Cài Node 20 LTS (nếu bước 1.4 báo CHƯA CÀI)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version    # phải >= 20.x
sudo npm install -g pm2

# 5.2 Build frontend. QUAN TRỌNG: KHÔNG tạo frontend/.env.local trên server.
#     NEXT_PUBLIC_* bị đông cứng vào bundle lúc build. Để trống → API gọi '/api' (relative)
#     → Nginx định tuyến /api/ → Gunicorn :8002. Có .env.local trỏ API dev = HỎNG production.
cd /var/www/apps/iuoss_hub/frontend
test -f .env.local && echo "⚠️ CÓ .env.local — XOÁ trước khi build: rm .env.local" || echo "OK: không có .env.local"
sudo -u <DEPLOY_USER> npm ci
sudo -u <DEPLOY_USER> npm run build

# 5.3 Khởi động qua PM2 dưới quyền <DEPLOY_USER> (ecosystem.config.js đã có sẵn trong repo)
sudo -u <DEPLOY_USER> pm2 start ecosystem.config.js
sudo -u <DEPLOY_USER> pm2 save

# 5.4 Cho PM2 tự chạy khi reboot — chạy lệnh pm2 startup IN RA rồi thực thi dòng sudo nó gợi ý
sudo -u <DEPLOY_USER> pm2 startup systemd -u <DEPLOY_USER> --hp /home/<DEPLOY_USER>
# → copy & chạy đúng lệnh "sudo env PATH=... pm2 startup ..." mà nó in ra
```

### ✅ GATE 5
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/login   # kỳ vọng 200
sudo -u <DEPLOY_USER> pm2 status iuoss_hub_front                        # status: online
```
- [ ] `/login` trả 200 từ :3000
- [ ] PM2 `iuoss_hub_front` = online, đã `pm2 save`

---

## 6. PHASE 6 — Nginx (server block cho hub.iuoss.com)

> ⚠️ **Lỗi go-live kinh điển:** Cloudflare Tunnel forward tới `localhost:80` bằng **HTTP**,
> nên `$scheme` = `http`. Django (có `SECURE_PROXY_SSL_HEADER`) sẽ tưởng request không bảo mật
> → secure-cookie hỏng / **redirect loop** sau khi đăng nhập. Phải dùng `map` ép `X-Forwarded-Proto`.

**6.1** `sudo nano /etc/nginx/sites-available/iuoss_hub`:
```nginx
# Ưu tiên X-Forwarded-Proto cloudflared gửi; nếu rỗng → https (site luôn HTTPS ra ngoài).
# Đặt map ở scope http — nếu trùng tên với block khác, đổi tên biến.
map $http_x_forwarded_proto $hub_forwarded_proto {
    default $http_x_forwarded_proto;
    ""      https;
}

server {
    listen 80;
    server_name hub.iuoss.com;

    location /static/ {
        alias /var/www/apps/iuoss_hub/backend/staticfiles/;
        expires 7d;
        add_header Cache-Control "public";
    }

    location /api/ {
        proxy_pass         http://127.0.0.1:8002;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $hub_forwarded_proto;
        proxy_read_timeout 60;
    }

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
> Nếu `nginx -t` báo `"map" directive is duplicate` (đã có map cùng tên ở nơi khác), đổi
> `$hub_forwarded_proto` thành tên khác duy nhất, hoặc bỏ block map và set thẳng
> `proxy_set_header X-Forwarded-Proto https;` (an toàn vì site này luôn HTTPS).

```bash
# 6.2 Bật site, kiểm tra cú pháp, reload (reload KHÔNG làm gián đoạn dashboard)
sudo ln -s /etc/nginx/sites-available/iuoss_hub /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### ✅ GATE 6
```bash
# Giả lập request qua tunnel (Host header + proto https)
curl -s -H "Host: hub.iuoss.com" -H "X-Forwarded-Proto: https" http://127.0.0.1/api/health/
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: hub.iuoss.com" http://127.0.0.1/login
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: dashboard.iuoss.com" http://127.0.0.1/   # dashboard VẪN sống
```
- [ ] `/api/health/` (Host hub) trả `"database":true`
- [ ] `/login` (Host hub) trả 200
- [ ] Dashboard (Host dashboard) vẫn trả như cũ (200/302) — không bị `nginx -t`/reload làm hỏng

---

## 7. PHASE 7 — Cloudflare Tunnel (thêm hub.iuoss.com vào tunnel CÓ SẴN)

Dùng lại tunnel `e0dcace8` (KHÔNG tạo tunnel mới).

```bash
# 7.1 Tạo DNS route (CNAME hub.iuoss.com → tunnel)
sudo cloudflared tunnel route dns e0dcace8 hub.iuoss.com
```

**7.2** Sửa `<CLOUDFLARED_CONFIG>` (file tìm ở bước 1.6). Thêm ingress hub.iuoss.com
**TRƯỚC** dòng catch-all `service: http_status:404` (ingress xét theo thứ tự):
```yaml
ingress:
  - hostname: dashboard.iuoss.com      # GIỮ NGUYÊN
    service: http://localhost:80
  - hostname: hub.iuoss.com            # THÊM DÒNG NÀY
    service: http://localhost:80
  - service: http_status:404           # PHẢI là rule cuối cùng
```
```bash
# 7.3 Kiểm tra config trước khi restart
sudo cloudflared tunnel ingress validate
sudo systemctl restart cloudflared
sudo systemctl status cloudflared --no-pager
```

### ✅ GATE 7
- [ ] `cloudflared tunnel ingress validate` = OK
- [ ] `cloudflared` active sau restart
- [ ] `dashboard.iuoss.com` ngoài Internet vẫn truy cập bình thường

---

## 8. PHASE 8 — Nghiệm thu end-to-end (từ Internet)

Mở trình duyệt ngoài mạng trường:

1. `https://hub.iuoss.com/login` → hiện trang login split-screen. **Phải là HTTPS, không cảnh báo cert.**
2. Đăng nhập bằng tài khoản LDAP trường (cần mạng trường/VPN để Django chạm tới `ldap.hcmiu.edu.vn`).
3. Vào được Dashboard, thấy thông tin sinh viên, **KHÔNG bị đá về /login** (xác nhận cookie HTTPS OK).
4. Tạo 1 yêu cầu giấy tờ → thành công → thấy trong danh sách.
5. F5 / mở tab mới → vẫn đăng nhập (session decode từ JWT).

```bash
# Kiểm tra log trong lúc test
tail -f /var/www/apps/iuoss_hub/backend/logs/auth.log     # LOGIN_SUCCESS, CONFIRMATION_REQUEST
sudo -u <DEPLOY_USER> pm2 logs iuoss_hub_front --lines 30
```

### ✅ GATE 8 — Go-live hoàn tất
- [ ] Login → Dashboard → tạo yêu cầu, tất cả qua `https://hub.iuoss.com`
- [ ] Không có redirect loop sau login
- [ ] `dashboard.iuoss.com` vẫn hoạt động bình thường (kiểm tra lần cuối)

---

## 9. Deploy code mới (lần sau)

Repo có sẵn `deploy.sh` ở gốc, tự làm: `git pull` → backend (pip/migrate/collectstatic/check/restart)
→ frontend (npm ci/build/pm2 restart) + health check sau mỗi service.

```bash
cd /var/www/apps/iuoss_hub
bash deploy.sh            # cả hai
bash deploy.sh backend    # chỉ Django
bash deploy.sh frontend   # chỉ Next.js
```
> `deploy.sh` sẽ **chặn build frontend** nếu phát hiện `frontend/.env.local` còn `NEXT_PUBLIC_API_URL`,
> và **poll `/api/health/`** sau restart. Nếu nó báo unhealthy → xem mục 10.

---

## 10. Troubleshooting

| Triệu chứng | Nguyên nhân | Xử lý |
|---|---|---|
| Login OK rồi bị đá ra liên tục / `ERR_TOO_MANY_REDIRECTS` | Django tưởng request HTTP (thiếu/sai `X-Forwarded-Proto`) | Xem Phase 6: Nginx phải set `X-Forwarded-Proto $hub_forwarded_proto`. `curl http://127.0.0.1:8002/api/health/` phải 200 |
| `502` chỉ ở `hub.iuoss.com/api/` | Gunicorn hub chết | `sudo systemctl restart iuoss_hub` ; xem `/var/log/apps/iuoss_hub/error.log` |
| `502` ở `hub.iuoss.com/` (không phải /api/) | PM2 Next.js chết | `pm2 restart iuoss_hub_front` ; `pm2 logs iuoss_hub_front` |
| Login báo "Tài khoản không đúng" dù đúng mật khẩu | Server không chạm được LDAP, hoặc `LDAP_BIND_PASSWORD` sai | `ldapsearch -H ldap://ldap.hcmiu.edu.vn -x -b dc=hcmiu,dc=edu,dc=vn` ; kiểm tra `.env` |
| Frontend gọi API ra `127.0.0.1:8000` | Build dính `NEXT_PUBLIC_API_URL` dev | `rm frontend/.env.local` → `npm run build` lại |
| `400 Bad Request` | `hub.iuoss.com` chưa trong `ALLOWED_HOSTS` | Thêm vào `backend/.env` → `systemctl restart iuoss_hub` |
| Template Django `403 CSRF` ở /login | (chỉ xảy ra nếu Nginx lỡ route / về Django) | Xác nhận `location /` trỏ `:3000`, không trỏ `:8002` |
| `nginx -t` lỗi `duplicate map` | Đã có `map` cùng tên ở config khác | Đổi tên biến `$hub_forwarded_proto`, hoặc set thẳng `X-Forwarded-Proto https` |
| Dashboard bị ảnh hưởng | Đã lỡ sửa file của dashboard | Hoàn nguyên file dashboard; hub chỉ thêm file MỚI, không sửa file cũ |

---

## 11. Rollback (gỡ hub, trả server về trạng thái chỉ-dashboard)

```bash
sudo systemctl disable --now iuoss_hub
sudo -u <DEPLOY_USER> pm2 delete iuoss_hub_front && sudo -u <DEPLOY_USER> pm2 save
sudo rm /etc/nginx/sites-enabled/iuoss_hub && sudo nginx -t && sudo systemctl reload nginx
# Gỡ ingress hub.iuoss.com khỏi <CLOUDFLARED_CONFIG> → sudo systemctl restart cloudflared
# (Tuỳ chọn) DROP các bảng hub_* nếu muốn dọn DB — KHÔNG đụng bảng khác.
```
Dashboard không bị ảnh hưởng vì hub chỉ **thêm** service/file, không sửa của dashboard.

---

## Phụ lục — Checklist tóm tắt cho người thực thi

```
[ ] P1 Khảo sát: DEPLOY_USER, PYTHON_BIN, cloudflared config, DB creds, port 8002/3000 trống
[ ] P2 Có LDAP_BIND_PASSWORD (hỏi admin)
[ ] P3 Clone repo → /var/www/apps/iuoss_hub (owner DEPLOY_USER)
[ ] P4 venv + .env + schema.sql + migrate + collectstatic + systemd iuoss_hub → /api/health/ ok
[ ] P5 Node20 + PM2 + npm ci + build + pm2 start/save/startup → /login :3000 = 200
[ ] P6 Nginx server block (map X-Forwarded-Proto) → nginx -t → reload; dashboard còn sống
[ ] P7 cloudflared: route dns + ingress hub.iuoss.com (trước 404) → validate → restart
[ ] P8 Test thật https://hub.iuoss.com: login → dashboard → tạo yêu cầu; dashboard còn sống
```
