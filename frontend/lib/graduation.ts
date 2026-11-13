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
  /** Hạn tải / thay ảnh trình chiếu (≥ hạn đăng ký). Sau hạn đăng ký chỉ người đã đăng ký đổi được ảnh. */
  photo_closes_at: string | null;
}

export interface GradBank {
  id: number;
  short_name: string;
  full_name: string;
}

export interface BankInput {
  bank_id: string;
  bank_account_number: string;
  bank_account_holder: string;
}

export interface GradInfo {
  round: GradRound | null;
  sessions: Record<string, string>;
  banks: GradBank[];
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
    photo_status: null | 'pending' | 'approved' | 'rejected';
    photo_review_note: string;
    can_replace_photo: boolean;
    photo_name: string;
    photo_size: number | null;
    photo_uploaded_at: string | null;
    cancel_reason: string;
    cancel_requested_at: string | null;
    cancel_reviewed_at: string | null;
    cancel_review_note: string;
    checked_in: boolean;
    can_edit: boolean;
    can_remove_photo: boolean;
    can_register: boolean;
  };
  bank: {
    bank_id: number;
    bank_short_name: string;
    bank_full_name: string;
    account_number: string;
    holder: string;
  } | null;
  bank_suggestion: { bank_id: number | null; account_number: string; holder: string } | null;
  deposit: GradDeposit;
  round: GradRound;
}

/** Tiền thế chân lễ phục — máy chủ tính (core/graduation.py::deposit_payload).
 *  Hạn = hạn đăng ký của đợt; quá hạn (`overdue`) thì máy chủ KHÔNG gửi thông tin chuyển khoản (các trường null). */
export interface GradDeposit {
  bank_name: string | null;
  bank_bin: string | null;
  account_number: string | null;
  account_name: string | null;
  amount: number | null;
  reference: string | null;
  deadline: string | null;       // ISO, giờ VN — hạn đăng ký của đợt
  overdue: boolean;
  has_receipt: boolean;
  receipt_is_pdf: boolean;
  receipt_uploaded_at: string | null;
  can_upload: boolean;
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
  register: (photo: File | null, bank: BankInput, receipt: File) => {
    const fd = new FormData();
    Object.entries(bank).forEach(([k, v]) => fd.append(k, v));
    if (photo) fd.append('photo', photo, photo.name);
    fd.append('receipt', receipt, receipt.name);
    return call<GradMember>('/graduation/register/', { method: 'POST', body: fd }, true);
  },
  replacePhoto: (photo: File) => {
    const fd = new FormData();
    fd.append('photo', photo, photo.name);
    return call<GradMember>('/graduation/photo/', { method: 'POST', body: fd }, true);
  },
  replaceReceipt: (receipt: File) => {
    const fd = new FormData();
    fd.append('receipt', receipt, receipt.name);
    return call<GradMember>('/graduation/receipt/', { method: 'POST', body: fd }, true);
  },
  receiptBlob: async (): Promise<Blob> => {
    const res = await fetch(`${API_BASE}/graduation/receipt/`, {
      headers: { Authorization: `Bearer ${getGradToken() ?? ''}` },
    });
    if (!res.ok) throw new GradError(res.status, 'Không tải được minh chứng.');
    return res.blob();
  },
  updateBank: (bank: BankInput) =>
    call<GradMember>('/graduation/bank/', { method: 'POST', body: JSON.stringify(bank) }, true),
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

/** Tên file máy chủ đặt khi lưu — giống `core/graduation.py::stored_photo_name`. */
export function storedPhotoName(code: string, file: File): string {
  return `${code.toUpperCase()}.${/\.png$/i.test(file.name) || file.type === 'image/png' ? 'png' : 'jpg'}`;
}

/** Tên chủ tài khoản: IN HOA, gộp khoảng trắng — giống `core/graduation.py::normalize_holder`. KHÔNG tự bỏ dấu. */
export function normalizeHolder(text: string): string {
  return text.toUpperCase().replace(/\s+/g, ' ').trim();
}

/** Họ tên người tốt nghiệp → dạng chủ tài khoản: bỏ HẾT dấu, đ→D, IN HOA, gộp khoảng trắng.
 *  Giống hệt `core/graduation.py::holder_of` (máy chủ kiểm lại đúng luật này). */
export function holderOf(fullName: string): string {
  return fullName.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toUpperCase().replace(/[^A-Z]/g, ' ').replace(/\s+/g, ' ').trim();
}

const otherOwner = (expected: string) =>
  `Tên chủ tài khoản phải trùng họ tên người tốt nghiệp (${expected}). Chỉ nhận tài khoản ngân hàng đứng tên chính người tốt nghiệp.`;

/** Câu lỗi của riêng ô tên chủ tài khoản ('' nếu hợp lệ hoặc còn trống). `ownerName` = họ tên người tốt
 *  nghiệp: đang gõ dở (còn là phần đầu của tên đúng) thì chưa báo, lệch hẳn mới báo. */
export function holderProblem(text: string, ownerName = ''): string {
  const holder = normalizeHolder(text);
  if (!holder) return '';
  if (/[^\x00-\x7F]/.test(holder)) return 'Tên chủ tài khoản phải nhập KHÔNG DẤU (VD: NGUYEN VAN AN).';
  if (!/^[A-Z ]+$/.test(holder)) return 'Tên chủ tài khoản chỉ gồm chữ cái không dấu và khoảng trắng.';
  const expected = holderOf(ownerName);
  if (expected && holder !== expected && !expected.startsWith(holder)) return otherOwner(expected);
  return '';
}

/** Kiểm nhanh ở trình duyệt (máy chủ kiểm lại): trả câu lỗi hoặc ''. */
export function checkBank(b: BankInput, ownerName = ''): string {
  if (!b.bank_id) return 'Vui lòng chọn ngân hàng nhận hoàn tiền cọc.';
  const number = b.bank_account_number.replace(/[\s.-]/g, '');
  if (!number) return 'Vui lòng nhập số tài khoản ngân hàng.';
  if (!/^\d+$/.test(number)) return 'Số tài khoản chỉ gồm chữ số.';
  if (number.length < 6 || number.length > 20) return 'Số tài khoản phải có từ 6 đến 20 chữ số.';
  const holder = normalizeHolder(b.bank_account_holder);
  if (!holder) return 'Vui lòng nhập tên chủ tài khoản.';
  const bad = holderProblem(holder, ownerName);
  if (bad) return bad;
  const expected = holderOf(ownerName);
  if (expected && holder !== expected) return otherOwner(expected);   // gõ thiếu (phần đầu tên) cũng chặn khi gửi
  return '';
}

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

/** Kiểm nội dung ảnh — trả câu lỗi (tiếng Việt) hoặc null. Tên file KHÔNG xét: máy chủ tự đặt <mã>.jpg|png. */
export async function checkPhoto(file: File): Promise<string | null> {
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

// ── Minh chứng chuyển khoản — kiểm sớm ở trình duyệt; máy chủ kiểm lại (core/graduation.py::validate_receipt). ──
export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;

export async function checkReceipt(file: File): Promise<string | null> {
  if (!file.size) return 'File minh chứng trống.';
  if (file.size > RECEIPT_MAX_BYTES) return `Minh chứng quá lớn (${formatMB(file.size)}) — dung lượng tối đa 10 MB.`;
  const head = await readHead(file, 8);
  const isPdf = [0x25, 0x50, 0x44, 0x46, 0x2d].every((b, i) => head[i] === b);
  const isJpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  const isPng = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => head[i] === b);
  if (!isPdf && !isJpeg && !isPng) return 'Minh chứng phải là ảnh JPG / PNG hoặc file PDF.';
  return null;
}

/** Mốc hạn để hiển thị: "hết ngày 18/11/2026" nếu là 23:59, còn lại "16:00 ngày 20/11/2026". */
export function deadlineText(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const opt = { timeZone: 'Asia/Ho_Chi_Minh' } as const;
  const day = d.toLocaleDateString('vi-VN', { ...opt, day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = d.toLocaleTimeString('vi-VN', { ...opt, hour: '2-digit', minute: '2-digit', hour12: false });
  return time === '23:59' ? `hết ngày ${day}` : `${time} ngày ${day}`;
}
