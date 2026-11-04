'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

// Pháo hoa trên <canvas>, không thư viện ngoài. Pháo bay lên rồi nổ thành tia có trọng lực,
// đuôi mờ dần. Tôn trọng prefers-reduced-motion (không chạy), dừng khi tab ẩn, tự co theo khung.

export interface FireworksHandle {
  /** Bắn một loạt (dùng khi đăng ký thành công). */
  celebrate: () => void;
}

const COLORS = ['#f5d27a', '#ffe9b0', '#ffffff', '#9cc3ff', '#ffb4c8', '#d4a72c'];

interface Rocket { x: number; y: number; vx: number; vy: number; targetY: number; color: string }
interface Spark {
  x: number; y: number; vx: number; vy: number; life: number; max: number;
  color: string; size: number; trail: Array<[number, number]>;
}

const Fireworks = forwardRef<FireworksHandle, { className?: string; intro?: boolean }>(function Fireworks(
  { className, intro = true }, ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const launchRef = useRef<(n: number) => void>(() => {});

  useImperativeHandle(ref, () => ({ celebrate: () => launchRef.current(7) }), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;

    let width = 0, height = 0, raf = 0, running = true, last = performance.now();
    const rockets: Rocket[] = [];
    const sparks: Spark[] = [];
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width; height = rect.height;
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const rand = (a: number, b: number) => a + Math.random() * (b - a);

    const launch = (count = 1) => {
      for (let i = 0; i < count; i++) {
        setTimeout(() => {
          const x = rand(width * 0.12, width * 0.88);
          rockets.push({
            x, y: height + 10, vx: rand(-0.6, 0.6), vy: -rand(8.5, 11.5) * Math.sqrt(height / 800),
            targetY: rand(height * 0.12, height * 0.42), color: COLORS[(Math.random() * COLORS.length) | 0],
          });
        }, i * 260);
      }
    };
    launchRef.current = launch;

    const explode = (r: Rocket) => {
      const n = (rand(46, 78)) | 0;
      const power = rand(3.2, 5.4);
      const ring = Math.random() < 0.35;
      for (let i = 0; i < n; i++) {
        const angle = (Math.PI * 2 * i) / n + rand(-0.05, 0.05);
        const speed = ring ? power : power * Math.sqrt(Math.random());
        const max = rand(55, 85);
        sparks.push({
          x: r.x, y: r.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: max, max,
          color: Math.random() < 0.2 ? '#ffffff' : r.color, size: rand(1.2, 2.2), trail: [],
        });
      }
    };

    const frame = (now: number) => {
      if (!running) return;
      const dt = Math.min((now - last) / 16.67, 2.5);
      last = now;
      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'lighter';

      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        r.x += r.vx * dt; r.y += r.vy * dt; r.vy += 0.09 * dt;
        ctx.beginPath();
        ctx.fillStyle = 'rgba(255,240,200,0.9)';
        ctx.arc(r.x, r.y, 1.6, 0, Math.PI * 2);
        ctx.fill();
        if (r.y <= r.targetY || r.vy >= -1) { explode(r); rockets.splice(i, 1); }
      }

      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.trail.push([s.x, s.y]);
        if (s.trail.length > 5) s.trail.shift();
        s.vx *= 0.985; s.vy = s.vy * 0.985 + 0.045 * dt;
        s.x += s.vx * dt; s.y += s.vy * dt;
        s.life -= dt;
        const alpha = Math.max(s.life / s.max, 0);
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.size;
        ctx.beginPath();
        const [tx, ty] = s.trail[0];
        ctx.moveTo(tx, ty);
        ctx.lineTo(s.x, s.y);
        ctx.stroke();
        if (s.life <= 0) sparks.splice(i, 1);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    // Màn mở đầu: một loạt dày, sau đó thưa dần — không làm phiền người đang đọc.
    const timers: number[] = [];
    if (intro) {
      timers.push(window.setTimeout(() => launch(4), 350));
      timers.push(window.setTimeout(() => launch(4), 1900));
      timers.push(window.setTimeout(() => launch(3), 3600));
    }
    const idle = window.setInterval(() => { if (!document.hidden) launch(1); }, 3400);

    const onVisibility = () => {
      if (document.hidden) { running = false; cancelAnimationFrame(raf); }
      else if (!running) { running = true; last = performance.now(); raf = requestAnimationFrame(frame); }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
      clearInterval(idle);
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intro]);

  return <canvas ref={canvasRef} aria-hidden="true" className={className} />;
});

export default Fireworks;
