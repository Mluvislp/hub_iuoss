'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, BadgeCheck, FileText, FileUp, History, ListChecks, Loader2, Send, UserRound, X } from 'lucide-react';
import { InsuranceModal } from '@/components/insurance-modal';
import { RejectionNotice } from '@/components/rejection-notice';
import { api, ApiError, newRequestKey } from '@/lib/api';
import { accentIcon, badge, ui } from '@/lib/ui';
import { cn } from '@/lib/utils';
import type { TuitionExemptionApplication, TuitionExemptionAward } from '@/lib/types';
import { AwardDetails } from './award';
import { ErrorBox, fmtDate, fmtDateTime, MODE_BADGE, REVIEW_BADGE, REVIEW_LABEL, StatusBadge } from './shared';

/**
 * Pop-up chi tiết một đơn Miễn giảm học phí — cùng khuôn "Chi tiết" đơn BHYT
 * (InsuranceModal + RejectionNotice + các thẻ thông tin). Đơn bị Từ chối vì thiếu /
 * sai / hết hạn giấy mà đợt còn mở → bổ sung ngay trong pop-up, đơn về "Đang xử lý".
 */

const SNAPSHOT_ROWS: [string, string][] = [
  ['citizen_id', 'Số CCCD'], ['citizen_id_issued_on', 'Ngày cấp CCCD'], ['phone_number', 'Số điện thoại'],
  ['permanent_address', 'Địa chỉ thường trú'], ['bank_account_number', 'Số tài khoản'],
  ['bank_account_holder', 'Chủ tài khoản'], ['bank_name', 'Ngân hàng'],
  ['father_full_name', 'Họ tên cha'], ['father_phone', 'SĐT cha'], ['mother_full_name', 'Họ tên mẹ'],
  ['mother_phone', 'SĐT mẹ'], ['guardian_full_name', 'Người giám hộ'], ['guardian_phone', 'SĐT người giám hộ'],
  ['guardian_relationship', 'Quan hệ'],
];

const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp,image/heic,.heic';

function SupplementForm({ app, saving, setSaving, onDone, onCancel }: {
  app: TuitionExemptionApplication;
  saving: boolean;
  setSaving: (v: boolean) => void;
  onDone: (a: TuitionExemptionApplication) => void;
  onCancel: () => void;
}) {
  const [files, setFiles] = useState<Record<string, File[]>>({});
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [requestKey] = useState(newRequestKey);

  async function send() {
    setError('');
    setErrors({});
    const body = new FormData();
    body.set('request_key', requestKey);
    body.set('row_version', String(app.row_version));
    Object.entries(files).forEach(([key, fs]) => fs.forEach((f) => body.append(key, f)));
    if (![...body.keys()].some((k) => k.startsWith('doc_'))) { setError('Chọn ít nhất một file để bổ sung.'); return; }
    setSaving(true);
    try {
      onDone(await api.tuitionExemption.supplement(app.id, body));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không gửi được hồ sơ bổ sung.');
      if (e instanceof ApiError && e.data.errors) setErrors(e.data.errors as Record<string, string[]>);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 rounded-lg border border-line bg-white p-4">
      {(app.supplement_targets ?? []).map((c) => (
        <div key={c.code} className="space-y-2">
          <div className="text-sm font-semibold text-ink">{c.name}</div>
          {c.review_note && <p className="text-meta text-warning-text">{c.review_note}</p>}
          {c.documents.map((d) => {
            const key = `doc_${c.code}__${d.doc_type}`;
            const list = files[key] ?? [];
            return (
              <div key={key} className="rounded-lg border border-line2 bg-surface-subtle px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-[160px] flex-1 text-meta text-ink">
                    {d.label}
                    {d.invalid_note && <span className="block text-xs text-warning-text">Lý do không hợp lệ: {d.invalid_note}</span>}
                  </span>
                  <label className={cn(ui.btnOutline, 'h-9 cursor-pointer coarse:h-11')}>
                    <FileUp size={15} /> {list.length ? `${list.length} file` : 'Chọn file'}
                    <input type="file" multiple accept={ACCEPT} className="hidden"
                           onChange={(e) => { const fs = Array.from(e.target.files ?? []); setFiles((cur) => ({ ...cur, [key]: fs })); e.target.value = ''; }} />
                  </label>
                </div>
                {list.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5">
                    {list.map((f, i) => (
                      <li key={`${f.name}-${i}`} className="flex items-center gap-1.5 text-xs text-muted">
                        <span className="truncate">{f.name}</span>
                        <button type="button" aria-label="Bỏ file" className="touch-target text-muted hover:text-danger-text"
                                onClick={() => setFiles((cur) => ({ ...cur, [key]: list.filter((_, j) => j !== i) }))}>
                          <X size={13} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {errors[key] && <p className="mt-1 text-xs text-danger-text">{errors[key][0]}</p>}
              </div>
            );
          })}
        </div>
      ))}
      <p className="text-xs text-muted">
        File mới sẽ thay file cùng loại đã nộp trước đó. Gửi xong, đơn quay về “Đang xử lý”.
        {app.status === 'awaiting_supplement' && ' Cần nộp lại đủ các giấy trên.'}
      </p>
      {error && <ErrorBox text={error} />}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button type="button" className={cn(ui.btnGhost, 'w-full sm:w-auto')} disabled={saving} onClick={onCancel}>Hủy</button>
        <button type="button" className={cn(ui.btnPrimary, 'w-full sm:w-auto')} onClick={send} disabled={saving}>
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Gửi bổ sung
        </button>
      </div>
    </div>
  );
}

function ApplicationBody({ app, award, saving, setSaving, onUpdated, onError }: {
  app: TuitionExemptionApplication;
  award?: TuitionExemptionAward;
  saving: boolean;
  setSaving: (v: boolean) => void;
  onUpdated: (a: TuitionExemptionApplication) => void;
  onError: (msg: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const rejected = app.status === 'rejected';
  const awaiting = app.status === 'awaiting_supplement';
  const snapshotRows = app.snapshot ? SNAPSHOT_ROWS.filter(([k]) => app.snapshot![k]) : [];

  async function openDocument(documentId: number) {
    try {
      const blob = await api.tuitionExemption.document(app.id, documentId);
      window.open(URL.createObjectURL(blob), '_blank');
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Không tải được giấy tờ.');
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">Trạng thái hiện tại</span>
        <StatusBadge status={app.status} label={app.status_label} />
      </div>

      {app.supplement_pending && (
        <p className="rounded-lg border border-primary-line bg-primary-soft px-4 py-3 text-sm text-primary-text">
          Đã gửi bổ sung — Phòng Công tác Sinh viên đang kiểm tra.
        </p>
      )}

      {awaiting ? (
        <RejectionNotice eyebrow="Chờ sinh viên bổ sung" title="Giấy tờ chưa hợp lệ — vui lòng nộp lại">
          <ul className="space-y-2">
            {app.invalid_documents.map((d, i) => (
              <li key={i} className="rounded-lg border border-line2 bg-surface-subtle px-3 py-2.5">
                <div className="text-sm font-medium text-ink">{d.label}</div>
                <div className="text-xs text-muted">File đã nộp: {d.original_filename}</div>
                {d.note && <div className="mt-1 text-meta text-warning-text">Lý do: {d.note}</div>}
              </li>
            ))}
          </ul>
          {editing ? (
            <SupplementForm key={app.row_version} app={app} saving={saving} setSaving={setSaving}
                            onDone={(a) => { setEditing(false); onUpdated(a); }} onCancel={() => setEditing(false)} />
          ) : (
            <div className="flex flex-col gap-2 rounded-lg bg-primary-soft p-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-primary-text">Nộp lại các giấy trên để Phòng Công tác Sinh viên xử lý tiếp đơn.</p>
              <button type="button" className={cn(ui.btnPrimary, 'w-full shrink-0 sm:w-auto')} onClick={() => setEditing(true)}>
                <FileUp size={16} /> Nộp lại giấy tờ
              </button>
            </div>
          )}
        </RejectionNotice>
      ) : rejected ? (
        <RejectionNotice eyebrow="Đơn bị từ chối" title={app.rejection_reason || 'Đơn bị từ chối'} note={app.review_note}>
          {app.supplement_overdue ? (
            <p className="text-sm text-danger-text">
              Đợt đã đóng nên không bổ sung được nữa. Vui lòng liên hệ Phòng Công tác Sinh viên.
            </p>
          ) : app.can_supplement && (editing ? (
            <SupplementForm key={app.row_version} app={app} saving={saving} setSaving={setSaving}
                            onDone={(a) => { setEditing(false); onUpdated(a); }} onCancel={() => setEditing(false)} />
          ) : (
            <div className="flex flex-col gap-2 rounded-lg bg-primary-soft p-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-primary-text">
                Bổ sung giấy tờ trước {fmtDateTime(app.supplement_closes_at)} (giờ đóng đợt) để đơn được xử lý lại.
              </p>
              <button type="button" className={cn(ui.btnPrimary, 'w-full shrink-0 sm:w-auto')} onClick={() => setEditing(true)}>
                <FileUp size={16} /> Bổ sung giấy tờ
              </button>
            </div>
          ))}
        </RejectionNotice>
      ) : (
        <RejectionNotice rejected={false} note={app.review_note} />
      )}

      {award && (
        <section className={cn(ui.card, 'overflow-hidden')}>
          <div className={ui.cardHeader}>
            <h3 className={ui.sectionTitle}><BadgeCheck size={16} className={accentIcon.success} />Kết quả miễn giảm</h3>
          </div>
          <div className="px-5 py-4"><AwardDetails award={award} /></div>
        </section>
      )}

      <section className={cn(ui.card, 'overflow-hidden')}>
        <div className={ui.cardHeader}>
          <div>
            <h3 className={ui.sectionTitle}><ListChecks size={16} className={accentIcon.primary} />Đối tượng đã chọn</h3>
            <p className="mt-1 text-xs text-muted">{app.round_title} · Nộp lúc {fmtDateTime(app.submitted_at)}</p>
          </div>
          <span className={cn(badge.base, badge.neutral)}>{app.submission_kind_label}</span>
        </div>
        <div className="divide-y divide-line2">
          {app.categories.map((c) => (
            <div key={c.code} className="flex items-start gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-ink">{c.name}</span>
                  {c.mode && c.mode !== 'new' && (
                    <span className={cn(badge.base, MODE_BADGE[c.mode])}>{c.mode_label}</span>
                  )}
                </div>
                {c.review_note && <p className="mt-0.5 text-meta text-muted">{c.review_note}</p>}
              </div>
              <span className={cn(badge.base, 'shrink-0', REVIEW_BADGE[c.review_status] ?? badge.neutral)}>
                {REVIEW_LABEL[c.review_status] ?? c.review_status}
              </span>
            </div>
          ))}
        </div>
      </section>

      {(snapshotRows.length > 0 || (app.category_details ?? []).length > 0) && (
        <section className={cn(ui.card, 'overflow-hidden')}>
          <div className={ui.cardHeader}>
            <h3 className={ui.sectionTitle}><UserRound size={16} className={accentIcon.primary} />Thông tin đã khai</h3>
          </div>
          <dl className="grid gap-x-8 px-5 py-2 sm:grid-cols-2">
            {snapshotRows.map(([k, label]) => (
              <div key={k} className={ui.dtRow}>
                <dt className={ui.dtLabel}>{label}</dt>
                <dd className={cn(ui.dtValue, 'break-words')}>
                  {k === 'citizen_id_issued_on' ? fmtDate(app.snapshot![k]) : app.snapshot![k]}
                </dd>
              </div>
            ))}
            {(app.category_details ?? []).map((r) => (
              <div key={r.label} className={cn(ui.dtRow, 'sm:col-span-2')}>
                <dt className={ui.dtLabel}>{r.label}</dt>
                <dd className={cn(ui.dtValue, 'whitespace-pre-line break-words')}>{r.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <section className={cn(ui.card, 'overflow-hidden')}>
        <div className={ui.cardHeader}>
          <h3 className={ui.sectionTitle}><FileText size={16} className={accentIcon.primary} />Giấy tờ đã nộp</h3>
          {(app.documents ?? []).length > 0 && <span className="text-xs text-muted">{app.documents!.length} file</span>}
        </div>
        {(app.documents ?? []).length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted">Đơn này không kèm giấy tờ (chỉ xác nhận gia hạn).</p>
        ) : (
          <ul className="divide-y divide-line2">
            {app.documents!.map((d) => (
              <li key={d.id}>
                <button type="button" onClick={() => openDocument(d.id)}
                        className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-surface-subtle">
                  <FileText size={16} className="shrink-0 text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-primary-text">{d.original_filename}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted">{d.category_code} · {d.doc_label}</span>
                  </span>
                  {d.expires_at && <span className="shrink-0 text-xs text-muted">Hết hạn {fmtDate(d.expires_at)}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={cn(ui.card, 'overflow-hidden')}>
        <div className={ui.cardHeader}>
          <h3 className={ui.sectionTitle}><History size={16} className={accentIcon.primary} />Lịch sử xử lý</h3>
        </div>
        <div className="px-5 py-4">
          {(app.timeline ?? []).length === 0 ? (
            <p className="text-sm text-muted">Chưa có.</p>
          ) : (
            <ol className="space-y-3 border-l border-line pl-4">
              {app.timeline!.map((ev, i) => (
                <li key={i} className="relative">
                  <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-primary" />
                  <div className="text-sm text-ink">{ev.label}</div>
                  <div className="text-xs text-muted">{fmtDateTime(ev.at)}</div>
                  {ev.note && <p className="mt-0.5 whitespace-pre-line text-meta text-muted">{ev.note}</p>}
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>
    </div>
  );
}

export function TuitionApplicationModal({ id, award, onClose, onUpdated }: {
  id: number;
  /** Kết quả miễn giảm của kỳ chứa đơn (nếu Phòng CTSV đã nạp danh sách). */
  award?: TuitionExemptionAward;
  onClose: () => void;
  /** Gọi sau khi bổ sung thành công — trang tổng quan tải lại danh sách. */
  onUpdated?: () => void;
}) {
  const [app, setApp] = useState<TuitionExemptionApplication | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    api.tuitionExemption.detail(id)
      .then((a) => { if (active) setApp(a); })
      .catch((e) => { if (active) setError(e instanceof ApiError ? e.message : 'Không tải được đơn.'); });
    return () => { active = false; };
  }, [id]);

  return (
    <InsuranceModal eyebrow="Hồ sơ miễn giảm học phí" title={`Đơn MGHP #${id}`} closeDisabled={saving} onClose={onClose}>
      {error && (
        <div role="alert" className="mb-4 flex items-start gap-2 rounded-lg border border-danger-line bg-danger-soft px-4 py-3 text-sm text-danger-text">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span className="min-w-0 flex-1">{error}</span>
        </div>
      )}
      {app ? (
        <ApplicationBody app={app} award={award} saving={saving} setSaving={setSaving} onError={setError}
                         onUpdated={(a) => { setApp(a); setError(''); onUpdated?.(); }} />
      ) : !error && (
        <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted">
          <Loader2 size={16} className="animate-spin" />Đang tải…
        </p>
      )}
    </InsuranceModal>
  );
}
