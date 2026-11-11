'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarHeart, ChevronDown, Loader2, LogOut, MapPin, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { notice, noticeIcon, ui } from '@/lib/ui';
import Fireworks, { type FireworksHandle } from '@/components/graduation/fireworks';
import Countdown from '@/components/graduation/countdown';
import Schedule from '@/components/graduation/schedule';
import Verify from '@/components/graduation/verify';
import QrCard from '@/components/graduation/qr-card';
import { RegisterForm, Registered } from '@/components/graduation/registration';
import {
  GradError, clearGradToken, getGradToken, gradApi, type GradInfo, type GradMember, type GradRound,
} from '@/lib/graduation';

/** Cuộn mượt tới một phần của trang (bỏ hiệu ứng nếu người dùng bật giảm chuyển động). */
function scrollToSection(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const top = el.getBoundingClientRect().top + window.scrollY - 24;
  window.scrollTo({ top, behavior: reduce ? 'auto' : 'smooth' });
  history.replaceState(null, '', `#${id}`);
}

function anchor(id: string) {
  return {
    href: `#${id}`,
    onClick: (e: React.MouseEvent) => { e.preventDefault(); scrollToSection(id); },
  };
}

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' }) : '';

function Hero({ fireworks, round, onElapsed }: {
  fireworks: React.RefObject<FireworksHandle>; round: GradRound | null; onElapsed: () => void;
}) {
  return (
    <header className="relative isolate min-h-[88vh] flex flex-col overflow-hidden text-white">
      <picture>
        <source srcSet="/img/graduation/hero.webp" type="image/webp" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/img/graduation/hero.jpg" alt="" className="absolute inset-0 -z-20 h-full w-full object-cover" />
      </picture>
      {/* Scrim navy: đậm ở đỉnh + đáy để chữ đọc được trên ảnh đông người. */}
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(9,24,56,0.86)_0%,rgba(9,24,56,0.55)_38%,rgba(9,24,56,0.62)_62%,rgba(9,24,56,0.94)_100%)]" />
      <Fireworks ref={fireworks} className="absolute inset-0 -z-10 h-full w-full pointer-events-none" />

      <div className="mx-auto w-full max-w-content px-5 pt-6 flex items-center gap-3 text-sm">
        <picture>
          <source srcSet="/img/graduation/iu-logo.webp" type="image/webp" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/img/graduation/iu-logo.png" alt="Logo Trường Đại học Quốc tế" width={44} height={44}
               className="h-11 w-11 rounded-full shadow-[0_0_0_2px_rgba(255,255,255,0.35)]" />
        </picture>
        <div className="leading-tight">
          <div className="font-semibold">Trường Đại học Quốc tế</div>
          <div className="text-white/70 text-xs">Đại học Quốc gia TP. Hồ Chí Minh</div>
        </div>
      </div>

      <div className="flex-1 flex items-center">
        <div className="mx-auto w-full max-w-content px-5 py-16 text-center">
          <p className="inline-flex items-center gap-2 text-[0.72rem] sm:text-xs font-semibold tracking-[0.3em] uppercase text-[#f5d27a]">
            <Sparkles size={14} /> Lễ Tốt nghiệp 2026 <Sparkles size={14} />
          </p>
          <h1 className="mt-5 font-display font-semibold text-[3.1rem] leading-[1.02] sm:text-7xl md:text-[5.75rem] tracking-[-0.01em]">
            Chúc mừng
            <span className="block italic font-medium text-[#f5d27a]">Tân khoa 2026</span>
          </h1>
          <div className="mx-auto mt-6 h-px w-24 bg-gradient-to-r from-transparent via-[#f5d27a] to-transparent" />
          <p className="mx-auto mt-6 max-w-2xl text-[0.98rem] sm:text-lg text-white/85 leading-[1.75] font-light">
            Trường Đại học Quốc tế trân trọng chúc mừng các tân cử nhân, kỹ sư, thạc sĩ và tiến sĩ đã hoàn thành
            chương trình đào tạo. Mỗi tấm bằng là thành quả của những năm tháng bền bỉ — và là khởi đầu cho
            những hành trình mới phía trước.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <a {...anchor('dang-ky')}
               className="inline-flex items-center justify-center gap-2 h-12 px-7 rounded-lg bg-[#f5d27a] hover:bg-[#f0c75c] text-[#0f2a5c] font-semibold transition-colors
                          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f2a5c]">
              Đăng ký tham dự lễ
            </a>
            <a {...anchor('lich')}
               className="inline-flex items-center justify-center gap-2 h-12 px-6 rounded-lg border border-white/40 hover:bg-white/10 font-medium transition-colors">
              Xem lịch tổ chức
            </a>
          </div>
          <div className="mt-10"><Countdown round={round} onElapsed={onElapsed} /></div>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-white/80">
            <span className="inline-flex items-center gap-1.5"><CalendarHeart size={15} className="text-[#f5d27a]" /> Tổng dợt chiều 27/11/2026</span>
            <span className="inline-flex items-center gap-1.5"><CalendarHeart size={15} className="text-[#f5d27a]" /> Lễ Tốt nghiệp 28 &amp; 29/11/2026</span>
          </div>
        </div>
      </div>
      <a {...anchor('lich')} aria-label="Cuộn xuống" className="mx-auto mb-6 text-white/60 hover:text-white motion-safe:animate-bounce">
        <ChevronDown size={26} />
      </a>
    </header>
  );
}

function MemberSummary({ m, onLogout }: { m: GradMember; onLogout: () => void }) {
  const s = m.student;
  const facts = [
    ['Ngành', s.major], ['Khoa', s.department], ['Tên bằng', s.award_title], ['Xếp loại', s.degree_class],
    ['Ngày sinh', s.date_of_birth],
  ].filter(([, v]) => v);
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-white shadow-[0_10px_40px_-22px_rgba(15,42,92,0.35)]
                    md:grid md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div className="relative overflow-hidden bg-[#0f2a5c] px-6 py-6 sm:px-8 text-white">
        <div aria-hidden className="absolute -right-14 -bottom-14 h-44 w-44 rounded-full border border-white/10" />
        <div aria-hidden className="absolute -right-4 -bottom-4 h-24 w-24 rounded-full border border-[#f5d27a]/25" />
        <p className="text-[0.7rem] font-semibold tracking-[0.22em] uppercase text-[#f5d27a]">{s.group_label}</p>
        <h3 className="mt-2 font-display text-[2rem] sm:text-[2.3rem] font-semibold leading-[1.1]">{s.full_name}</h3>
        <div className="mt-3">
          <span className="inline-flex items-center rounded-md border border-white/20 bg-white/[0.07] px-2.5 py-1 font-mono text-sm tracking-wide">
            {s.student_code}
          </span>
        </div>
        <button type="button" onClick={onLogout}
                className="relative mt-6 flex items-center gap-1.5 text-sm text-white/70 hover:text-white">
          <LogOut size={15} /> Thoát, xác minh người khác
        </button>
      </div>
      <div className="px-6 py-6 sm:px-8">
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {facts.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-xs font-medium uppercase tracking-wider text-slate-400">{k}</dt>
              <dd className="mt-0.5 font-medium text-ink break-words">{v}</dd>
            </div>
          ))}
        </dl>
        {s.session_label && (
          <div className="mt-5 flex items-center gap-3.5 rounded-xl border border-[#e9cf86] bg-[#fdf9ec] px-4 py-3.5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#f5d27a] text-[#0f2a5c]">
              <MapPin size={18} />
            </span>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-[#a07d1c]">Buổi lễ tham dự</div>
              <div className="font-display text-xl font-semibold text-[#0f2a5c]">{s.session_label}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function GraduationPage() {
  const fireworks = useRef<FireworksHandle>(null);
  const [info, setInfo] = useState<GradInfo | null>(null);
  const [member, setMember] = useState<GradMember | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const i = await gradApi.info();
        if (!alive) return;
        setInfo(i);
        if (getGradToken()) {
          try { const m = await gradApi.me(); if (alive) setMember(m); } catch { /* phiên hết hạn → xác minh lại */ }
        }
      } catch (err) {
        if (alive) setLoadError(err instanceof GradError ? err.message : 'Không tải được thông tin.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  // Quay về từ Microsoft (#dang-ky) → cuộn xuống phần đăng ký khi đã tải xong.
  useEffect(() => {
    if (!loading && window.location.hash === '#dang-ky') {
      scrollToSection('dang-ky');
    }
  }, [loading]);

  // Đồng hồ chạm mốc mở / hạn chót → lấy lại trạng thái từ máy chủ (nút đăng ký tự mở / khóa).
  const refresh = useCallback(async () => {
    try {
      setInfo(await gradApi.info());
      if (getGradToken()) setMember(await gradApi.me());
    } catch { /* giữ trạng thái cũ; lượt sau thử lại */ }
  }, []);

  const onVerified = useCallback((m: GradMember) => {
    setMember(m);
    requestAnimationFrame(() => scrollToSection('dang-ky'));
  }, []);

  const onRegistered = useCallback((m: GradMember) => {
    setMember(m);
    fireworks.current?.celebrate();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const logout = useCallback(() => { clearGradToken(); setMember(null); }, []);

  const round = member?.round ?? info?.round ?? null;
  // Chưa mở đợt (chưa đặt hạn hoặc chưa tới giờ mở) ⇒ khóa chọn đối tượng. Đã qua hạn ⇒ vẫn cho xác minh
  // để người đã đăng ký xem lại QR.
  const closedAlready = !!round && !round.registration_open && !!round.registration_closes_at
    && new Date(round.registration_closes_at) < new Date();
  const notOpenYet = !!round && !round.registration_open && !closedAlready;
  const reg = member?.registration;
  const registered = reg?.status === 'registered' || reg?.status === 'cancel_requested';

  return (
    <div className="min-h-screen bg-canvas">
      <Hero fireworks={fireworks} round={info?.round ?? null} onElapsed={refresh} />

      <main className="mx-auto max-w-content px-5 py-16 space-y-20 pb-28">
        <Schedule highlight={member?.student.session} round={round} />

        <section id="dang-ky" className="scroll-mt-6">
          <div className="text-center mb-8">
            <p className="text-[0.72rem] font-semibold tracking-[0.22em] uppercase text-[#a07d1c]">Đăng ký tham dự</p>
            <h2 className="mt-2 font-display font-semibold text-4xl sm:text-5xl text-[#0f2a5c]">Xác nhận tham dự Lễ Tốt nghiệp</h2>
            {round && (round.registration_opens_at && round.registration_closes_at ? (
              <div className="mt-6"><Countdown round={round} onElapsed={refresh} variant="light" /></div>
            ) : (
              <p className="mt-3 text-sm text-muted">Thời gian đăng ký sẽ được thông báo sau.</p>
            ))}
          </div>

          <div className="mx-auto max-w-5xl">
            {loading ? (
              <div className={cn(ui.card, 'p-10 flex items-center justify-center gap-2 text-sm text-muted')}>
                <Loader2 size={16} className="animate-spin" /> Đang tải…
              </div>
            ) : loadError ? (
              <div className={cn(notice.base, notice.error)}><span>{loadError}</span></div>
            ) : !round ? (
              <div className={cn(ui.card, 'p-8 text-center text-sm text-muted')}>Chưa có đợt Lễ tốt nghiệp nào.</div>
            ) : !member ? (
              <Verify
                msEnabled={info?.microsoft_login ?? false}
                onVerified={onVerified}
                lockedMessage={notOpenYet
                  ? (round.registration_opens_at
                    ? `Chưa mở đợt đăng ký tham dự — mở lúc ${fmt(round.registration_opens_at)}.`
                    : 'Chưa mở đợt đăng ký tham dự.')
                  : undefined}
                notice={closedAlready && (
                  <div className={cn(notice.base, notice.neutral, 'mb-6')}>
                    <CalendarHeart size={16} className={noticeIcon.neutral} />
                    <p className="text-sm">
                      Đã hết thời gian đăng ký tham dự. Sinh viên, học viên đã đăng ký vẫn xác minh được để xem lại mã QR.
                    </p>
                  </div>
                )}
              />
            ) : (
              <div className="space-y-5">
                <MemberSummary m={member} onLogout={logout} />
                {registered ? (
                  <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] items-start">
                    <Registered member={member} banks={info?.banks ?? []} onChange={setMember} />
                    <QrCard member={member} />
                  </div>
                ) : reg?.can_register ? (
                  <RegisterForm member={member} banks={info?.banks ?? []} onRegistered={onRegistered} />
                ) : (
                  <div className={cn(notice.base, notice.neutral)}>
                    <CalendarHeart size={16} className={noticeIcon.neutral} />
                    <p className="text-sm">Ngoài thời gian đăng ký — chưa đăng ký tham dự được.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        <section className="relative overflow-hidden rounded-lg">
          <picture>
            <source srcSet="/img/graduation/lights.webp" type="image/webp" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/img/graduation/lights.jpg" alt="Tân khoa IU trong Lễ Tốt nghiệp" loading="lazy"
                 className="h-72 sm:h-96 w-full object-cover" />
          </picture>
          <div className="absolute inset-0 bg-[linear-gradient(0deg,rgba(9,24,56,0.88)_0%,rgba(9,24,56,0.2)_60%)]" />
          <div className="absolute inset-x-0 bottom-0 p-6 sm:p-10 text-white">
            <p className="font-display text-2xl sm:text-3xl leading-snug max-w-2xl">
              “Hành trình tại IU khép lại một chương — những chương tiếp theo do chính các tân khoa viết nên.”
            </p>
            <p className="mt-2 text-sm text-white/75">Phòng Công tác Sinh viên — Trường Đại học Quốc tế</p>
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-white py-6 text-center text-xs text-muted">
        Phòng Công tác Sinh viên · Trường Đại học Quốc tế — ĐHQG-HCM
      </footer>
    </div>
  );
}
