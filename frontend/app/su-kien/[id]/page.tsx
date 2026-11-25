'use client';

/**
 * Trang CÔNG KHAI của một sự kiện cộng tác viên — đích của link / QR staff chia sẻ (Dashboard → Chia sẻ).
 *
 * - Không cần đăng nhập (middleware cho qua `/su-kien/*`). Chỉ hiện thông tin chung: ảnh, thời gian, địa
 *   điểm, hạn đăng ký, mô tả, đối tượng. KHÔNG có câu hỏi của form (API công khai không trả).
 * - Bấm Đăng ký: chưa đăng nhập ⇒ /login?next=/dashboard/su-kien/<id> (LDAP lẫn Microsoft đều quay lại
 *   đúng trang); đã đăng nhập ⇒ vào thẳng trang đăng ký trong Hub. Ai được đăng ký do trang trong Hub xét.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AlertCircle, CalendarDays, Clock, Info, Loader2, LogIn, MapPin, Users } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { badge, notice, noticeIcon, ui } from '@/lib/ui';
import { cn } from '@/lib/utils';
import { eventRange, hmdmy, timeLeft } from '@/components/volunteer';
import type { VolunteerEventPublic } from '@/lib/types';

const RICH =
  'break-words text-[0.9rem] leading-relaxed text-ink ' +
  '[&_p]:mb-2 [&>*:last-child]:mb-0 [&_strong]:font-semibold [&_b]:font-semibold [&_em]:italic ' +
  '[&_ul]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mb-2 [&_ol]:list-decimal [&_ol]:pl-5 ' +
  '[&_blockquote]:mb-2 [&_blockquote]:border-l-[3px] [&_blockquote]:border-primary-line ' +
  '[&_blockquote]:bg-slate-50 [&_blockquote]:px-3 [&_blockquote]:py-1 [&_a]:text-primary-text [&_a]:underline';

const AUDIENCE: Record<string, string> = {
  all: 'Sinh viên đại học đang học',
  list: 'Sinh viên trong danh sách Phòng Công tác Sinh viên mời',
};

function Brand() {
  return (
    <header className="border-b border-line bg-white">
      <div className="h-1 bg-primary" />
      <div className="mx-auto flex h-14 max-w-content items-center px-4 sm:px-6">
        <Link href="/dashboard" className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-[0.82rem] font-bold tracking-tight text-white shadow-sm shadow-primary/25">IU</div>
          <div className="leading-tight">
            <div className="text-[0.9rem] font-semibold text-ink">IUOSS Hub</div>
            <div className="text-[0.68rem] text-muted">Cổng dịch vụ sinh viên</div>
          </div>
        </Link>
      </div>
    </header>
  );
}

export default function PublicVolunteerEventPage() {
  const { id } = useParams<{ id: string }>();
  const eventId = Number(id);
  const [data, setData] = useState<VolunteerEventPublic | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    setLoggedIn(!!getToken());
    if (!Number.isInteger(eventId) || eventId <= 0) { setError('Không tìm thấy sự kiện.'); return; }
    api.volunteerPublic.get(eventId)
      .then((d) => { setData(d); document.title = `${d.title} — IUOSS Hub`; })
      .catch((err) => setError(err instanceof ApiError && err.status === 404
        ? 'Không tìm thấy sự kiện, hoặc sự kiện đã ngừng nhận đăng ký trên Hub.'
        : 'Không tải được sự kiện. Kiểm tra kết nối rồi thử lại.'));
  }, [eventId]);

  const hubPath = `/dashboard/su-kien/${eventId}`;
  const loginHref = `/login?next=${encodeURIComponent(hubPath)}`;

  let cta: React.ReactNode = null;
  if (data) {
    const open = !data.ended && data.registration_state === 'open';
    const upcoming = !data.ended && data.registration_state === 'upcoming';
    cta = (
      <section className={ui.card}>
        <div className="space-y-3 px-5 py-5">
          {open && (
            <>
              <p className="text-sm text-ink">Đang nhận đăng ký tới <b>{hmdmy(data.registration_closes_at)}</b>
                <span className="text-[#b45309]"> · {timeLeft(data.registration_closes_at)}</span></p>
              <Link href={loggedIn ? hubPath : loginHref} className={cn(ui.btnPrimary, 'w-full')}>
                {loggedIn ? 'Đăng ký tham gia' : <><LogIn size={16} />Đăng nhập để đăng ký</>}
              </Link>
              {!loggedIn && <p className="text-center text-[0.75rem] text-muted">Đăng nhập bằng tài khoản sinh viên, sau đó điền form đăng ký.</p>}
            </>
          )}
          {upcoming && (
            <>
              <div className={cn(notice.base, notice.info)}><Clock className={noticeIcon.info} /><p>Mở nhận đăng ký lúc <b>{hmdmy(data.registration_opens_at)}</b>.</p></div>
              <Link href={loggedIn ? hubPath : loginHref} className={cn(ui.btnOutline, 'w-full')}>
                {loggedIn ? 'Xem trong Hub' : <><LogIn size={16} />Đăng nhập Hub</>}
              </Link>
            </>
          )}
          {!open && !upcoming && (
            <>
              <div className={cn(notice.base, notice.neutral)}><Info className={noticeIcon.neutral} />
                <p>{data.ended ? 'Sự kiện đã kết thúc.' : 'Sự kiện đã hết thời gian nhận đăng ký.'}</p></div>
              <Link href={loggedIn ? hubPath : loginHref} className={cn(ui.btnOutline, 'w-full')}>
                {loggedIn ? 'Xem đăng ký của tôi' : <><LogIn size={16} />Đăng nhập để xem kết quả</>}
              </Link>
            </>
          )}
        </div>
      </section>
    );
  }

  return (
    <div className="min-h-screen bg-canvas">
      <Brand />
      <main className="mx-auto max-w-content px-4 pb-24 pt-6 sm:px-6">
        {error && (
          <div className="mx-auto max-w-xl space-y-4 py-10 text-center">
            <div className={cn(notice.base, notice.error, 'text-left')}><AlertCircle className={noticeIcon.error} /><p>{error}</p></div>
            <Link href="/dashboard" className={ui.btnSecondary}>Vào IUOSS Hub</Link>
          </div>
        )}
        {!data && !error && (
          <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted"><Loader2 size={16} className="animate-spin" />Đang tải…</div>
        )}
        {data && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
              <h1 className="text-xl font-semibold leading-snug text-ink sm:text-2xl">{data.title}</h1>
              {!data.ended && data.registration_state === 'open' && <span className={cn(badge.base, badge.success, 'mt-1')}>Đang nhận đăng ký</span>}
              {data.ended && <span className={cn(badge.base, badge.neutral, 'mt-1')}>Đã kết thúc</span>}
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
              {/* Điện thoại: thông tin + nút đăng ký lên trước (người quét QR thấy ngay). */}
              <aside className="space-y-4 lg:order-2">
                <section className={ui.card}>
                  <div className="space-y-3.5 px-5 py-4 text-sm">
                    <div className="flex gap-3"><CalendarDays size={16} className="mt-0.5 shrink-0 text-slate-400" />
                      <div><p className="text-[0.75rem] text-muted">Thời gian</p><p className="font-medium text-ink">{eventRange(data)}</p>
                        <p className="text-[0.78rem] text-muted">{data.day_count} ngày</p></div></div>
                    {data.location && <div className="flex gap-3"><MapPin size={16} className="mt-0.5 shrink-0 text-slate-400" />
                      <div><p className="text-[0.75rem] text-muted">Địa điểm</p><p className="font-medium text-ink">{data.location}</p></div></div>}
                    {data.audience && <div className="flex gap-3"><Users size={16} className="mt-0.5 shrink-0 text-slate-400" />
                      <div><p className="text-[0.75rem] text-muted">Đối tượng</p><p className="font-medium text-ink">{AUDIENCE[data.audience]}</p>
                        {data.capacity ? <p className="text-[0.78rem] text-muted">Số lượng cần: {data.capacity} sinh viên</p> : null}</div></div>}
                  </div>
                </section>
                {cta}
              </aside>

              <div className="min-w-0 space-y-4 lg:order-1">
                {data.cover_url && (
                  <div className="overflow-hidden rounded-lg border border-line bg-[#f1f5f9]">
                    <img src={api.volunteerPublic.coverUrl(data.cover_url)} alt="" className="aspect-video w-full object-cover" />
                  </div>
                )}
                {data.description && (
                  <section className={ui.card}>
                    <div className="px-5 py-4"><div className={RICH} dangerouslySetInnerHTML={{ __html: data.description }} /></div>
                  </section>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
