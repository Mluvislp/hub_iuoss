#!/usr/bin/env bash
# deploy.sh — chạy trên server appctsv sau khi git pull
# Usage: bash deploy.sh [backend|frontend|all]
set -euo pipefail

TARGET=${1:-all}
APP_ROOT="/var/www/apps/iuoss_hub"

deploy_backend() {
  echo "──────────────────────────────────────"
  echo "  Deploying BACKEND (Django API)"
  echo "──────────────────────────────────────"
  cd "$APP_ROOT/backend"
  venv/bin/pip install -r requirements.txt -q
  venv/bin/python manage.py migrate --noinput
  venv/bin/python manage.py collectstatic --noinput --clear
  sudo systemctl restart iuoss_hub
  echo "  Backend OK — Gunicorn restarted on :8002"
}

deploy_frontend() {
  echo "──────────────────────────────────────"
  echo "  Deploying FRONTEND (Next.js)"
  echo "──────────────────────────────────────"
  cd "$APP_ROOT/frontend"
  npm install --production=false
  npm run build
  pm2 restart iuoss_hub_front
  echo "  Frontend OK — Next.js restarted on :3000"
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
