'use client';

const TOKEN_KEY = 'hub_token';

function isHttps(): boolean {
  return typeof window !== 'undefined' && window.location.protocol === 'https:';
}

function buildCookie(name: string, value: string, extra: string[]): string {
  return [`${name}=${value}`, 'path=/', 'SameSite=Lax', ...extra].join('; ');
}

// ── Token (cookie) ────────────────────────────────────────────────────────────

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${TOKEN_KEY}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function setToken(token: string, expiresInSeconds = 28800): void {
  const expires = new Date(Date.now() + expiresInSeconds * 1000).toUTCString();
  document.cookie = buildCookie(
    TOKEN_KEY,
    encodeURIComponent(token),
    [`expires=${expires}`, ...(isHttps() ? ['Secure'] : [])],
  );
}

export function clearAuth(): void {
  document.cookie = buildCookie(
    TOKEN_KEY,
    '',
    ['expires=Thu, 01 Jan 1970 00:00:00 GMT', ...(isHttps() ? ['Secure'] : [])],
  );
}

// ── Session — decode từ JWT, không dùng sessionStorage ───────────────────────
// Ưu điểm: sống qua page refresh, tab mới, không cần lưu riêng.

export function getSession(): Record<string, unknown> | null {
  const token = getToken();
  if (!token) return null;
  try {
    // JWT payload là phần giữa, base64url-encoded
    const b64 = token.split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/');
    if (!b64) return null;
    return JSON.parse(atob(b64));
  } catch {
    return null;
  }
}
