'use client';

/**
 * Danh sách yêu cầu "Nạp giấy tờ trực tiếp" của sinh viên — cùng khuôn trang Yêu cầu giấy tờ:
 * chỉ đánh dấu thứ cần chú ý (cần bổ sung, đã có mã trả hồ sơ), còn lại trung tính.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ChevronRight, FileUp, Loader2, MessageSquare, Paperclip, Plus, Ticket } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { ui, badge, notice, noticeIcon } from '@/lib/ui';
import { cn, formatDateTime } from '@/lib/utils';
import { REQUEST_STATUS_LABELS, REQUEST_STATUS_STYLES, type RequestStatus, type SubmissionSummary } from '@/lib/types';
import { RequestCode } from '@/components/request-code';

const FILTERS: { key: 'all' | RequestStatus; label: string }[] = [
  { key: 'all', label: 'Tất cả' },
  { key: 'pending', label: 'Chờ xử lý' },
  { key: 'processing', label: 'Đang xử lý' },
  { key: 'awaiting_info', label: 'Cần bổ sung' },
  { key: 'done', label: 'Hoàn thành' },
  { key: 'returned', label: 'Đã trả giấy' },
  { key: 'rejected', label: 'Từ chối' },
];

export default function SubmissionListPage() {
  const [rows, setRows] = useState<SubmissionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | RequestStatus>('all');

  useEffect(() => {
    api.submissions.list()
      .then(setRows)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Không tải được danh sách.'));
  }, []);

  const counts = (rows ?? []).reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});
  const visible = (rows ?? []).filter((r) => filter === 'all' || r.status === filter);
  const needsAction = counts.awaiting_info ?? 0;
  const ready = counts.done ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Nạp giấy tờ trực tiếp</h1>
          <p className="mt-1 text-sm text-muted">
            Nạp ảnh chụp / bản scan giấy tờ cần Phòng Công tác Sinh viên xét, theo dõi xử lý và nhận lại giấy.
          </p>
        </div>
        <Link href="/dashboard/nap-giay-to/new" className={ui.btnPrimary}>
          <Plus size={15} />
          Nạp giấy tờ
        </Link>
      </div>

      {needsAction > 0 && (
        <div className={cn(notice.base, notice.warning)}>
          <AlertCircle className={noticeIcon.warning} />
          <p><strong>{needsAction}</strong> yêu cầu cần bổ sung thông tin. Mở yêu cầu để sửa lại hoặc trả lời Phòng CTSV.</p>
        </div>
      )}
      {ready > 0 && (
        <div className={cn(notice.base, notice.success)}>
          <Ticket className={noticeIcon.success} />
          <p><strong>{ready}</strong> yêu cầu đã hoàn thành — mang mã trả hồ sơ đến Phòng Công tác Sinh viên (O1.105) để nhận lại giấy.</p>
        </div>
      )}

      {error && (
        <div className={cn(notice.base, notice.error)}><AlertCircle className={noticeIcon.error} /><p>{error}</p></div>
      )}

      {rows === null && !error && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
          <Loader2 size={16} className="animate-spin" /> Đang tải…
        </div>
      )}

      {rows !== null && rows.length === 0 && (
        <section className={ui.card}>
          <div className="px-5 py-12 text-center">
            <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full border border-line bg-[#f8fafc]">
              <FileUp size={20} className="text-slate-400" />
            </span>
            <p className="text-sm font-medium text-ink">Chưa nạp giấy tờ nào</p>
            <p className="mt-1 text-[0.82rem] text-muted">Giấy tờ cần Phòng CTSV xét, ký hoặc đóng dấu — nạp ảnh chụp / bản scan tại đây.</p>
            <Link href="/dashboard/nap-giay-to/new" className={cn(ui.btnPrimary, 'mt-4')}>
              <Plus size={15} /> Nạp giấy tờ
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
                  key={key} type="button" onClick={() => setFilter(key)}
                  className={cn(
                    'inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[0.8rem] font-medium transition-colors sm:h-8',
                    filter === key ? 'border-primary bg-primary-soft text-primary-text' : 'border-line bg-white text-slate-600 hover:bg-slate-50',
                  )}
                >
                  {label}
                  <span className={cn('rounded-full px-1.5 text-[0.7rem]', filter === key ? 'bg-white text-primary-text' : 'bg-slate-100 text-slate-500')}>{n}</span>
                </button>
              );
            })}
          </div>

          <div className={cn(ui.card, 'divide-y divide-line2 overflow-hidden')}>
            {visible.map((s) => (
              <Link key={s.id} href={`/dashboard/nap-giay-to/${s.id}`} className="block px-5 py-4 transition-colors hover:bg-[#f9fafb]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink line-clamp-1" title={s.document_name}>{s.document_name}</span>
                      <span className={cn(badge.base, REQUEST_STATUS_STYLES[s.status])}>{REQUEST_STATUS_LABELS[s.status]}</span>
                      {s.comment_count > 0 && (
                        <span className={cn(badge.base, badge.neutral)}><MessageSquare size={12} />{s.comment_count}</span>
                      )}
                    </div>
                    <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.78rem] text-muted">
                      <RequestCode code={s.code} />
                      <span>Gửi {formatDateTime(s.created_at)}</span>
                      <span className="inline-flex items-center gap-1"><Paperclip size={12} /> {s.file_count} file · {s.copies} bản</span>
                      {s.return_code && (
                        <span className="inline-flex items-center gap-1">
                          <Ticket size={13} className="text-slate-400" />
                          Mã trả hồ sơ <span className="font-mono font-semibold text-ink">{s.return_code}</span>
                        </span>
                      )}
                    </p>
                  </div>
                  <ChevronRight size={16} className="mt-1 shrink-0 text-slate-400" />
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
