const configuredDistDir = process.env.NEXT_DIST_DIR?.trim();

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Tách output của `next dev` khỏi `.next` dùng cho production build.
  // Nếu dùng chung, `next build` có thể thay các chunk mà dev server đang giữ.
  distDir: configuredDistDir || '.next',

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
