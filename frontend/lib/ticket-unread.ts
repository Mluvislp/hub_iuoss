'use client';

import { useEffect, useState } from 'react';
import { api } from './api';

// ── Số ticket có phản hồi mới chưa xem (badge ở sidebar) ─────────────────────
// Polling 60 giây, chỉ khi tab đang hiển thị; quay lại tab thì hỏi ngay. Trang chi
// tiết ticket bắn sự kiện REFRESH_EVENT sau khi mở/đọc để badge tắt liền, không phải
// chờ tới lượt hỏi kế tiếp.

export const TICKET_UNREAD_REFRESH = 'hub:ticket-unread-refresh';
const INTERVAL_MS = 60_000;

export function refreshTicketUnread() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(TICKET_UNREAD_REFRESH));
}

export function useTicketUnread(enabled: boolean): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setCount(0);
      return;
    }
    let alive = true;
    const tick = () => {
      if (document.hidden) return;
      api.tickets
        .unread()
        .then((r) => alive && setCount(r.count))
        .catch(() => {
          /* mất mạng / hết phiên: giữ số cũ, lượt sau thử lại */
        });
    };
    tick();
    const timer = window.setInterval(tick, INTERVAL_MS);
    const onVisible = () => !document.hidden && tick();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener(TICKET_UNREAD_REFRESH, tick);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener(TICKET_UNREAD_REFRESH, tick);
    };
  }, [enabled]);

  return count;
}
