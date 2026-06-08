import { getToken, clearAuth } from './auth';
import type {
  LoginResponse,
  DashboardData,
  ConfirmationRequest,
  RequestType,
} from './types';

// Dev:  NEXT_PUBLIC_API_URL=http://127.0.0.1:8000/api  (browser gọi thẳng Django, CORS ok)
// Prod: không set env → '/api' → Nginx định tuyến /api/ → Gunicorn :8002
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';

class ApiError extends Error {
  constructor(
    public status: number,
    public data: Record<string, unknown>,
  ) {
    const msg =
      (data['detail'] as string) ||
      (data['non_field_errors'] as string[])?.[0] ||
      `HTTP ${status}`;
    super(msg);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...init.headers,
  };

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });

  if (res.status === 401) {
    clearAuth();
    window.location.href = '/login';
    throw new ApiError(401, { detail: 'Phiên đăng nhập hết hạn' });
  }

  const data = res.headers.get('Content-Type')?.includes('application/json')
    ? await res.json()
    : {};

  if (!res.ok) throw new ApiError(res.status, data as Record<string, unknown>);
  return data as T;
}

export const api = {
  auth: {
    login(uid: string, password: string): Promise<LoginResponse> {
      return request('/auth/login/', {
        method: 'POST',
        body: JSON.stringify({ uid, password }),
      });
    },
    logout(): Promise<void> {
      return request('/auth/logout/', { method: 'POST' });
    },
    refresh(refreshToken: string): Promise<{ access: string }> {
      return request('/auth/token/refresh/', {
        method: 'POST',
        body: JSON.stringify({ refresh: refreshToken }),
      });
    },
  },

  dashboard: {
    get(): Promise<DashboardData> {
      return request('/dashboard/');
    },
  },

  requests: {
    list(): Promise<ConfirmationRequest[]> {
      return request('/requests/');
    },
    create(data: {
      request_type: RequestType;
      purpose: string;
      note?: string;
    }): Promise<ConfirmationRequest> {
      return request('/requests/', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },
  },
};

export { ApiError };
