'use client';

import { badge } from '@/lib/ui';
import { cn } from '@/lib/utils';

// ── Hiệu lực thẻ BHYT ────────────────────────────────────────────────────────
// Tính theo `valid_until` so với hôm nay. TUYỆT ĐỐI không suy từ `is_current`:
// cột đó chỉ nghĩa là "thẻ đang dùng của SV", không nói gì về việc còn hạn.
// So sánh dạng chuỗi 'YYYY-MM-DD' (thứ tự từ điển = thứ tự thời gian) để tránh
// lệch múi giờ khi parse Date.

export type ValidityState = 'valid' | 'expired' | 'unknown';

export function todayStr(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}

export function validityState(validUntil: string | null | undefined): ValidityState {
  if (!validUntil) return 'unknown';
  return validUntil.slice(0, 10) < todayStr() ? 'expired' : 'valid';
}

/** Số ngày còn lại (null nếu không có hạn hoặc đã hết hạn). Dùng cho cảnh báo sắp hết hạn. */
export function daysLeft(validUntil: string | null | undefined): number | null {
  if (!validUntil || validityState(validUntil) !== 'valid') return null;
  const [y, m, d] = validUntil.slice(0, 10).split('-').map(Number);
  const [ty, tm, td] = todayStr().split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td);
  return Math.round(ms / 86_400_000);
}

const LABELS: Record<ValidityState, string> = {
  valid: 'Còn hiệu lực',
  expired: 'Hết hạn',
  unknown: 'Chưa có thông tin hạn',
};

const VARIANTS: Record<ValidityState, string> = {
  valid: badge.success,
  expired: badge.danger,
  unknown: badge.neutral,
};

export function HealthValidityBadge({ validUntil }: { validUntil: string | null | undefined }) {
  const state = validityState(validUntil);
  return <span className={cn(badge.base, VARIANTS[state])}>{LABELS[state]}</span>;
}
