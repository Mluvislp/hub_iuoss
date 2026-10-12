'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import QRCode from 'react-qr-code';
import {
  AlertCircle, CalendarClock, Check, CheckCircle2, ChevronRight, FileText, GraduationCap,
  Award, Info, Loader2, Lock, MapPin, Pencil, Plus, Upload, User,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { badge, ui } from '@/lib/ui';
import { cn } from '@/lib/utils';
import { RejectionNotice } from '@/components/rejection-notice';
import type { DiplomaLine, DiplomaState, DiplomaStatus } from '@/lib/types';

const MAX_IMAGE = 5 * 1024 * 1024;
const MAX_PDF = 10 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
// Gợi ý cho ô Nơi cấp — chữ tự do vì bằng cấp trước 2025 ghi tên tỉnh cũ.
const ISSUER_HINTS = [
  'Sở Giáo dục và Đào tạo Thành phố Hồ Chí Minh',
  'Sở Giáo dục và Đào tạo tỉnh Đồng Nai',
  'Sở Giáo dục và Đào tạo tỉnh Bình Dương',
  'Sở Giáo dục và Đào tạo tỉnh Bà Rịa – Vũng Tàu',
  'Sở Giáo dục và Đào tạo tỉnh Long An',
];

const STATUS_BADGE: Record<DiplomaStatus, string> = {
  pending: badge.warning,
  returned: badge.danger,
  approved: badge.info,
  notified: badge.info,
  received: badge.success,
};

type Field = 'phone_number' | 'citizen_id' | 'diploma_number' | 'issued_by' | 'issued_on' | 'exam_session';
type Values = Record<Field, string>;
type Errors = Partial<Record<Field | 'cccd_front' | 'diploma_pdf' | 'confirm', string>>;

const EMPTY: Values = { phone_number: '', citizen_id: '', diploma_number: '', issued_by: '', issued_on: '', exam_session: '' };

function fmtDateTime(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) + ' '
    + d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Kiểm giống `core/diploma.clean` để báo lỗi ngay trên ô; server vẫn kiểm lại. */
function validate(v: Values): Errors {
  const e: Errors = {};
  if (!/^(0|\+84)\d{9,10}$/.test(v.phone_number.replace(/[\s.-]/g, ''))) e.phone_number = 'Số điện thoại không hợp lệ.';
  if (!/^\d{12}$/.test(v.citizen_id.replace(/\s/g, ''))) e.citizen_id = 'Số CCCD gồm 12 chữ số.';
  if (!/^[A-Z0-9][A-Z0-9/.-]{3,31}$/.test(v.diploma_number.replace(/\s/g, '').toUpperCase())) {
    e.diploma_number = 'Số hiệu văn bằng gồm 4–32 ký tự chữ, số, "/", "-" (ghi đúng như trên bằng).';
  }
  if (v.issued_by.trim().length < 3) e.issued_by = 'Vui lòng nhập nơi cấp, ghi đúng như trên bằng.';
  const year = v.exam_session.match(/(19[5-9]\d|20\d\d)/)?.[1];
  if (!year || v.exam_session.trim().length > 32) e.exam_session = 'Khóa thi phải có năm (VD: 2025 hoặc 26/06/2025).';
  if (!v.issued_on) e.issued_on = 'Vui lòng chọn ngày cấp.';
  else if (v.issued_on > new Date().toISOString().slice(0, 10)) e.issued_on = 'Ngày cấp không thể ở tương lai.';
  else if (year && Number(v.issued_on.slice(0, 4)) < Number(year)) e.issued_on = 'Ngày cấp không thể trước năm của khóa thi.';
  return e;
}

/** File riêng tư cần token: tải về blob rồi dựng object URL. */
function usePrivateFile(url?: string | null) {
  const [src, setSrc] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!url) { setSrc(''); return; }
    let alive = true;
    let objectUrl = '';
    setError('');
    api.diploma.file(url).then((blob) => {
      if (!alive) return;
      objectUrl = URL.createObjectURL(blob);
      setSrc(objectUrl);
    }).catch((e: Error) => { if (alive) setError(e.message); });
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);
  return { src, error };
}

function Lines({ lines }: { lines: DiplomaLine[] }) {
  return (
    <div className="space-y-1.5 text-sm leading-relaxed">
      {lines.map((l, i) => l.bullet ? (
        <div key={i} className="flex gap-2 pl-1">
          <span className="mt-[0.55em] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-current opacity-70" />
          <span>{l.text}</span>
        </div>
      ) : <p key={i}>{l.text}</p>)}
    </div>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p data-field-error className="mt-1 text-xs text-danger-text">{message}</p>;
}

/** Bốn bước của quy trình; bước hiện tại tô đậm, bước bị trả về tô đỏ. */
function Steps({ status }: { status: DiplomaStatus | null }) {
  const steps = ['Nộp hồ sơ online', 'Phòng CTSV duyệt', 'Nhận thư hẹn', 'Nộp bằng gốc'];
  const done = status === null ? 0
    : status === 'pending' || status === 'returned' ? 1
    : status === 'approved' ? 2 : status === 'notified' ? 3 : 4;
  return (
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {steps.map((label, i) => {
        const finished = i < done;
        const current = i === done;
        const failed = status === 'returned' && i === 1;
        return (
          <li key={label} className={cn('flex items-center gap-2 rounded-lg border px-3 py-2 text-[0.8rem]',
            failed ? 'border-danger-line bg-danger-soft text-danger-text'
              : finished ? 'border-success-line bg-success-soft text-success-text'
              : current ? 'border-primary-line bg-primary-soft font-semibold text-primary-text'
              : 'border-line bg-white text-muted')}>
            <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[0.7rem] font-bold',
              finished ? 'bg-success-text text-white' : failed ? 'bg-danger-text text-white' : 'border border-current')}>
              {finished ? <Check size={12} /> : i + 1}
            </span>
            <span className="min-w-0">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

export default function DiplomaPage() {
  const [state, setState] = useState<DiplomaState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [values, setValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [cccdFile, setCccdFile] = useState<File | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [editing, setEditing] = useState(false);
  // SĐT/CCCD đã có trong hồ sơ thì khóa, bấm "Sửa" mới mở — cùng cách form BHYT.
  const [contactEditable, setContactEditable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const requestKey = useRef<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const apply = useCallback((s: DiplomaState) => {
    const sub = s.submission;
    setState(s);
    setValues(sub ? {
      phone_number: sub.phone_number, citizen_id: sub.citizen_id, diploma_number: sub.diploma_number,
      issued_by: sub.issued_by, issued_on: sub.issued_on, exam_session: sub.exam_session,
    } : { ...EMPTY, phone_number: s.profile.phone_number, citizen_id: s.profile.citizen_id });
    setCccdFile(null);
    setPdfFile(null);
    setConfirm(false);
    setErrors({});
    setEditing(false);
    setContactEditable(false);
  }, []);

  useEffect(() => {
    api.diploma.state()
      .then(apply)
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : 'Không tải được dữ liệu.'))
      .finally(() => setLoading(false));
  }, [apply]);

  const sub = state?.submission ?? null;
  const cccdUrl = sub ? sub.cccd_front_url : state?.cccd_image?.url;
  const cccdPreview = usePrivateFile(cccdFile ? null : cccdUrl);
  const [localCccd, setLocalCccd] = useState('');
  useEffect(() => {
    if (!cccdFile) { setLocalCccd(''); return; }
    const url = URL.createObjectURL(cccdFile);
    setLocalCccd(url);
    return () => URL.revokeObjectURL(url);
  }, [cccdFile]);

  if (loading) {
    return <div className="flex h-64 justify-center text-muted"><Loader2 size={26} className="mt-10 animate-spin" /></div>;
  }
  if (!state) {
    return (
      <div className="flex items-start gap-2.5 rounded-lg border border-danger-line bg-danger-soft px-4 py-3 text-sm text-danger-text">
        <AlertCircle size={16} className="mt-0.5 shrink-0" /> {loadError}
      </div>
    );
  }

  const round = state.round;
  const formOpen = sub ? editing : state.can_submit;
  const profile = state.profile;
  const contactLocked = (field: 'phone_number' | 'citizen_id') =>
    !formOpen || (!sub && !!profile[field] && !contactEditable);

  const set = (field: Field) => (e: React.ChangeEvent<HTMLInputElement>) => {
    requestKey.current = null;
    setValues((v) => ({ ...v, [field]: e.target.value }));
    setErrors((er) => ({ ...er, [field]: undefined }));
  };

  const pickCccd = (file?: File) => {
    requestKey.current = null;
    if (!file) return;
    if (!IMAGE_TYPES.includes(file.type) && !/\.(heic|heif)$/i.test(file.name)) {
      setErrors((er) => ({ ...er, cccd_front: 'Chỉ nhận ảnh JPG, PNG, WEBP, HEIC.' }));
      return;
    }
    if (file.size > MAX_IMAGE) { setErrors((er) => ({ ...er, cccd_front: 'Ảnh tối đa 5 MB.' })); return; }
    setErrors((er) => ({ ...er, cccd_front: undefined }));
    setCccdFile(file);
  };
  const pickPdf = (file?: File) => {
    requestKey.current = null;
    if (!file) return;
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
      setErrors((er) => ({ ...er, diploma_pdf: 'Chỉ nhận file PDF.' }));
      return;
    }
    if (file.size > MAX_PDF) { setErrors((er) => ({ ...er, diploma_pdf: 'File PDF tối đa 10 MB.' })); return; }
    setErrors((er) => ({ ...er, diploma_pdf: undefined }));
    setPdfFile(file);
  };

  const scrollToError = () => setTimeout(() => {
    formRef.current?.querySelector('[data-field-error]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 50);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setNotice('');
    const found = validate(values);
    if (!sub && !cccdFile && !state.cccd_image) found.cccd_front = 'Vui lòng tải lên ảnh CCCD mặt trước.';
    if (!sub && !pdfFile) found.diploma_pdf = 'Vui lòng tải lên bản scan bằng tốt nghiệp (PDF).';
    if (!confirm) found.confirm = 'Vui lòng tích ô cam kết.';
    setErrors(found);
    if (Object.values(found).some(Boolean)) { scrollToError(); return; }

    const fd = new FormData();
    (Object.keys(values) as Field[]).forEach((k) => fd.append(k, values[k]));
    fd.append('confirm', 'true');
    if (cccdFile) fd.append('cccd_front', cccdFile);
    if (pdfFile) fd.append('diploma_pdf', pdfFile);
    if (sub) fd.append('row_version', String(sub.row_version));
    requestKey.current ??= crypto.randomUUID();
    fd.set('request_key', requestKey.current);
    const resubmit = sub?.status === 'returned';
    setSaving(true);
    try {
      const fresh = await api.diploma.submit(fd);
      requestKey.current = null;
      apply(fresh);
      setNotice(!sub ? 'Đã nộp hồ sơ. Phòng CTSV sẽ kiểm tra và báo kết quả qua email trường.'
        : resubmit ? 'Đã gửi lại hồ sơ. Phòng CTSV sẽ kiểm tra lại.' : 'Đã lưu thay đổi.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      if (err instanceof ApiError && err.data.errors && typeof err.data.errors === 'object') {
        setErrors(err.data.errors as Errors);
        scrollToError();
      }
      setFormError(err instanceof ApiError ? err.message : 'Đã có lỗi xảy ra, vui lòng thử lại.');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = (locked: boolean, error?: string) => cn(ui.input, locked && 'bg-slate-50 text-slate-500',
    error && 'border-red-500 bg-red-50/30 focus:border-red-500 focus:ring-red-500');
  const cccdSrc = localCccd || cccdPreview.src;

  return (
    <div className="mx-auto max-w-4xl space-y-5 sm:space-y-6">
      <nav className="flex items-center gap-1.5 text-[0.82rem] text-muted" aria-label="Breadcrumb">
        <Link href="/dashboard" className="hover:text-ink">Bảng thông tin</Link>
        <ChevronRight size={14} className="text-slate-400" />
        <span className="font-medium text-ink">Nộp bằng tốt nghiệp THPT</span>
      </nav>

      <div className="rounded-lg border border-primary-line bg-primary-soft p-4 text-primary-text sm:p-5">
        <h1 className="flex items-start gap-2 text-base font-bold sm:text-lg">
          <GraduationCap size={20} className="mt-0.5 shrink-0" />
          <span>Nộp bằng tốt nghiệp THPT{round ? ` — ${round.title}` : ''}</span>
        </h1>
        {round?.description_lines.length ? <div className="mt-3"><Lines lines={round.description_lines} /></div> : (
          <p className="mt-2 text-sm">
            Khai thông tin văn bằng và tải bản scan PDF. Sau khi Phòng CTSV duyệt, bạn sẽ nhận email hẹn
            mang <strong>bằng gốc</strong> tới nộp.
          </p>
        )}
        {round && !sub && (
          <p className="mt-3 flex items-center gap-1.5 text-xs">
            <CalendarClock size={14} /> Nhận hồ sơ: {fmtDateTime(round.opens_at)} – {fmtDateTime(round.closes_at)}
          </p>
        )}
      </div>

      <Steps status={sub?.status ?? null} />

      {notice && (
        <div role="status" className="flex items-start gap-2.5 rounded-lg border border-success-line bg-success-soft px-4 py-3 text-sm text-success-text">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> {notice}
        </div>
      )}

      {!sub && !state.can_submit && (
        <p className="flex items-center gap-2 rounded-lg border border-line bg-white px-4 py-3 text-sm text-muted">
          <Lock size={15} className="shrink-0" /> {state.closed_message || 'Hiện không nhận hồ sơ.'}
        </p>
      )}

      {sub && (
        <section className={ui.card}>
          <div className={cn(ui.cardHeader, 'flex-wrap')}>
            <h2 className={ui.sectionTitle}><FileText size={16} className="text-primary" /> Hồ sơ đã nộp</h2>
            <span className={cn(badge.base, STATUS_BADGE[sub.status])}>{sub.status_label}</span>
          </div>
          <div className="space-y-4 p-4 sm:p-5">
            <p className="text-xs text-muted">Nộp lúc {fmtDateTime(sub.created_at)} · Cập nhật lúc {fmtDateTime(sub.updated_at)}</p>
            {sub.status === 'pending' && (
              <p className="text-sm text-slate-700">Phòng CTSV đang kiểm tra hồ sơ online. Kết quả sẽ gửi qua email trường <strong>{sub.university_email || 'của bạn'}</strong>.</p>
            )}
            {sub.status === 'returned' && (
              <RejectionNotice eyebrow="Hồ sơ cần sửa lại" title="Vui lòng sửa theo phản hồi rồi gửi lại" note={sub.review_note} />
            )}
            {(sub.status === 'approved' || sub.status === 'notified') && (
              <div className="grid gap-4 rounded-lg border border-primary-line bg-primary-soft p-4 text-primary-text sm:grid-cols-[1fr_auto]">
                <div className="min-w-0 space-y-2">
                  <p className="font-semibold">
                    {sub.status === 'notified' ? 'Mời bạn mang bằng tốt nghiệp THPT bản gốc tới nộp' : 'Hồ sơ online đã được duyệt'}
                  </p>
                  {sub.status === 'approved' && <p className="text-sm">Bạn sẽ nhận email hẹn thời gian, địa điểm nộp bản gốc trong thời gian tới.</p>}
                  {round?.original_note_lines.length ? (
                    <div className="flex gap-2"><MapPin size={16} className="mt-0.5 shrink-0" /><Lines lines={round.original_note_lines} /></div>
                  ) : null}
                  <p className="text-sm">Khi tới nơi, đọc <strong>MSSV</strong> hoặc đưa mã QR bên cạnh để cán bộ tìm hồ sơ. Nhớ mang theo CCCD.</p>
                </div>
                <div className="flex flex-col items-center gap-1.5 justify-self-center rounded-lg bg-white p-3">
                  <QRCode value={sub.student_code} size={112} />
                  <span className="font-mono text-sm font-semibold tracking-wide text-ink">{sub.student_code}</span>
                </div>
              </div>
            )}
            {sub.status === 'received' && (
              <div className="flex items-start gap-2.5 rounded-lg border border-success-line bg-success-soft px-4 py-3 text-sm text-success-text">
                <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
                Phòng CTSV đã nhận bằng gốc của bạn lúc {fmtDateTime(sub.received_at)}. Hồ sơ đã hoàn tất.
              </div>
            )}
            {state.can_edit && !editing && (
              <button type="button" onClick={() => { setNotice(''); setEditing(true); }} className={ui.btnPrimary}>
                <Pencil size={15} /> {sub.status === 'returned' ? 'Sửa và gửi lại hồ sơ' : 'Chỉnh sửa hồ sơ'}
              </button>
            )}
          </div>
        </section>
      )}

      {formError && (
        <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-danger-line bg-danger-soft px-4 py-3 text-sm text-danger-text">
          <AlertCircle size={16} className="mt-0.5 shrink-0" /> {formError}
        </div>
      )}

      {(sub || state.can_submit) && (
        <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-5 sm:space-y-6">
          <fieldset disabled={saving || !formOpen} className={cn('min-w-0 space-y-5 sm:space-y-6', saving && 'opacity-60')}>
            <section className={ui.card}>
              <div className={ui.cardHeader}>
                <h2 className={ui.sectionTitle}><User size={16} className="text-primary" /> Thông tin sinh viên</h2>
                {formOpen && !sub && (profile.phone_number || profile.citizen_id) && (
                  <span role="button" tabIndex={0} onClick={() => {
                    if (contactEditable) setValues((v) => ({ ...v, phone_number: profile.phone_number, citizen_id: profile.citizen_id }));
                    setContactEditable(!contactEditable);
                  }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setContactEditable(!contactEditable); } }}
                  className="inline-flex cursor-pointer select-none items-center gap-1 text-xs font-medium text-primary hover:underline">
                    <Pencil size={12} /> {contactEditable ? 'Hủy sửa' : 'Sửa SĐT / CCCD'}
                  </span>
                )}
              </div>
              <div className="grid gap-4 p-4 sm:grid-cols-2 sm:gap-5 sm:p-5">
                {([['Họ và tên', sub?.full_name ?? profile.full_name], ['Mã số sinh viên', sub?.student_code ?? profile.student_code],
                  ['Email trường', sub?.university_email ?? profile.university_email]] as const).map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <label className={ui.fieldLabel}>{label}</label>
                    <input value={value || 'Chưa có trong hồ sơ'} readOnly disabled className={inputCls(true)} />
                  </div>
                ))}
                <div className="min-w-0">
                  <label htmlFor="phone_number" className={ui.fieldLabel}>Số điện thoại *</label>
                  <input id="phone_number" inputMode="tel" value={values.phone_number} onChange={set('phone_number')}
                    disabled={contactLocked('phone_number')} className={inputCls(contactLocked('phone_number'), errors.phone_number)} />
                  <FieldError message={errors.phone_number} />
                </div>
                <div className="min-w-0">
                  <label htmlFor="citizen_id" className={ui.fieldLabel}>Số CCCD *</label>
                  <input id="citizen_id" inputMode="numeric" maxLength={12} value={values.citizen_id} onChange={set('citizen_id')}
                    disabled={contactLocked('citizen_id')} className={inputCls(contactLocked('citizen_id'), errors.citizen_id)} />
                  <FieldError message={errors.citizen_id} />
                </div>
                <div className="min-w-0 sm:col-span-2">
                  <label className={ui.fieldLabel}>Ảnh CCCD mặt trước *
                    {!sub && state.cccd_image && !cccdFile && <span className="ml-1.5 text-xs font-normal text-muted">(lấy từ ảnh bạn đã nộp trước đây)</span>}
                  </label>
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,18rem)_1fr] sm:items-start">
                    {cccdSrc ? (
                      <a href={cccdSrc} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-line bg-slate-50">
                        <img src={cccdSrc} alt="CCCD mặt trước" className="h-40 w-full object-contain" />
                      </a>
                    ) : (
                      <label className={cn('relative flex h-40 flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed text-center text-sm',
                        errors.cccd_front ? 'border-red-500 bg-red-50' : 'border-slate-300', formOpen ? 'cursor-pointer hover:bg-slate-50' : 'bg-slate-50')}>
                        {formOpen && <input type="file" accept="image/*" onChange={(e) => pickCccd(e.target.files?.[0])} className="absolute inset-0 cursor-pointer opacity-0" />}
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-500"><Plus size={20} /></span>
                        <span className="font-medium text-slate-700">{cccdPreview.error || 'Tải lên mặt trước CCCD'}</span>
                        <span className="text-xs text-slate-500">JPG, PNG, HEIC · tối đa 5 MB</span>
                      </label>
                    )}
                    {cccdSrc && formOpen && (
                      <label className={cn(ui.btnOutline, 'relative h-9 cursor-pointer self-start overflow-hidden px-3 text-xs')}>
                        <input type="file" accept="image/*" onChange={(e) => pickCccd(e.target.files?.[0])} className="absolute inset-0 cursor-pointer opacity-0" />
                        <Upload size={14} /> {cccdFile ? cccdFile.name : 'Thay ảnh khác'}
                      </label>
                    )}
                  </div>
                  <FieldError message={errors.cccd_front} />
                </div>
              </div>
            </section>

            <section className={ui.card}>
              <div className={ui.cardHeader}>
                <h2 className={ui.sectionTitle}><Award size={16} className="text-primary" /> Thông tin bằng tốt nghiệp THPT</h2>
              </div>
              <div className="grid gap-4 p-4 sm:grid-cols-2 sm:gap-5 sm:p-5">
                <div className="min-w-0">
                  <label htmlFor="diploma_number" className={ui.fieldLabel}>Số hiệu văn bằng *</label>
                  <input id="diploma_number" value={values.diploma_number} onChange={set('diploma_number')} autoComplete="off"
                    placeholder="Ghi đúng như trên bằng" className={inputCls(!formOpen, errors.diploma_number)} />
                  <FieldError message={errors.diploma_number} />
                </div>
                <div className="min-w-0">
                  <label htmlFor="exam_session" className={ui.fieldLabel}>Khóa thi *</label>
                  <input id="exam_session" value={values.exam_session} onChange={set('exam_session')} maxLength={32}
                    placeholder="VD: 2025 hoặc 26/06/2025" className={inputCls(!formOpen, errors.exam_session)} />
                  <FieldError message={errors.exam_session} />
                </div>
                <div className="min-w-0">
                  <label htmlFor="issued_by" className={ui.fieldLabel}>Nơi cấp *</label>
                  <input id="issued_by" list="diploma-issuers" value={values.issued_by} onChange={set('issued_by')} maxLength={255}
                    placeholder="VD: Sở Giáo dục và Đào tạo TP. Hồ Chí Minh" className={inputCls(!formOpen, errors.issued_by)} />
                  <datalist id="diploma-issuers">{ISSUER_HINTS.map((h) => <option key={h} value={h} />)}</datalist>
                  <FieldError message={errors.issued_by} />
                </div>
                <div className="min-w-0">
                  <label htmlFor="issued_on" className={ui.fieldLabel}>Ngày cấp *</label>
                  <input id="issued_on" type="date" value={values.issued_on} onChange={set('issued_on')}
                    className={inputCls(!formOpen, errors.issued_on)} />
                  <FieldError message={errors.issued_on} />
                </div>
                <div className="min-w-0 sm:col-span-2">
                  <label className={ui.fieldLabel}>Bản scan bằng tốt nghiệp (PDF) *</label>
                  <div className={cn('flex flex-col gap-3 rounded-lg border-2 border-dashed p-4 sm:flex-row sm:items-center',
                    errors.diploma_pdf ? 'border-red-500 bg-red-50' : 'border-slate-300')}>
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-500"><FileText size={20} /></span>
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="truncate font-medium text-slate-700">
                        {pdfFile ? pdfFile.name : sub ? sub.diploma_pdf_name : 'Chưa chọn file'}
                      </p>
                      <p className="text-xs text-slate-500">Chỉ nhận PDF · tối đa 10 MB · scan rõ cả mặt có số hiệu văn bằng</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {sub && !pdfFile && <PdfLink url={sub.diploma_pdf_url} />}
                      {formOpen && (
                        <label className={cn(ui.btnOutline, 'relative h-9 cursor-pointer overflow-hidden px-3 text-xs')}>
                          <input type="file" accept="application/pdf,.pdf" onChange={(e) => pickPdf(e.target.files?.[0])} className="absolute inset-0 cursor-pointer opacity-0" />
                          <Upload size={14} /> {sub || pdfFile ? 'Chọn file khác' : 'Chọn file PDF'}
                        </label>
                      )}
                    </div>
                  </div>
                  <FieldError message={errors.diploma_pdf} />
                </div>
              </div>
            </section>

            {formOpen && (
              <section className={cn(ui.card, 'space-y-4 p-4 sm:p-5')}>
                <label className={cn('flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm',
                  errors.confirm ? 'border-red-500 bg-red-50' : 'border-line')}>
                  <input type="checkbox" checked={confirm} onChange={(e) => { setConfirm(e.target.checked); setErrors((er) => ({ ...er, confirm: undefined })); }}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-primary" />
                  <span>{state.consent_text}</span>
                </label>
                <FieldError message={errors.confirm} />
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  {sub && (
                    <button type="button" onClick={() => apply(state)} className={ui.btnGhost}>Hủy</button>
                  )}
                  <button type="submit" className={ui.btnPrimary}>
                    {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                    {!sub ? 'Nộp hồ sơ' : sub.status === 'returned' ? 'Gửi lại hồ sơ' : 'Lưu thay đổi'}
                  </button>
                </div>
              </section>
            )}
          </fieldset>
          {formOpen && !sub && (
            <p className="flex items-start gap-2 text-xs text-muted">
              <Info size={14} className="mt-0.5 shrink-0" />
              Họ tên, MSSV và email lấy từ hồ sơ sinh viên. Nếu sai, vui lòng liên hệ Phòng CTSV.
            </p>
          )}
        </form>
      )}
    </div>
  );
}

/** Span role="button" thay vì <button>: nằm trong <fieldset disabled> lúc chỉ xem mà vẫn phải bấm được. */
function PdfLink({ url }: { url: string }) {
  const [busy, setBusy] = useState(false);
  const open = async () => {
    if (busy) return;
    setBusy(true);
      // Mở tab trước khi await để trình duyệt không chặn popup.
      const tab = window.open('', '_blank');
      try {
        const blob = await api.diploma.file(url);
        const objectUrl = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
        if (tab) tab.location.href = objectUrl; else window.location.href = objectUrl;
        setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      } catch {
        tab?.close();
      } finally {
        setBusy(false);
      }
  };
  return (
    <span role="button" tabIndex={0} aria-disabled={busy} onClick={open}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void open(); } }}
      className={cn(ui.btnSecondary, 'h-9 cursor-pointer text-xs', busy && 'opacity-60')}>
      <FileText size={14} /> Xem bản đã nộp
    </span>
  );
}
