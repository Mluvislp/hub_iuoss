'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  CalendarClock, ChevronRight, FilePlus2, FileUp, History, Loader2, Lock, RefreshCw, Wallet,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { badge, ui } from '@/lib/ui';
import { cn } from '@/lib/utils';
import type { TuitionExemptionApplication, TuitionExemptionState } from '@/lib/types';
import { BASE, Breadcrumb, ErrorBox, fmtDate, fmtDateTime, fmtVnd, MODE_BADGE, StatusBadge } from './shared';

/**
 * Trang tổng quan Miễn giảm học phí: đợt đang mở, đơn của đợt này, lịch sử đơn,
 * kết quả đã chốt. Nộp đơn ở `nop-ho-so/`, xem chi tiết/bổ sung ở `ho-so/[id]/`.
 */

const ACTION_ICON = { submit: FilePlus2, confirm: RefreshCw, supplement: FileUp };

/** Nút hành động theo kết quả nhận diện: chưa từng hưởng → Nộp hồ sơ; đang hưởng
 *  → Xác nhận gia hạn, hoặc Bổ sung hồ sơ nếu có diện phải nộp lại giấy ở kỳ này. */
function PlanBlock({ state }: { state: TuitionExemptionState }) {
  const plan = state.plan!;
  const Icon = ACTION_ICON[plan.action];
  return (
    <div className="space-y-3">
      {plan.renewals.length > 0 && (
        <div className="rounded-lg border border-line divide-y divide-line2">
          <div className="px-4 py-2.5 text-[0.8rem] font-medium text-muted">Diện bạn đang được hưởng</div>
          {plan.renewals.map((c) => (
            <div key={c.code} className="px-4 py-2.5 flex flex-wrap items-center gap-2">
              <div className="flex-1 min-w-[180px]">
                <div className="text-sm text-ink font-medium">{c.name}</div>
                {c.last_verified && (
                  <div className="text-[0.75rem] text-muted">Xác nhận gần nhất: {c.last_verified}</div>
                )}
              </div>
              <span className={cn(badge.base, MODE_BADGE[c.mode])}>
                {c.mode === 'confirm' ? 'Chỉ cần xác nhận' : 'Cần bổ sung giấy tờ'}
              </span>
            </div>
          ))}
        </div>
      )}
      {plan.inactive_history.length > 0 && (
        <p className="text-[0.8rem] text-muted">
          Diện không còn nhận hồ sơ ở đợt này: {plan.inactive_history.map((c) => c.name).join(', ')}.
        </p>
      )}
      <Link href={`${BASE}/nop-ho-so`} className={ui.btnPrimary}>
        <Icon size={16} /> {plan.action_label}
      </Link>
    </div>
  );
}

function RoundCard({ state }: { state: TuitionExemptionState }) {
  const r = state.round;
  const app = state.application;
  return (
    <section className={ui.card}>
      <div className={ui.cardHeader}>
        <h2 className={ui.sectionTitle}><CalendarClock size={17} className="text-primary" />Đợt nhận hồ sơ</h2>
      </div>
      <div className="px-5 py-4 space-y-3 text-sm">
        {!r ? (
          <div className="flex items-start gap-2.5 text-muted">
            <Lock size={16} className="flex-shrink-0 mt-0.5" />
            Hiện chưa có đợt nhận hồ sơ miễn giảm học phí nào đang mở. Theo dõi thông báo
            của Phòng Công tác Sinh viên để biết thời gian nộp.
          </div>
        ) : (
          <>
            <div>
              <div className="font-semibold text-ink">{r.title}</div>
              <div className="text-muted text-[0.82rem] mt-0.5">
                {r.term_label} · Nhận hồ sơ từ {fmtDateTime(r.opens_at)} đến {fmtDateTime(r.closes_at)}
              </div>
            </div>
            {r.description && <p className="text-ink leading-relaxed whitespace-pre-line">{r.description}</p>}
            {app ? (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm text-ink">
                  Bạn đã gửi đơn {app.submission_kind_label.toLowerCase()} cho đợt này.
                </span>
                <StatusBadge status={app.status} label={app.status_label} />
                <Link href={`${BASE}/ho-so/${app.id}`} className={ui.btnSecondary}>
                  Xem đơn <ChevronRight size={15} />
                </Link>
              </div>
            ) : state.plan ? (
              <PlanBlock state={state} />
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

function ApplicationRow({ app }: { app: TuitionExemptionApplication }) {
  return (
    <Link href={`${BASE}/ho-so/${app.id}`}
          className="flex items-center gap-3 px-5 py-3 hover:bg-surface-subtle transition-colors">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-ink truncate">{app.round_title}</div>
        <div className="text-[0.78rem] text-muted mt-0.5 truncate">
          {app.submission_kind_label} · {app.categories.map((c) => c.name).join(', ')} · {fmtDateTime(app.submitted_at)}
        </div>
      </div>
      <StatusBadge status={app.status} label={app.status_label} />
      <ChevronRight size={15} className="text-faint" />
    </Link>
  );
}

export default function TuitionWaiverPage() {
  const [state, setState] = useState<TuitionExemptionState | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.tuitionExemption.state()
      .then(setState)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Không tải được dữ liệu.'));
  }, []);

  return (
    <div className="space-y-5">
      <Breadcrumb trail={[{ label: 'Miễn giảm học phí' }]} />
      {error && <ErrorBox text={error} />}
      {!state && !error && (
        <div className="flex items-center justify-center h-48 text-muted">
          <Loader2 size={24} className="animate-spin" />
        </div>
      )}
      {state && (
        <>
          <RoundCard state={state} />

          <section className={ui.card}>
            <div className={ui.cardHeader}>
              <h2 className={ui.sectionTitle}><History size={17} className="text-primary" />Đơn đã nộp</h2>
            </div>
            {state.history.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted">Bạn chưa nộp đơn miễn giảm học phí nào.</p>
            ) : (
              <div className="divide-y divide-line2">
                {state.history.map((a) => <ApplicationRow key={a.id} app={a} />)}
              </div>
            )}
          </section>

          <section className={ui.card}>
            <div className={ui.cardHeader}>
              <h2 className={ui.sectionTitle}><Wallet size={17} className="text-primary" />Kết quả miễn giảm</h2>
            </div>
            {state.results.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted">Chưa có kết quả miễn giảm nào được chốt.</p>
            ) : (
              <>
              {/* Điện thoại: 5 cột tiền không vừa màn hình → mỗi học kỳ một thẻ,
                  số tiền được miễn giảm (thứ SV tìm) đứng đầu bên phải. */}
              <ul className="divide-y divide-line2 md:hidden">
                {state.results.map((r) => (
                  <li key={r.term_code} className="px-4 py-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink">{r.term_code}</p>
                        <p className="mt-0.5 text-[0.82rem] text-ink">{r.category || '—'}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-[0.72rem] text-muted">Được miễn giảm</p>
                        <p className="text-sm font-semibold tabular-nums text-success-text">
                          {fmtVnd(r.exemption_amount_vnd)}
                        </p>
                      </div>
                    </div>
                    <p className="mt-1.5 text-[0.78rem] text-muted tabular-nums">
                      Mức {Number(r.percent)}% · Học phí {fmtVnd(r.fee_amount_vnd)}
                    </p>
                  </li>
                ))}
              </ul>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead className="text-[0.78rem] text-muted">
                    <tr className="border-b border-line2">
                      <th className="text-left font-medium px-5 py-2">Học kỳ</th>
                      <th className="text-left font-medium px-3 py-2">Đối tượng áp dụng</th>
                      <th className="text-right font-medium px-3 py-2">Mức</th>
                      <th className="text-right font-medium px-3 py-2">Học phí</th>
                      <th className="text-right font-medium px-5 py-2">Được miễn giảm</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.results.map((r) => (
                      <tr key={r.term_code} className="border-b border-line2 last:border-0">
                        <td className="px-5 py-2.5 text-ink">{r.term_code}</td>
                        <td className="px-3 py-2.5 text-ink">{r.category || '—'}</td>
                        <td className="px-3 py-2.5 text-right text-ink">{Number(r.percent)}%</td>
                        <td className="px-3 py-2.5 text-right text-muted">{fmtVnd(r.fee_amount_vnd)}</td>
                        <td className={cn('px-5 py-2.5 text-right font-semibold text-success-text')}>
                          {fmtVnd(r.exemption_amount_vnd)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              </>
            )}
            {/* TODO(mghp): ghi chú thời điểm hoàn tiền về tài khoản khi quy trình chi trả được chốt. */}
          </section>

          {state.application?.supplement_deadline && (
            <p className="text-[0.82rem] text-muted">
              Hạn bổ sung hồ sơ: {fmtDate(state.application.supplement_deadline)}
            </p>
          )}
        </>
      )}
    </div>
  );
}
