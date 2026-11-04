'use client';

import { useRef } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { AlertTriangle, ChevronRight, Construction, Home } from 'lucide-react';
import { badge, ui } from '@/lib/ui';
import { cn } from '@/lib/utils';
import { useDialog } from '@/lib/use-dialog';
import type { TuitionCategoryMode, TuitionCategoryReview, TuitionExemptionStatus } from '@/lib/types';

// Dùng chung cho các trang Miễn giảm học phí (tổng quan, nộp hồ sơ, chi tiết đơn).

export const BASE = '/dashboard/mien-giam-hoc-phi';

// Cùng bảng màu với pill trạng thái BHYT (components/insurance-status.tsx):
// đang xử lý ở trường = trung tính, chờ bước kế tiếp = info.
export const STATUS_BADGE: Record<TuitionExemptionStatus, string> = {
  processing: badge.neutral,
  awaiting_supplement: badge.warning,
  waiting_result: badge.info,
  done: badge.success,
  rejected: badge.danger,
};

export const REVIEW_BADGE: Record<TuitionCategoryReview, string> = {
  pending: badge.neutral,
  approved: badge.success,
  rejected: badge.neutral,
};

export const MODE_BADGE: Record<TuitionCategoryMode, string> = {
  confirm: badge.success,
  supplement: badge.warning,
  new: badge.info,
};

export const REVIEW_LABEL: Record<TuitionCategoryReview, string> = {
  pending: 'Chờ xét',
  approved: 'Đạt',
  rejected: 'Không đạt',
};

export function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) + ' ' + fmtDate(iso);
}

/** Breadcrumb cùng khuôn form BHYT: Trang chủ › Miễn giảm học phí › trang hiện tại. */
export function Breadcrumb({ current }: { current: string }) {
  return (
    <nav className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted" aria-label="Breadcrumb">
      <Link href="/dashboard" className="hover:text-primary flex items-center gap-1.5">
        <Home size={14} /> Trang chủ
      </Link>
      <ChevronRight size={14} />
      <Link href={BASE} className="hover:text-primary">Miễn giảm học phí</Link>
      <ChevronRight size={14} />
      <span className="font-medium text-ink">{current}</span>
    </nav>
  );
}

export function ErrorBox({ text }: { text: string }) {
  return (
    <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-danger-line bg-danger-soft px-4 py-3 text-sm text-danger-text">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {text}
    </div>
  );
}

/** Pill trạng thái đơn — cùng dáng `InsuranceStatus` (chấm màu + chữ). */
export function StatusBadge({ status, label }: { status: TuitionExemptionStatus; label: string }) {
  return (
    <span className={cn(badge.base, 'max-w-full whitespace-nowrap', STATUS_BADGE[status] ?? badge.neutral)}>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-80" />
      {label}
    </span>
  );
}

/** Pop-up "Sinh viên không đủ điều kiện do …" — cùng khung với FreshmanWarningModal. */
export function IneligibleModal({ message, onClose }: { message: string; onClose: () => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useDialog(boxRef, btn);
  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-end justify-center bg-scrim/50 sm:items-center sm:p-6">
      <div ref={boxRef} role="alertdialog" aria-modal="true" aria-labelledby="mghp-ineligible-title"
           className="w-full flex flex-col overflow-hidden rounded-t-xl border border-danger-line bg-white shadow-card sm:max-w-md sm:rounded-lg">
        <div className="flex items-start gap-3 border-b border-danger-line bg-danger-soft px-4 py-3 text-danger-text">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <h2 id="mghp-ineligible-title" className="font-semibold leading-snug">Không đủ điều kiện</h2>
        </div>
        <p className="px-4 py-4 text-sm text-ink leading-relaxed">{message}</p>
        <div className="flex justify-end border-t border-line2 px-4 py-3">
          <button ref={btn} type="button" className={ui.btnPrimary} onClick={onClose}>Tôi đã hiểu</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Ghi chú "đang dựng khung" — gỡ khi phần tương ứng được cài thật. */
export function ScaffoldNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-lg bg-warning-soft border border-warning-line text-warning-text text-meta">
      <Construction size={15} className="flex-shrink-0 mt-0.5" />
      <div>{children}</div>
    </div>
  );
}
