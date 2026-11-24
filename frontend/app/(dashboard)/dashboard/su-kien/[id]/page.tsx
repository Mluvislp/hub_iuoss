'use client';

/**
 * Chi tiết sự kiện cộng tác viên + form đăng ký.
 * Bố cục 2/3 + 1/3 (Polaris): trái = ảnh, mô tả, đăng ký; phải = tóm tắt (thời gian, địa điểm, hạn).
 * Đăng ký: gửi mới · sửa khi còn Chờ duyệt · hủy trong thời gian đăng ký · đăng ký lại sau khi hủy.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  AlertCircle, ArrowLeft, CalendarDays, CheckCircle2, Clock, FileText, Hourglass, Info, Loader2, Lock, MapPin,
  Paperclip, Pencil, Upload, Users, X,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { badge, notice, noticeIcon, subtle, ui } from '@/lib/ui';
import { cn } from '@/lib/utils';
import { Cover, MY_STATUS_BADGE, eventRange, hmdmy, timeLeft, useBlobUrl } from '@/components/volunteer';
import type { VolunteerEventDetail, VolunteerFile, VolunteerQuestion } from '@/lib/types';

const OTHER = '__other__';
const RICH =
  'break-words text-[0.9rem] leading-relaxed text-ink ' +
  '[&_p]:mb-2 [&>*:last-child]:mb-0 [&_strong]:font-semibold [&_b]:font-semibold [&_em]:italic ' +
  '[&_ul]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mb-2 [&_ol]:list-decimal [&_ol]:pl-5 ' +
  '[&_blockquote]:mb-2 [&_blockquote]:border-l-[3px] [&_blockquote]:border-primary-line ' +
  '[&_blockquote]:bg-slate-50 [&_blockquote]:px-3 [&_blockquote]:py-1 [&_a]:text-primary-text [&_a]:underline';
const ACCEPT_ATTR = { image: 'image/*', pdf: 'application/pdf', any: 'image/*,application/pdf' };
const ACCEPT_LABEL = { image: 'Ảnh', pdf: 'PDF', any: 'Ảnh hoặc PDF' };

type Values = Record<string, string | string[]>;

function fmtSize(n: number) {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

/** Câu trả lời đã lưu → chữ đọc được (xem lại đăng ký). */
function answerText(q: VolunteerQuestion, answers: Record<string, unknown>): string {
  const v = answers[q.id];
  if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return '';
  const label = (id: string) => (id === OTHER ? `Khác: ${answers[`${q.id}:other`] ?? ''}` : q.options?.find((o) => o.id === id)?.label ?? '');
  if (q.type === 'single' || q.type === 'dropdown') return label(String(v));
  if (q.type === 'multi') return (v as string[]).map(label).join('; ');
  if (q.type === 'date') { const [y, m, d] = String(v).split('-'); return `${d}/${m}/${y}`; }
  if (q.type === 'file') return (v as VolunteerFile[]).map((f) => f.name).join('; ');
  return String(v);
}

function NoteImage({ path }: { path: string }) {
  const url = useBlobUrl(path);
  if (!url) return <div className="mb-2 h-24 w-40 animate-pulse rounded-md bg-slate-100" />;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="mb-2 block w-fit">
      <img src={url} alt="" className="max-h-64 max-w-full rounded-md border border-line" />
    </a>
  );
}

export default function VolunteerEventPage() {
  const { id } = useParams<{ id: string }>();
  const eventId = Number(id);
  const [data, setData] = useState<VolunteerEventDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Values>({});
  const [profile, setProfile] = useState<Record<string, string>>({});
  const [newFiles, setNewFiles] = useState<Record<string, File[]>>({});
  const [keep, setKeep] = useState<Record<string, number[]>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const fillFrom = useCallback((d: VolunteerEventDetail) => {
    const answers = d.registration?.answers ?? {};
    const v: Values = {};
    const k: Record<string, number[]> = {};
    for (const q of d.form.questions) {
      const a = answers[q.id];
      if (q.type === 'file') k[q.id] = ((a as VolunteerFile[]) ?? []).map((f) => f.idx);
      else if (q.type === 'multi') v[q.id] = (a as string[]) ?? [];
      else v[q.id] = a == null ? '' : String(a);
      if (q.other) v[`${q.id}:other`] = String(answers[`${q.id}:other`] ?? '');
    }
    const saved = (answers.profile ?? {}) as Record<string, string>;
    setValues(v);
    setKeep(k);
    setNewFiles({});
    setProfile(Object.fromEntries(d.form.profile.filter((p) => p.editable).map((p) => [p.key, saved[p.key] ?? p.value])));
    setErrors({});
    setFormError(null);
  }, []);

  useEffect(() => {
    api.volunteer.detail(eventId)
      .then((d) => { setData(d); fillFrom(d); })
      .catch((err) => setLoadError(err instanceof ApiError && err.status === 404
        ? 'Không tìm thấy sự kiện hoặc sinh viên không thuộc đối tượng của sự kiện.'
        : 'Không tải được sự kiện.'));
  }, [eventId, fillFrom]);

  if (loadError) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/su-kien" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft size={14} />Sự kiện cộng tác viên</Link>
        <div className={cn(notice.base, notice.error)}><AlertCircle className={noticeIcon.error} /><p>{loadError}</p></div>
      </div>
    );
  }
  if (!data) {
    return <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted"><Loader2 size={16} className="animate-spin" />Đang tải…</div>;
  }

  const reg = data.registration;
  const state = data.registration_state;
  const showForm = state === 'open' && data.eligible && (!reg || editing || reg.status === 'cancelled');
  const set = (key: string, v: string | string[]) => { setValues((s) => ({ ...s, [key]: v })); setErrors((e) => ({ ...e, [key.split(':')[0]]: '' })); };

  function validate(): Record<string, string> {
    const e: Record<string, string> = {};
    for (const p of data!.form.profile) {
      if (!p.editable) continue;
      const v = (profile[p.key] ?? '').trim();
      if (!v) e[`profile.${p.key}`] = 'Vui lòng nhập thông tin này.';
      else if (p.key === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) e[`profile.${p.key}`] = 'Email không hợp lệ.';
      else if (p.key === 'phone' && !/^(\+?84|0)[0-9]{9,10}$/.test(v.replace(/[\s.-]/g, ''))) e[`profile.${p.key}`] = 'Số điện thoại không hợp lệ.';
    }
    for (const q of data!.form.questions) {
      const v = values[q.id];
      if (q.type === 'file') {
        const n = (keep[q.id]?.length ?? 0) + (newFiles[q.id]?.length ?? 0);
        if (q.required && !n) e[q.id] = 'Vui lòng tải file lên.';
        else if (n > (q.max_files ?? 1)) e[q.id] = `Tối đa ${q.max_files ?? 1} file.`;
        continue;
      }
      const empty = Array.isArray(v) ? !v.length : !String(v ?? '').trim();
      if (q.required && empty) { e[q.id] = q.type === 'multi' || q.type === 'single' || q.type === 'dropdown' ? 'Vui lòng chọn.' : 'Vui lòng trả lời câu hỏi này.'; continue; }
      if (empty) continue;
      const picked = Array.isArray(v) ? v : [String(v)];
      if (picked.includes(OTHER) && !String(values[`${q.id}:other`] ?? '').trim()) e[q.id] = 'Vui lòng ghi rõ lựa chọn Khác.';
      if (q.type === 'multi') {
        if (q.min && picked.length < q.min) e[q.id] = `Chọn ít nhất ${q.min} lựa chọn.`;
        if (q.max && picked.length > q.max) e[q.id] = `Chọn tối đa ${q.max} lựa chọn.`;
      }
      if (q.type === 'short_text' && q.format === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v).trim())) e[q.id] = 'Email không hợp lệ.';
      if (q.type === 'short_text' && q.format === 'phone' && !/^(\+?84|0)[0-9]{9,10}$/.test(String(v).replace(/[\s.-]/g, ''))) e[q.id] = 'Số điện thoại không hợp lệ.';
      if (q.type === 'number') {
        const n = Number(String(v).replace(',', '.'));
        if (Number.isNaN(n)) e[q.id] = 'Vui lòng nhập một số.';
        else if (q.integer && !Number.isInteger(n)) e[q.id] = 'Vui lòng nhập số nguyên.';
        else if (q.min != null && n < q.min) e[q.id] = `Giá trị nhỏ nhất là ${q.min}.`;
        else if (q.max != null && n > q.max) e[q.id] = `Giá trị lớn nhất là ${q.max}.`;
      }
    }
    return e;
  }

  function scrollToFirstError(e: Record<string, string>) {
    const first = Object.keys(e).find((k) => e[k]);
    if (!first) return;
    document.getElementById(`f-${first}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function submit() {
    const e = validate();
    if (Object.values(e).some(Boolean)) {
      setErrors(e); setFormError('Thông tin chưa hợp lệ, vui lòng kiểm tra các ô được đánh dấu đỏ.'); scrollToFirstError(e); return;
    }
    const fd = new FormData();
    const answers: Record<string, unknown> = {};
    for (const q of data!.form.questions) {
      if (q.type === 'file') {
        fd.set(`keep:${q.id}`, JSON.stringify(keep[q.id] ?? []));
        (newFiles[q.id] ?? []).forEach((f) => fd.append(`file:${q.id}`, f));
        continue;
      }
      answers[q.id] = values[q.id];
      if (q.other) answers[`${q.id}:other`] = values[`${q.id}:other`] ?? '';
    }
    fd.set('answers', JSON.stringify(answers));
    fd.set('profile', JSON.stringify(profile));
    setBusy(true); setFormError(null);
    try {
      const d = await api.volunteer.register(eventId, fd);
      setData(d); fillFrom(d); setEditing(false);
      setFlash(reg && reg.status === 'pending' ? 'Đã cập nhật đăng ký.' : 'Đã gửi đăng ký. Phòng Công tác Sinh viên sẽ xét và cập nhật kết quả tại đây.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      if (err instanceof ApiError) {
        const fe = (err.data.errors ?? {}) as Record<string, string>;
        setErrors(fe); setFormError(err.message); scrollToFirstError(fe);
        if (err.status === 409) api.volunteer.detail(eventId).then((d) => { setData(d); setEditing(false); });
      } else setFormError('Không gửi được đăng ký. Kiểm tra kết nối rồi thử lại.');
    } finally { setBusy(false); }
  }

  async function cancel() {
    if (!window.confirm('Hủy đăng ký tham gia sự kiện này? Có thể đăng ký lại trước khi hết hạn.')) return;
    setBusy(true);
    try {
      const d = await api.volunteer.cancel(eventId);
      setData(d); fillFrom(d); setEditing(false); setFlash('Đã hủy đăng ký.');
    } catch (err) {
      setFlash(null); setFormError(err instanceof ApiError ? err.message : 'Không hủy được.');
    } finally { setBusy(false); }
  }

  function pickFiles(q: VolunteerQuestion, list: FileList | null) {
    if (!list) return;
    const max = data!.form.max_file_bytes;
    const room = (q.max_files ?? 1) - (keep[q.id]?.length ?? 0) - (newFiles[q.id]?.length ?? 0);
    const files = Array.from(list);
    const tooBig = files.find((f) => f.size > max);
    if (tooBig) { setErrors((e) => ({ ...e, [q.id]: `${tooBig.name}: tối đa ${fmtSize(max)}.` })); return; }
    if (files.length > room) { setErrors((e) => ({ ...e, [q.id]: `Tối đa ${q.max_files ?? 1} file.` })); return; }
    setNewFiles((s) => ({ ...s, [q.id]: [...(s[q.id] ?? []), ...files] }));
    setErrors((e) => ({ ...e, [q.id]: '' }));
  }

  const savedFiles = (qid: string) => ((reg?.answers[qid] as VolunteerFile[]) ?? []);

  function renderInput(q: VolunteerQuestion) {
    const v = values[q.id];
    const err = !!errors[q.id];
    const inputCls = cn(ui.input, err && 'border-danger-text focus:border-danger-text focus:ring-danger-text/15');
    if (q.type === 'short_text') {
      return <input className={inputCls} value={String(v ?? '')} maxLength={500} onChange={(e) => set(q.id, e.target.value)}
        inputMode={q.format === 'phone' ? 'tel' : q.format === 'email' ? 'email' : undefined}
        placeholder={q.format === 'phone' ? 'VD: 0901234567' : q.format === 'email' ? 'ten@example.com' : 'Câu trả lời'} />;
    }
    if (q.type === 'long_text') {
      return (
        <div>
          <textarea className={cn(ui.textarea, err && 'border-danger-text')} rows={4} maxLength={5000} value={String(v ?? '')}
            onChange={(e) => set(q.id, e.target.value)} placeholder="Câu trả lời" />
          <p className="mt-1 text-right text-[0.72rem] text-slate-400">{String(v ?? '').length}/5000</p>
        </div>
      );
    }
    if (q.type === 'date') return <input type="date" className={cn(inputCls, 'sm:max-w-[14rem]')} value={String(v ?? '')} onChange={(e) => set(q.id, e.target.value)} />;
    if (q.type === 'number') {
      return <input type="number" inputMode="decimal" className={cn(inputCls, 'sm:max-w-[14rem]')} value={String(v ?? '')}
        step={q.integer ? 1 : 'any'} min={q.min ?? undefined} max={q.max ?? undefined} onChange={(e) => set(q.id, e.target.value)} />;
    }
    if (q.type === 'dropdown') {
      return (
        <select className={cn(inputCls, 'sm:max-w-md')} value={String(v ?? '')} onChange={(e) => set(q.id, e.target.value)}>
          <option value="">Chọn…</option>
          {q.options?.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      );
    }
    if (q.type === 'single' || q.type === 'multi') {
      const multi = q.type === 'multi';
      const picked = multi ? ((v as string[]) ?? []) : [String(v ?? '')];
      const toggle = (oid: string) => {
        if (!multi) return set(q.id, oid);
        set(q.id, picked.includes(oid) ? picked.filter((x) => x !== oid) : [...picked, oid]);
      };
      const opts = [...(q.options ?? []), ...(q.other ? [{ id: OTHER, label: 'Khác' }] : [])];
      return (
        <div className="space-y-1.5">
          {multi && (q.min || q.max) ? <p className="text-[0.75rem] text-muted">{q.min ? `Chọn ít nhất ${q.min}` : ''}{q.min && q.max ? ', ' : ''}{q.max ? `tối đa ${q.max}` : ''}.</p> : null}
          {opts.map((o) => {
            const on = picked.includes(o.id);
            return (
              <div key={o.id}>
                <label className={cn('flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors',
                  on ? 'border-primary bg-primary-soft text-ink' : 'border-line bg-white hover:bg-slate-50')}>
                  <input type={multi ? 'checkbox' : 'radio'} name={q.id} checked={on} onChange={() => toggle(o.id)}
                    className={cn('h-4 w-4 shrink-0 accent-[#2563eb]', !multi && 'rounded-full')} />
                  <span>{o.label}</span>
                </label>
                {o.id === OTHER && on && (
                  <input className={cn(ui.input, 'mt-1.5')} autoFocus maxLength={500} placeholder="Ghi rõ…"
                    value={String(values[`${q.id}:other`] ?? '')} onChange={(e) => set(`${q.id}:other`, e.target.value)} />
                )}
              </div>
            );
          })}
        </div>
      );
    }
    // file
    const kept = savedFiles(q.id).filter((f) => keep[q.id]?.includes(f.idx));
    const fresh = newFiles[q.id] ?? [];
    const room = (q.max_files ?? 1) - kept.length - fresh.length;
    return (
      <div className="space-y-2">
        {[...kept.map((f) => ({ key: `k${f.idx}`, name: f.name, size: f.size, drop: () => setKeep((s) => ({ ...s, [q.id]: (s[q.id] ?? []).filter((x) => x !== f.idx) })) })),
          ...fresh.map((f, i) => ({ key: `n${i}`, name: f.name, size: f.size, drop: () => setNewFiles((s) => ({ ...s, [q.id]: (s[q.id] ?? []).filter((_, j) => j !== i) })) }))]
          .map((f) => (
            <div key={f.key} className={cn(subtle, 'flex items-center gap-2 px-3 py-2 text-sm')}>
              <Paperclip size={14} className="shrink-0 text-slate-400" />
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className="shrink-0 text-[0.75rem] text-slate-400">{fmtSize(f.size)}</span>
              <button type="button" onClick={f.drop} className="-m-1.5 p-1.5 text-slate-400 hover:text-danger-text" aria-label="Bỏ file"><X size={14} /></button>
            </div>
          ))}
        {room > 0 && (
          <label className={cn('flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-4 py-5 text-center text-sm transition-colors hover:border-primary hover:bg-primary-soft/40',
            err ? 'border-danger-text' : 'border-slate-300')}>
            <Upload size={18} className="text-slate-400" />
            <span className="font-medium text-primary-text">Chọn file</span>
            <span className="text-[0.75rem] text-muted">{ACCEPT_LABEL[q.accept ?? 'any']} · tối đa {q.max_files ?? 1} file · mỗi file ≤ {fmtSize(data!.form.max_file_bytes)}</span>
            <input type="file" className="hidden" multiple={(q.max_files ?? 1) > 1} accept={ACCEPT_ATTR[q.accept ?? 'any']}
              onChange={(e) => { pickFiles(q, e.target.files); e.target.value = ''; }} />
          </label>
        )}
      </div>
    );
  }

  const statusBox = reg && reg.status !== 'cancelled' && !editing && (
    <section className={ui.card}>
      <div className={ui.cardHeader}>
        <h2 className={ui.sectionTitle}><CheckCircle2 size={16} className="text-slate-500" />Đăng ký của sinh viên</h2>
        <span className={cn(badge.base, MY_STATUS_BADGE[reg.status])}>{reg.status_label}</span>
      </div>
      <div className="space-y-4 px-5 py-4">
        {reg.status === 'pending' && <div className={cn(notice.base, notice.info)}><Hourglass className={noticeIcon.info} /><p>Đã gửi lúc {hmdmy(reg.submitted_at)}. Phòng Công tác Sinh viên đang xét chọn; kết quả cập nhật tại trang này.</p></div>}
        {reg.status === 'approved' && <div className={cn(notice.base, notice.success)}><CheckCircle2 className={noticeIcon.success} /><p>Sinh viên được chọn làm cộng tác viên của sự kiện. Đề nghị có mặt đúng giờ tại địa điểm tổ chức.</p></div>}
        {reg.status === 'waitlist' && <div className={cn(notice.base, notice.warning)}><Info className={noticeIcon.warning} /><p>Sinh viên nằm trong danh sách chờ — được chọn bổ sung nếu còn chỗ.</p></div>}
        {reg.status === 'rejected' && <div className={cn(notice.base, notice.neutral)}><Info className={noticeIcon.neutral} /><p>Sinh viên không được chọn ở sự kiện này.</p></div>}
        {reg.review_note && <div className={cn(subtle, 'px-4 py-3 text-sm')}><p className="mb-0.5 text-[0.75rem] font-medium text-muted">Ghi chú của Phòng Công tác Sinh viên</p><p className="whitespace-pre-line text-ink">{reg.review_note}</p></div>}
        <div>
          {data.form.profile.map((p) => (
            <div key={p.key} className={ui.dtRow}><span className={ui.dtLabel}>{p.label}</span>
              <span className={ui.dtValue}>{(reg.answers.profile as Record<string, string> | undefined)?.[p.key] ?? p.value ?? '—'}</span></div>
          ))}
          {data.form.questions.map((q) => {
            const text = answerText(q, reg.answers);
            return (
              <div key={q.id} className={ui.dtRow}><span className={ui.dtLabel}>{q.title}</span>
                <span className={cn(ui.dtValue, 'whitespace-pre-line', !text && 'font-normal italic text-slate-400')}>{text || 'Không trả lời'}</span></div>
            );
          })}
        </div>
        {(reg.can_edit || reg.can_cancel) && (
          <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end">
            {reg.can_cancel && <button type="button" disabled={busy} onClick={cancel} className={cn(ui.btnGhost, 'text-danger-text hover:text-danger-text')}>Hủy đăng ký</button>}
            {reg.can_edit && <button type="button" disabled={busy} onClick={() => { setEditing(true); setFlash(null); setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth' }), 50); }} className={ui.btnSecondary}><Pencil size={14} />Sửa đăng ký</button>}
          </div>
        )}
      </div>
    </section>
  );

  const form = showForm && (
    <section className={ui.card} ref={formRef}>
      <div className={ui.cardHeader}>
        <h2 className={ui.sectionTitle}><FileText size={16} className="text-slate-500" />{editing ? 'Sửa đăng ký' : 'Đăng ký tham gia'}</h2>
        {data.registration_closes_at && <span className="text-[0.78rem] text-muted">Hạn {hmdmy(data.registration_closes_at)}</span>}
      </div>
      <div className="space-y-5 px-5 py-5">
        <div>
          <p className="mb-2 text-[0.82rem] font-semibold text-ink">Thông tin sinh viên</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {data.form.profile.map((p) => (
              <div key={p.key} id={`f-profile.${p.key}`} className="min-w-0">
                <label className={ui.fieldLabel}>{p.label}{p.editable && <span className="ml-0.5 text-danger-text">*</span>}</label>
                {p.editable ? (
                  <>
                    <input className={cn(ui.input, errors[`profile.${p.key}`] && 'border-danger-text')} value={profile[p.key] ?? ''}
                      inputMode={p.key === 'phone' ? 'tel' : 'email'} onChange={(e) => { setProfile((s) => ({ ...s, [p.key]: e.target.value })); setErrors((x) => ({ ...x, [`profile.${p.key}`]: '' })); }} />
                    {errors[`profile.${p.key}`] && <p className="mt-1 text-[0.78rem] text-danger-text">{errors[`profile.${p.key}`]}</p>}
                  </>
                ) : (
                  <div className={cn(subtle, 'flex h-10 items-center gap-2 px-3 text-sm text-ink')}>
                    <Lock size={12} className="shrink-0 text-slate-400" /><span className="truncate">{p.value || '—'}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="mt-2 text-[0.75rem] text-muted">Lấy từ hồ sơ sinh viên. Thông tin sai lệch: cập nhật ở mục Thông tin cá nhân.</p>
        </div>

        {data.form.questions.map((q, i) => (
          <div key={q.id} id={`f-${q.id}`} className="border-t border-line2 pt-5">
            <p className="mb-1.5 text-[0.9rem] font-semibold text-ink">{i + 1}. {q.title}{q.required && <span className="ml-0.5 text-danger-text">*</span>}</p>
            {q.note && <p className="mb-2 whitespace-pre-line border-l-[3px] border-primary-line pl-3 text-[0.8rem] text-muted">{q.note}</p>}
            {q.note_image_url && <NoteImage path={q.note_image_url} />}
            {renderInput(q)}
            {errors[q.id] && <p className="mt-1.5 flex items-center gap-1 text-[0.78rem] text-danger-text"><AlertCircle size={13} />{errors[q.id]}</p>}
          </div>
        ))}

        {formError && <div className={cn(notice.base, notice.error)}><AlertCircle className={noticeIcon.error} /><p>{formError}</p></div>}

        <div className={ui.formFooter}>
          {editing && <button type="button" className={cn(ui.btnGhost, ui.formFooterBtn)} onClick={() => { fillFrom(data); setEditing(false); }}>Thôi</button>}
          <button type="button" className={cn(ui.btnPrimary, ui.formFooterBtn)} disabled={busy} onClick={submit}>
            {busy && <Loader2 size={15} className="animate-spin" />}{editing ? 'Lưu thay đổi' : 'Gửi đăng ký'}
          </button>
        </div>
      </div>
    </section>
  );

  const closedNotice = !showForm && !(reg && reg.status !== 'cancelled') && (
    <div className={cn(notice.base, notice.neutral)}>
      <Clock className={noticeIcon.neutral} />
      <p>{!data.eligible ? 'Sinh viên không còn thuộc đối tượng được đăng ký sự kiện này.'
        : state === 'upcoming' ? `Mở nhận đăng ký lúc ${hmdmy(data.registration_opens_at)}.`
          : 'Sự kiện đã hết thời gian nhận đăng ký.'}</p>
    </div>
  );

  return (
    <div className="space-y-4">
      <Link href="/dashboard/su-kien" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft size={14} />Sự kiện cộng tác viên</Link>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <h1 className="text-xl font-semibold leading-snug text-ink">{data.title}</h1>
        {reg && reg.status !== 'cancelled'
          ? <span className={cn(badge.base, MY_STATUS_BADGE[reg.status], 'mt-1')}>{reg.status_label}</span>
          : state === 'open' && !data.ended && <span className={cn(badge.base, badge.success, 'mt-1')}>Đang nhận đăng ký</span>}
      </div>

      {flash && <div className={cn(notice.base, notice.success)}><CheckCircle2 className={noticeIcon.success} /><p>{flash}</p></div>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Điện thoại: cột tóm tắt lên trước. */}
        <aside className="space-y-4 lg:order-2">
          <section className={ui.card}>
            <div className="space-y-3.5 px-5 py-4 text-sm">
              <div className="flex gap-3"><CalendarDays size={16} className="mt-0.5 shrink-0 text-slate-400" />
                <div><p className="text-[0.75rem] text-muted">Thời gian</p><p className="font-medium text-ink">{eventRange(data)}</p>
                  <p className="text-[0.78rem] text-muted">{data.day_count} ngày</p></div></div>
              {data.location && <div className="flex gap-3"><MapPin size={16} className="mt-0.5 shrink-0 text-slate-400" />
                <div><p className="text-[0.75rem] text-muted">Địa điểm</p><p className="font-medium text-ink">{data.location}</p></div></div>}
              <div className="flex gap-3"><Clock size={16} className="mt-0.5 shrink-0 text-slate-400" />
                <div><p className="text-[0.75rem] text-muted">Nhận đăng ký</p>
                  <p className="font-medium text-ink">{hmdmy(data.registration_opens_at)} – {hmdmy(data.registration_closes_at)}</p>
                  {state === 'open' && <p className="text-[0.78rem] text-[#b45309]">{timeLeft(data.registration_closes_at)}</p>}</div></div>
              {data.capacity && <div className="flex gap-3"><Users size={16} className="mt-0.5 shrink-0 text-slate-400" />
                <div><p className="text-[0.75rem] text-muted">Số lượng cần</p><p className="font-medium text-ink">{data.capacity} sinh viên</p></div></div>}
            </div>
          </section>
        </aside>

        <div className="min-w-0 space-y-4 lg:order-1">
          {data.cover_url && <Cover path={data.cover_url} className="aspect-video w-full rounded-lg border border-line" />}
          {data.description && (
            <section className={ui.card}>
              <div className="px-5 py-4"><div className={RICH} dangerouslySetInnerHTML={{ __html: data.description }} /></div>
            </section>
          )}
          {statusBox}
          {reg?.status === 'cancelled' && !showForm && (
            <div className={cn(notice.base, notice.neutral)}><Info className={noticeIcon.neutral} /><p>Sinh viên đã hủy đăng ký sự kiện này.</p></div>
          )}
          {reg?.status === 'cancelled' && showForm && (
            <div className={cn(notice.base, notice.info)}><Info className={noticeIcon.info} /><p>Đăng ký trước đã hủy. Gửi lại form dưới đây để đăng ký lại.</p></div>
          )}
          {form}
          {closedNotice}
        </div>
      </div>
    </div>
  );
}
