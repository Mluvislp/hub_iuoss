'use client';

/**
 * Link rút gọn hub.iuoss.com/<slug> — staff tạo ở Dashboard (Link rút gọn), đích đổi được bất cứ lúc nào.
 *
 * Chuyển hướng ở TRÌNH DUYỆT (`location.replace`) sau khi hỏi API: không bao giờ bị cache như 301 ⇒ QR đã in luôn
 * đi tới đích mới nhất; API đếm 1 lượt mỗi lần mở. Route có sẵn (/login, /dashboard, /su-kien…) luôn thắng route
 * động này; middleware cho slug qua mà không cần đăng nhập.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Link2Off, Loader2 } from 'lucide-react';
import { ui } from '@/lib/ui';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';

export default function ShortLinkPage() {
  const { slug } = useParams<{ slug: string }>();
  const [state, setState] = useState<{ kind: 'loading' | 'gone' | 'missing' | 'error'; target?: string }>({ kind: 'loading' });

  useEffect(() => {
    const s = String(slug || '').toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)) { setState({ kind: 'missing' }); return; }
    fetch(`${API_BASE}/short-links/${encodeURIComponent(s)}/`, { cache: 'no-store' })
      .then(async (res) => {
        if (res.status === 404) return setState({ kind: 'missing' });
        if (res.status === 410) return setState({ kind: 'gone' });
        const data = await res.json().catch(() => ({}));
        const target = typeof data.target === 'string' ? data.target : '';
        // Chỉ nhận http(s) — không bao giờ chạy "javascript:" dù dữ liệu bị sửa ngoài Dashboard.
        if (!res.ok || !/^https?:\/\//i.test(target)) return setState({ kind: 'error' });
        setState({ kind: 'loading', target });
        window.location.replace(target);
      })
      .catch(() => setState({ kind: 'error' }));
  }, [slug]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-[440px] rounded-lg border border-line bg-white px-6 py-8 text-center shadow-card">
        {state.kind === 'loading' ? (
          <>
            <Loader2 size={22} className="mx-auto mb-3 animate-spin text-primary" />
            <p className="text-sm font-medium text-ink">Đang chuyển trang…</p>
            {state.target && (
              <p className="mt-2 text-[0.78rem] text-muted">
                Trường hợp trang không tự chuyển, mở{' '}
                <a href={state.target} className="break-all text-primary-text underline">{state.target}</a>
              </p>
            )}
          </>
        ) : (
          <>
            <Link2Off size={22} className="mx-auto mb-3 text-slate-400" />
            <p className="text-sm font-medium text-ink">
              {state.kind === 'gone' ? 'Link này không còn hoạt động.'
                : state.kind === 'missing' ? 'Không tìm thấy link.'
                  : 'Không mở được link. Kiểm tra kết nối rồi thử lại.'}
            </p>
            <Link href="/dashboard" className={`${ui.btnSecondary} mt-4`}>Vào IUOSS Hub</Link>
          </>
        )}
      </div>
    </div>
  );
}
