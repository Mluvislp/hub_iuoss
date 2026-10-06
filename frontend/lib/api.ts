import { getToken, clearAuth } from './auth';
import type {
  FeaturesResponse,
  LoginResponse,
  DashboardData,
  HealthInsuranceData,
  ConfirmationRequest,
  ConfirmationRequestDetail,
  RequestComment,
  RequestStatus,
  RequestType,
  OtherRequestFormData,
  DefermentFormData,
  ThuongBinhFormData,
  BankLoanFormData,
  EnglishFormData,
  ConductScoreFormData,
  Province,
  Ward,
  OffCampusForm,
  OffCampusSubmit,
  OffCampusResult,
  InsuranceRegistrationPrefill,
  TicketDetail,
  TicketMessage,
  TicketSummary,
  TicketTopic,
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

/**
 * `crypto.randomUUID` chỉ có trong secure context (HTTPS/localhost). Mở dev qua IP LAN
 * (http://192.168.x.x:3000, test trên điện thoại) thì hàm này không tồn tại và nộp đơn
 * chết ngay ở trình duyệt trước khi gọi API.
 */
export function newRequestKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
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

/** POST multipart/form-data (cho file upload). Browser tự đặt Content-Type + boundary. */
async function requestMultipart<T>(
  path: string,
  formData: FormData,
  opts: RequestOptions = {},
): Promise<T> {
  const token = getToken();
  const headers: HeadersInit = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers,
      body: formData,
    });
  } catch {
    // Nginx gặp body vượt client_max_body_size thường trả 413 rồi cắt kết nối khi
    // trình duyệt còn đang upload → fetch chỉ thấy "Failed to fetch", không có status.
    throw new ApiError(0, {
      detail: 'Không gửi được dữ liệu lên máy chủ. Kiểm tra kết nối mạng, hoặc ảnh tải lên có thể quá lớn — thử chụp/chọn ảnh nhẹ hơn rồi gửi lại.',
    });
  }

  if (res.status === 401 && !opts.skipAuthRedirect) {
    clearAuth();
    window.location.href = '/login';
    throw new ApiError(401, { detail: 'Phiên đăng nhập hết hạn' });
  }

  if (res.status === 413) {
    throw new ApiError(413, { detail: 'Tổng dung lượng ảnh tải lên quá lớn. Vui lòng chọn ảnh nhẹ hơn rồi gửi lại.' });
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
    /** Lấy URL đăng nhập Microsoft để chuyển hướng trình duyệt sang đó. */
    microsoftStart(): Promise<{ authorize_url: string }> {
      return request('/auth/microsoft/start/', {}, { skipAuthRedirect: true });
    },
    /** Đổi code Microsoft trả về lấy phiên của Hub. */
    microsoftCallback(code: string, state: string): Promise<LoginResponse> {
      return request(
        '/auth/microsoft/callback/',
        { method: 'POST', body: JSON.stringify({ code, state }) },
        { skipAuthRedirect: true },
      );
    },
  },

  features: {
    get(): Promise<FeaturesResponse> {
      return request('/features/');
    },
  },

  dashboard: {
    get(): Promise<DashboardData> {
      return request('/dashboard/');
    },
  },

  healthInsurance: {
    get(): Promise<HealthInsuranceData> {
      return request('/health-insurance/');
    },
  },

  requests: {
    /** PDF bản mềm bảng điểm RL — cần token nên tải qua fetch rồi mở bằng blob URL. */
    async softCopy(id: number): Promise<Blob> {
      const res = await fetch(`${API_BASE}/requests/${id}/soft-copy/`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw new Error('Không tải được file.');
      return res.blob();
    },
    list(): Promise<ConfirmationRequest[]> {
      return request('/requests/');
    },
    /** Loại giấy nào còn lượt trong học kỳ hiện tại (1 lần / loại / học kỳ). */
    availability(): Promise<import('./types').RequestAvailability> {
      return request('/requests/availability/');
    },
    detail(id: number): Promise<ConfirmationRequestDetail> {
      return request(`/requests/${id}/`);
    },
    addComment(id: number, body: string): Promise<{
      comment: RequestComment;
      status: RequestStatus;
      student_can_comment: boolean;
    }> {
      return request(`/requests/${id}/comments/`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      });
    },
    /** Sửa yêu cầu đang "Chờ bổ sung thông tin" — cùng body với lúc tạo (có `request_type`). */
    update(id: number, data: Record<string, unknown>): Promise<ConfirmationRequestDetail> {
      return request(`/requests/${id}/`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
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
      fee_exemption: string;
      orphan: string;
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
    conductScoreForm(): Promise<ConductScoreFormData> {
      return request('/requests/conduct-score/form/');
    },
    createConductScore(data: {
      semester_code: string;
      delivery: string;
      dob: string;
      citizen_id: string;
      citizen_id_issue_date: string;
      province_code: string;
      ward_code: string;
      street: string;
      note?: string;
    }): Promise<ConfirmationRequest> {
      return request('/requests/', {
        method: 'POST',
        body: JSON.stringify({ request_type: 'conduct_score', ...data }),
      });
    },
  },

  tickets: {
    topics(): Promise<TicketTopic[]> {
      return request('/tickets/topics/');
    },
    list(): Promise<TicketSummary[]> {
      return request('/tickets/');
    },
    /** FormData: topic_id, subject, body, files (tối đa 2). */
    create(body: FormData): Promise<{ id: number }> {
      return requestMultipart('/tickets/', body);
    },
    /**
     * Chi tiết + polling. `after` = id lượt cuối đang có → chỉ trả lượt mới.
     * `seen=false` khi tab đang ẩn: không đánh dấu đã đọc.
     */
    detail(id: number, after = 0, seen = true): Promise<TicketDetail> {
      return request(`/tickets/${id}/?after=${after}${seen ? '' : '&seen=0'}`);
    },
    reply(id: number, body: FormData): Promise<TicketSummary & { message: TicketMessage; can_reply: boolean }> {
      return requestMultipart(`/tickets/${id}/messages/`, body);
    },
    /** Sinh viên xác nhận đã được giải đáp và đóng ticket. */
    close(id: number): Promise<TicketSummary & { message: TicketMessage; can_reply: boolean }> {
      return request(`/tickets/${id}/close/`, { method: 'POST' });
    },
    unread(): Promise<{ count: number }> {
      return request('/tickets/unread/');
    },
    /** File đính kèm cần token → tải qua fetch rồi mở bằng blob URL. */
    async attachment(ticketId: number, attachmentId: number): Promise<Blob> {
      const res = await fetch(`${API_BASE}/tickets/${ticketId}/attachments/${attachmentId}/`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw new Error('Không tải được file.');
      return res.blob();
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

  healthCheck: {
    state(): Promise<import('./types').HealthCheckState> {
      return request('/health-check/');
    },
    submitEvidence(body: FormData): Promise<import('./types').HealthCheckState> {
      return requestMultipart('/health-check/evidence/', body);
    },
    register(data: { declaration?: OffCampusSubmit; consent: boolean; data_consent: boolean }):
      Promise<import('./types').HealthCheckState> {
      return request('/health-check/register/', { method: 'POST', body: JSON.stringify(data) });
    },
    /** Bổ sung CCCD khi hồ sơ chưa có (form khai báo đã khóa). */
    addCitizenId(data: { number: string; issue_place: string; issue_date: string }):
      Promise<import('./types').HealthCheckState> {
      return request('/health-check/citizen-id/', { method: 'POST', body: JSON.stringify(data) });
    },
    /** Ảnh minh chứng của chính SV — cần token nên phải tải qua fetch, không dùng <img src>. */
    async evidence(index: number): Promise<Blob> {
      const res = await fetch(`${API_BASE}/health-check/evidence/${index}/`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw new Error('Không tải được ảnh.');
      return res.blob();
    },
  },

  // Miễn giảm học phí (FEATURE_TUITION_WAIVER). Bổ sung khi cán bộ yêu cầu: backend còn
  // trả 501, trang hiển thị nguyên văn `detail`.
  tuitionExemption: {
    state(): Promise<import('./types').TuitionExemptionState> {
      return request('/tuition-exemption/');
    },
    detail(id: number): Promise<import('./types').TuitionExemptionApplication> {
      return request(`/tuition-exemption/applications/${id}/`);
    },
    /** Field form + `category_codes` (lặp) + file `doc_<MÃ_DIỆN>__<doc_type>` (lặp). */
    submit(body: FormData): Promise<import('./types').TuitionExemptionState> {
      if (!body.has('request_key')) body.set('request_key', newRequestKey());
      return requestMultipart('/tuition-exemption/', body);
    },
    /** Kèm `row_version` của đơn; file `doc_<MÃ_DIỆN>__<doc_type>` như lúc nộp. */
    supplement(id: number, body: FormData): Promise<import('./types').TuitionExemptionApplication> {
      if (!body.has('request_key')) body.set('request_key', newRequestKey());
      return requestMultipart(`/tuition-exemption/applications/${id}/supplement/`, body);
    },
    /** Giấy tờ của chính SV — cần token nên tải qua fetch rồi mở blob. */
    async document(id: number, documentId: number): Promise<Blob> {
      const res = await fetch(`${API_BASE}/tuition-exemption/applications/${id}/documents/${documentId}/`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw new Error('Không tải được giấy tờ.');
      return res.blob();
    },
  },

  locations: {
    provinces(): Promise<Province[]> {
      return request('/locations/provinces/');
    },
    wards(provinceCode: string): Promise<Ward[]> {
      return request(`/locations/wards/?province=${encodeURIComponent(provinceCode)}`);
    },
    ethnicities(): Promise<{ code: string; name: string }[]> {
      return request('/locations/ethnicities/');
    },
  },

  hospitals: {
    /** Toàn bộ cơ sở KCB của một tỉnh, đã xếp theo tên. */
    byProvince(provinceCode: string): Promise<{ code: string; name: string }[]> {
      return request(`/hospitals/?province=${encodeURIComponent(provinceCode)}`);
    },
  },

  externalInsurance: {
    detail(id:number): Promise<import('./types').SubmittedInsurance> { return request('/health-insurance/external/' + id + '/'); },
    update(id:number, body:FormData): Promise<{id:number; status:string}> { return requestMultipart('/health-insurance/external/' + id + '/', body); },
    prefill(): Promise<import("./types").SubmittedInsurance> {
      return request('/health-insurance/external/');
    },
    submit(body: FormData): Promise<{ id: number; status: string }> {
      return requestMultipart('/health-insurance/external/', body);
    },
  },
  insuranceRegistration: {
    detail(id:number): Promise<import('./types').InsuranceDetail> {
      return request(`/health-insurance/registrations/${id}/`);
    },
    supplement(id:number, body:FormData): Promise<{id:number; status:string}> {
      return requestMultipart(`/health-insurance/registrations/${id}/`, body);
    },
    async evidence(path:string): Promise<Blob> {
      if (!/^\/api\/health-insurance\/(?:registrations|external)\/\d+\/(?:evidence\/\d+|images\/[a-z_]+)\/(?:\?v=\d+)?$/.test(path)) throw new Error('Đường dẫn ảnh không hợp lệ.');
      const res = await fetch(`${API_BASE}${path.slice(4)}`, {headers:{Authorization:`Bearer ${getToken()}`}});
      if (!res.ok) throw new Error('Không tải được ảnh.');
      return res.blob();
    },
    prefill(period: string): Promise<{ prefill: InsuranceRegistrationPrefill; config: import('./types').InsurancePeriodConfig; }> {
      return request(`/health-insurance/registrations/?period=${encodeURIComponent(period)}`);
    },
    submit(formData: FormData): Promise<{ id: number; status: string }> {
      if (!formData.has('request_key')) formData.set('request_key', newRequestKey());
      return requestMultipart('/health-insurance/registrations/', formData);
    },
  },
};

export { ApiError };
