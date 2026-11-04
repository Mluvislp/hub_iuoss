'use client';

import { useState } from 'react';
import { Hourglass, Loader2, XCircle } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { notice, noticeIcon, ui } from '@/lib/ui';
import { cn } from '@/lib/utils';
import { RejectionNotice } from '@/components/rejection-notice';
import type { HealthCheckState } from '@/lib/types';

const REASON_MAX = 500;

function fmt(iso: string | null) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('vi-VN', {
    hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

/**
 * Yêu cầu hủy đăng ký khám tại trường (kể cả đã khám) — Phòng CTSV duyệt trên Dashboard.
 * Duyệt ⇒ đăng ký bị xoá, sinh viên trả lời lại đợt khám từ đầu.
 */
export default function CancelRequest({ state, onChange }: {
  state: HealthCheckState;
  onChange: (next: HealthCheckState) => void;
}) {
  const cancel = state.response?.cancel_request ?? null;
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (state.response?.choice !== 'register') return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) { setError('Vui lòng nhập lý do hủy đăng ký.'); return; }
    setBusy(true); setError('');
    try {
      onChange(await api.healthCheck.requestCancel(reason.trim()));
      setOpen(false); setReason('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không gửi được yêu cầu.');
    } finally { setBusy(false); }
  }

  async function withdraw() {
    setBusy(true); setError('');
    try {
      onChange(await api.healthCheck.withdrawCancel());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không rút được yêu cầu.');
    } finally { setBusy(false); }
  }

  if (cancel?.status === 'pending') {
    return (
      <div className="pt-4 border-t border-line2 space-y-3">
        <div className={cn(notice.base, notice.warning)}>
          <Hourglass className={noticeIcon.warning} />
          <div className="min-w-0">
            <div className="font-semibold">Yêu cầu hủy đăng ký đang chờ Phòng Công tác Sinh viên duyệt</div>
            <div className="text-muted mt-0.5">Gửi lúc {fmt(cancel.requested_at)}</div>
            <div className="mt-1.5 whitespace-pre-wrap break-words">Lý do: {cancel.reason}</div>
          </div>
        </div>
        {error && <p className="text-sm text-danger-text">{error}</p>}
        <div className="flex justify-end">
          <button type="button" className={ui.btnGhost} onClick={withdraw} disabled={busy}>
            {busy && <Loader2 size={15} className="animate-spin" />} Rút yêu cầu hủy
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-4 border-t border-line2 space-y-3">
      {cancel?.status === 'rejected' && (
        <RejectionNotice
          eyebrow="Yêu cầu hủy đăng ký bị từ chối"
          title="Đăng ký khám tại trường vẫn được giữ"
          noteLabel="Ghi chú của Phòng Công tác Sinh viên"
          note={cancel.review_note}
        />
      )}
      {!open ? (
        state.can_request_cancel && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[0.82rem] text-muted max-w-[520px]">
              Đăng ký nhầm hoặc cần khai báo lại? Gửi yêu cầu hủy đăng ký để Phòng Công tác Sinh viên xem xét.
            </p>
            <button type="button" className={ui.btnGhost} onClick={() => setOpen(true)}>
              <XCircle size={15} /> Yêu cầu hủy đăng ký
            </button>
          </div>
        )
      ) : (
        <form onSubmit={submit} className="rounded-lg border border-line px-4 py-4 space-y-3">
          <div>
            <div className="text-sm font-semibold text-ink">Yêu cầu hủy đăng ký khám tại trường</div>
            <p className="text-[0.82rem] text-muted mt-1">
              Khi được duyệt, đăng ký và phiếu khám hiện tại bị xoá; sinh viên trả lời lại đợt khám từ đầu.
            </p>
          </div>
          <div>
            <label htmlFor="cancel-reason" className={ui.fieldLabel}>Lý do hủy</label>
            <textarea id="cancel-reason" className={ui.textarea} rows={3} maxLength={REASON_MAX}
                      value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="text-right text-xs text-muted mt-1">{reason.length}/{REASON_MAX}</div>
          </div>
          {error && <p className="text-sm text-danger-text">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={ui.btnGhost} onClick={() => { setOpen(false); setError(''); }} disabled={busy}>
              Thôi
            </button>
            <button type="submit" className={ui.btnPrimary} disabled={busy}>
              {busy && <Loader2 size={15} className="animate-spin" />} Gửi yêu cầu hủy
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
