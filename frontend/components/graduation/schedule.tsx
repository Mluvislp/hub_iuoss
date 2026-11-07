import { CalendarDays, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

// Lịch Lễ tốt nghiệp 2026 — nội dung do Phòng CTSV gửi 04/11/2026. Mã buổi (SAT_AM…) khớp cột
// graduation_round_students.ceremony_session; buổi của từng người được tô nổi.
export const SCHEDULE: Array<{ key: string; day: string; part: string; items: string[] }> = [
  {
    key: 'SAT_AM', day: 'Thứ Bảy, 28/11/2026', part: 'Buổi sáng',
    items: [
      'CTLK UWE: Khoa Công nghệ Sinh học, Công nghệ Thông tin, Khoa Ngôn ngữ, Khoa Quản trị Kinh doanh',
      'CTLK Đại học Andrews, Hoa Kỳ: Quản trị Kinh doanh',
      'Sau đại học: Quản trị Kinh doanh, Kỹ thuật Y Sinh, Công nghệ Sinh học, Điện – Điện tử, Công nghệ Thông tin, Kỹ thuật và Quản lý Công nghiệp, Quản lý Công',
    ],
  },
  {
    key: 'SAT_PM', day: 'Thứ Bảy, 28/11/2026', part: 'Buổi chiều',
    items: [
      'Bộ môn Vật lý', 'Bộ môn Toán', 'Khoa Kỹ thuật và Quản lý Xây dựng', 'Khoa Kỹ thuật Hóa học và Môi trường',
      'Khoa Kỹ thuật Y Sinh', 'Khoa Ngôn ngữ', 'Khoa Kinh tế, Tài chính và Kế toán',
    ],
  },
  {
    key: 'SUN_AM', day: 'Chủ nhật, 29/11/2026', part: 'Buổi sáng',
    items: ['Khoa Quản trị Kinh doanh', 'Khoa Kỹ thuật và Quản lý Công nghiệp'],
  },
  {
    key: 'SUN_PM', day: 'Chủ nhật, 29/11/2026', part: 'Buổi chiều',
    items: ['Khoa Công nghệ Sinh học', 'Khoa Điện – Điện tử', 'Khoa Công nghệ Thông tin'],
  },
];

export const EDUSOFT_URL = 'https://edusoftweb.hcmiu.edu.vn/';

export default function Schedule({ highlight }: { highlight?: string }) {
  return (
    <section id="lich" className="scroll-mt-6">
      <div className="text-center mb-8">
        <p className="text-[0.72rem] font-semibold tracking-[0.22em] uppercase text-[#a07d1c]">Thời gian tổ chức</p>
        <h2 className="mt-2 font-display font-semibold text-4xl sm:text-5xl text-[#0f2a5c]">Lịch Lễ Tốt nghiệp 2026</h2>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 mb-4">
        <div className="rounded-lg border border-line bg-white p-4 flex gap-3 items-start">
          <CalendarDays size={18} className="text-[#a07d1c] mt-0.5 shrink-0" />
          <div>
            <div className="text-sm font-semibold text-ink">Tổng dợt</div>
            <div className="text-sm text-muted">Chiều thứ Sáu, ngày 27 tháng 11 năm 2026</div>
          </div>
        </div>
        <div className="rounded-lg border border-line bg-white p-4 flex gap-3 items-start">
          <CalendarDays size={18} className="text-[#a07d1c] mt-0.5 shrink-0" />
          <div>
            <div className="text-sm font-semibold text-ink">Lễ Tốt nghiệp</div>
            <div className="text-sm text-muted">Thứ Bảy &amp; Chủ nhật, ngày 28 &amp; 29 tháng 11 năm 2026</div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {SCHEDULE.map((s) => {
          const mine = highlight === s.key;
          return (
            <article
              key={s.key}
              className={cn(
                'rounded-lg border bg-white p-5 transition-shadow',
                mine ? 'border-[#d4a72c] ring-2 ring-[#f5e3ad] shadow-card' : 'border-line',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-[0.72rem] font-semibold uppercase tracking-wider text-[#a07d1c]">{s.part}</div>
                  <div className="font-semibold text-ink">{s.day}</div>
                </div>
                {mine && (
                  <span className="rounded-md border border-[#e9cf86] bg-[#fdf6e3] px-2 py-0.5 text-xs font-semibold text-[#7a5d0f] whitespace-nowrap">
                    Buổi lễ đã xếp
                  </span>
                )}
              </div>
              <ol className="mt-3 space-y-1.5 text-sm text-slate-700 list-decimal pl-5 marker:text-slate-400">
                {s.items.map((it) => <li key={it}>{it}</li>)}
              </ol>
            </article>
          );
        })}
      </div>

      <p className="mt-5 text-sm text-muted text-center">
        SV/HV sau đại học xem thông báo về Kế hoạch tổ chức Lễ tốt nghiệp 2026 tại{' '}
        <a href={EDUSOFT_URL} target="_blank" rel="noopener noreferrer"
           className="inline-flex items-center gap-1 font-medium text-primary-text hover:underline">
          Cổng Thông Tin Đào Tạo — Trường ĐH Quốc Tế <ExternalLink size={13} />
        </a>
      </p>
    </section>
  );
}
