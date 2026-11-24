'use client';

/**
 * Sự kiện cộng tác viên — danh sách sự kiện sinh viên được mời tham gia hỗ trợ.
 * Một card, mỗi sự kiện một dòng (resource list); sự kiện đang nhận đăng ký đứng đầu.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, CalendarDays, CalendarHeart, ChevronRight, Clock, Loader2, MapPin } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { ui } from '@/lib/ui';
import { cn } from '@/lib/utils';
import { Cover, EventBadge, eventRange, hmdmy, timeLeft } from '@/components/volunteer';
import type { VolunteerEventSummary } from '@/lib/types';

type Filter = 'all' | 'open' | 'mine';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Tất cả' },
  { key: 'open', label: 'Đang nhận đăng ký' },
  { key: 'mine', label: 'Đã đăng ký' },
];

/** Thứ tự: đang mở (hạn gần trước) → sắp mở → đã đóng chưa diễn ra → đã kết thúc. */
function rank(e: VolunteerEventSummary) {
  if (e.ended) return 3;
  return { open: 0, upcoming: 1, unset: 2, closed: 2 }[e.registration_state];
}

export default function VolunteerEventsPage() {
  const [rows, setRows] = useState<VolunteerEventSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    api.volunteer.list()
      .then((d) => setRows(d.events))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Không tải được danh sách sự kiện.'));
  }, []);

  const sorted = useMemo(() => [...(rows ?? [])].sort((a, b) => rank(a) - rank(b)
    || (a.registration_closes_at ?? a.starts_at).localeCompare(b.registration_closes_at ?? b.starts_at)), [rows]);
  const counts = {
    all: sorted.length,
    open: sorted.filter((e) => !e.ended && e.registration_state === 'open').length,
    mine: sorted.filter((e) => e.my_status && e.my_status !== 'cancelled').length,
  };
  const visible = sorted.filter((e) => filter === 'all'
    || (filter === 'open' ? !e.ended && e.registration_state === 'open' : e.my_status && e.my_status !== 'cancelled'));

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold text-ink">Sự kiện cộng tác viên</h1>

      {error && (
        <div className="flex items-start gap-2.5 rounded-lg border border-danger-line bg-danger-soft px-4 py-3">
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-danger-text" />
          <p className="text-sm text-danger-text">{error}</p>
        </div>
      )}

      {rows === null && !error && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
          <Loader2 size={16} className="animate-spin" />Đang tải…
        </div>
      )}

      {rows !== null && rows.length === 0 && (
        <section className={ui.card}>
          <div className="px-5 py-14 text-center">
            <CalendarHeart size={24} className="mx-auto mb-2 text-slate-300" />
            <p className="text-sm font-medium text-ink">Chưa có sự kiện</p>
            <p className="mt-1 text-sm text-muted">Sự kiện sinh viên được mời tham gia sẽ hiện ở đây.</p>
          </div>
        </section>
      )}

      {rows !== null && rows.length > 0 && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map(({ key, label }) => (key !== 'all' && counts[key] === 0 ? null : (
              <button key={key} type="button" onClick={() => setFilter(key)}
                className={cn('inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[0.8rem] font-medium transition-colors sm:h-8',
                  filter === key ? 'border-primary bg-primary-soft text-primary-text' : 'border-line bg-white text-slate-600 hover:bg-slate-50')}>
                {label}
                <span className={cn('rounded-full px-1.5 text-[0.7rem]', filter === key ? 'bg-white text-primary-text' : 'bg-slate-100 text-slate-500')}>{counts[key]}</span>
              </button>
            )))}
          </div>

          <section className={cn(ui.card, 'divide-y divide-line2 overflow-hidden')}>
            {visible.map((e) => (
              <Link key={e.id} href={`/dashboard/su-kien/${e.id}`}
                className={cn('group flex gap-4 px-4 py-4 transition-colors hover:bg-[#f9fafb] sm:px-5', e.ended && 'opacity-70')}>
                <Cover path={e.cover_url} className="aspect-video w-28 shrink-0 rounded-md border border-line2 sm:w-44" iconSize={22} />
                <div className="min-w-0 flex-1">
                  <div className="mb-1"><EventBadge e={e} /></div>
                  <h2 className="line-clamp-2 text-[0.95rem] font-semibold leading-snug text-ink group-hover:text-primary-text">{e.title}</h2>
                  <div className="mt-1.5 space-y-1 text-[0.8rem] text-muted">
                    <p className="flex items-start gap-1.5"><CalendarDays size={14} className="mt-0.5 shrink-0" />
                      <span>{eventRange(e)} <span className="text-slate-400">· {e.day_count} ngày</span></span></p>
                    {e.location && <p className="flex items-start gap-1.5"><MapPin size={14} className="mt-0.5 shrink-0" /><span className="line-clamp-1">{e.location}</span></p>}
                    {!e.ended && e.registration_state === 'open' && (
                      <p className="flex items-start gap-1.5 text-[#b45309]"><Clock size={14} className="mt-0.5 shrink-0" />
                        <span>Hạn đăng ký {hmdmy(e.registration_closes_at)} · {timeLeft(e.registration_closes_at)}</span></p>
                    )}
                    {!e.ended && e.registration_state === 'upcoming' && (
                      <p className="flex items-start gap-1.5"><Clock size={14} className="mt-0.5 shrink-0" /><span>Mở đăng ký {hmdmy(e.registration_opens_at)}</span></p>
                    )}
                  </div>
                </div>
                <ChevronRight size={18} className="hidden shrink-0 self-center text-slate-300 group-hover:text-primary sm:block" />
              </Link>
            ))}
            {visible.length === 0 && <p className="px-5 py-10 text-center text-sm text-muted">Không có sự kiện ở mục này.</p>}
          </section>
        </>
      )}
    </div>
  );
}
