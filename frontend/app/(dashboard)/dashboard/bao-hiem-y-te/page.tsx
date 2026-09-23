'use client';

import { InsuranceStatus } from '@/components/insurance-status';
import { InsuranceSupplement } from '@/components/insurance-supplement';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { getVisibleInsurancePeriods } from '@/lib/insurance-periods';
import { AlertCircle, FileClock, History, Loader2, ShieldCheck, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { ui, accentIcon } from '@/lib/ui';
import { cn, formatDate } from '@/lib/utils';
import { HealthValidityBadge, daysLeft, validityState } from '@/components/health-insurance';
import type { ExternalInsuranceDeclaration, HealthInsuranceCard, HealthInsuranceData } from '@/lib/types';

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

function hideHistoricalCardDetails(card: HealthInsuranceCard): boolean {
  return !!card.registration_type_code && !['DHQT', 'KTX_DHQG', 'DHQT_DN_SV', 'NGOAI_TRUONG'].includes(card.registration_type_code);
}

function ExternalDeclarationDetail({ row }: { row: ExternalInsuranceDeclaration }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = overflow; };
  }, [open]);

  return <>
    <button
      type="button"
      className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3.5 py-2 text-sm font-semibold text-blue-700 shadow-sm transition hover:border-blue-300 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
      onClick={() => setOpen(true)}
    >
      <FileClock className="h-4 w-4" />Chi tiết
    </button>
    {open && createPortal(
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-3 backdrop-blur-sm sm:p-6" role="dialog" aria-modal="true" aria-label={`Chi tiết khai báo BHYT ngoài trường số ${row.id}`}>
        <div className="max-h-[calc(100dvh-1.5rem)] min-w-0 w-full max-w-3xl overflow-x-hidden overflow-y-auto rounded-2xl bg-slate-50 text-left shadow-2xl ring-1 ring-black/5 sm:max-h-[calc(100dvh-3rem)]">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white/95 px-4 py-4 backdrop-blur sm:px-7">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-blue-600">BHYT tại nơi khác</p>
              <h2 className="mt-0.5 text-lg font-bold text-slate-900">Khai báo #{row.id}</h2>
            </div>
            <button type="button" aria-label="Đóng" className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900" onClick={() => setOpen(false)}>
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="space-y-5 px-4 py-5 sm:px-7">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-slate-500">Trạng thái hiện tại</span>
              <InsuranceStatus status={row.status} />
            </div>
            <section className={cn(
              'rounded-xl border p-4',
              row.status === 'rejected' ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-white',
            )}>
              <h3 className="text-sm font-semibold text-slate-900">Phản hồi của nhà trường</h3>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-700">
                {row.review_note || (row.status === 'pending' ? 'Đơn đang chờ cán bộ kiểm tra.' : 'Không có ghi chú.')}
              </p>
            </section>
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <h3 className="mb-3 text-sm font-semibold text-slate-900">Thông tin thẻ tham gia ngoài nhà trường</h3>
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <DefRow label="Mã thẻ BHYT" value={row.medical_insurance_code} />
                <DefRow label="Mã số BHXH" value={row.social_insurance_code} />
                <DefRow label="Nơi đăng ký KCB" value={row.hospital_name || row.hospital_code} />
                <DefRow label="Giá trị sử dụng" value={`${formatDate(row.valid_from)} — ${formatDate(row.valid_until)}`} />
                <DefRow label="Ngày khai" value={new Date(row.created_at).toLocaleString('vi-VN')} />
                {row.reviewed_at && <DefRow label="Ngày xử lý" value={new Date(row.reviewed_at).toLocaleString('vi-VN')} />}
              </dl>
            </section>
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <h3 className="mb-3 text-sm font-semibold text-slate-900">Thông tin sinh viên đã khai</h3>
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                {row.declared.map(field => <DefRow key={field.label} label={field.label} value={field.value} />)}
              </dl>
            </section>
          </div>
        </div>
      </div>,
      document.body,
    )}
  </>;
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
  const showCoverage = current && !hideHistoricalCardDetails(current);
  const remaining = showCoverage ? daysLeft(current.valid_until) : null;
  const expiringSoon = remaining !== null && remaining <= EXPIRING_SOON_DAYS;
  const period = showCoverage ? periodText(current) : '';

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
          <div>
            <h2 className={ui.sectionTitle}>
              <ShieldCheck size={16} className={accentIcon.success} />
              Thẻ bảo hiểm y tế
            </h2>
            <p className="mt-1 text-xs font-normal text-muted">
              Sinh viên tạo yêu cầu tại mục &quot;Tạo yêu cầu mới&quot; trong trường hợp cần cập nhật thông tin
            </p>
          </div>
          {showCoverage && <HealthValidityBadge validUntil={current.valid_until} />}
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
              {showCoverage && <DefRow
                label="Nơi đăng ký khám chữa bệnh"
                value={<HospitalValue card={current} />}
              />}
              <DefRow label="Diện đăng ký" value={current.registration_type} />
              <DefRow label="Năm tham gia" value={current.registration_year} />
            </dl>
          </div>
        ) : (
          <div className="px-5 py-10 text-center">
            <p className="text-sm text-muted">Chưa có thông tin bảo hiểm y tế.</p>
            <p className="mt-1.5 text-[0.82rem] text-muted">
              Trường hợp đã tham gia BHYT tại trường, vui lòng liên hệ Phòng Công tác Sinh viên để được
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
          <div className="divide-y divide-slate-100 md:hidden">
            {history.map(card => (
              <article key={card.id} className="space-y-3 px-4 py-4">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-sm font-semibold text-ink">
                      {card.medical_insurance_code || 'Chưa có mã thẻ'}
                    </p>
                    <p className="mt-1 text-xs text-muted">{card.registration_type || 'Chưa xác định diện tham gia'}</p>
                  </div>
                  <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">
                    {card.registration_year || '—'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  <div>
                    <span className="block text-muted">Mã số BHXH</span>
                    <span className="mt-0.5 block break-all font-mono text-ink">{card.social_insurance_code || '—'}</span>
                  </div>
                  {!hideHistoricalCardDetails(card) && <div>
                    <span className="block text-muted">Giá trị sử dụng</span>
                    <span className="mt-0.5 block text-ink">{periodText(card) || '—'}</span>
                  </div>}
                </div>
                {!hideHistoricalCardDetails(card) && (card.hospital_name || card.hospital_code) && (
                  <p className="border-t border-line2 pt-2 text-xs text-slate-600">
                    <span className="text-muted">Nơi đăng ký KCB: </span>
                    {card.hospital_name || card.hospital_code}
                  </p>
                )}
              </article>
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#f8fafc] text-[0.78rem] text-muted border-b border-line">
                  <th className="text-left font-medium px-5 py-2.5">Mã thẻ</th>
                  <th className="text-left font-medium px-3 py-2.5">Mã số BHXH</th>
                  <th className="text-left font-medium px-3 py-2.5 hidden sm:table-cell">Nơi đăng ký KCB</th>
                  <th className="text-left font-medium px-3 py-2.5 hidden md:table-cell">Diện đăng ký</th>
                  <th className="text-left font-medium px-3 py-2.5">Năm</th>
                  <th className="text-left font-medium px-5 py-2.5">Giá trị sử dụng</th>
                </tr>
              </thead>
              <tbody>
                {history.map((card) => (
                  <tr
                    key={card.id}
                    className="border-b border-line2 last:border-0 hover:bg-[#f9fafb] transition-colors"
                  >
                    <td className="px-5 py-3 text-[0.82rem] text-ink">
                      {card.medical_insurance_code || '—'}
                    </td>
                    <td className="px-3 py-3 text-[0.82rem] text-ink">{card.social_insurance_code || '—'}</td>
                    <td className="px-3 py-3 text-slate-600 hidden sm:table-cell max-w-[220px]">
                      {!hideHistoricalCardDetails(card) && <span
                        className="line-clamp-2"
                        title={[card.hospital_name, card.hospital_code].filter(Boolean).join(' — ') || undefined}
                      >
                        {card.hospital_name || card.hospital_code || '—'}
                      </span>}
                    </td>
                    <td className="px-3 py-3 text-slate-600 hidden md:table-cell max-w-[220px]">
                      <span className="line-clamp-2" title={card.registration_type ?? undefined}>
                        {card.registration_type || '—'}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-slate-600">{card.registration_year || '—'}</td>
                    <td
                      className={cn(
                        'px-5 py-3 text-[0.82rem] whitespace-nowrap',
                        validityState(card.valid_until) === 'expired' ? 'text-slate-400' : 'text-muted',
                      )}
                    >
                      {hideHistoricalCardDetails(card) ? null : periodText(card) || '—'}
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
              Lịch sử đăng ký BHYT
            </h2>
          </div>
          <div className="divide-y divide-slate-100 md:hidden">
            {data.registrations.map(reg => (
              <article key={reg.id} className="space-y-3 px-4 py-4">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink">
                      {PERIOD_LABELS[reg.registration_period?.toUpperCase()] ?? reg.registration_period} năm {reg.registration_year}
                    </p>
                    <p className="mt-1 text-xs text-muted">Đăng ký lúc {new Date(reg.created_at).toLocaleString('vi-VN')}</p>
                  </div>
                  <InsuranceStatus status={reg.status} />
                </div>
                <div className="flex justify-end">
                  <InsuranceSupplement id={reg.id} onUpdated={() => { api.healthInsurance.get().then(setData).catch(e => setError(e.message)); }} />
                </div>
              </article>
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr>
                  <th className="px-5 py-3 w-[20%]">Mã đợt</th>
                  <th className="px-5 py-3 w-[25%]">Ngày đăng ký</th>
                  <th className="px-5 py-3 w-[25%]">Trạng thái</th>
                  <th className="px-5 py-3">Phản hồi</th>
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
                      <InsuranceStatus status={reg.status} />
                    </td>
                    <td className="px-5 py-3 text-[0.82rem] text-slate-600"><InsuranceSupplement id={reg.id} onUpdated={() => { api.healthInsurance.get().then(setData).catch(e => setError(e.message)); }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {data?.external_declarations && data.external_declarations.length > 0 && (
        <section className={ui.card}>
          <div className={ui.cardHeader}>
            <h2 className={ui.sectionTitle}>
              <History size={16} className={accentIcon.primary} />
              Lịch sử khai báo BHYT tại nơi khác
            </h2>
          </div>
          <div className="divide-y divide-slate-100 md:hidden">
            {data.external_declarations.map(row => (
              <article key={row.id} className="space-y-3 px-4 py-4">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-sm font-semibold text-ink">{row.medical_insurance_code}</p>
                    <p className="mt-1 text-xs text-muted">Khai lúc {new Date(row.created_at).toLocaleString('vi-VN')}</p>
                  </div>
                  <InsuranceStatus status={row.status} />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-slate-600">{formatDate(row.valid_from)} — {formatDate(row.valid_until)}</p>
                  <ExternalDeclarationDetail row={row} />
                </div>
              </article>
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left border-collapse">
              <thead><tr>
                <th className="px-5 py-3">Mã thẻ</th>
                <th className="px-5 py-3">Giá trị sử dụng</th>
                <th className="px-5 py-3">Ngày khai</th>
                <th className="px-5 py-3">Trạng thái</th>
                <th className="px-5 py-3 text-right">Thao tác</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data.external_declarations.map(row => (
                  <tr key={row.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3 text-[0.82rem] font-mono">{row.medical_insurance_code}</td>
                    <td className="px-5 py-3 text-[0.82rem] whitespace-nowrap">{formatDate(row.valid_from)} — {formatDate(row.valid_until)}</td>
                    <td className="px-5 py-3 text-[0.82rem] whitespace-nowrap">{new Date(row.created_at).toLocaleString('vi-VN')}</td>
                    <td className="px-5 py-3"><InsuranceStatus status={row.status} /></td>
                    <td className="px-5 py-3 text-right"><ExternalDeclarationDetail row={row} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Các cách tham gia BHYT ─────────────────────────── */}
      <section className={ui.card}>
        <div className={ui.cardHeader}>
          <h2 className={ui.sectionTitle}>Tham gia Bảo hiểm Y tế</h2>
        </div>
        <div className="p-5 space-y-6">
          <div className="rounded-lg border border-primary-line bg-primary-soft p-4 sm:flex sm:items-center sm:justify-between sm:gap-4">
            <div>
              <h3 className="text-sm font-semibold text-ink">Đã tham gia BHYT tại nơi khác?</h3>
              <p className="mt-1 text-[0.82rem] text-muted">Khai thông tin thẻ để nhà trường kiểm tra và xác nhận.</p>
            </div>
            <Link href="/dashboard/bao-hiem-y-te/khai-noi-khac" className={cn(ui.btnOutline, "mt-3 shrink-0 sm:mt-0")}>Khai thông tin tại nơi khác</Link>
          </div>
          <div className="border-t border-line2 pt-5">
            <h3 className="text-sm font-semibold text-ink">Đăng ký BHYT tại trường</h3>
            <p className="text-[0.85rem] text-muted mb-4">
              Sinh viên có thể đăng ký mua mới hoặc gia hạn BHYT tại trường vào các đợt theo quy định.
            </p>
            <div className="grid sm:grid-cols-2 gap-4">
              {getVisibleInsurancePeriods(data?.periods ?? []).map((p) => {
              const isOpen = p.status === 'open';
              // Mã đợt trong DB viết hoa ('MAIN'/'Q2'…), ở đây viết thường — so sánh cùng dạng.
              const registered = !!data?.registrations?.some(
                (r) => r.registration_period?.toUpperCase() === p.id.toUpperCase()
                  && r.registration_year === p.registration_year
,
              );
              const blocked = !data?.is_eligible || registered;
              return (
                <div key={`${p.id}-${p.registration_year}`} className="p-4 rounded-lg border border-line bg-slate-50 flex flex-col justify-between">
                  <div>
                    <h3 className="font-semibold text-ink text-sm">{p.name}</h3>
                    <p className="text-[0.78rem] text-muted mt-1">
                      {isOpen
                        ? 'Đang mở'
                        : p.status === 'expired'
                          ? 'Đã kết thúc'
                          : `Dự kiến mở từ ${formatDate(p.start_date)}`}
                    </p>
                    {isOpen && (
                      <p className="text-[0.78rem] font-medium text-ink mt-1">
                        Hạn cuối đăng ký: {formatDate(p.end_date)}
                      </p>
                    )}
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
                    ) : p.status === 'expired' ? (
                      <button disabled className={ui.btnOutline + " w-full bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed"}>
                        Đã kết thúc
                      </button>
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
        </div>
      </section>
      <p className="text-[0.78rem] text-muted">
        Thông tin BHYT do Phòng Công tác Sinh viên quản lý. Nếu phát hiện sai sót, vui lòng liên hệ
        Phòng Công tác Sinh viên để được điều chỉnh.
      </p>
    </div>
  );
}
