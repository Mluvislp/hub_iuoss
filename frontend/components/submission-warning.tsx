'use client';

/**
 * Popup cảnh báo trước khi mở form "Nạp giấy tờ trực tiếp" (người dùng yêu cầu 19/10/2026): sinh viên
 * hay nhầm với "Yêu cầu giấy tờ" (xin Phòng CTSV cấp giấy xác nhận). Bấm "Tiếp tục" mới sang form;
 * Esc / nút đóng / bấm nền = huỷ. Khung cùng kiểu FreshmanWarningModal, tông vàng cảnh báo.
 */

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, FileText, X } from 'lucide-react';
import { ui } from '@/lib/ui';
import { cn } from '@/lib/utils';

export function SubmissionWarningModal({ onContinue, onClose }: { onContinue: () => void; onClose: () => void }) {
  const continueRef = useRef<HTMLButtonElement>(null);
  // Giữ hàm đóng mới nhất trong ref: effect chỉ chạy một lần lúc mở (khoá cuộn + focus), không chạy lại
  // mỗi khi trang cha vẽ lại với một hàm `onClose` mới.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    continueRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    document.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', onKey); };
  }, []);

  return createPortal(
    <div
      role="alertdialog" aria-modal="true" aria-labelledby="submission-warning-title"
      className="fixed inset-0 z-[110] flex items-end justify-center bg-black/50 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-[calc(100dvh-1rem)] w-full min-w-0 flex-col overflow-hidden rounded-t-xl border border-warning-line bg-white text-left shadow-card sm:max-w-lg sm:rounded-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start gap-3 border-b border-warning-line bg-warning-soft px-4 py-3 text-warning-text">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wide opacity-80">Lưu ý trước khi tiếp tục</p>
            <h2 id="submission-warning-title" className="font-semibold leading-snug">Kiểm tra đúng chức năng cần dùng</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Đóng" className="-mr-1 rounded-md p-1 hover:bg-white/60">
            <X size={18} />
          </button>
        </div>

        <div className="min-w-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4 text-sm leading-6 text-slate-700">
          <p>
            <strong className="text-ink">Nạp giấy tờ trực tiếp</strong> chỉ dành cho giấy tờ sinh viên{' '}
            <strong className="text-ink">nộp trực tiếp tại Phòng Công tác Sinh viên (O1.105)</strong> để được xét, ký
            hoặc đóng dấu — ví dụ đơn, mẫu xác nhận do đơn vị bên ngoài (ngân hàng, cơ quan, công ty…) phát hành.
          </p>
          <div className="rounded-lg border border-line bg-slate-50 px-3.5 py-3">
            <p className="flex items-center gap-1.5 font-medium text-ink">
              <FileText size={15} className="text-slate-500" /> Cần Phòng CTSV cấp giấy xác nhận?
            </p>
            <p className="mt-1 text-[0.84rem]">
              Giấy xác nhận sinh viên, hoãn nghĩa vụ quân sự, vay vốn, ưu đãi giáo dục, mẫu tiếng Anh, bảng điểm rèn
              luyện… được tạo tại mục <strong className="text-ink">Yêu cầu giấy tờ</strong>, không dùng chức năng này.
            </p>
          </div>
          <p className="text-[0.84rem] text-muted">
            Yêu cầu gửi nhầm chức năng sẽ bị từ chối và phải gửi lại.
          </p>
        </div>

        <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-line px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end">
          <Link href="/dashboard/requests/new" className={cn(ui.btnOutline, 'w-full sm:w-auto')}>
            Đến Yêu cầu giấy tờ
          </Link>
          <button ref={continueRef} type="button" onClick={onContinue} className={cn(ui.btnPrimary, 'w-full sm:w-auto')}>
            Đúng, tiếp tục nạp giấy tờ <ArrowRight size={15} />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
