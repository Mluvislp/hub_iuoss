'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { ui } from '@/lib/ui';
import { cn } from '@/lib/utils';
import { useDialog } from '@/lib/use-dialog';

/**
 * Khung hộp thoại dùng chung cho cụm BHYT: tiêu đề dính trên cùng, thân cuộn
 * riêng, khóa cuộn trang nền. Trên điện thoại hộp phủ gần kín màn hình.
 */
export function InsuranceModal({ title, eyebrow, onClose, closeDisabled = false, size = 'lg', children }: {
  title: ReactNode;
  eyebrow?: ReactNode;
  onClose: () => void;
  closeDisabled?: boolean;
  size?: 'sm' | 'lg';
  children: ReactNode;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialog(boxRef);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !closeDisabled) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, closeDisabled]);

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 sm:items-center sm:p-6"
      onClick={(e) => { if (e.target === e.currentTarget && !closeDisabled) onClose(); }}>
      <div ref={boxRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={cn(
        'flex max-h-[calc(100dvh-1rem)] focus:outline-none w-full min-w-0 flex-col overflow-hidden rounded-t-xl border border-line bg-canvas text-left shadow-card sm:max-h-[calc(100dvh-3rem)] sm:rounded-lg',
        size === 'sm' ? 'sm:max-w-md' : 'sm:max-w-4xl',
      )}>
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-white px-4 py-3 sm:px-6">
          <div className="min-w-0">
            {eyebrow && <p className="text-xs font-medium text-primary-text">{eyebrow}</p>}
            <h2 id={titleId} className="truncate text-base font-semibold text-ink sm:text-lg">{title}</h2>
          </div>
          <button type="button" aria-label="Đóng" className={cn(ui.btnGhost, 'h-9 w-9 coarse:h-11 coarse:w-11 shrink-0 px-0')} disabled={closeDisabled} onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="min-w-0 flex-1 overflow-y-auto overscroll-contain break-words px-4 py-4 sm:px-6 sm:py-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
