'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import type { GradRound } from '@/lib/graduation';

// Đồng hồ đếm ngược hạn đăng ký — chỉ hiện khi Phòng CTSV đã đặt CẢ HAI mốc ở Dashboard.
// Chưa tới giờ mở → đếm tới lúc mở; đang mở → đếm tới hạn chót; quá hạn → một dòng báo đã hết hạn.
// Đếm theo đồng hồ máy người xem; chạm 0 thì gọi onElapsed để trang lấy lại trạng thái từ máy chủ
// (máy chủ mới là nơi quyết định có cho đăng ký hay không).

type Phase = 'before' | 'open' | 'closed';

function phaseOf(round: GradRound, now: number): { phase: Phase; target: number } | null {
  if (!round.registration_opens_at || !round.registration_closes_at) return null;
  const opens = new Date(round.registration_opens_at).getTime();
  const closes = new Date(round.registration_closes_at).getTime();
  if (now < opens) return { phase: 'before', target: opens };
  if (now <= closes) return { phase: 'open', target: closes };
  return { phase: 'closed', target: closes };
}

const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (ms: number) =>
  new Date(ms).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });

export default function Countdown({ round, onElapsed, variant = 'dark' }: {
  round: GradRound | null;
  onElapsed?: () => void;
  variant?: 'dark' | 'light';
}) {
  const [now, setNow] = useState<number | null>(null);   // null tới khi mount — tránh lệch SSR/hydration
  const fired = useRef<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const state = round && now !== null ? phaseOf(round, now) : null;

  useEffect(() => {
    if (!state || state.phase === 'closed' || now === null) return;
    if (now >= state.target && fired.current !== state.target) {
      fired.current = state.target;
      onElapsed?.();
    }
  }, [now, state, onElapsed]);

  if (!state || now === null) return null;
  const dark = variant === 'dark';

  if (state.phase === 'closed') {
    return (
      <p className={cn('text-sm text-center', dark ? 'text-white/75' : 'text-muted')}>
        Đã hết thời gian đăng ký tham dự (hạn chót {fmt(state.target)}).
      </p>
    );
  }

  const left = Math.max(0, state.target - now);
  const parts = [
    { v: Math.floor(left / 86_400_000), l: 'Ngày' },
    { v: Math.floor(left / 3_600_000) % 24, l: 'Giờ' },
    { v: Math.floor(left / 60_000) % 60, l: 'Phút' },
    { v: Math.floor(left / 1000) % 60, l: 'Giây' },
  ];
  const urgent = state.phase === 'open' && left < 86_400_000;

  return (
    <div className="flex flex-col items-center" role="timer" aria-live="off">
      <p className={cn('text-[0.72rem] font-semibold uppercase tracking-[0.24em]',
                       dark ? 'text-[#f5d27a]' : 'text-[#a07d1c]')}>
        {state.phase === 'before' ? 'Mở đăng ký sau' : 'Hạn đăng ký tham dự còn'}
      </p>
      <div className="mt-3 flex items-stretch gap-2 sm:gap-3">
        {parts.map((p, i) => (
          <div key={p.l} className="flex items-stretch gap-2 sm:gap-3">
            <div className={cn(
              'w-[4.1rem] sm:w-[5rem] rounded-lg border px-1 py-2.5 text-center',
              dark ? 'border-white/20 bg-white/[0.07]' : 'border-line bg-white',
              urgent && (dark ? 'border-[#f5d27a]/60' : 'border-[#e9cf86]'),
            )}>
              <div className={cn('font-display font-semibold leading-none tabular-nums text-[2rem] sm:text-[2.5rem]',
                                 dark ? 'text-white' : 'text-[#0f2a5c]')}>
                {i === 0 ? p.v : pad(p.v)}
              </div>
              <div className={cn('mt-1.5 text-[0.68rem] font-medium uppercase tracking-wider',
                                 dark ? 'text-white/60' : 'text-muted')}>{p.l}</div>
            </div>
            {i < parts.length - 1 && (
              <span className={cn('hidden sm:block self-center font-display text-2xl -mt-4', dark ? 'text-white/35' : 'text-slate-300')}>:</span>
            )}
          </div>
        ))}
      </div>
      <p className={cn('mt-3 text-xs', dark ? 'text-white/60' : 'text-muted')}>
        {state.phase === 'before' ? `Mở đăng ký lúc ${fmt(state.target)}` : `Hạn chót ${fmt(state.target)}`}
      </p>
    </div>
  );
}
