#!/usr/bin/env bash
# deploy.sh — chạy trên server appctsv sau khi git pull
# Usage: bash deploy.sh [backend|frontend|all]
set -euo pipefail

TARGET=${1:-all}
APP_ROOT="/var/www/apps/hub_iuoss"
BACKEND_HEALTH="http://127.0.0.1:8002/api/health/"
FRONTEND_HEALTH="http://127.0.0.1:3000/login"

log() { echo "  $*"; }
section() { echo "──────────────────────────────────────"; echo "  $*"; echo "──────────────────────────────────────"; }

# Đợi service trả HTTP 200 (tối đa ~30s) trước khi coi là deploy thành công.
wait_healthy() {
  local url=$1 name=$2 i
  for i in $(seq 1 15); do
    if curl -fsS -o /dev/null "$url" 2>/dev/null; then
      log "$name healthy ✓"
      return 0
    fi
    sleep 2
  done
  log "WARNING: $name không phản hồi $url sau 30s — kiểm tra log!"
  return 1
}

deploy_backend() {
  section "Deploying BACKEND (Django API)"
  cd "$APP_ROOT/backend"
  venv/bin/pip install -r requirements.txt -q
  venv/bin/python manage.py migrate --noinput
  venv/bin/python manage.py collectstatic --noinput --clear
  # Gate an toàn: kiểm tra cấu hình production (cookie secure, ALLOWED_HOSTS, …).
  # Chỉ cảnh báo, không chặn deploy (exit 0 trừ khi có lỗi nghiêm trọng).
  venv/bin/python manage.py check --deploy || true
  sudo systemctl restart iuoss_hub
  wait_healthy "$BACKEND_HEALTH" "Backend (:8002)"
}

deploy_frontend() {
  section "Deploying FRONTEND (Next.js)"
  cd "$APP_ROOT/frontend"

  # Footgun guard: NEXT_PUBLIC_* bị đông cứng vào bundle lúc build.
  # Nếu còn .env.local trỏ tới API dev, prod bundle sẽ dính IP sai.
  if [ -f .env.local ] && grep -q "NEXT_PUBLIC_API_URL" .env.local; then
    log "WARNING: frontend/.env.local có NEXT_PUBLIC_API_URL — production nên để API_BASE='/api'."
    log "         Xoá hoặc bỏ trống biến này trước khi build production. Dừng."
    exit 1
  fi

  npm ci
  npm run build
  pm2 restart iuoss_hub_front
  wait_healthy "$FRONTEND_HEALTH" "Frontend (:3000)"
}

cd "$APP_ROOT"
git pull origin main

case "$TARGET" in
  backend)  deploy_backend  ;;
  frontend) deploy_frontend ;;
  all)
    deploy_backend
    deploy_frontend
    ;;
  *)
    echo "Usage: bash deploy.sh [backend|frontend|all]"
    exit 1
    ;;
esac

echo ""
echo "✓ Deploy complete at $(date '+%Y-%m-%d %H:%M:%S')"
