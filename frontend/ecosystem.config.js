module.exports = {
  apps: [
    {
      name: 'iuoss_hub_front',
      script: 'node_modules/.bin/next',
      args: 'start --port 3000',
      cwd: '/var/www/apps/iuoss_hub/frontend',
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        DJANGO_API_URL: 'http://127.0.0.1:8002',
      },
    },
  ],
};
