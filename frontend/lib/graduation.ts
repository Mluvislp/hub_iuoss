'use client';

// Trang Lễ tốt nghiệp (/le-tot-nghiep) — API riêng, phiên riêng.
// Phiên tốt nghiệp (GraduationToken, 2 giờ) KHÔNG dùng cookie hub_token: nó không mở được trang
// nào khác của Hub, và để chung sẽ làm middleware tưởng là đã đăng nhập Hub. Lưu sessionStorage —
// đóng tab là hết, máy dùng chung không để lại phiên.

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';
const TOKEN_KEY = 'hub_grad_token';
export const MS_PURPOSE_KEY = 'hub_ms_purpose';
export const GRAD_PATH = '/le-tot-nghiep';

/** Đường dẫn trang tốt nghiệp trên tên miền đang mở: "/" ở graduation(-sandbox).iuoss.com, còn lại /le-tot-nghiep. */
export function gradHomePath(): string {
  if (typeof window === 'undefined') return GRAD_PATH;
  return window.location.hostname.startsWith('graduation') ? '/' : GRAD_PATH;
}

export type Audience = 'student' | 'graduate';
export type RegistrationStatus = null | 'registered' | 'cancel_requested' | 'cancelled';

export interface GradRound {
  title: string;
  ceremony_date: string | null;
  registration_opens_at: string | null;
  registration_closes_at: string | null;
  registration_open: boolean;
}

export interface GradInfo {
  round: GradRound | null;
  sessions: Record<string, string>;
  microsoft_login: boolean;
}

export interface GradMember {
  student: {
    full_name: string;
    student_code: string;
    date_of_birth: string;
    sex: string;
    group: string;
    group_label: string;
    is_graduate: boolean;
    major: string;
    department: string;
    award_title: string;
    degree_class: string;
    session: string;
    session_label: string;
  };
  registration: {
    status: RegistrationStatus;
    registered_at: string | null;
    qr: string | null;
    has_photo: boolean;
    photo_name: string;
    photo_size: number | null;
    photo_uploaded_at: string | null;
    cancel_reason: string;
    cancel_requested_at: string | null;
    cancel_reviewed_at: string | null;
    cancel_review_note: string;
    checked_in: boolean;
    can_edit: boolean;
    can_register: boolean;
  };
  round: GradRound;
}

export class GradError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function getGradToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setGradToken(token: string) {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* chế độ riêng tư chặn storage — phiên chỉ sống trong trang hiện tại */
  }
}

export function clearGradToken() {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* bỏ qua */
  }
}

async function call<T>(path: string, init: RequestInit = {}, auth = false): Promise<T> {
  const headers: Record<string, string> = {};
  if (!(init.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const token = auth ? getGradToken() : null;
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  } catch {
    throw new GradError(0, 'Không kết nối được máy chủ. Vui lòng thử lại.');
  }
  const data = res.headers.get('Content-Type')?.includes('application/json') ? await res.json() : {};
  if (!res.ok) {
    if (auth && res.status === 401) clearGradToken();
    const detail = (data as { detail?: string }).detail;
    throw new GradError(res.status, detail || `Có lỗi xảy ra (HTTP ${res.status}). Vui lòng thử lại.`);
  }
  return data as T;
}

type Session = GradMember & { token: string };

function keep(session: Session): GradMember {
  setGradToken(session.token);
  return session;
}

export const gradApi = {
  info: () => call<GradInfo>('/graduation/'),
  verifyLdap: (uid: string, password: string) =>
    call<Session>('/graduation/verify/ldap/', { method: 'POST', body: JSON.stringify({ uid, password }) }).then(keep),
  verifyMicrosoft: (code: string, state: string) =>
    call<Session>('/graduation/verify/microsoft/', { method: 'POST', body: JSON.stringify({ code, state }) }).then(keep),
  verifyInfo: (body: { code: string; full_name: string; sex: string; date_of_birth: string }) =>
    call<Session>('/graduation/verify/info/', { method: 'POST', body: JSON.stringify(body) }).then(keep),
  microsoftStart: () => call<{ authorize_url: string }>('/auth/microsoft/start/'),
  me: () => call<GradMember>('/graduation/me/', {}, true),
  register: (photo: File | null) => {
    const fd = new FormData();
    if (photo) fd.append('photo', photo, photo.name);
    return call<GradMember>('/graduation/register/', { method: 'POST', body: fd }, true);
  },
  replacePhoto: (photo: File) => {
    const fd = new FormData();
    fd.append('photo', photo, photo.name);
    return call<GradMember>('/graduation/photo/', { method: 'POST', body: fd }, true);
  },
  removePhoto: () => call<GradMember>('/graduation/photo/', { method: 'DELETE' }, true),
  photoBlob: async (): Promise<Blob> => {
    const res = await fetch(`${API_BASE}/graduation/photo/`, {
      headers: { Authorization: `Bearer ${getGradToken() ?? ''}` },
    });
    if (!res.ok) throw new GradError(res.status, 'Không tải được ảnh.');
    return res.blob();
  },
  cancel: (reason: string) =>
    call<GradMember>('/graduation/cancel/', { method: 'POST', body: JSON.stringify({ reason }) }, true),
};

// ── Kiểm ảnh phía trình duyệt — CHỈ để báo sớm; máy chủ kiểm lại toàn bộ (core/graduation.py). ──
export const PHOTO_MIN_BYTES = 1024 * 1024;
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const PHOTO_MIN_SIDE = 600;
const NAME_RE = /^([A-Za-z0-9]+)\.(jpg|jpeg|png)$/i;

export function formatMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2).replace('.', ',')} MB`;
}

async function readHead(file: File, n: number): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(0, n).arrayBuffer());
}

function dimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      reject(new Error('decode'));
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

/** Trả câu lỗi (tiếng Việt) hoặc null nếu ảnh hợp lệ. */
export async function checkPhoto(file: File, code: string): Promise<string | null> {
  const expected = code.toUpperCase();
  const name = file.name;
  if (/\s/.test(name)) {
    return `Tên file “${name}” có khoảng trắng. Đổi tên thành ${expected}.jpg (hoặc .jpeg / .png), không có khoảng trắng.`;
  }
  const m = NAME_RE.exec(name);
  if (!m) return `Tên file phải là mã số kèm đuôi JPG / JPEG / PNG, ví dụ ${expected}.jpg.`;
  const ext = m[2].toLowerCase();
  if (m[1].toUpperCase() !== expected) return `Tên file phải đúng mã số: ${expected}.${ext} (đang là ${name}).`;
  if (file.size >= PHOTO_MAX_BYTES) return `Ảnh quá lớn (${formatMB(file.size)}). Dung lượng phải dưới 5 MB.`;
  if (file.size < PHOTO_MIN_BYTES) {
    return `Ảnh quá nhỏ (${formatMB(file.size)}). Dung lượng cần từ 1 MB trở lên để không bị vỡ nét khi trình chiếu.`;
  }
  const head = await readHead(file, 8);
  const isJpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  const isPng = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => head[i] === b);
  if (!isJpeg && !isPng) {
    return 'File không phải ảnh JPG / PNG thật (có thể chỉ đổi đuôi). Vui lòng xuất lại ảnh ở định dạng JPG hoặc PNG.';
  }
  if ((isJpeg && ext === 'png') || (isPng && ext !== 'png')) {
    return `Ảnh là định dạng ${isJpeg ? 'JPG' : 'PNG'} nhưng đuôi file là .${ext}. Đổi tên thành ${expected}.${isJpeg ? 'jpg' : 'png'}.`;
  }
  try {
    const { width, height } = await dimensions(file);
    if (Math.min(width, height) < PHOTO_MIN_SIDE) {
      return `Ảnh có độ phân giải thấp (${width}×${height} px). Cạnh ngắn cần từ ${PHOTO_MIN_SIDE} px trở lên.`;
    }
  } catch {
    return 'Không đọc được ảnh — file có thể bị hỏng. Vui lòng chọn ảnh khác.';
  }
  return null;
}
