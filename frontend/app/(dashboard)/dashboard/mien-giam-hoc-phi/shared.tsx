'use client';

import { useRef } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { AlertCircle, AlertTriangle, ChevronRight, Construction } from 'lucide-react';
import { badge, ui } from '@/lib/ui';
import { cn } from '@/lib/utils';
import { useDialog } from '@/lib/use-dialog';
import type { TuitionCategoryMode, TuitionCategoryReview, TuitionExemptionStatus } from '@/lib/types';

// Dùng chung cho các trang Miễn giảm học phí (tổng quan, nộp hồ sơ, chi tiết đơn).

export const BASE = '/dashboard/mien-giam-hoc-phi';

export const STATUS_BADGE: Record<TuitionExemptionStatus, string> = {
  submitted: badge.info,
  under_review: badge.warning,
  need_supplement: badge.danger,
  approved: badge.success,
  rejected: badge.neutral,
};

export const REVIEW_BADGE: Record<TuitionCategoryReview, string> = {
  pending: badge.neutral,
  approved: badge.success,
  rejected: badge.neutral,
  need_supplement: badge.danger,
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
  need_supplement: 'Cần bổ sung',
};

export function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) + ' ' + fmtDate(iso);
}

export function fmtVnd(n: number) {
  return n.toLocaleString('vi-VN') + ' đ';
}

export function Breadcrumb({ trail }: { trail: { label: string; href?: string }[] }) {
  const items = [{ label: 'Bảng thông tin', href: '/dashboard' }, ...trail];
  return (
    <nav className="flex items-center gap-1.5 text-[0.82rem] text-muted flex-wrap">
      {items.map((it, i) => (
        <span key={it.label} className="flex items-center gap-1.5">
          {i > 0 && <ChevronRight size={14} className="text-faint" />}
          {it.href && i < items.length - 1
            ? <Link href={it.href} className="hover:text-ink">{it.label}</Link>
            : <span className="text-ink font-medium">{it.label}</span>}
        </span>
      ))}
    </nav>
  );
}

export function ErrorBox({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-lg bg-danger-soft border border-danger-line text-danger-text text-sm">
      <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />{text}
    </div>
  );
}

export function StatusBadge({ status, label }: { status: TuitionExemptionStatus; label: string }) {
  return <span className={cn(badge.base, STATUS_BADGE[status] ?? badge.neutral)}>{label}</span>;
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
    <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-lg bg-warning-soft border border-warning-line text-warning-text text-[0.82rem]">
      <Construction size={15} className="flex-shrink-0 mt-0.5" />
      <div>{children}</div>
    </div>
  );
}
