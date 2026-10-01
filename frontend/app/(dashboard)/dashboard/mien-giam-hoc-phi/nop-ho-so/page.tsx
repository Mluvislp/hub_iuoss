'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CheckCircle2, FileUp, Info, Loader2, Lock, Send, X } from 'lucide-react';
import { api, ApiError, newRequestKey } from '@/lib/api';
import { badge, ui } from '@/lib/ui';
import { cn } from '@/lib/utils';
import { FormBusy } from '@/components/form-busy';
import type { TuitionExemptionCategory, TuitionExemptionPlan, TuitionExemptionState } from '@/lib/types';
import { BASE, Breadcrumb, ErrorBox, fmtDate, fmtDateTime, IneligibleModal, MODE_BADGE } from '../shared';

/**
 * Form MGHP. SV TỰ CHỌN ĐÚNG MỘT đối tượng (radio, không chọn sẵn). Việc phải làm
 * phụ thuộc đối tượng được chọn (`mode` do backend tính):
 *   new        — chưa từng hưởng đối tượng này: nộp đủ giấy tờ
 *   confirm    — đang hưởng, chỉ cần xác nhận gia hạn: không nộp giấy
 *   supplement — đang hưởng, phải nộp lại giấy của kỳ này (chỉ giấy "nộp lại khi gia hạn")
 * Đối tượng có thông tin riêng (TSKK, KHAC…) hiện thêm ô theo `fields`, gửi dạng
 * `detail_<tên>`. Không đủ điều kiện (TSKK) → pop-up, không cho nộp; server kiểm lại.
 *
 * Gửi multipart: trường text theo TuitionExemptionSubmitSerializer, `category_codes`
 * (một mã), `detail_*`, file `doc_<MÃ>__<doc_type>`. Thông tin chỉ lưu vào đơn.
 */

type Errors = Record<string, string[]>;
type Details = Record<string, string | boolean>;

const FIELD_GROUPS: { section: string; items: { name: string; label: string; type?: string; required?: boolean; wide?: boolean }[] }[] = [
  {
    section: 'Giấy tờ tùy thân và liên hệ',
    items: [
      { name: 'citizen_id', label: 'Số CCCD', required: true },
      { name: 'citizen_id_issued_on', label: 'Ngày cấp CCCD', type: 'date', required: true },
      { name: 'phone_number', label: 'Số điện thoại', type: 'tel', required: true },
      { name: 'permanent_address', label: 'Địa chỉ thường trú của sinh viên', required: true, wide: true },
    ],
  },
  {
    section: 'Tài khoản nhận tiền miễn giảm',
    items: [
      { name: 'bank_account_number', label: 'Số tài khoản', required: true },
      { name: 'bank_account_holder', label: 'Tên chủ tài khoản', required: true },
      { name: 'bank_name', label: 'Tên ngân hàng', required: true, wide: true },
    ],
  },
  {
    section: 'Cha mẹ / người giám hộ',
    items: [
      { name: 'father_full_name', label: 'Họ tên cha' },
      { name: 'father_phone', label: 'Số điện thoại cha', type: 'tel' },
      { name: 'mother_full_name', label: 'Họ tên mẹ' },
      { name: 'mother_phone', label: 'Số điện thoại mẹ', type: 'tel' },
      { name: 'guardian_full_name', label: 'Họ tên người giám hộ (nếu có)' },
      { name: 'guardian_phone', label: 'Số điện thoại người giám hộ', type: 'tel' },
      { name: 'guardian_relationship', label: 'Quan hệ với sinh viên' },
    ],
  },
];

const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp,image/heic,.heic';
const ACTION_LABEL = { new: 'Nộp hồ sơ', confirm: 'Xác nhận gia hạn', supplement: 'Bổ sung hồ sơ' } as const;

function fileKey(code: string, docType: string) {
  return `doc_${code}__${docType}`;
}

const errId = (name: string) => `mghp-err-${name}`;

/** Gắn ô với dòng lỗi của nó (aria-describedby) để trình đọc màn hình đọc được lý do. */
function errA11y(errors: Errors, name: string) {
  const invalid = !!errors[name]?.[0];
  return { 'aria-invalid': invalid, 'aria-describedby': invalid ? errId(name) : undefined };
}

function FieldError({ errors, name }: { errors: Errors; name: string }) {
  const msg = errors[name]?.[0];
  return msg ? <p id={errId(name)} className="mt-1 text-[0.78rem] text-danger-text">{msg}</p> : null;
}

/** Lý do không đủ điều kiện kiểm được ngay trên trình duyệt — CÙNG luật với
 *  contract.clean_category_details (server vẫn kiểm lại, đây chỉ để báo sớm). */
function ineligibleReasons(c: TuitionExemptionCategory, plan: TuitionExemptionPlan, details: Details, full: boolean) {
  const reasons: string[] = [];
  if (c.requires_ethnic_minority) {
    if (plan.is_ethnic_minority === null) reasons.push('hồ sơ chưa có thông tin dân tộc (liên hệ Phòng CTSV để cập nhật)');
    else if (!plan.is_ethnic_minority) reasons.push(`không thuộc dân tộc thiểu số (hồ sơ ghi: ${plan.ethnicity || 'Kinh'})`);
  }
  if (full && c.code === 'TSKK') {
    if (!details.self_special_area) reasons.push('bản thân không thường trú tại xã, thôn đặc biệt khó khăn hoặc xã biên giới');
    if (!details.father_special_area && !details.mother_special_area) {
      reasons.push('cả cha và mẹ đều không thường trú tại xã, thôn đặc biệt khó khăn hoặc xã biên giới');
    }
  }
  return reasons.length ? `Sinh viên không đủ điều kiện hưởng đối tượng ${c.code} do ${reasons.join('; ')}.` : '';
}

/** Một đối tượng: ô chọn (radio) + khi được chọn: thông tin riêng + giấy tờ. */
function CategoryOption({
  c, checked, onSelect, details, setDetail, files, onFiles, errors,
}: {
  c: TuitionExemptionCategory;
  checked: boolean;
  onSelect: () => void;
  details: Details;
  setDetail: (name: string, value: string | boolean) => void;
  files: Record<string, File[]>;
  onFiles: (key: string, list: File[]) => void;
  errors: Errors;
}) {
  return (
    <div className={cn('px-5 py-3.5', checked && 'bg-primary-soft/40')}>
      <label className="flex items-start gap-3 cursor-pointer">
        <input type="radio" name="mghp_category" className="mt-1 accent-primary" checked={checked} onChange={onSelect} />
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-ink">{c.name}</span>
            {c.mode !== 'new' && <span className={cn(badge.base, MODE_BADGE[c.mode])}>Đang hưởng · {c.mode_label}</span>}
          </div>
          {c.description && <p className="text-[0.8rem] text-muted mt-0.5 whitespace-pre-line">{c.description}</p>}
          {c.last_verified && <p className="text-[0.75rem] text-muted mt-0.5">Xác nhận gần nhất: {c.last_verified}</p>}
        </div>
      </label>

      {checked && (
        <div className="mt-3 ml-7 space-y-3">
          {c.fields.length > 0 && (
            <div className="rounded-lg border border-line bg-white px-4 py-3 space-y-3">
              <div className="text-[0.8rem] font-medium text-ink">Thông tin riêng của đối tượng {c.code}</div>
              {c.fields.map((f) => {
                const name = `detail_${f.name}`;
                if (f.type === 'checkbox') {
                  return (
                    <label key={f.name} className="flex items-start gap-2.5 text-[0.84rem] text-ink cursor-pointer">
                      <input type="checkbox" className="mt-0.5 accent-primary" checked={!!details[f.name]}
                             onChange={(e) => setDetail(f.name, e.target.checked)} />
                      {f.label}
                    </label>
                  );
                }
                return (
                  <label key={f.name} className="block">
                    <span className={ui.fieldLabel}>{f.label}{f.required && <span className="text-danger-text"> *</span>}</span>
                    {f.type === 'textarea' ? (
                      <textarea {...errA11y(errors, name)} rows={4} maxLength={f.max} className={cn(ui.textarea, errors[name] && 'border-danger-line')}
                                value={String(details[f.name] ?? '')} onChange={(e) => setDetail(f.name, e.target.value)} />
                    ) : (
                      <input {...errA11y(errors, name)} maxLength={f.max} className={cn(ui.input, errors[name] && 'border-danger-line')}
                             value={String(details[f.name] ?? '')} onChange={(e) => setDetail(f.name, e.target.value)} />
                    )}
                    <FieldError errors={errors} name={name} />
                  </label>
                );
              })}
            </div>
          )}

          {c.mode === 'confirm' ? (
            <p className="flex items-center gap-1.5 text-[0.8rem] text-success-text">
              <CheckCircle2 size={14} /> Không cần nộp lại giấy tờ — cán bộ sẽ xác nhận gia hạn.
            </p>
          ) : (
            <div className="space-y-2.5">
              {c.mode === 'supplement' && (
                <p className="text-[0.8rem] text-warning-text">Đối tượng này cần nộp lại các giấy tờ sau cho học kỳ này:</p>
              )}
              {c.documents.map((d) => {
                const key = fileKey(c.code, d.doc_type);
                const list = files[key] ?? [];
                return (
                  <div key={key}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[0.82rem] text-ink flex-1 min-w-[160px]">
                        {d.label}{d.required && <span className="text-danger-text"> *</span>}
                      </span>
                      <label className={cn(ui.btnOutline, 'h-9 cursor-pointer')}>
                        <FileUp size={15} /> {list.length ? `${list.length} file` : 'Chọn file'}
                        <input type="file" multiple accept={ACCEPT} className="hidden"
                               onChange={(e) => { onFiles(key, Array.from(e.target.files ?? [])); e.target.value = ''; }} />
                      </label>
                    </div>
                    {list.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {list.map((f, i) => (
                          <li key={`${f.name}-${i}`} className="flex items-center gap-1.5 text-[0.78rem] text-muted">
                            <span className="truncate">{f.name}</span>
                            <button type="button" aria-label="Bỏ file" className="text-muted hover:text-danger-text"
                                    onClick={() => onFiles(key, list.filter((_, j) => j !== i))}>
                              <X size={13} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <FieldError errors={errors} name={key} />
                  </div>
                );
              })}
            </div>
          )}
          <FieldError errors={errors} name={`category_${c.code}`} />
        </div>
      )}
    </div>
  );
}

export default function TuitionWaiverSubmitPage() {
  const router = useRouter();
  const [state, setState] = useState<TuitionExemptionState | null>(null);
  const [loadError, setLoadError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [details, setDetails] = useState<Details>({});
  const [files, setFiles] = useState<Record<string, File[]>>({});
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [popup, setPopup] = useState('');
  const [confirmTrue, setConfirmTrue] = useState(false);
  const [saving, setSaving] = useState(false);
  // Một key cho cả lần nộp: bấm lại sau lỗi mạng không tạo đơn thứ hai.
  const requestKey = useRef(newRequestKey());

  useEffect(() => {
    api.tuitionExemption.state()
      .then((s) => { setState(s); setFields(s.prefill.fields); })
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : 'Không tải được dữ liệu.'));
  }, []);

  const plan = state?.plan ?? null;
  const all = plan ? [...plan.renewals, ...plan.others] : [];
  const chosen = all.find((c) => c.code === selected) ?? null;

  function select(c: TuitionExemptionCategory) {
    if (!plan) return;
    // Điều kiện kiểm được ngay (DTTS theo hồ sơ) → pop-up, không cho chọn.
    const reason = ineligibleReasons(c, plan, {}, false);
    if (reason) { setPopup(reason); return; }
    setSelected(c.code);
    setErrors({});
    const prev = state?.prefill.category_details;
    setDetails(prev && prev.code === c.code ? prev.values : {});
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!state?.plan) return;
    setError('');
    setErrors({});
    if (!chosen) { setError('Chọn một đối tượng miễn giảm.'); return; }
    const reason = ineligibleReasons(chosen, state.plan, details, true);
    if (reason) { setPopup(reason); return; }
    if (!confirmTrue) { setError('Vui lòng xác nhận thông tin khai là đúng sự thật.'); return; }

    const body = new FormData();
    body.set('request_key', requestKey.current);
    const p = state.prefill;
    body.set('full_name', p.full_name);
    body.set('student_code', p.student_code);
    if (p.date_of_birth) body.set('date_of_birth', p.date_of_birth);
    body.set('class_code', p.class_code);
    body.set('department_code', p.department_code);
    Object.entries(fields).forEach(([k, v]) => { if (v) body.set(k, v.trim()); });
    body.append('category_codes', chosen.code);
    chosen.fields.forEach((f) => {
      const v = details[f.name];
      if (f.type === 'checkbox') { if (v) body.set(`detail_${f.name}`, '1'); } else if (v) body.set(`detail_${f.name}`, String(v));
    });
    let count = 0;
    if (chosen.mode !== 'confirm') {
      chosen.documents.forEach((d) => {
        (files[fileKey(chosen.code, d.doc_type)] ?? []).forEach((f) => { body.append(fileKey(chosen.code, d.doc_type), f); count += 1; });
      });
    }
    if (count > state.limits.max_files) { setError(`Tối đa ${state.limits.max_files} file mỗi đơn.`); return; }

    setSaving(true);
    try {
      const next = await api.tuitionExemption.submit(body);
      router.replace(next.submitted_id ? `${BASE}/ho-so/${next.submitted_id}` : BASE);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.data.code === 'ineligible') { setPopup(err.message); return; }
        setError(err.message);
        if (err.data.errors) setErrors(err.data.errors as Errors);
      } else {
        setError('Không gửi được hồ sơ.');
      }
    } finally {
      setSaving(false);
    }
  }

  const trail = [{ label: 'Miễn giảm học phí', href: BASE }, { label: 'Nộp đơn' }];

  if (loadError) return <div className="space-y-5"><Breadcrumb trail={trail} /><ErrorBox text={loadError} /></div>;
  if (!state) {
    return <div className="flex items-center justify-center h-48 text-muted"><Loader2 size={24} className="animate-spin" /></div>;
  }
  if (!state.round || !plan || state.application) {
    return (
      <div className="space-y-5">
        <Breadcrumb trail={trail} />
        <section className={cn(ui.card, 'px-5 py-5 text-sm text-muted flex items-start gap-2.5')}>
          <Lock size={16} className="flex-shrink-0 mt-0.5" />
          <div>
            {state.application ? 'Bạn đã gửi đơn cho đợt này.' : 'Hiện không có đợt nhận hồ sơ nào đang mở.'}{' '}
            <Link href={BASE} className="text-primary-text font-medium hover:underline">Quay lại</Link>
          </div>
        </section>
      </div>
    );
  }

  const p = state.prefill;
  const renewal = plan.submission_kind === 'previously_reviewed';
  const option = (c: TuitionExemptionCategory) => (
    <CategoryOption key={c.code} c={c} checked={selected === c.code} onSelect={() => select(c)}
                    details={details} setDetail={(n, v) => setDetails((cur) => ({ ...cur, [n]: v }))}
                    files={files} onFiles={(k, l) => setFiles((cur) => ({ ...cur, [k]: l }))} errors={errors} />
  );

  return (
    <form onSubmit={handleSubmit} noValidate>
      {popup && <IneligibleModal message={popup} onClose={() => setPopup('')} />}
      <FormBusy busy={saving} className="space-y-5">
        <Breadcrumb trail={trail} />

        <section className={ui.card}>
          <div className={ui.cardHeader}>
            <h2 className={ui.sectionTitle}>{state.round.title}</h2>
            <span className={cn(badge.base, renewal ? badge.success : badge.info)}>{plan.submission_kind_label}</span>
          </div>
          <div className="px-5 py-3 text-[0.82rem] text-muted space-y-1">
            <div>{state.round.term_label} · Hạn nộp: {fmtDateTime(state.round.closes_at)}</div>
            {renewal && (
              <div className="flex items-start gap-1.5 text-ink">
                <Info size={14} className="mt-0.5 flex-shrink-0 text-primary" />
                Bạn đang được hưởng miễn giảm học phí. Chọn lại đối tượng đang hưởng để gia hạn, hoặc chọn
                đối tượng khác (khi đó phải nộp đầy đủ hồ sơ của đối tượng mới).
              </div>
            )}
          </div>
        </section>

        <section className={ui.card}>
          <div className={ui.cardHeader}><h2 className={ui.sectionTitle}>Thông tin sinh viên</h2></div>
          <div className="px-5 py-1">
            {([
              ['Họ và tên', p.full_name], ['MSSV', p.student_code], ['Ngày sinh', fmtDate(p.date_of_birth)],
              ['Lớp', p.class_code], ['Khoa', p.department_name], ['Dân tộc', plan.ethnicity],
            ] as const).map(([k, v]) => (
              <div key={k} className={ui.dtRow}>
                <span className={ui.dtLabel}>{k}</span><span className={ui.dtValue}>{v || '—'}</span>
              </div>
            ))}
          </div>
        </section>

        {p.source === 'previous_application' && (
          <p className="text-[0.8rem] text-muted -mb-2">
            Các ô dưới đây được điền sẵn từ đơn gần nhất của bạn — kiểm tra và sửa nếu có thay đổi.
          </p>
        )}
        {FIELD_GROUPS.map((group) => (
          <section key={group.section} className={ui.card}>
            <div className={ui.cardHeader}><h2 className={ui.sectionTitle}>{group.section}</h2></div>
            <div className="px-5 py-4 grid gap-4 sm:grid-cols-2">
              {group.items.map((f) => (
                <label key={f.name} className={f.wide ? 'sm:col-span-2' : undefined}>
                  <span className={ui.fieldLabel}>
                    {f.label}{f.required && <span className="text-danger-text"> *</span>}
                  </span>
                  <input {...errA11y(errors, f.name)} className={cn(ui.input, errors[f.name] && 'border-danger-line')} type={f.type ?? 'text'}
                         value={fields[f.name] ?? ''}
                         onChange={(e) => setFields((cur) => ({ ...cur, [f.name]: e.target.value }))} />
                  <FieldError errors={errors} name={f.name} />
                </label>
              ))}
            </div>
          </section>
        ))}

        <section className={ui.card}>
          <div className={ui.cardHeader}>
            <h2 className={ui.sectionTitle}>Đối tượng miễn giảm</h2>
            <span className="text-[0.78rem] text-muted">Chọn MỘT đối tượng</span>
          </div>
          {all.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted">Chưa có đối tượng nào được mở.</p>
          ) : (
            <div className="divide-y divide-line2">
              {plan.renewals.length > 0 && (
                <div className="px-5 py-2 text-[0.75rem] font-medium text-muted bg-slate-50">Đối tượng bạn đang hưởng</div>
              )}
              {plan.renewals.map(option)}
              {plan.renewals.length > 0 && plan.others.length > 0 && (
                <div className="px-5 py-2 text-[0.75rem] font-medium text-muted bg-slate-50">Đối tượng khác</div>
              )}
              {plan.others.map(option)}
            </div>
          )}
          <div className="px-5 pb-3"><FieldError errors={errors} name="category_codes" /></div>
        </section>

        <p className="text-[0.78rem] text-muted">
          Giấy tờ nhận PDF (tối đa {state.limits.max_pdf_mb} MB) hoặc ảnh JPG/PNG/HEIC (tối đa {state.limits.max_image_mb} MB mỗi ảnh),
          tổng cộng không quá {state.limits.max_files} file. Mẫu đơn M01–M04 tải tại iuoss.com/bieumau.
        </p>

        <label className="flex items-start gap-2.5 text-sm text-ink cursor-pointer">
          <input type="checkbox" className="mt-1 accent-primary" checked={confirmTrue}
                 onChange={(e) => setConfirmTrue(e.target.checked)} />
          Tôi cam đoan các thông tin đã khai và giấy tờ đã nộp là đúng sự thật, và chịu trách nhiệm nếu có sai lệch.
        </label>

        {error && <ErrorBox text={error} />}
        <div className="flex justify-end gap-3">
          <Link href={BASE} className={ui.btnGhost}>Hủy</Link>
          <button type="submit" className={ui.btnPrimary} disabled={saving || !chosen}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            {chosen ? ACTION_LABEL[chosen.mode] : 'Chọn đối tượng để tiếp tục'}
          </button>
        </div>
      </FormBusy>
    </form>
  );
}
