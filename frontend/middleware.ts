import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/login'];

// Trang nhận kết quả từ Microsoft: luôn cho qua, KHÔNG xét hub_token.
// - chưa có token (trường hợp thường) → chặn là đá về /login ngay trước bước đổi code
// - đã có token cũ → vẫn phải chạy tiếp, vì sinh viên có thể đang cố đăng nhập
//   bằng tài khoản khác; đá sang /dashboard sẽ giữ nguyên phiên cũ một cách khó hiểu
// Trang Lễ tốt nghiệp: công khai, có phiên xác minh RIÊNG (lib/graduation.ts) — không xét
// hub_token, cũng không đá người đã đăng nhập Hub sang /dashboard.
const ALWAYS_ALLOW = ['/auth/microsoft/callback', '/le-tot-nghiep'];

// ── Tên miền riêng của Lễ tốt nghiệp ───────────────────────────────────────────
// graduation.iuoss.com ↔ hub.iuoss.com, graduation-sandbox.iuoss.com ↔ hub-sandbox.iuoss.com:
// CÙNG một app Next.js, Nginx trỏ cả hai tên miền vào đây. Suy cặp tên miền từ tiền tố để không phải
// khai env (NEXT_PUBLIC_* bị đông cứng lúc build). Local (127.0.0.1) không khớp tiền tố nào → giữ nguyên.
const GRAD_PREFIX = 'graduation';
const HUB_PREFIX = 'hub';
const GRAD_ALLOWED = ['/auth/microsoft/callback'];   // trang Microsoft trả về trên tên miền tốt nghiệp

function requestHost(request: NextRequest): string {
  return (request.headers.get('x-forwarded-host') || request.headers.get('host') || '').split(':')[0].toLowerCase();
}

function swapHost(host: string, from: string, to: string): string | null {
  return host.startsWith(from + '.') || host.startsWith(from + '-') ? to + host.slice(from.length) : null;
}

function graduationRouting(request: NextRequest): NextResponse | null {
  const { pathname, search } = request.nextUrl;
  const host = requestHost(request);
  const proto = request.headers.get('x-forwarded-proto') || 'https';

  const hubHost = swapHost(host, GRAD_PREFIX, HUB_PREFIX);
  if (hubHost) {
    // Trên tên miền tốt nghiệp: "/" là trang Lễ tốt nghiệp; link cũ /le-tot-nghiep gọn về "/";
    // mọi trang khác của Hub chuyển sang tên miền Hub.
    if (pathname === '/') return NextResponse.rewrite(new URL('/le-tot-nghiep', request.url));
    if (pathname === '/le-tot-nghiep') return NextResponse.redirect(`${proto}://${host}/${search}`, 308);
    if (GRAD_ALLOWED.includes(pathname)) return NextResponse.next();
    return NextResponse.redirect(`${proto}://${hubHost}${pathname}${search}`, 307);
  }

  const gradHost = swapHost(host, HUB_PREFIX, GRAD_PREFIX);
  if (gradHost && pathname === '/le-tot-nghiep') {
    // Link cũ trên tên miền Hub → tên miền riêng (giữ #fragment do trình duyệt tự mang theo).
    return NextResponse.redirect(`${proto}://${gradHost}/${search}`, 308);
  }
  return null;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const graduation = graduationRouting(request);
  if (graduation) return graduation;

  // /api/* — Django xử lý auth riêng qua JWT Bearer, không cần middleware chặn.
  // Trong dev, Next.js rewrite sẽ proxy sang Django SAU khi middleware chạy,
  // nên phải để pass-through ở đây tránh redirect loop khi gọi login endpoint.
  if (pathname.startsWith('/api/')) return NextResponse.next();

  if (ALWAYS_ALLOW.includes(pathname)) return NextResponse.next();

  const token = request.cookies.get('hub_token')?.value;

  // Public paths: chỉ match chính xác hoặc sub-path (tránh /login-extra)
  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + '/'),
  );

  if (isPublic) {
    // Đã login → về thẳng dashboard, không qua '/' để tránh double-redirect
    if (token) return NextResponse.redirect(new URL('/dashboard', request.url));
    return NextResponse.next();
  }

  if (!token) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // Ảnh tĩnh trong public/ (icons/, img/) phải qua được khi chưa đăng nhập —
  // trang /login dùng ảnh bìa ở public/img/.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons/|img/).*)'],
};
