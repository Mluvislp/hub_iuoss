'use client';

/**
 * Hỏi đáp — danh sách ticket của sinh viên.
 *
 * Ticket có phản hồi mới chưa xem được đánh dấu (chấm + nền nhạt); còn lại trung tính.
 * Danh sách tự làm mới mỗi 30 giây khi tab đang mở để trạng thái không bị cũ.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Loader2, MessageSquare, MessagesSquare, Plus } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { ui, badge } from '@/lib/ui';
import { cn, formatDateTime } from '@/lib/utils';
import { TICKET_STATUS_STYLES, type TicketStatus, type TicketSummary } from '@/lib/types';

const FILTERS: { key: 'all' | TicketStatus; label: string }[] = [
  { key: 'all', label: 'Tất cả' },
  { key: 'answered', label: 'Đã phản hồi' },
  { key: 'open', label: 'Chờ phản hồi' },
  { key: 'closed', label: 'Đã đóng' },
];

const REFRESH_MS = 30_000;

export default function TicketListPage() {
  const [rows, setRows] = useState<TicketSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | TicketStatus>('all');

  const load = useCallback(() => {
    api.tickets
      .list()
      .then((data) => {
        setRows(data);
        setError(null);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Không tải được danh sách ticket.'),
      );
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(() => !document.hidden && load(), REFRESH_MS);
    const onVisible = () => !document.hidden && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  const counts = (rows ?? []).reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});
  const visible = (rows ?? []).filter((r) => filter === 'all' || r.status === filter);
  const unread = (rows ?? []).filter((r) => r.unread).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Hỏi đáp</h1>
          <p className="mt-1 text-sm text-muted">
            Câu hỏi gửi Phòng Công tác Sinh viên theo từng mảng công việc.
          </p>
        </div>
        <Link href="/dashboard/hoi-dap/new" className={ui.btnPrimary}>
          <Plus size={15} />
          Đặt câu hỏi
        </Link>
      </div>

      {unread > 0 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-primary-line bg-primary-soft px-4 py-3">
          <MessageSquare size={16} className="mt-0.5 shrink-0 text-primary-text" />
          <p className="text-sm text-primary-text">
            <strong>{unread}</strong> ticket có phản hồi mới từ Phòng Công tác Sinh viên.
          </p>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2.5 rounded-lg border border-danger-line bg-danger-soft px-4 py-3">
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-danger-text" />
          <p className="text-sm text-danger-text">{error}</p>
        </div>
      )}

      {rows === null && !error && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
          <Loader2 size={16} className="animate-spin" />
          Đang tải…
        </div>
      )}

      {rows !== null && rows.length === 0 && (
        <section className={ui.card}>
          <div className="px-5 py-12 text-center">
            <MessagesSquare size={22} className="mx-auto mb-2 text-slate-300" />
            <p className="text-sm text-muted">Chưa có câu hỏi.</p>
            <Link
              href="/dashboard/hoi-dap/new"
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary-text hover:underline"
            >
              <Plus size={15} />
              Đặt câu hỏi
            </Link>
          </div>
        </section>
      )}

      {rows !== null && rows.length > 0 && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map(({ key, label }) => {
              const n = key === 'all' ? rows.length : counts[key] ?? 0;
              if (key !== 'all' && n === 0) return null;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[0.8rem] font-medium transition-colors',
                    filter === key
                      ? 'border-primary bg-primary text-white'
                      : 'border-line bg-white text-slate-600 hover:bg-slate-50',
                  )}
                >
                  {label}
                  <span
                    className={cn(
                      'rounded-full px-1.5 text-[0.7rem]',
                      filter === key ? 'bg-white/20' : 'bg-slate-100 text-slate-500',
                    )}
                  >
                    {n}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Máy tính: bảng hồ sơ (lối Zendesk "My requests"). Điện thoại: thẻ gọn. */}
          <section className={cn(ui.card, 'hidden overflow-hidden md:block')}>
            <table className="w-full text-left text-[0.86rem]">
              <thead className="border-b border-line bg-[#f8fafc] text-[0.75rem] text-muted">
                <tr>
                  <th className="w-[92px] px-5 py-2.5 font-medium">Mã</th>
                  <th className="px-3 py-2.5 font-medium">Tiêu đề</th>
                  <th className="w-[140px] px-3 py-2.5 font-medium">Trạng thái</th>
                  <th className="w-[150px] px-5 py-2.5 font-medium">Cập nhật</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line2">
                {visible.map((t) => (
                  <tr key={t.id} className={cn('cursor-pointer hover:bg-[#f9fafb]', t.unread && 'bg-[#f8fbff]')}>
                    <td className="px-5 py-3 align-top font-mono text-[0.8rem] text-muted">
                      <Link href={`/dashboard/hoi-dap/${t.id}`} className="block">#{t.id}</Link>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <Link href={`/dashboard/hoi-dap/${t.id}`} className="block">
                        <span className="flex items-center gap-2">
                          {t.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Có phản hồi mới" />}
                          <span className={cn('line-clamp-1 text-ink', t.unread ? 'font-semibold' : 'font-medium')}>{t.subject}</span>
                        </span>
                        <span className="mt-0.5 block text-[0.78rem] text-muted">
                          {t.topic.name}{t.message_count ? ` · ${t.message_count} lượt trao đổi` : ''}
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <span className={cn(badge.base, TICKET_STATUS_STYLES[t.status])}>{t.status_label}</span>
                    </td>
                    <td className="px-5 py-3 align-top text-[0.8rem] text-muted">{formatDateTime(t.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <div className="space-y-2.5 md:hidden">
            {visible.map((t) => (
              <Link
                key={t.id}
                href={`/dashboard/hoi-dap/${t.id}`}
                className={cn(ui.card, 'block px-4 py-3.5', t.unread && 'border-primary-line bg-[#f8fbff]')}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[0.75rem] text-muted">#{t.id}</span>
                  <span className={cn(badge.base, TICKET_STATUS_STYLES[t.status])}>{t.status_label}</span>
                </div>
                <p className={cn('mt-1.5 text-ink', t.unread ? 'font-semibold' : 'font-medium')}>{t.subject}</p>
                <p className="mt-0.5 text-[0.78rem] text-muted">{t.topic.name} · {formatDateTime(t.updated_at)}</p>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
