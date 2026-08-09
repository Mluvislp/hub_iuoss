'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Headset, Mail, Phone, X } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Ô liên hệ hỗ trợ kỹ thuật ────────────────────────────────────────────────
// Nút tròn nổi góc dưới-phải, có mặt ở MỌI trang (mount ở app/layout.tsx nên
// gồm cả màn hình đăng nhập). Nguyên tắc để không gây phiền:
//   • không tự bật, không đếm ngược, không nhắc lại — chỉ mở khi người dùng bấm
//   • z-30: thấp hơn overlay (z-40) và sidebar (z-50) nên không đè menu mobile
//   • đóng được bằng nút X, phím Esc, hoặc bấm ra ngoài
//   • panel co theo màn hình hẹp, không bao giờ tràn viewport

const SUPPORT = {
  name: 'Hoàng Hải Đăng (Mr)',
  phone: '+84 862 215 649',
  /** Dạng chỉ chữ số cho link tel: / zalo.me */
  phoneRaw: '84862215649',
  email: 'hhdang@hcmiu.edu.vn',
};

/** Nút chép nhỏ — trên desktop link tel: vô dụng nên chép tay là cách nhanh nhất. */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* Trình duyệt chặn clipboard → bỏ qua, người dùng vẫn bôi đen chép tay được */
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? `Đã chép ${label}` : `Chép ${label}`}
      className="flex-shrink-0 p-1.5 -mr-1 rounded-md text-slate-400 hover:text-ink
                 hover:bg-slate-100 transition-colors"
    >
      {copied ? <Check size={14} className="text-success-text" /> : <Copy size={14} />}
    </button>
  );
}

function ContactRow({
  icon: Icon, label, value, href, extra,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  href: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-line2 last:border-0">
      <span
        className="flex-shrink-0 mt-0.5 w-7 h-7 rounded-md bg-primary-soft border border-primary-line
                   flex items-center justify-center"
      >
        <Icon size={14} className="text-primary" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[0.72rem] text-muted">{label}</div>
        <a
          href={href}
          className="block mt-0.5 text-[0.85rem] font-medium text-ink hover:text-primary-text
                     hover:underline break-all"
        >
          {value}
        </a>
        {extra}
      </div>
      <CopyButton value={value} label={label} />
    </div>
  );
}

export default function SupportWidget() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Esc để đóng + trả tiêu điểm về nút; bấm ra ngoài cũng đóng.
  useEffect(() => {
    if (!open) return;

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    function onPointerDown(e: MouseEvent | TouchEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }

    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    panelRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="fixed bottom-5 right-5 sm:bottom-6 sm:right-6 z-30 print:hidden">
      {/* Panel — mở LÊN TRÊN nút, canh phải, tự co trên màn hình hẹp */}
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Thông tin liên hệ hỗ trợ kỹ thuật"
          tabIndex={-1}
          className="absolute bottom-full right-0 mb-3 w-[min(330px,calc(100vw-2.5rem))]
                     bg-white border border-line rounded-lg shadow-card overflow-hidden
                     focus:outline-none"
        >
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-line bg-[#f8fafc]">
            <h2 className="flex items-center gap-2 text-[0.9rem] font-semibold text-ink">
              <Headset size={15} className="text-primary" />
              Hỗ trợ kỹ thuật
            </h2>
            <button
              type="button"
              onClick={() => { setOpen(false); buttonRef.current?.focus(); }}
              aria-label="Đóng"
              className="p-1 -mr-1 rounded-md text-muted hover:text-ink hover:bg-slate-200/60 transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          <div className="px-4 py-3.5">
            <p className="text-[0.82rem] text-muted leading-relaxed">
              Mọi sự cố về kỹ thuật vui lòng liên hệ chuyên viên{' '}
              <span className="font-medium text-ink">{SUPPORT.name}</span>
            </p>

            <div className="mt-2">
              <ContactRow
                icon={Phone}
                label="Điện thoại / Zalo"
                value={SUPPORT.phone}
                href={`tel:+${SUPPORT.phoneRaw}`}
                extra={
                  <a
                    href={`https://zalo.me/${SUPPORT.phoneRaw}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block mt-1 text-[0.75rem] font-medium text-primary-text hover:underline"
                  >
                    Nhắn qua Zalo
                  </a>
                }
              />
              <ContactRow
                icon={Mail}
                label="Email"
                value={SUPPORT.email}
                href={`mailto:${SUPPORT.email}`}
              />
            </div>
          </div>
        </div>
      )}

      {/* Nút nổi */}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? 'Đóng hỗ trợ kỹ thuật' : 'Liên hệ hỗ trợ kỹ thuật'}
        title="Liên hệ hỗ trợ kỹ thuật"
        className={cn(
          'w-12 h-12 rounded-full flex items-center justify-center transition-colors',
          'shadow-card focus-visible:outline-none focus-visible:ring-2',
          'focus-visible:ring-primary/40 focus-visible:ring-offset-2',
          open
            ? 'bg-white border border-line text-muted hover:text-ink'
            : 'bg-primary hover:bg-primary-hover text-white',
        )}
      >
        {open ? <X size={20} /> : <Headset size={20} />}
      </button>
    </div>
  );
}
