'use client';

import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { GradRound } from '@/lib/graduation';

// Các mốc Lễ tốt nghiệp 2026. Mở / hạn đăng ký đọc từ đợt (Phòng CTSV đặt ở Dashboard) — khớp đồng hồ đếm ngược;
// hạn đăng ký cũng là hạn đóng tiền thế chân (core/graduation.py::deposit_payload). Hạn ảnh trình chiếu từ máy chủ
// (`photo_closes_at`, hết 20/11/2026). Tổng dợt / lễ do Phòng CTSV gửi. `end` = thời điểm mốc coi là đã qua.

type Step = { title: string; when: string; note?: string; end: number | null };

const VN = '+07:00';
const at = (iso: string) => new Date(iso).getTime();
const dmy = (iso: string) =>
  new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' });
const hm = (iso: string) =>
  new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Ho_Chi_Minh' });
/** "Hết ngày" khi mốc là 23:59, còn lại "Trước HH:MM". */
const dayNote = (iso: string) => (hm(iso) === '23:59' ? 'Hết ngày' : `Trước ${hm(iso)}`);

function steps(round: GradRound | null): Step[] {
  const opens = round?.registration_opens_at;
  const closes = round?.registration_closes_at;
  const photo = round?.photo_closes_at;
  return [
    { title: 'Mở đăng ký tham dự', when: opens ? dmy(opens) : 'Sẽ thông báo', end: opens ? at(opens) : null },
    {
      title: 'Hạn cuối đăng ký tham dự & đóng tiền thế chân lễ phục', when: closes ? dmy(closes) : '18/11/2026',
      note: closes ? dayNote(closes) : 'Hết ngày', end: closes ? at(closes) : at(`2026-11-18T23:59:59${VN}`),
    },
    {
      title: 'Hạn cuối tải ảnh trình chiếu', when: photo ? dmy(photo) : '20/11/2026',
      note: `${photo ? dayNote(photo) : 'Hết ngày'} · chỉ người đã đăng ký`,
      end: photo ? at(photo) : at(`2026-11-20T23:59:59${VN}`),
    },
    { title: 'Tổng dợt', when: '27/11/2026', note: 'Chiều thứ Sáu', end: at(`2026-11-27T23:59:59${VN}`) },
    { title: 'Lễ Tốt nghiệp', when: '28 & 29/11/2026', note: 'Thứ Bảy & Chủ nhật', end: at(`2026-11-29T23:59:59${VN}`) },
  ];
}

export default function Timeline({ round }: { round: GradRound | null }) {
  const [now, setNow] = useState<number | null>(null);    // null tới khi mount — tránh lệch SSR/hydration
  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const list = steps(round);
  const done = (s: Step) => now !== null && s.end !== null && now > s.end;
  const next = now === null ? -1 : list.findIndex((s) => !done(s));

  return (
    <ol className="relative grid gap-0 md:grid-cols-5 md:gap-3">
      {list.map((s, i) => {
        const past = done(s);
        const current = i === next;
        return (
          <li key={s.title} className="relative flex gap-4 pb-6 last:pb-0 md:flex-col md:gap-0 md:pb-0">
            {/* Đường nối: dọc trên điện thoại, ngang từ máy tính bảng trở lên. */}
            {i < list.length - 1 && (
              <span aria-hidden className={cn(
                'absolute left-[0.9rem] top-8 bottom-0 w-px md:left-8 md:right-[-0.75rem] md:top-[0.9rem] md:bottom-auto md:h-px md:w-auto',
                past ? 'bg-[#d4a72c]' : 'bg-line',
              )} />
            )}
            <span className={cn(
              'relative z-10 flex h-[1.85rem] w-[1.85rem] shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
              past ? 'border-[#d4a72c] bg-[#f5d27a] text-[#0f2a5c]'
                : current ? 'border-[#0f2a5c] bg-[#0f2a5c] text-white ring-4 ring-[#f5e3ad]'
                  : 'border-line bg-white text-slate-400',
            )}>
              {past ? <Check size={14} strokeWidth={3} /> : i + 1}
            </span>
            <div className={cn('min-w-0 md:mt-3 md:pr-2', past && 'opacity-60')}>
              <div className={cn('font-display text-xl font-semibold leading-tight', current ? 'text-[#0f2a5c]' : 'text-ink')}>
                {s.when}
              </div>
              <div className="mt-1 text-sm font-medium text-ink">{s.title}</div>
              {s.note && <div className="text-xs text-muted">{s.note}</div>}
              {current && (
                <span className="mt-1.5 inline-block rounded-md border border-[#e9cf86] bg-[#fdf6e3] px-1.5 py-px text-[0.68rem] font-semibold text-[#7a5d0f]">
                  Sắp tới
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
