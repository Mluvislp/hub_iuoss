'use client';

/**
 * Lịch sử yêu cầu giấy tờ của sinh viên.
 *
 * Danh sách chỉ trả lời hai câu: "yêu cầu của tôi đang ở đâu" và "tôi có việc gì
 * phải làm không". Nên chỉ đánh dấu thứ BẤT THƯỜNG — cần bổ sung thông tin, hoặc
 * đã có mã hồ sơ portal để đi nhận giấy; còn lại để trung tính.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle, ChevronRight, FileText, Loader2, MessageSquare, Plus, Ticket,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { ui, badge, accentIcon } from '@/lib/ui';
import { cn, formatDateTime } from '@/lib/utils';
import {
  REQUEST_TYPE_LABELS,
  REQUEST_STATUS_LABELS,
  REQUEST_STATUS_STYLES,
  type ConfirmationRequest,
  type RequestStatus,
} from '@/lib/types';

const FILTERS: { key: 'all' | RequestStatus; label: string }[] = [
  { key: 'all', label: 'Tất cả' },
  { key: 'pending', label: 'Chờ xử lý' },
  { key: 'processing', label: 'Đang xử lý' },
  { key: 'awaiting_info', label: 'Cần bổ sung' },
  { key: 'done', label: 'Hoàn thành' },
  { key: 'rejected', label: 'Từ chối' },
];

export default function RequestHistoryPage() {
  const [rows, setRows] = useState<ConfirmationRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | RequestStatus>('all');

  useEffect(() => {
    api.requests
      .list()
      .then(setRows)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Không tải được danh sách yêu cầu.'),
      );
  }, []);

  const counts = (rows ?? []).reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});
  const visible = (rows ?? []).filter((r) => filter === 'all' || r.status === filter);
  const needsAction = (rows ?? []).filter((r) => r.status === 'awaiting_info').length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Yêu cầu giấy tờ</h1>
          <p className="mt-1 text-sm text-muted">
            Toàn bộ yêu cầu em đã gửi, trạng thái xử lý và trao đổi với Phòng CTSV.
          </p>
        </div>
        <Link href="/dashboard/requests/new" className={ui.btnPrimary}>
          <Plus size={15} />
          Tạo yêu cầu
        </Link>
      </div>

      {needsAction > 0 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-violet-200 bg-violet-50 px-4 py-3">
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-violet-700" />
          <p className="text-sm text-violet-900">
            Em có <strong>{needsAction}</strong> yêu cầu cần bổ sung thông tin. Mở yêu cầu và
            trả lời trong phần trao đổi để Phòng CTSV xử lý tiếp.
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
            <FileText size={22} className="mx-auto mb-2 text-slate-300" />
            <p className="text-sm text-muted">Em chưa gửi yêu cầu giấy tờ nào.</p>
            <Link
              href="/dashboard/requests/new"
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary-text hover:underline"
            >
              <Plus size={15} />
              Tạo yêu cầu đầu tiên
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

          <div className="space-y-2.5">
            {visible.map((req) => (
              <Link
                key={req.id}
                href={`/dashboard/requests/${req.id}`}
                className={cn(
                  ui.card,
                  'block px-5 py-4 transition-colors hover:border-primary-line hover:bg-slate-50/60',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink">
                        {REQUEST_TYPE_LABELS[req.request_type]}
                      </span>
                      <span className={cn(badge.base, REQUEST_STATUS_STYLES[req.status])}>
                        {REQUEST_STATUS_LABELS[req.status]}
                      </span>
                      {req.comment_count > 0 && (
                        <span className={cn(badge.base, badge.neutral)}>
                          <MessageSquare size={12} />
                          {req.comment_count}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 line-clamp-1 text-[0.85rem] text-slate-600" title={req.purpose}>
                      {req.purpose}
                    </p>
                    <p className="mt-1 text-[0.78rem] text-muted">
                      Mã #{req.id} · Gửi {formatDateTime(req.created_at)}
                    </p>
                    {req.portal_code && (
                      <p className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-primary-line bg-primary-soft px-2 py-1 text-[0.78rem] text-primary-text">
                        <Ticket size={13} />
                        Mã hồ sơ portal:{' '}
                        <span className="font-mono font-semibold">{req.portal_code}</span>
                      </p>
                    )}
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
