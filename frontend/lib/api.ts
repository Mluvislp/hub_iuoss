import { getToken, clearAuth } from './auth';
import type {
  LoginResponse,
  DashboardData,
  ConfirmationRequest,
  RequestType,
  OtherRequestFormData,
  DefermentFormData,
  ThuongBinhFormData,
  BankLoanFormData,
  EnglishFormData,
  Province,
  Ward,
  OffCampusForm,
  OffCampusSubmit,
  OffCampusResult,
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

interface RequestOptions {
  // Bỏ qua cơ chế auto-redirect về /login khi gặp 401.
  // Dùng cho chính request đăng nhập: 401 lúc đó = "sai mật khẩu",
  // không phải "hết phiên" — để trang login tự hiển thị lỗi.
  skipAuthRedirect?: boolean;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  opts: RequestOptions = {},
): Promise<T> {
  const token = getToken();
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...init.headers,
  };

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });

  if (res.status === 401 && !opts.skipAuthRedirect) {
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
      return request(
        '/auth/login/',
        {
          method: 'POST',
          body: JSON.stringify({ uid, password }),
        },
        { skipAuthRedirect: true },
      );
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
    otherForm(): Promise<OtherRequestFormData> {
      return request('/requests/other/form/');
    },
    createOther(data: {
      purpose_code: string;
      program_name?: string;
      dob: string;
      citizen_id: string;
      note?: string;
    }): Promise<ConfirmationRequest> {
      return request('/requests/', {
        method: 'POST',
        body: JSON.stringify({ request_type: 'other', ...data }),
      });
    },
    defermentForm(): Promise<DefermentFormData> {
      return request('/requests/deferment/form/');
    },
    createDeferment(data: {
      dob: string;
      province_code: string;
      ward_code: string;
      street: string;
      note?: string;
    }): Promise<ConfirmationRequest> {
      return request('/requests/', {
        method: 'POST',
        body: JSON.stringify({ request_type: 'deferment', ...data }),
      });
    },
    thuongbinhForm(): Promise<ThuongBinhFormData> {
      return request('/requests/thuong-binh/form/');
    },
    createThuongBinh(data: {
      citizen_id: string;
      citizen_id_issue_date: string;
      note?: string;
    }): Promise<ConfirmationRequest> {
      return request('/requests/', {
        method: 'POST',
        body: JSON.stringify({ request_type: 'thuong_binh', ...data }),
      });
    },
    bankloanForm(): Promise<BankLoanFormData> {
      return request('/requests/bank-loan/form/');
    },
    createBankLoan(data: {
      dob: string;
      citizen_id: string;
      citizen_id_issue_date: string;
      class_code: string;
      note?: string;
    }): Promise<ConfirmationRequest> {
      return request('/requests/', {
        method: 'POST',
        body: JSON.stringify({ request_type: 'bank_loan', ...data }),
      });
    },
    englishForm(): Promise<EnglishFormData> {
      return request('/requests/english/form/');
    },
    createEnglish(data: {
      dob: string;
      purpose_code: string;
      program_name?: string;
      note?: string;
    }): Promise<ConfirmationRequest> {
      return request('/requests/', {
        method: 'POST',
        body: JSON.stringify({ request_type: 'english_form', ...data }),
      });
    },
  },

  offcampus: {
    form(): Promise<OffCampusForm> {
      return request('/offcampus/');
    },
    submit(data: OffCampusSubmit): Promise<OffCampusResult> {
      return request('/offcampus/', { method: 'POST', body: JSON.stringify(data) });
    },
    requestReopen(reason: string): Promise<{ ok: boolean; created: boolean; requested_at: string }> {
      return request('/offcampus/request-reopen/', {
        method: 'POST', body: JSON.stringify({ reason }),
      });
    },
  },

  locations: {
    provinces(): Promise<Province[]> {
      return request('/locations/provinces/');
    },
    wards(provinceCode: string): Promise<Ward[]> {
      return request(`/locations/wards/?province=${encodeURIComponent(provinceCode)}`);
    },
  },
};

export { ApiError };
