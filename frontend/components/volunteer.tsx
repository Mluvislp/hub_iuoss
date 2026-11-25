'use client';

/** Phần dùng chung 2 trang Sự kiện cộng tác viên: ảnh cần token, nhãn trạng thái, định dạng thời gian. */

import { useEffect, useState } from 'react';
import { CalendarHeart } from 'lucide-react';
import { api } from '@/lib/api';
import { badge } from '@/lib/ui';
import { cn } from '@/lib/utils';
import type { VolunteerEventSummary, VolunteerStatus } from '@/lib/types';

/** Ảnh qua API có xác thực → blob URL (thu hồi khi đổi ảnh / rời trang). */
export function useBlobUrl(path: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path) { setUrl(null); return; }
    let alive = true;
    let made: string | null = null;
    api.volunteer.media(path)
      .then((blob) => { if (alive) { made = URL.createObjectURL(blob); setUrl(made); } })
      .catch(() => alive && setUrl(null));
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [path]);
  return url;
}

export function Cover({ path, className, iconSize = 28 }: { path: string | null; className?: string; iconSize?: number }) {
  const url = useBlobUrl(path);
  return (
    <div className={cn('relative overflow-hidden bg-[#f1f5f9]', className)}>
      {url
        ? <img src={url} alt="" className="h-full w-full object-cover" />
        : <div className="flex h-full w-full items-center justify-center text-slate-300"><CalendarHeart size={iconSize} /></div>}
    </div>
  );
}

export const MY_STATUS_BADGE: Record<VolunteerStatus, string> = {
  pending: badge.warning,
  approved: badge.success,
  waitlist: badge.info,
  rejected: badge.danger,
  cancelled: badge.neutral,
};

/** Một badge cho mỗi sự kiện: kết quả của SV nếu đã đăng ký, không thì trạng thái nhận đăng ký. */
export function EventBadge({ e }: { e: VolunteerEventSummary }) {
  if (e.my_status && e.my_status !== 'cancelled') {
    return <span className={cn(badge.base, MY_STATUS_BADGE[e.my_status])}>{e.my_status_label}</span>;
  }
  if (e.ended) return <span className={cn(badge.base, badge.neutral)}>Đã kết thúc</span>;
  if (e.registration_state === 'open') return <span className={cn(badge.base, badge.success)}>Đang nhận đăng ký</span>;
  if (e.registration_state === 'upcoming') return <span className={cn(badge.base, badge.info)}>Sắp mở đăng ký</span>;
  return <span className={cn(badge.base, badge.neutral)}>Đã đóng đăng ký</span>;
}

const pad = (n: number) => String(n).padStart(2, '0');
export const hm = (iso: string) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const dmy = (iso: string) => { const d = new Date(iso); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; };
export const hmdmy = (iso: string | null) => (iso ? `${hm(iso)} ${dmy(iso)}` : '—');

/** "08:00 – 17:00, 24/11/2026" (một ngày) hoặc "08:00 24/11 – 17:00 25/11/2026". */
export function eventRange(e: Pick<VolunteerEventSummary, 'starts_at' | 'ends_at' | 'day_count'>) {
  if (e.day_count === 1) return `${hm(e.starts_at)} – ${hm(e.ends_at)}, ${dmy(e.starts_at)}`;
  const s = new Date(e.starts_at);
  return `${hm(e.starts_at)} ${pad(s.getDate())}/${pad(s.getMonth() + 1)} – ${hm(e.ends_at)} ${dmy(e.ends_at)}`;
}

/** "còn 2 ngày" / "còn 5 giờ" tới mốc. */
export function timeLeft(iso: string | null) {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return '';
  const h = Math.floor(ms / 3_600_000);
  if (h >= 48) return `còn ${Math.floor(h / 24)} ngày`;
  if (h >= 1) return `còn ${h} giờ`;
  return `còn ${Math.max(1, Math.floor(ms / 60_000))} phút`;
}
