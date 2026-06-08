import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/login'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // /api/* — Django xử lý auth riêng qua JWT Bearer, không cần middleware chặn.
  // Trong dev, Next.js rewrite sẽ proxy sang Django SAU khi middleware chạy,
  // nên phải để pass-through ở đây tránh redirect loop khi gọi login endpoint.
  if (pathname.startsWith('/api/')) return NextResponse.next();

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
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons/).*)'],
};
