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

/** Ô "Thực nhận" + bảng số liệu của MỘT kỳ — dùng ở trang tổng quan và pop-up đơn. */
export function AwardDetails({ award }: { award: TuitionExemptionAward }) {
  const hasRetake = (award.retake_fee_vnd ?? 0) > 0;
  return (
    <>
      <div className="rounded-lg border border-success-line bg-success-soft px-5 py-4">
        <div className={ui.label}>Số tiền miễn giảm, hỗ trợ (thực nhận)</div>
        <div className="mt-1.5 text-2xl font-semibold text-ink">{fmtVnd(award.received_vnd)}</div>
        <div className="mt-2 text-meta text-muted">
          {award.term_label}{award.basis && <> · Căn cứ {award.basis}</>}
        </div>
      </div>
      <dl className="mt-4">
        <Row label="Đối tượng" value={award.category || '—'} />
        <Row label="Mức miễn giảm" value={fmtPercent(award.percent)} />
        <Row label="Học phí xét miễn giảm" value={fmtVnd(award.base_fee_vnd)}
             hint={hasRetake ? `Không tính ${fmtVnd(award.retake_fee_vnd)} học cải thiện, học lại` : undefined} />
        {award.decree_amount_vnd != null && award.decree_amount_vnd > 0 && (
          <Row label="Giảm theo Nghị định 238" value={fmtVnd(award.decree_amount_vnd)} />
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
