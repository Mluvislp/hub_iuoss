'use client';

const TOKEN_KEY = 'hub_token';
const SESSION_KEY = 'hub_session';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${TOKEN_KEY}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function setToken(token: string, expiresInSeconds = 28800): void {
  const expires = new Date(Date.now() + expiresInSeconds * 1000);
  document.cookie = [
    `${TOKEN_KEY}=${encodeURIComponent(token)}`,
    `path=/`,
    `expires=${expires.toUTCString()}`,
    `SameSite=Lax`,
  ].join('; ');
}

export function clearAuth(): void {
  document.cookie = `${TOKEN_KEY}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
  sessionStorage.removeItem(SESSION_KEY);
}

export function getSession() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setSession(session: object): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}
