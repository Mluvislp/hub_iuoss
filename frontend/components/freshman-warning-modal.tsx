'use client';

import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle } from 'lucide-react';
import { ui } from '@/lib/ui';
import { cn } from '@/lib/utils';
import { useDialog } from '@/lib/use-dialog';

/**
 * Popup cảnh báo dành cho tân sinh viên. Dùng cùng tông đỏ nhạt với
 * RejectionNotice (danger-soft / danger-line) và khung của InsuranceModal.
 * Chỉ đóng khi sinh viên bấm xác nhận; trên điện thoại hộp bám đáy màn hình.
 */
export function FreshmanWarningModal({ message, onConfirm, confirmLabel = 'Tôi đã hiểu' }: {
  message: string;
  onConfirm: () => void;
  confirmLabel?: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useDialog(boxRef, confirmRef);

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-end justify-center bg-black/50 sm:items-center sm:p-6">
      <div
        ref={boxRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="freshman-warning-title"
        className="flex max-h-[calc(100dvh-1rem)] w-full min-w-0 flex-col overflow-hidden rounded-t-xl border border-danger-line bg-white text-left shadow-card sm:max-w-md sm:rounded-lg">
        <div className="flex shrink-0 items-start gap-3 border-b border-danger-line bg-danger-soft px-4 py-3 text-danger-text">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide opacity-80">Lưu ý</p>
            <h2 id="freshman-warning-title" className="font-semibold leading-snug">Dành cho tân sinh viên</h2>
          </div>
        </div>
        <div className="min-w-0 flex-1 overflow-y-auto overscroll-contain p-4">
          <blockquote className="whitespace-pre-wrap break-words rounded-lg border-l-4 border-danger-text bg-slate-50 px-3.5 py-3 text-sm leading-6 text-slate-800">
            {message}
          </blockquote>
        </div>
        <div className={cn('shrink-0 px-4 pt-1 pb-[max(1rem,env(safe-area-inset-bottom))]')}>
          <button ref={confirmRef} type="button" className={cn(ui.btnPrimary, 'w-full')} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
