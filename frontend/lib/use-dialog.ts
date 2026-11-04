'use client';

import { useEffect, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), ' +
  'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Hành vi chung của hộp thoại modal: khóa cuộn trang nền, đưa focus vào hộp,
 * giữ Tab / Shift+Tab quanh quẩn trong hộp, đóng thì trả focus về chỗ cũ (thường
 * là nút đã mở hộp).
 *
 * `initialFocus` bỏ trống → focus vào chính khung hộp (cần `tabIndex={-1}`), để
 * trình đọc màn hình đọc tiêu đề trước. Phím Esc KHÔNG xử lý ở đây — popup cảnh báo
 * cố ý chỉ đóng khi SV bấm xác nhận, nên từng hộp tự quyết.
 */
export function useDialog(
  containerRef: RefObject<HTMLElement>,
  initialFocus?: RefObject<HTMLElement>,
) {
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    const returnTo = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    (initialFocus?.current ?? root).focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      // display:none (vd input file `hidden`) có offsetParent null → bỏ qua.
      const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((el) => el.offsetParent !== null);
      if (items.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const outside = !root.contains(active) || active === root;
      if (e.shiftKey && (active === first || outside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || outside)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      returnTo?.focus?.();
    };
    // Chỉ chạy lúc mở/đóng hộp — ref ổn định suốt vòng đời component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
