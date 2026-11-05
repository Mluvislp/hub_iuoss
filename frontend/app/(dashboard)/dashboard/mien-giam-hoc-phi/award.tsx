'use client';

import { useState } from 'react';
import { BadgeCheck } from 'lucide-react';
import { accentIcon, badge, ui } from '@/lib/ui';
import { cn } from '@/lib/utils';
import type { TuitionExemptionAward } from '@/lib/types';

/**
 * Kết quả miễn giảm học phí theo kỳ — số liệu Phòng CTSV nạp từ danh sách kèm quyết định
 * (Dashboard → Kết quả miễn giảm). Cùng dáng thẻ "Thẻ bảo hiểm y tế": ô nổi bật + bảng định nghĩa.
 */

export const fmtVnd = (n: number | null | undefined) =>
  n == null ? '—' : `${n.toLocaleString('vi-VN')} đ`;

const fmtPercent = (p: number | null) => (p == null ? '—' : `${Number.isInteger(p) ? p : p.toFixed(2)}%`);

function Row({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className={ui.dtRow}>
      <dt className={ui.dtLabel}>
        {label}
        {hint && <span className="block text-xs text-faint">{hint}</span>}
      </dt>
      <dd className={ui.dtValue}>{value}</dd>
    </div>
  );
}

/** Số tiền được giảm kèm mức % bên phải — dùng ở thẻ kết quả, thẻ đơn và bảng lịch sử. */
export function AmountWithPercent({ award, className }: { award: TuitionExemptionAward; className?: string }) {
  return (
    <span className={cn('inline-flex flex-wrap items-baseline gap-x-2', className)}>
      <span>{fmtVnd(award.received_vnd)}</span>
      {award.percent != null && (
        <span className={cn(badge.base, badge.success, 'text-xs')}>{fmtPercent(award.percent)}</span>
      )}
    </span>
  );
}

/** Kết quả của MỘT kỳ: diện, học phí kỳ này, được giảm (kèm %), còn phải đóng. */
export function AwardDetails({ award }: { award: TuitionExemptionAward }) {
  const hasRetake = (award.retake_fee_vnd ?? 0) > 0;
  const fee = award.base_fee_vnd ?? award.first_fee_vnd;
  return (
    <>
      <div className="rounded-lg border border-success-line bg-success-soft px-5 py-4">
        <div className={ui.label}>Diện miễn giảm</div>
        <div className="mt-1 text-section font-semibold text-ink">{award.category || '—'}</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <div className={ui.label}>Học phí kỳ này</div>
            <div className="mt-1 text-lg font-semibold text-ink">{fmtVnd(fee)}</div>
          </div>
          <div>
            <div className={ui.label}>Được giảm</div>
            <AmountWithPercent award={award} className="mt-1 text-lg font-semibold text-success-text" />
          </div>
          <div>
            <div className={ui.label}>Còn phải đóng</div>
            <div className="mt-1 text-lg font-semibold text-ink">{fmtVnd(award.payable_vnd)}</div>
          </div>
        </div>
        <div className="mt-3 text-meta text-muted">
          {award.term_label}{award.basis && <> · Căn cứ {award.basis}</>}
        </div>
        {award.capped_by_ceiling && (
          <p className="mt-2 text-meta text-ink-2">
            Số tiền được giảm tối đa bằng mức Nhà nước hỗ trợ ({fmtVnd(award.ceiling_vnd)} = 5 tháng × mức trần học phí
            × {fmtPercent(award.percent)}); phần còn lại sinh viên tự đóng.
          </p>
        )}
      </div>
      <dl className="mt-4">
        <Row label="Mức miễn giảm của diện" value={fmtPercent(award.percent)} />
        <Row label="Học phí xét miễn giảm" value={fmtVnd(fee)}
             hint={hasRetake ? `Không tính ${fmtVnd(award.retake_fee_vnd)} học cải thiện, học lại` : 'Học phí lần học đầu, không gồm học lại / học cải thiện'} />
        {award.decree_amount_vnd != null && award.decree_amount_vnd > 0 && (
          <Row label="Nhà nước chi trả (NĐ 238)" value={fmtVnd(award.decree_amount_vnd)} />
        )}
        {award.school_support_vnd != null && award.school_support_vnd > 0 && (
          <Row label="Trường hỗ trợ" value={fmtVnd(award.school_support_vnd)} />
        )}
        {award.payment_label && (
          <Row label="Tình trạng học phí"
               value={<span className={cn(badge.base, award.payment_status === 'paid' ? badge.success : badge.warning)}>{award.payment_label}</span>} />
        )}
        {award.bank_account && (
          <Row label="Tài khoản nhận" value={[award.bank_account, award.bank_name].filter(Boolean).join(' · ')} />
        )}
        {award.note && <Row label="Ghi chú" value={award.note} />}
      </dl>
    </>
  );
}

/** Thẻ "Kết quả miễn giảm học phí" — nhiều kỳ thì chọn kỳ bằng nút phía trên. */
export function AwardCard({ awards }: { awards: TuitionExemptionAward[] }) {
  const [termCode, setTermCode] = useState(awards[0]?.term_code);
  const award = awards.find((a) => a.term_code === termCode) ?? awards[0];
  if (!award) return null;
  return (
    <section className={ui.card}>
      <div className={ui.cardHeader}>
        <div>
          <h2 className={ui.sectionTitle}>
            <BadgeCheck size={16} className={accentIcon.success} />
            Kết quả miễn giảm học phí
          </h2>
          <p className="mt-1 text-xs font-normal text-muted">
            Theo danh sách kèm quyết định miễn giảm, hỗ trợ học phí của Trường
          </p>
        </div>
      </div>
      <div className="px-5 py-5">
        {awards.length > 1 && (
          <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Chọn học kỳ">
            {awards.map((a) => (
              <button key={a.term_code} type="button" role="tab" aria-selected={a.term_code === award.term_code}
                      onClick={() => setTermCode(a.term_code)}
                      className={cn(badge.base, 'px-2.5 py-1 transition-colors',
                                    a.term_code === award.term_code ? badge.info : cn(badge.neutral, 'hover:bg-surface-muted'))}>
                {a.term_label}
              </button>
            ))}
          </div>
        )}
        <AwardDetails award={award} />
        <p className="mt-4 text-meta text-muted">
          Thắc mắc về số tiền, vui lòng liên hệ Phòng Công tác Sinh viên (đối tượng, mức miễn giảm) hoặc Phòng Kế
          hoạch – Tài chính (chi trả).
        </p>
      </div>
    </section>
  );
}
