'use client';

import QRCode from 'react-qr-code';
import { CalendarDays, Clock, Info, Printer, Ticket } from 'lucide-react';
import { badge, notice, noticeIcon, subtle, ui } from '@/lib/ui';
import { cn } from '@/lib/utils';
import type { HealthCheckTicket } from '@/lib/types';

/** In riêng phiếu: ẩn toàn bộ trang (sidebar, đầu trang, nút hỗ trợ…), chỉ giữ #exam-ticket. */
const PRINT_CSS = `
@media print {
  @page { size: A5 portrait; margin: 10mm; }
  body * { visibility: hidden !important; }
  #exam-ticket, #exam-ticket * { visibility: visible !important; }
  #exam-ticket { position: absolute; left: 0; top: 0; width: 100%; box-shadow: none !important; }
  #exam-ticket .no-print { display: none !important; }
}`;

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[0.75rem] text-muted">{label}</div>
      <div className={cn('text-sm font-medium text-ink break-words mt-0.5', mono && 'font-mono tracking-wide')}>
        {value || <span className="italic font-normal text-slate-400">Chưa cập nhật</span>}
      </div>
    </div>
  );
}

/** Thông tin định danh — đặt ngay dưới mã phiếu, chữ lớn hơn để đối chiếu nhanh tại bàn khám. */
function BigField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[0.75rem] text-muted">{label}</div>
      <div className={cn('text-[1.02rem] font-semibold text-ink break-words mt-0.5', mono && 'font-mono tracking-wide')}>
        {value || <span className="italic font-normal text-sm text-slate-400">Chưa cập nhật</span>}
      </div>
    </div>
  );
}

/** Phiếu khám sức khỏe — chỉ hiện khi Phòng CTSV đã gán mã (`exam_code`) cho đăng ký khám tại trường. */
export default function ExamTicket({ ticket }: { ticket: HealthCheckTicket }) {
  const s = ticket.student;
  return (
    <section id="exam-ticket" className={ui.card} aria-label="Phiếu khám sức khỏe">
      <style>{PRINT_CSS}</style>
      <div className={ui.cardHeader}>
        <h2 className={ui.sectionTitle}>
          <Ticket size={16} className="text-slate-500" /> Phiếu khám sức khỏe
        </h2>
        <div className="flex items-center gap-2">
          <span className={cn(badge.base, badge.success)}>Đã phát hành</span>
          <button type="button" onClick={() => window.print()} className={cn(ui.btnSecondary, 'no-print h-8 px-3 text-[0.8rem]')}>
            <Printer size={14} /> In phiếu
          </button>
        </div>
      </div>

      <div className="px-5 py-5 grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="space-y-4 min-w-0">
          <div>
            <div className="text-[0.75rem] font-medium text-muted">Mã phiếu khám</div>
            <div className="font-mono text-[1.35rem] font-bold text-primary-text tracking-wide mt-0.5 break-all">{ticket.code}</div>
          </div>

          <div className="grid gap-x-6 gap-y-3.5 grid-cols-1 sm:grid-cols-2">
            <BigField label="Họ và tên" value={s.full_name} />
            <BigField label="Mã số sinh viên" value={s.student_code} mono />
            <BigField label="Số CCCD" value={s.citizen_id} mono />
            <BigField label="Ngày sinh" value={s.date_of_birth} />
          </div>

          <div className={cn(subtle, 'divide-y divide-line2 text-sm')}>
            <div className="flex items-start gap-2.5 px-3.5 py-2.5">
              <CalendarDays size={15} className="text-slate-500 mt-0.5 shrink-0" />
              <div><span className="text-muted">Ngày khám: </span><span className="font-semibold text-ink">{ticket.date_label || '—'}</span></div>
            </div>
            <div className="flex items-start gap-2.5 px-3.5 py-2.5">
              <Clock size={15} className="text-slate-500 mt-0.5 shrink-0" />
              <div>
                <span className="text-muted">Ca khám: </span>
                <span className="font-semibold text-ink">{ticket.slot_label || '—'}</span>
                {ticket.slot_time && <span className="text-ink"> ({ticket.slot_time})</span>}
              </div>
            </div>
          </div>
        </div>

        <div className="flex sm:flex-col items-center gap-3 sm:gap-1.5 justify-self-center">
          <div className="rounded-lg border border-line bg-white p-2.5">
            <QRCode value={ticket.code} size={112} />
          </div>
          <div className="text-[0.72rem] text-muted text-center">Quét để tra mã phiếu</div>
        </div>
      </div>

      <div className="mx-5 border-t border-dashed border-line" />

      <div className="px-5 py-5">
        <div className="text-[0.82rem] font-semibold text-ink mb-3">Thông tin khác</div>
        <div className="grid gap-x-6 gap-y-3.5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Giới tính" value={s.sex} />
          <Field label="Số điện thoại" value={s.phone} mono />
          <Field label="Mã thẻ BHYT" value={s.health_insurance_code} mono />
          <Field label="Lớp" value={s.class_code} />
          <Field label="Khoa" value={s.department} />
        </div>
      </div>

      <div className="px-5 pb-5">
        <div className={cn(notice.base, notice.info)}>
          <Info className={noticeIcon.info} />
          <span>Xuất trình phiếu khám (bản in hoặc trên điện thoại) kèm CCCD khi đến khám. Thông tin cá nhân chưa đúng
            thì cập nhật ở trang Thông tin cá nhân trước ngày khám.</span>
        </div>
      </div>
    </section>
  );
}
