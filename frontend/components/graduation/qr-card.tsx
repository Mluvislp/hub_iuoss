'use client';

import { useRef, useState } from 'react';
import QRCode from 'react-qr-code';
import { Download, Loader2, QrCode, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ui } from '@/lib/ui';
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
    <div className={cn(ui.card, 'overflow-hidden')}>
      <div className={ui.cardHeader}>
        <span className={ui.sectionTitle}><QrCode size={16} className="text-slate-500" /> Mã QR check-in</span>
      </div>
      <div className="p-5 flex flex-col items-center text-center">
        <div ref={holder} className="rounded-lg border border-line p-4 bg-white">
          <QRCode value={qr} size={220} level="M" viewBox="0 0 256 256" style={{ width: 220, height: 220 }} />
        </div>
        <div className="mt-3 font-semibold text-ink">{member.student.full_name}</div>
        <div className="font-mono text-sm font-semibold text-primary-text">{member.student.student_code}</div>
        {member.student.session_label && <div className="text-sm text-muted mt-0.5">{member.student.session_label}</div>}
        <button type="button" onClick={download} disabled={busy} className={cn(ui.btnPrimary, 'mt-4')}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
          Tải mã QR
        </button>
        <p className="mt-3 text-xs text-muted flex items-start gap-1.5 text-left max-w-xs">
          <ShieldCheck size={14} className="shrink-0 mt-0.5 text-success-text" />
          Mã QR gắn với riêng từng người và được đối chiếu trên hệ thống khi check-in. Mã bị hủy sẽ không còn hiệu lực.
          Xuất trình mã QR tại bàn check-in.
        </p>
      </div>
    </div>
  );
}
