module.exports = {
  apps: [
    {
      name: 'iuoss_hub_front',
      script: 'node_modules/.bin/next',
      args: 'start --port 3000',
      cwd: '/var/www/apps/hub_iuoss/frontend',
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        // NEXT_PUBLIC_API_URL không set ở đây
        // → API_BASE = '/api' → Nginx định tuyến /api/ → Gunicorn :8002
        // Xem frontend/.env.example để biết chi tiết.
      },
    },
  ],
};
