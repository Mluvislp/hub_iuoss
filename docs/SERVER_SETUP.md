# IUOSS Hub — production (appctsv)

Hạ tầng chung (traffic, port, đường dẫn cả hai app, cảnh báo cổng mở LAN): `dashboard_iuoss/docs/DEPLOY.md`. Sandbox:
`dashboard_iuoss/docs/SANDBOX.md`. File này chỉ có phần riêng của Hub.

`hub.iuoss.com`: `/api/` → Gunicorn `:8002` (systemd `iuoss_hub`, 6 worker) · `/static/` → `backend/staticfiles/` · `/` →
Next.js `:3000` (PM2 `iuoss_hub_front`). Code `/var/www/apps/hub_iuoss/`, venv `backend/venv/`, `.env` `backend/.env`,
log `/var/log/apps/hub_iuoss/` + `backend/logs/{auth,app}.log`, PM2 config `frontend/ecosystem.config.js` (của prod).
`graduation.iuoss.com` proxy vào cùng app (Nginx `iuoss_graduation`).

## Deploy

```bash
cd /var/www/apps/hub_iuoss && bash deploy.sh [backend|frontend]
```

- ⚠️ `deploy.sh` hardcode `APP_ROOT="/var/www/apps/hub_iuoss"` — chạy trong thư mục sandbox **vẫn deploy prod**. Sandbox
  dùng `deploy-sandbox.sh hub`.
- **Không tạo `frontend/.env.local` trên server** (`NEXT_PUBLIC_*` đông cứng vào bundle; `deploy.sh` chặn). Để trống ⇒
  API gọi `/api` tương đối, Nginx định tuyến.
- SQL nâng cấp schema chạy tay **trước** khi deploy ([`INSURANCE.md §5`](INSURANCE.md), `dashboard_iuoss/docs/sql/`).

## Cài lần đầu (tóm tắt)

```bash
# Node ≥ 20 + pm2 (server đang chạy Node 24)
cd /var/www/apps && git clone <repo> hub_iuoss && cd hub_iuoss/backend
python3.12 -m venv venv && venv/bin/pip install -r requirements.txt
cp .env.example .env                                   # DJANGO_ENV=production tự đặt DEBUG=False
mysql -u iuoss_app -p iuoss_student_data < ../docs/schema.sql   # bảng hub_* lần đầu
venv/bin/python manage.py migrate && venv/bin/python manage.py collectstatic --noinput   # migrate chỉ tạo django_session
sudo mkdir -p /var/log/apps/hub_iuoss && sudo chown hhdang:hhdang /var/log/apps/hub_iuoss
cd ../frontend && npm install && npm run build && pm2 start ecosystem.config.js && pm2 save && pm2 startup
```

`.env` prod: `DJANGO_ENV=production` · `SECRET_KEY` · `ALLOWED_HOSTS=hub.iuoss.com,graduation.iuoss.com,10.8.20.33,127.0.0.1`
· `FRONTEND_ORIGINS=https://hub.iuoss.com` (CORS + CSRF) · `DB_*` (`DB_CONN_MAX_AGE=60`) · `TIME_ZONE=Asia/Ho_Chi_Minh` ·
`LDAP_*` · `MS_*` · `FEATURE_*` · (tuỳ chọn) `SECURE_HSTS_*`.

**systemd** `/etc/systemd/system/iuoss_hub.service`: `User=hhdang`, `WorkingDirectory=…/backend`,
`gunicorn config.wsgi:application --bind 127.0.0.1:8002 --workers 6 --timeout 60 --access-logfile … --error-logfile …`,
`Restart=on-failure`, `Requires=mysql.service`.

**Nginx** `/etc/nginx/sites-available/iuoss_hub` — ⚠️ Cloudflare Tunnel tới `:80` bằng HTTP nên `$scheme` = `http`; truyền
thẳng là hỏng secure cookie / redirect loop. Bắt buộc dùng `map`:

```nginx
map $http_x_forwarded_proto $hub_forwarded_proto { default $http_x_forwarded_proto; "" https; }
server {
    listen 80; server_name hub.iuoss.com;
    location /static/ { alias /var/www/apps/hub_iuoss/backend/staticfiles/; expires 7d; }
    location /api/ { proxy_pass http://127.0.0.1:8002; proxy_set_header Host $host;
                     proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
                     proxy_set_header X-Forwarded-Proto $hub_forwarded_proto; proxy_read_timeout 60; }
    location / { proxy_pass http://127.0.0.1:3000; proxy_set_header Host $host;
                 proxy_set_header X-Forwarded-Proto $hub_forwarded_proto;
                 proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; }
}
```

**Cloudflare Tunnel**: `cloudflared tunnel route dns <TUNNEL_ID> <hostname>`; ingress ở `/etc/cloudflared/config.yml`
(mọi hostname → `http://127.0.0.1:80`, rule cuối `http_status:404`). ⚠️ `~/.cloudflared/config.yml` là bản cũ 1
hostname — chạy tay `cloudflared tunnel run` sẽ bốc nhầm.

## Vận hành

```bash
sudo journalctl -u iuoss_hub -f ; tail -f /var/log/apps/hub_iuoss/error.log
tail -f backend/logs/auth.log backend/logs/app.log ; pm2 logs iuoss_hub_front
curl -s http://127.0.0.1:8002/api/health/      # {"status":"ok","environment":"production","database":true}
```

| Triệu chứng | Nguyên nhân → sửa |
|---|---|
| 502 mọi nơi / chỉ ở `/` | `restart iuoss_hub` / `pm2 restart iuoss_hub_front` |
| "Tài khoản không đúng" hàng loạt | mất kết nối LDAP: `ldapsearch -H ldap://ldap.hcmiu.edu.vn -x -b dc=hcmiu,dc=edu,dc=vn` |
| 400 Bad Request | tên miền thiếu trong `ALLOWED_HOSTS` |
| Bị đá ra / `ERR_TOO_MANY_REDIRECTS` | Nginx không dùng `map $hub_forwarded_proto` |
| `:8002/` ra 404 | đúng thiết kế — Django chỉ phục vụ `/api/` |
| Frontend gọi `127.0.0.1:8002` | build dính `.env.local` dev → xoá, build lại |
| Build fail | `rm -rf node_modules .next && npm install && npm run build` |
| PM2 không tự chạy sau reboot | `pm2 save` + lệnh `pm2 startup` in ra |
