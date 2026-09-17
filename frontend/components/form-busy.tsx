'use client';

import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Khoá form trong lúc đang gửi.
 *
 * Trước đây các form chỉ `disabled` mỗi nút Gửi — người dùng vẫn sửa được input
 * trong lúc request đang bay, nên thứ gửi đi và thứ đang hiện trên màn hình lệch
 * nhau, và họ tưởng sửa kịp.
 *
 * Dùng `<fieldset disabled>` chứ KHÔNG dùng `pointer-events-none`: fieldset chặn
 * cả bàn phím (Tab vào ô rồi gõ) và chặn ở tầng trình duyệt, không phải mẹo CSS.
 * Lớp phủ bên trên chỉ để nhìn thấy, không phải thứ đang chặn.
 *
 * `className` truyền thẳng vào fieldset — form cha thường đặt `space-y-*` ở đó,
 * bọc thêm một lớp div là mất khoảng cách giữa các khối.
 */
export function FormBusy({
  busy,
  label = 'Đang gửi…',
  className,
  children,
}: {
  busy: boolean;
  label?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <fieldset
        disabled={busy}
        // min-w-0: fieldset mặc định có `min-width: min-content`, để nguyên thì
        // các khối flex/grid con bị đẩy rộng ra khỏi thẻ cha.
        className={cn('min-w-0', busy && 'opacity-60 transition-opacity', className)}
      >
        {children}
      </fieldset>

      {busy && (
        <>
          {/* Chắn chuột. z-40 = tầng overlay của Hub, thấp hơn sidebar (z-50). */}
          <div aria-hidden className="absolute inset-0 z-40 cursor-wait rounded-lg" />

          {/* Form dài hơn màn hình nên dùng sticky để chỉ báo luôn nằm trong tầm mắt. */}
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-none sticky bottom-6 z-40 flex justify-center"
          >
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-4 py-2 text-sm font-medium text-ink shadow-md">
              <Loader2 size={15} className="animate-spin text-primary" />
              {label}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
