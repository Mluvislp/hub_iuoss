import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function getInitials(name: string): string {
  return name.trim().charAt(0).toUpperCase();
}

// ── Ngày: form nhập bằng <input type="date"> (giá trị yyyy-mm-dd) nhưng contract
// với backend là chuỗi dd/mm/yyyy. Hai hàm dưới đổi qua lại; giá trị không đọc
// được thì trả '' để ô lịch trống thay vì hiện rác.

/** 'dd/mm/yyyy' → 'yyyy-mm-dd' cho value của <input type="date">. */
export function toDateInput(vn: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((vn || '').trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

/** 'yyyy-mm-dd' (từ <input type="date">) → 'dd/mm/yyyy' để gửi backend. */
export function fromDateInput(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso || '').trim());
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** Hôm nay dạng yyyy-mm-dd — dùng cho thuộc tính `max` của ô lịch. */
export function todayInput(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Cận dưới hợp lý cho ngày sinh / ngày cấp giấy tờ (khớp validate backend). */
export const DATE_INPUT_MIN = '1940-01-01';
