'use client';

import { useRef, useState } from 'react';
import QRCode from 'react-qr-code';
import { Download, Loader2, ShieldCheck } from 'lucide-react';
import type { GradMember } from '@/lib/graduation';

// Vẽ thẻ PNG: SVG của QR → <img> → canvas, kèm tên + mã + buổi lễ để đem in / lưu điện thoại.
async function renderPng(svg: SVGSVGElement, m: GradMember): Promise<Blob> {
  const xml = new XMLSerializer().serializeToString(svg);
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
  await img.decode();

  const W = 900, H = 1180, Q = 640;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#0f2a5c'; ctx.fillRect(0, 0, W, 150);
  ctx.fillStyle = '#d4a72c'; ctx.fillRect(0, 150, W, 6);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f5d27a';
  ctx.font = '600 26px system-ui, sans-serif';
  ctx.fillText('TRƯỜNG ĐẠI HỌC QUỐC TẾ — ĐHQG-HCM', W / 2, 62);
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 44px Georgia, serif';
  ctx.fillText(m.round.title, W / 2, 118);
  ctx.drawImage(img, (W - Q) / 2, 200, Q, Q);
  ctx.fillStyle = '#111827';
  ctx.font = '700 40px system-ui, sans-serif';
  ctx.fillText(m.student.full_name, W / 2, 920);
  ctx.fillStyle = '#1d4ed8';
  ctx.font = '700 34px ui-monospace, Consolas, monospace';
  ctx.fillText(m.student.student_code, W / 2, 972);
  ctx.fillStyle = '#475569';
  ctx.font = '400 28px system-ui, sans-serif';
  if (m.student.session_label) ctx.fillText(m.student.session_label, W / 2, 1024);
  ctx.font = '400 22px system-ui, sans-serif';
  ctx.fillStyle = '#64748b';
  ctx.fillText('Mã QR check-in cá nhân — không chia sẻ cho người khác', W / 2, 1110);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject()), 'image/png'));
}

export default function QrCard({ member }: { member: GradMember }) {
  const holder = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const qr = member.registration.qr;
  if (!qr) return null;

  async function download() {
    const svg = holder.current?.querySelector('svg');
    if (!svg) return;
    setBusy(true);
    try {
      const blob = await renderPng(svg as SVGSVGElement, member);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `QR-LeTotNghiep-${member.student.student_code}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-white shadow-[0_10px_40px_-22px_rgba(15,42,92,0.35)] lg:sticky lg:top-6">
      <div className="relative bg-[#0f2a5c] px-5 py-4 text-white">
        <p className="text-[0.7rem] font-semibold tracking-[0.22em] uppercase text-[#f5d27a]">Mã QR check-in</p>
        <p className="mt-0.5 font-display text-xl font-semibold">{member.round.title}</p>
      </div>
      {/* Đường răng cưa giả vé */}
      <div aria-hidden className="relative h-0 border-t-2 border-dashed border-line">
        <span className="absolute -left-3 -top-3 h-6 w-6 rounded-full bg-canvas border border-line" />
        <span className="absolute -right-3 -top-3 h-6 w-6 rounded-full bg-canvas border border-line" />
      </div>
      <div className="px-5 pb-5 pt-6 flex flex-col items-center text-center">
        <div ref={holder} className="rounded-lg border border-line p-3 bg-white">
          <QRCode value={qr} size={208} level="M" viewBox="0 0 256 256" style={{ width: 208, height: 208 }} />
        </div>
        <div className="mt-3 font-semibold text-ink">{member.student.full_name}</div>
        <div className="font-mono text-sm font-semibold text-[#0f2a5c]">{member.student.student_code}</div>
        {member.student.session_label && <div className="text-sm text-muted mt-0.5">{member.student.session_label}</div>}
        <button type="button" onClick={download} disabled={busy}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 h-11 rounded-lg bg-[#0f2a5c] hover:bg-[#163a7a]
                           text-white font-semibold transition-colors disabled:opacity-60">
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
          Tải mã QR
        </button>
        <p className="mt-3 text-xs text-muted flex items-start gap-1.5 text-left">
          <ShieldCheck size={14} className="shrink-0 mt-0.5 text-emerald-600" />
          Mã gắn với riêng từng người, đối chiếu trên hệ thống khi check-in. Xuất trình mã này tại bàn check-in; không chia sẻ cho người khác.
        </p>
      </div>
    </div>
  );
}
