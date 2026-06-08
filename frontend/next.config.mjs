/** @type {import('next').NextConfig} */
const nextConfig = {
  // Tắt redirect 308 khi URL có trailing slash — tránh xung đột với Django URLs.
  skipTrailingSlashRedirect: true,

  // KHÔNG dùng rewrite proxy cho /api/*.
  //
  // Lý do: Next.js strip trailing slash trước khi rewrite chạy, khiến
  // Django nhận URL sai → 301 → redirect loop với POST requests.
  //
  // Thay thế:
  //   Dev:  set NEXT_PUBLIC_API_URL=http://127.0.0.1:8000/api (browser → Django trực tiếp, CORS ok)
  //   Prod: không set → API_BASE = '/api' → Nginx định tuyến /api/ → Gunicorn :8002
};

export default nextConfig;
