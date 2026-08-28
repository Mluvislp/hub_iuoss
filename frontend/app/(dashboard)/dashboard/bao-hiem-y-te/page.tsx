'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getInsurancePeriods } from '@/lib/insurance-periods';
import { AlertCircle, History, Loader2, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { ui, accentIcon } from '@/lib/ui';
import { cn, formatDate } from '@/lib/utils';
import { HealthValidityBadge, daysLeft, validityState } from '@/components/health-insurance';
import type { HealthInsuranceCard, HealthInsuranceData } from '@/lib/types';

/** Ngưỡng nhắc gia hạn — dưới mức này thì hiện dòng lưu ý. */
const EXPIRING_SOON_DAYS = 60;

/** Mã đợt lưu trong DB → tên hiển thị. */
const PERIOD_LABELS: Record<string, string> = {
  MAIN: 'Đợt 1',
  Q2: 'Đợt 2',
  Q3: 'Đợt 3',
  Q4: 'Đợt 4',
};

function Empty() {
  return <span className="italic font-normal text-slate-400">Chưa cập nhật</span>;
}

function DefRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className={ui.dtRow}>
      <span className={ui.dtLabel}>{label}</span>
      <span className={ui.dtValue}>{value || <Empty />}</span>
    </div>
  );
}

/**
 * Nơi đăng ký KCB: ưu tiên TÊN cơ sở, mã xuống dòng phụ.
 * Mã không có trong danh mục `hospitals` → chỉ hiện mã, không bịa tên.
 */
function HospitalValue({ card }: { card: HealthInsuranceCard }) {
  if (!card.hospital_code) return null;
  if (!card.hospital_name) {
    return <span className="font-mono text-[0.82rem]">{card.hospital_code}</span>;
  }
  return (
    <span className="block">
      <span className="block">{card.hospital_name}</span>
      <span className="block mt-0.5 font-mono text-[0.75rem] font-normal text-muted">
        {card.hospital_code}
      </span>
    </span>
  );
}

/** Khoảng hiệu lực "từ – đến"; thiếu vế nào thì nói rõ vế đó. */
function periodText(card: HealthInsuranceCard): string {
  if (!card.valid_from && !card.valid_until) return '';
  if (!card.valid_from) return `Đến ${formatDate(card.valid_until)}`;
  if (!card.valid_until) return `Từ ${formatDate(card.valid_from)}`;
  return `${formatDate(card.valid_from)} — ${formatDate(card.valid_until)}`;
}

export default function HealthInsurancePage() {
  const [data, setData] = useState<HealthInsuranceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.healthInsurance.get()
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Không thể tải dữ liệu.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted">
        <Loader2 size={26} className="animate-spin" />
      </div>
    );
  }

  const current = data?.current ?? null;
  const history = data?.history ?? [];
  const remaining = current ? daysLeft(current.valid_until) : null;
  const expiringSoon = remaining !== null && remaining <= EXPIRING_SOON_DAYS;
  const period = current ? periodText(current) : '';

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-center gap-2.5 px-4 py-3 rounded-lg bg-warning-soft border border-warning-line text-warning-text text-sm">
          <AlertCircle size={16} className="flex-shrink-0" />
          {error}
        </div>
      )}

      {/* ── Thẻ đang dùng ─────────────────────────────────── */}
      <section className={ui.card}>
        <div className={ui.cardHeader}>
          <h2 className={ui.sectionTitle}>
            <ShieldCheck size={16} className={accentIcon.success} />
            Thẻ bảo hiểm y tế
          </h2>
          {current && <HealthValidityBadge validUntil={current.valid_until} />}
        </div>

        {current ? (
          <div className="px-5 py-5">
            {/* Mã thẻ là thứ SV cần nhất khi đi khám → cho nổi lên trên cùng. */}
            <div className="rounded-lg border border-primary-line bg-[#f5f9ff] px-5 py-4">
              <div className={ui.label}>Mã thẻ BHYT</div>
              <div className="mt-1.5 font-mono text-[1.25rem] font-semibold text-ink tracking-wide break-all">
                {current.medical_insurance_code || <Empty />}
              </div>
              {period && <div className="mt-2 text-[0.82rem] text-muted">Giá trị sử dụng: {period}</div>}
            </div>

            {expiringSoon && (
              <p className="mt-3 flex items-start gap-2 text-[0.82rem] text-warning-text">
                <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                <span>
                  Thẻ còn hiệu lực {remaining} ngày. Vui lòng theo dõi thông báo gia hạn từ Phòng
                  Công tác Sinh viên.
                </span>
              </p>
            )}

            <dl className="mt-4">
              <DefRow
                label="Mã số BHXH"
                value={
                  current.social_insurance_code && (
                    <span className="font-mono text-[0.82rem]">{current.social_insurance_code}</span>
                  )
                }
              />
              <DefRow
                label="Nơi đăng ký khám chữa bệnh"
                value={<HospitalValue card={current} />}
              />
              <DefRow label="Diện đăng ký" value={current.registration_type} />
            </dl>
          </div>
        ) : (
          <div className="px-5 py-10 text-center">
            <p className="text-sm text-muted">Chưa có thông tin bảo hiểm y tế.</p>
            <p className="mt-1.5 text-[0.82rem] text-muted">
              Nếu bạn đã tham gia BHYT tại trường, vui lòng liên hệ Phòng Công tác Sinh viên để được
              cập nhật.
            </p>
          </div>
        )}
      </section>

      {/* ── Lịch sử thẻ ───────────────────────────────────── */}
      {history.length > 0 && (
        <section className={ui.card}>
          <div className={ui.cardHeader}>
            <h2 className={ui.sectionTitle}>
              <History size={16} className={accentIcon.neutral} />
              Các thẻ trước đây
            </h2>
            <span className="text-xs text-muted">{history.length} thẻ</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#f8fafc] text-[0.78rem] text-muted border-b border-line">
                  <th className="text-left font-medium px-5 py-2.5">Mã thẻ</th>
                  <th className="text-left font-medium px-3 py-2.5 hidden sm:table-cell">Nơi đăng ký KCB</th>
                  <th className="text-left font-medium px-3 py-2.5 hidden md:table-cell">Diện đăng ký</th>
                  <th className="text-left font-medium px-5 py-2.5">Giá trị sử dụng</th>
                </tr>
              </thead>
              <tbody>
                {history.map((card) => (
                  <tr
                    key={card.id}
                    className="border-b border-line2 last:border-0 hover:bg-[#f9fafb] transition-colors"
                  >
                    <td className="px-5 py-3 font-mono text-[0.82rem] text-ink whitespace-nowrap">
                      {card.medical_insurance_code || '—'}
                    </td>
                    <td className="px-3 py-3 text-slate-600 hidden sm:table-cell max-w-[220px]">
                      <span
                        className="line-clamp-2"
                        title={[card.hospital_name, card.hospital_code].filter(Boolean).join(' — ') || undefined}
                      >
                        {card.hospital_name || card.hospital_code || '—'}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-slate-600 hidden md:table-cell max-w-[220px]">
                      <span className="line-clamp-2" title={card.registration_type ?? undefined}>
                        {card.registration_type || '—'}
                      </span>
                    </td>
                    <td
                      className={cn(
                        'px-5 py-3 text-[0.82rem] whitespace-nowrap',
                        validityState(card.valid_until) === 'expired' ? 'text-slate-400' : 'text-muted',
                      )}
                    >
                      {periodText(card) || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}


      {data?.registrations && data.registrations.length > 0 && (
        <section className={ui.card}>
          <div className={ui.cardHeader}>
            <h2 className={ui.sectionTitle}>
              <History size={16} className={accentIcon.primary} />
              Lịch sử ghi danh mua thẻ/gia hạn
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr>
                  <th className="px-5 py-3 w-[20%]">Mã đợt</th>
                  <th className="px-5 py-3 w-[25%]">Ngày đăng ký</th>
                  <th className="px-5 py-3 w-[25%]">Trạng thái</th>
                  <th className="px-5 py-3">Ghi chú phản hồi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.registrations.map(reg => (
                  <tr key={reg.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3 font-medium text-[0.85rem] text-ink">
                      {PERIOD_LABELS[reg.registration_period?.toUpperCase()] ?? reg.registration_period} năm {reg.registration_year}
                    </td>
                    <td className="px-5 py-3 text-[0.82rem] text-slate-600">{new Date(reg.created_at).toLocaleString('vi-VN')}</td>
                    <td className="px-5 py-3">
                      {reg.status === 'pending' && <span className="inline-flex px-2 py-0.5 rounded text-[0.75rem] font-medium bg-slate-100 text-slate-600">Đang chờ</span>}
                      {reg.status === 'processing' && <span className="inline-flex px-2 py-0.5 rounded text-[0.75rem] font-medium bg-primary-soft text-primary-text">Đang xử lý</span>}
                      {reg.status === 'done' && <span className="inline-flex px-2 py-0.5 rounded text-[0.75rem] font-medium bg-success-soft text-success-text">Hoàn tất</span>}
                      {reg.status === 'rejected' && <span className="inline-flex px-2 py-0.5 rounded text-[0.75rem] font-medium bg-danger-soft text-danger-text">Từ chối</span>}
                    </td>
                    <td className="px-5 py-3 text-[0.82rem] text-slate-600">{reg.rejection_reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Đăng ký BHYT ───────────────────────────────────── */}
      <section className={ui.card}>
        <div className={ui.cardHeader}>
          <h2 className={ui.sectionTitle}>Đăng ký Bảo hiểm Y tế</h2>
        </div>
        <div className="p-5">
          <p className="text-[0.85rem] text-muted mb-4">
            Sinh viên có thể đăng ký mua mới hoặc gia hạn BHYT tại trường vào các đợt theo quy định.
          </p>
          <div className="grid sm:grid-cols-2 gap-4">
            {getInsurancePeriods().map((p) => {
              if (p.status === 'expired') return null;
              
              const isOpen = p.status === 'open';
              // Mã đợt trong DB viết hoa ('MAIN'/'Q2'…), ở đây viết thường — so sánh cùng dạng.
              const registered = !!data?.registrations?.some(
                (r) => r.registration_period?.toUpperCase() === p.id.toUpperCase()
                  && ['pending', 'processing', 'done'].includes(r.status),
              );
              const blocked = !data?.is_eligible || registered;
              return (
                <div key={p.id} className="p-4 rounded-lg border border-line bg-slate-50 flex flex-col justify-between">
                  <div>
                    <h3 className="font-semibold text-ink text-sm">{p.name}</h3>
                    <p className="text-[0.78rem] text-muted mt-1">
                      {isOpen ? 'Đang mở' : `Dự kiến mở từ ${formatDate(p.startDate.toISOString())}`}
                    </p>
                  </div>
                  <div className="mt-4">
                    {isOpen ? (
                      <Link
                        href={`/dashboard/bao-hiem-y-te/dang-ky?period=${p.id}`}
                        className={cn(ui.btnPrimary, "w-full text-center")}
                        onClick={(e) => { if (blocked) e.preventDefault(); }}
                        aria-disabled={blocked}
                        style={blocked ? { pointerEvents: 'none', opacity: 0.5 } : {}}
                      >
                        {!data?.is_eligible ? "Không đủ điều kiện" : registered ? "Đã đăng ký" : "Đăng ký ngay"}
                      </Link>
                    ) : (
                      <button disabled className={ui.btnOutline + " w-full bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed"}>
                        Chưa mở
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
      <p className="text-[0.78rem] text-muted">
        Thông tin BHYT do Phòng Công tác Sinh viên quản lý. Nếu phát hiện sai sót, vui lòng liên hệ
        Phòng Công tác Sinh viên để được điều chỉnh.
      </p>
    </div>
  );
}
