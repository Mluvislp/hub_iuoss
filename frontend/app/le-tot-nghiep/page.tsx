'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarHeart, ChevronDown, Loader2, LogOut, MapPin, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { notice, noticeIcon, ui } from '@/lib/ui';
import Fireworks, { type FireworksHandle } from '@/components/graduation/fireworks';
import Schedule from '@/components/graduation/schedule';
import Verify from '@/components/graduation/verify';
import QrCard from '@/components/graduation/qr-card';
import { RegisterForm, Registered } from '@/components/graduation/registration';
import { GradError, clearGradToken, getGradToken, gradApi, type GradInfo, type GradMember } from '@/lib/graduation';

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

function Hero({ fireworks }: { fireworks: React.RefObject<FireworksHandle> }) {
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
        <span className="w-9 h-9 rounded-full border border-white/40 flex items-center justify-center font-display font-bold">IU</span>
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
          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-white/80">
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
  return (
    <div className={cn(ui.card, 'p-5')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[0.72rem] font-semibold uppercase tracking-wider text-[#a07d1c]">{s.group_label}</div>
          <div className="mt-0.5 text-xl font-bold text-ink">{s.full_name}</div>
          <div className="font-mono text-sm font-semibold text-primary-text">{s.student_code}</div>
        </div>
        <button type="button" onClick={onLogout} className={cn(ui.btnGhost, 'h-9')}>
          <LogOut size={15} /> Thoát
        </button>
      </div>
      <dl className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2 text-sm">
        {s.major && <div><dt className="text-muted">Ngành</dt><dd className="font-medium text-ink">{s.major}</dd></div>}
        {s.department && <div><dt className="text-muted">Khoa</dt><dd className="font-medium text-ink">{s.department}</dd></div>}
        {s.award_title && <div><dt className="text-muted">Tên bằng</dt><dd className="font-medium text-ink">{s.award_title}</dd></div>}
        {s.degree_class && <div><dt className="text-muted">Xếp loại</dt><dd className="font-medium text-ink">{s.degree_class}</dd></div>}
        <div><dt className="text-muted">Ngày sinh</dt><dd className="font-medium text-ink">{s.date_of_birth || '—'}</dd></div>
      </dl>
      {s.session_label && (
        <div className="mt-4 flex items-center gap-3 rounded-lg border border-[#e9cf86] bg-[#fdf9ec] px-4 py-3">
          <MapPin size={18} className="text-[#a07d1c] shrink-0" />
          <div className="text-sm">
            <div className="text-[#7a5d0f]">Buổi lễ tham dự</div>
            <div className="font-semibold text-ink">{s.session_label}</div>
          </div>
        </div>
      )}
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
  const reg = member?.registration;
  const registered = reg?.status === 'registered' || reg?.status === 'cancel_requested';

  return (
    <div className="min-h-screen bg-canvas">
      <Hero fireworks={fireworks} />

      <main className="mx-auto max-w-content px-5 py-16 space-y-20 pb-28">
        <Schedule highlight={member?.student.session} />

        <section id="dang-ky" className="scroll-mt-6">
          <div className="text-center mb-8">
            <p className="text-[0.72rem] font-semibold tracking-[0.22em] uppercase text-[#a07d1c]">Đăng ký tham dự</p>
            <h2 className="mt-2 font-display font-semibold text-4xl sm:text-5xl text-[#0f2a5c]">Xác nhận tham dự Lễ Tốt nghiệp</h2>
            {round && (round.registration_opens_at && round.registration_closes_at ? (
              <p className="mt-3 text-sm text-muted">
                Thời gian đăng ký: {fmt(round.registration_opens_at)} — {fmt(round.registration_closes_at)}
              </p>
            ) : (
              <p className="mt-3 text-sm text-muted">Thời gian đăng ký sẽ được thông báo sau.</p>
            ))}
          </div>

          <div className={cn('mx-auto', member ? 'max-w-3xl' : 'max-w-5xl')}>
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
                notice={!round.registration_open && (
                  <div className={cn(notice.base, notice.neutral, 'mb-6')}>
                    <CalendarHeart size={16} className={noticeIcon.neutral} />
                    <p className="text-sm">
                      {round.registration_closes_at && new Date(round.registration_closes_at) < new Date()
                        ? 'Đã hết thời gian đăng ký tham dự. Sinh viên, học viên đã đăng ký vẫn xác minh được để xem lại mã QR.'
                        : 'Chưa mở đăng ký tham dự. Sinh viên, học viên có tên trong danh sách vẫn xác minh được để xem buổi lễ của mình.'}
                    </p>
                  </div>
                )}
              />
            ) : (
              <div className="space-y-5">
                <MemberSummary m={member} onLogout={logout} />
                {registered ? (
                  <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_300px] items-start">
                    <Registered member={member} onChange={setMember} />
                    <QrCard member={member} />
                  </div>
                ) : reg?.can_register ? (
                  <RegisterForm member={member} onRegistered={onRegistered} />
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
