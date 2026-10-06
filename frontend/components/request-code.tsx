'use client';

/** Mã yêu cầu `GT-YYMM-XXXXX` trong ô viền, chữ đơn cách, có nút chép. */

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';

export function RequestCode({ code, size = 'sm' }: { code: string; size?: 'sm' | 'lg' }) {
  const [copied, setCopied] = useState(false);

  async function copy(e: React.MouseEvent) {
    e.preventDefault();          // nằm trong thẻ <Link> ở danh sách: không mở chi tiết
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* trình duyệt chặn clipboard — bôi đen chép tay được */
    }
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-slate-50 font-mono font-semibold tracking-wide text-ink',
        size === 'lg' ? 'px-2.5 py-1 text-[0.95rem]' : 'px-2 py-0.5 text-[0.78rem]',
      )}
    >
      {code}
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? `Đã chép mã ${code}` : `Chép mã ${code}`}
        className="text-slate-400 hover:text-primary"
      >
        {copied ? <Check size={size === 'lg' ? 15 : 13} className="text-success-text" /> : <Copy size={size === 'lg' ? 15 : 13} />}
      </button>
    </span>
  );
}
