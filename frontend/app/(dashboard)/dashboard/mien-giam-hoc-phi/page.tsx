'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FileCheck2, FileClock, FilePlus2, FileUp, History, Loader2, RefreshCw } from 'lucide-react';
import { RejectionNotice } from '@/components/rejection-notice';
import { api, ApiError } from '@/lib/api';
import { accentIcon, badge, ui } from '@/lib/ui';
import { cn } from '@/lib/utils';
import type { TuitionExemptionApplication, TuitionExemptionState } from '@/lib/types';
import { TuitionApplicationModal } from './application-detail';
import { BASE, ErrorBox, fmtDateTime, MODE_BADGE, StatusBadge } from './shared';

/**
 * Trang tổng quan Miễn giảm học phí — cùng khuôn trang BHYT: thẻ đơn của đợt hiện
 * tại, bảng lịch sử đơn (nút "Chi tiết" mở pop-up), khối nộp hồ sơ theo đợt.
 * Nộp đơn ở `nop-ho-so/`. `?don=<id>` mở sẵn pop-up đơn đó (link cũ `ho-so/<id>`).
 */

const ACTION_ICON = { submit: FilePlus2, confirm: RefreshCw, supplement: FileUp };

/** Tiêu đề cột dùng chung cho bảng — như trang BHYT. */
const TH = 'px-5 py-2.5 text-left text-xs font-medium text-muted';
const THEAD_ROW = 'border-b border-line bg-surface-subtle';

const categoryNames = (app: TuitionExemptionApplication) => app.categories.map((c) => c.name).join(', ');

function DetailButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className={ui.btnSecondary} onClick={onClick}>
      <FileClock className="h-4 w-4" />Chi tiết
    </button>
  );
}

function DefRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className={ui.dtRow}>
      <span className={ui.dtLabel}>{label}</span>
      <span className={ui.dtValue}>{value || <span className="italic font-normal text-muted">Chưa cập nhật</span>}</span>
    </div>
  );
}

/** Thẻ đầu trang: đơn của đợt đang mở (giống thẻ "Thẻ bảo hiểm y tế"). */
function CurrentCard({ state, onOpen }: { state: TuitionExemptionState; onOpen: (id: number) => void }) {
  const r = state.round;
  const app = state.application;
  return (
    <section className={ui.card}>
      <div className={ui.cardHeader}>
        <div>
          <h2 className={ui.sectionTitle}>
            <FileCheck2 size={16} className={accentIcon.success} />
            Đơn miễn giảm học phí
          </h2>
          <p className="mt-1 text-xs font-normal text-muted">
            Trạng thái đơn bạn đã nộp trong đợt đang nhận hồ sơ
          </p>
        </div>
        {app && <StatusBadge status={app.status} label={app.status_label} />}
      </div>

      {app ? (
        <div className="px-5 py-5">
          <div className="rounded-lg border border-primary-line bg-primary-wash px-5 py-4">
            <div className={ui.label}>Đợt nhận hồ sơ</div>
            <div className="mt-1.5 text-lg font-semibold text-ink">{app.round_title}</div>
            <div className="mt-2 text-meta text-muted">
              Đơn {app.submission_kind_label.toLowerCase()} · Nộp lúc {fmtDateTime(app.submitted_at)}
            </div>
          </div>

          {app.can_supplement && (
            <RejectionNotice className="mt-4" eyebrow="Đơn bị từ chối" title={app.rejection_reason || 'Đơn bị từ chối'}
                             note={app.review_note}>
              <div className="flex flex-col gap-2 rounded-lg bg-primary-soft p-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-primary-text">
                  Bổ sung giấy tờ trước {fmtDateTime(app.supplement_closes_at)} (giờ đóng đợt) để đơn được xử lý lại.
                </p>
                <button type="button" className={cn(ui.btnPrimary, 'w-full shrink-0 sm:w-auto')} onClick={() => onOpen(app.id)}>
                  <FileUp size={16} /> Bổ sung giấy tờ
                </button>
              </div>
            </RejectionNotice>
          )}

          <dl className="mt-4">
            <DefRow label="Đối tượng" value={categoryNames(app)} />
            {r && <DefRow label="Học kỳ" value={r.term_label} />}
            {r && <DefRow label="Hạn nộp hồ sơ" value={fmtDateTime(r.closes_at)} />}
          </dl>

          <div className="mt-4 flex justify-end">
            <DetailButton onClick={() => onOpen(app.id)} />
          </div>
        </div>
      ) : (
        <div className="px-5 py-10 text-center">
          <p className="text-sm text-muted">
            {r ? 'Bạn chưa nộp đơn cho đợt này.' : 'Hiện chưa có đợt nhận hồ sơ nào đang mở.'}
          </p>
          <p className="mt-1.5 text-meta text-muted">
            {r
              ? 'Xem đợt đang mở và nộp hồ sơ ở mục bên dưới.'
              : 'Theo dõi thông báo của Phòng Công tác Sinh viên để biết thời gian nộp.'}
          </p>
        </div>
      )}
    </section>
  );
}

/** Lịch sử đơn: thẻ trên điện thoại, bảng trên màn hình rộng — như "Lịch sử đăng ký BHYT". */
function HistoryCard({ history, onOpen }: { history: TuitionExemptionApplication[]; onOpen: (id: number) => void }) {
  return (
    <section className={ui.card}>
      <div className={ui.cardHeader}>
        <h2 className={ui.sectionTitle}>
          <History size={16} className={accentIcon.primary} />
          Lịch sử nộp đơn
        </h2>
        <span className="text-xs text-muted">{history.length} đơn</span>
      </div>
      <div className="divide-y divide-line2 md:hidden">
        {history.map((app) => (
          <article key={app.id} className="space-y-3 px-4 py-4">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-ink">{app.round_title}</p>
                <p className="mt-1 text-xs text-muted">Nộp lúc {fmtDateTime(app.submitted_at)}</p>
              </div>
              <StatusBadge status={app.status} label={app.status_label} />
            </div>
            {app.categories.length > 0 && (
              <p className="text-xs text-ink-3"><span className="text-muted">Đối tượng: </span>{categoryNames(app)}</p>
            )}
            <div className="flex [&>button]:w-full">
              <DetailButton onClick={() => onOpen(app.id)} />
            </div>
          </article>
        ))}
      </div>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className={THEAD_ROW}>
              <th className={cn(TH, 'w-[26%]')}>Đợt</th>
              <th className={cn(TH, 'px-3')}>Đối tượng</th>
              <th className={cn(TH, 'px-3')}>Ngày nộp</th>
              <th className={cn(TH, 'px-3')}>Trạng thái</th>
              <th className={cn(TH, 'text-right')}>Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line2">
            {history.map((app) => (
              <tr key={app.id} className="hover:bg-surface-subtle transition-colors">
                <td className="px-5 py-3 text-sm font-medium text-ink">
                  {app.round_title}
                  <span className="mt-0.5 block text-xs font-normal text-muted">{app.submission_kind_label}</span>
                </td>
                <td className="max-w-[240px] px-3 py-3 text-ink-3">
                  <span className="line-clamp-2" title={categoryNames(app) || undefined}>{categoryNames(app) || '—'}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-meta text-ink-3">{fmtDateTime(app.submitted_at)}</td>
                <td className="px-3 py-3"><StatusBadge status={app.status} label={app.status_label} /></td>
                <td className="px-5 py-3 text-right"><DetailButton onClick={() => onOpen(app.id)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Khối nộp hồ sơ: diện đang hưởng + ô đợt đang mở — như "Tham gia Bảo hiểm Y tế". */
function ApplyCard({ state }: { state: TuitionExemptionState }) {
  const r = state.round;
  const plan = state.plan;
  const app = state.application;
  const Icon = plan ? ACTION_ICON[plan.action] : FilePlus2;
  return (
    <section className={ui.card}>
      <div className={ui.cardHeader}>
        <h2 className={ui.sectionTitle}>Nộp hồ sơ miễn giảm học phí</h2>
      </div>
      <div className="p-5 space-y-6">
        {plan && plan.renewals.length > 0 && (
          <div className="rounded-lg border border-primary-line bg-primary-soft p-4">
            <h3 className="text-sm font-semibold text-ink">Diện bạn đang được hưởng</h3>
            <ul className="mt-2 divide-y divide-primary-line/60">
              {plan.renewals.map((c) => (
                <li key={c.code} className="flex flex-wrap items-center gap-2 py-2.5">
                  <div className="min-w-[180px] flex-1">
                    <div className="text-sm font-medium text-ink">{c.name}</div>
                    {c.last_verified && <div className="text-xs text-muted">Xác nhận gần nhất: {c.last_verified}</div>}
                  </div>
                  <span className={cn(badge.base, MODE_BADGE[c.mode])}>
                    {c.mode === 'confirm' ? 'Chỉ cần xác nhận' : 'Cần bổ sung giấy tờ'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className={cn(plan && plan.renewals.length > 0 && 'border-t border-line2 pt-5')}>
          <h3 className="text-sm font-semibold text-ink">Đợt nhận hồ sơ</h3>
          <p className="mb-4 text-sm text-muted">
            Phòng Công tác Sinh viên nhận hồ sơ miễn giảm học phí theo từng đợt trong học kỳ.
          </p>
          {r ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col justify-between rounded-lg border border-line bg-surface-subtle p-4">
                <div>
                  <h3 className="text-sm font-semibold text-ink">{r.title}</h3>
                  <p className="mt-1 text-xs text-muted">{r.term_label} · Đang mở</p>
                  <p className="mt-1 text-xs font-medium text-ink">Hạn cuối nộp: {fmtDateTime(r.closes_at)}</p>
                </div>
                <div className="mt-4">
                  {app ? (
                    <button disabled className={cn(ui.btnOutline, 'w-full cursor-not-allowed border-line bg-surface-muted text-faint')}>
                      Đã nộp đơn đợt này
                    </button>
                  ) : plan ? (
                    <Link href={`${BASE}/nop-ho-so`} className={cn(ui.btnPrimary, 'w-full text-center')}>
                      <Icon size={16} /> {plan.action_label}
                    </Link>
                  ) : (
                    <button disabled className={cn(ui.btnOutline, 'w-full cursor-not-allowed border-line bg-surface-muted text-faint')}>
                      Chưa mở
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <p className="rounded-lg border border-line bg-surface-subtle px-4 py-3 text-sm text-muted">
              Hiện chưa có đợt nhận hồ sơ nào đang mở.
            </p>
          )}
          {plan && plan.inactive_history.length > 0 && (
            <p className="mt-3 text-meta text-muted">
              Diện không còn nhận hồ sơ ở đợt này: {plan.inactive_history.map((c) => c.name).join(', ')}.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

export default function TuitionWaiverPage() {
  const router = useRouter();
  const [state, setState] = useState<TuitionExemptionState | null>(null);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);

  const load = useCallback(() => {
    api.tuitionExemption.state()
      .then(setState)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Không tải được dữ liệu.'));
  }, []);

  useEffect(() => {
    load();
    // Đọc thẳng location thay vì useSearchParams: trang client không cần Suspense.
    const id = Number(new URLSearchParams(window.location.search).get('don'));
    if (id) setOpenId(id);
  }, [load]);

  function closeModal() {
    setOpenId(null);
    if (window.location.search) router.replace(BASE, { scroll: false });
  }

  if (!state && !error) {
    return (
      <div className="flex items-center justify-center h-64 text-muted">
        <Loader2 size={26} className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && <ErrorBox text={error} />}

      {state && (
        <>
          <CurrentCard state={state} onOpen={setOpenId} />
          {state.history.length > 0 && <HistoryCard history={state.history} onOpen={setOpenId} />}
          <ApplyCard state={state} />
        </>
      )}

      {openId && <TuitionApplicationModal id={openId} onClose={closeModal} onUpdated={load} />}

      <p className="text-xs text-muted">
        Hồ sơ miễn giảm học phí do Phòng Công tác Sinh viên tiếp nhận và xét duyệt. Nếu thông tin có sai sót, vui
        lòng liên hệ Phòng Công tác Sinh viên để được hỗ trợ.
      </p>
    </div>
  );
}
