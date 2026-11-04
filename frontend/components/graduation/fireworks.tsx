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
  glitter: boolean;   // nhấp nháy
  split: boolean;     // tách thêm chùm nhỏ khi gần tàn (crossette)
}

const MAX_SPARKS = 2600;   // trần để máy yếu không giật

const Fireworks = forwardRef<FireworksHandle, { className?: string; intro?: boolean }>(function Fireworks(
  { className, intro = true }, ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const launchRef = useRef<(n: number) => void>(() => {});

  useImperativeHandle(ref, () => ({ celebrate: () => launchRef.current(14) }), []);

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
    const flashes: Array<{ x: number; y: number; life: number }> = [];
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

    // Màn hẹp (điện thoại) bắn ít hơn ~40%.
    const scale = () => (width < 640 ? 0.6 : 1);

    const launch = (count = 1) => {
      const total = Math.max(1, Math.round(count * scale()));
      for (let i = 0; i < total; i++) {
        setTimeout(() => {
          const x = rand(width * 0.12, width * 0.88);
          rockets.push({
            x, y: height + 10, vx: rand(-0.6, 0.6), vy: -rand(8.5, 11.5) * Math.sqrt(height / 800),
            targetY: rand(height * 0.12, height * 0.42), color: COLORS[(Math.random() * COLORS.length) | 0],
          });
        }, i * 170 + Math.random() * 90);
      }
    };
    launchRef.current = launch;

    const burst = (x: number, y: number, color: string, n: number, power: number, life: [number, number],
                   opts: { ring?: boolean; split?: boolean; size?: [number, number] } = {}) => {
      if (sparks.length > MAX_SPARKS) n = Math.round(n * 0.35);
      const [sMin, sMax] = opts.size ?? [1.3, 2.4];
      for (let i = 0; i < n; i++) {
        const angle = (Math.PI * 2 * i) / n + rand(-0.06, 0.06);
        const speed = opts.ring ? power * rand(0.92, 1.05) : power * Math.sqrt(Math.random());
        const max = rand(life[0], life[1]);
        sparks.push({
          x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: max, max,
          color: Math.random() < 0.18 ? '#ffffff' : color, size: rand(sMin, sMax), trail: [],
          glitter: Math.random() < 0.3, split: !!opts.split && Math.random() < 0.22,
        });
      }
    };

    const explode = (r: Rocket) => {
      const kind = Math.random();
      const n = (rand(90, 140) * scale()) | 0;
      const power = rand(3.8, 6.5) * Math.sqrt(Math.max(height, 500) / 800);
      if (kind < 0.25) {
        // Vòng kép: vòng ngoài + lõi khác màu.
        burst(r.x, r.y, r.color, n, power, [70, 105], { ring: true });
        burst(r.x, r.y, COLORS[(Math.random() * COLORS.length) | 0], (n * 0.45) | 0, power * 0.5, [55, 80], { ring: true });
      } else if (kind < 0.45) {
        burst(r.x, r.y, r.color, n, power, [70, 110], { split: true });
      } else {
        burst(r.x, r.y, r.color, n, power, [75, 115]);
      }
      // Chớp sáng tại tâm nổ.
      flashes.push({ x: r.x, y: r.y, life: 10 });
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
        if (s.trail.length > 7) s.trail.shift();
        s.vx *= 0.985; s.vy = s.vy * 0.985 + 0.045 * dt;
        s.x += s.vx * dt; s.y += s.vy * dt;
        s.life -= dt;
        let alpha = Math.max(s.life / s.max, 0);
        if (s.glitter && s.life < s.max * 0.6) alpha *= Math.random() < 0.5 ? 1 : 0.15;
        if (s.split && s.life < s.max * 0.45) {
          s.split = false;
          burst(s.x, s.y, s.color, 9, 1.6, [28, 42], { size: [0.9, 1.4] });
        }
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
      for (let i = flashes.length - 1; i >= 0; i--) {
        const f = flashes[i];
        const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, 70);
        g.addColorStop(0, `rgba(255,236,190,${0.35 * (f.life / 10)})`);
        g.addColorStop(1, 'rgba(255,236,190,0)');
        ctx.globalAlpha = 1;
        ctx.fillStyle = g;
        ctx.fillRect(f.x - 70, f.y - 70, 140, 140);
        f.life -= dt;
        if (f.life <= 0) flashes.splice(i, 1);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    // Màn mở đầu 4 đợt dày, sau đó vẫn bắn đều 1–3 quả mỗi ~1,5 giây.
    const timers: number[] = [];
    if (intro) {
      timers.push(window.setTimeout(() => launch(6), 300));
      timers.push(window.setTimeout(() => launch(6), 1500));
      timers.push(window.setTimeout(() => launch(6), 2900));
      timers.push(window.setTimeout(() => launch(5), 4300));
    }
    const idle = window.setInterval(() => { if (!document.hidden) launch(1 + ((Math.random() * 3) | 0)); }, 1500);

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
