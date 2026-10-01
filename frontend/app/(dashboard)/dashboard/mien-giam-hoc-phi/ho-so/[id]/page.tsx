'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { FileText, FileUp, History, ListChecks, Loader2, Send } from 'lucide-react';
import { api, ApiError, newRequestKey } from '@/lib/api';
import { badge, ui } from '@/lib/ui';
import { cn } from '@/lib/utils';
import type { TuitionExemptionApplication } from '@/lib/types';
import {
  BASE, Breadcrumb, ErrorBox, fmtDate, fmtDateTime, MODE_BADGE, REVIEW_BADGE, REVIEW_LABEL, StatusBadge,
} from '../../shared';

const SNAPSHOT_ROWS: [string, string][] = [
  ['citizen_id', 'Số CCCD'], ['citizen_id_issued_on', 'Ngày cấp CCCD'], ['phone_number', 'Số điện thoại'],
  ['permanent_address', 'Địa chỉ thường trú'], ['bank_account_number', 'Số tài khoản'],
  ['bank_account_holder', 'Chủ tài khoản'], ['bank_name', 'Ngân hàng'],
  ['father_full_name', 'Họ tên cha'], ['father_phone', 'SĐT cha'], ['mother_full_name', 'Họ tên mẹ'],
  ['mother_phone', 'SĐT mẹ'], ['guardian_full_name', 'Người giám hộ'], ['guardian_phone', 'SĐT người giám hộ'],
  ['guardian_relationship', 'Quan hệ'],
];

/**
 * Chi tiết một đơn Miễn giảm học phí của chính SV: kết quả xét từng đối tượng,
 * thông tin đã khai, giấy tờ đã nộp, lịch sử xử lý, và khu bổ sung khi CÁN BỘ yêu cầu
 * (đơn "Cần bổ sung"): mỗi diện cần bổ sung hiện đủ ô giấy tờ như lúc nộp.
 */

const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp,image/heic,.heic';

function SupplementBox({ app, onDone }: { app: TuitionExemptionApplication; onDone: (a: TuitionExemptionApplication) => void }) {
  const [files, setFiles] = useState<Record<string, File[]>>({});
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);
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
    <section className={cn(ui.card, 'border-danger-line')}>
      <div className={ui.cardHeader}>
        <h2 className={ui.sectionTitle}><FileUp size={17} className="text-danger-text" />Cán bộ yêu cầu bổ sung hồ sơ</h2>
        {app.supplement_deadline && (
          <span className="text-xs text-muted">Hạn: {fmtDateTime(app.supplement_deadline)}</span>
        )}
      </div>
      <div className="px-5 py-4 space-y-4">
        {(app.rejection_reason || app.review_note) && (
          <div className="rounded-lg bg-warning-soft border border-warning-line px-3.5 py-2.5 text-sm text-warning-text">
            {app.rejection_reason && <div className="font-medium">{app.rejection_reason}</div>}
            {app.review_note && <div className="whitespace-pre-line">{app.review_note}</div>}
          </div>
        )}
        {app.supplement_overdue ? (
          <p className="text-sm text-danger-text">Đã quá hạn bổ sung. Vui lòng liên hệ Phòng Công tác Sinh viên.</p>
        ) : (
          <>
            {(app.supplement_targets ?? []).map((c) => (
              <div key={c.code} className="space-y-2">
                <div className="text-sm font-medium text-ink">{c.name}</div>
                {c.review_note && <p className="text-meta text-warning-text">{c.review_note}</p>}
                {c.documents.map((d) => {
                  const key = `doc_${c.code}__${d.doc_type}`;
                  const list = files[key] ?? [];
                  return (
                    <div key={key} className="pl-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-meta text-ink flex-1 min-w-[160px]">{d.label}</span>
                        <label className={cn(ui.btnOutline, 'h-9 cursor-pointer')}>
                          <FileUp size={15} /> {list.length ? `${list.length} file` : 'Chọn file'}
                          <input type="file" multiple accept={ACCEPT} className="hidden"
                                 onChange={(e) => { const fs = Array.from(e.target.files ?? []); setFiles((cur) => ({ ...cur, [key]: fs })); e.target.value = ''; }} />
                        </label>
                      </div>
                      {list.length > 0 && <p className="mt-1 text-xs text-muted truncate">{list.map((f) => f.name).join(', ')}</p>}
                      {errors[key] && <p className="mt-1 text-xs text-danger-text">{errors[key][0]}</p>}
                    </div>
                  );
                })}
              </div>
            ))}
            <p className="text-xs text-muted">File mới sẽ thay file cùng loại đã nộp trước đó.</p>
            {error && <ErrorBox text={error} />}
            <div className="flex justify-end">
              <button type="button" className={ui.btnPrimary} onClick={send} disabled={saving}>
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Gửi bổ sung
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

export default function TuitionWaiverDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params?.id);
  const [app, setApp] = useState<TuitionExemptionApplication | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) { setError('Không tìm thấy đơn.'); return; }
    api.tuitionExemption.detail(id)
      .then(setApp)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Không tải được đơn.'));
  }, [id]);

  async function openDocument(documentId: number) {
    try {
      const blob = await api.tuitionExemption.document(id, documentId);
      window.open(URL.createObjectURL(blob), '_blank');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được giấy tờ.');
    }
  }

  const trail = [{ label: 'Miễn giảm học phí', href: BASE }, { label: `Đơn #${id || ''}` }];

  return (
    <div className="space-y-5">
      <Breadcrumb trail={trail} />
      {error && <ErrorBox text={error} />}
      {!app && !error && (
        <div className="flex items-center justify-center h-48 text-muted"><Loader2 size={24} className="animate-spin" /></div>
      )}
      {app && (
        <>
          <section className={ui.card}>
            <div className={ui.cardHeader}>
              <h2 className={ui.sectionTitle}>Đơn {app.submission_kind_label.toLowerCase()} #{app.id}</h2>
              <StatusBadge status={app.status} label={app.status_label} />
            </div>
            <div className="px-5 py-3 text-meta text-muted">{app.round_title} · Nộp lúc {fmtDateTime(app.submitted_at)}</div>
            {(app.status === 'approved' || app.status === 'rejected') && (app.review_note || app.rejection_reason) && (
              <div className="px-5 pb-3 text-sm text-ink whitespace-pre-line">
                {app.status === 'rejected' && app.rejection_reason && (
                  <span className="font-medium">Lý do: {app.rejection_reason}. </span>
                )}
                {app.review_note}
              </div>
            )}
          </section>

          {app.status === 'need_supplement' && <SupplementBox key={app.row_version} app={app} onDone={setApp} />}

          <section className={ui.card}>
            <div className={ui.cardHeader}>
              <h2 className={ui.sectionTitle}><ListChecks size={17} className="text-primary" />Nhóm đối tượng đã chọn</h2>
            </div>
            <div className="divide-y divide-line2">
              {app.categories.map((c) => (
                <div key={c.code} className="px-5 py-3 flex items-start gap-3">
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-ink">{c.name}</span>
                      {c.mode && c.mode !== 'new' && (
                        <span className={cn(badge.base, MODE_BADGE[c.mode])}>{c.mode_label}</span>
                      )}
                    </div>
                    {c.review_note && <p className="text-meta text-muted mt-0.5">{c.review_note}</p>}
                  </div>
                  <span className={cn(badge.base, REVIEW_BADGE[c.review_status] ?? badge.neutral)}>
                    {REVIEW_LABEL[c.review_status] ?? c.review_status}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {app.snapshot && (
            <section className={ui.card}>
              <div className={ui.cardHeader}><h2 className={ui.sectionTitle}>Thông tin đã khai</h2></div>
              <div className="px-5 py-1">
                {SNAPSHOT_ROWS.filter(([k]) => app.snapshot![k]).map(([k, label]) => (
                  <div key={k} className={ui.dtRow}>
                    <span className={ui.dtLabel}>{label}</span>
                    <span className={ui.dtValue}>{k === 'citizen_id_issued_on' ? fmtDate(app.snapshot![k]) : app.snapshot![k]}</span>
                  </div>
                ))}
                {(app.category_details ?? []).map((r) => (
                  <div key={r.label} className={ui.dtRow}>
                    <span className={ui.dtLabel}>{r.label}</span>
                    <span className={cn(ui.dtValue, 'whitespace-pre-line')}>{r.value}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className={ui.card}>
            <div className={ui.cardHeader}>
              <h2 className={ui.sectionTitle}><FileText size={17} className="text-primary" />Giấy tờ đã nộp</h2>
            </div>
            <div className="px-5 py-4 space-y-2">
              {(app.documents ?? []).length === 0 ? (
                <p className="text-sm text-muted">Đơn này không kèm giấy tờ (chỉ xác nhận gia hạn).</p>
              ) : (
                app.documents!.map((d) => (
                  <button key={d.id} type="button" onClick={() => openDocument(d.id)}
                          className="flex w-full items-center gap-2.5 text-sm text-primary-text hover:underline text-left">
                    <FileText size={15} className="flex-shrink-0" />
                    <span className="flex-1 min-w-0 truncate">
                      <span className="text-muted">{d.category_code} · {d.doc_label}:</span> {d.original_filename}
                    </span>
                    {d.expires_at && <span className="text-xs text-muted">Hết hạn {fmtDate(d.expires_at)}</span>}
                  </button>
                ))
              )}
            </div>
          </section>

          <section className={ui.card}>
            <div className={ui.cardHeader}>
              <h2 className={ui.sectionTitle}><History size={17} className="text-primary" />Lịch sử xử lý</h2>
            </div>
            <div className="px-5 py-4">
              {(app.timeline ?? []).length === 0 ? (
                <p className="text-sm text-muted">Chưa có.</p>
              ) : (
                <ol className="space-y-3 border-l border-line pl-4">
                  {app.timeline!.map((ev, i) => (
                    <li key={i} className="relative">
                      <span className="absolute -left-[21px] top-1.5 w-2 h-2 rounded-full bg-primary" />
                      <div className="text-sm text-ink">{ev.label}</div>
                      <div className="text-xs text-muted">{fmtDateTime(ev.at)}</div>
                      {ev.note && <p className="text-meta text-muted mt-0.5">{ev.note}</p>}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
