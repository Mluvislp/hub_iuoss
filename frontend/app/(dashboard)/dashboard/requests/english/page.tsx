'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, ArrowLeft, Check, AlertCircle, Loader2, Info, FileText } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ui } from '@/lib/ui';
import type { EnglishFormData } from '@/lib/types';
import { RequestConsent, ConsentGate, CONSENT_REQUIRED_MSG } from '@/components/request-consent';
import { ReadonlyField, EditableField } from '@/components/editable-field';
import { validateDob } from '@/lib/form-validators';

// Mốc nhập học / ra trường thuộc NHÓM CỨNG — chỉ xem.
type FieldKey = 'dob';
const FIELD_KEYS: FieldKey[] = ['dob'];

type FErr = Partial<Record<FieldKey | 'purpose_code' | 'program_name', string>>;

export default function EnglishRequestPage() {
  const [form, setForm] = useState<EnglishFormData | null>(null);
  const [loadError, setLoadError] = useState('');

  const [values, setValues] = useState<Record<FieldKey, string>>({ dob: '' });
  const [openFields, setOpenFields] = useState<Record<FieldKey, boolean>>({ dob: false });
  const [purposeCode, setPurposeCode] = useState('');
  const [programName, setProgramName] = useState('');
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FErr>({});

  useEffect(() => {
    api.requests.englishForm()
      .then((data) => {
        const pf = data.prefill;
        setForm(data);
        setValues({ dob: pf.dob });
        setOpenFields({ dob: !pf.dob.trim() });
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Không tải được thông tin sinh viên.'));
  }, []);

  const isProgram = !!form && purposeCode === form.program_purpose_code;

  function setValue(key: FieldKey, v: string) {
    setValues((s) => ({ ...s, [key]: v }));
    setFieldErrors((f) => ({ ...f, [key]: undefined }));
  }
  function openField(key: FieldKey) { setOpenFields((s) => ({ ...s, [key]: true })); }
  function cancelField(key: FieldKey, originals: Record<FieldKey, string>) {
    setValues((s) => ({ ...s, [key]: originals[key] }));
    setFieldErrors((f) => ({ ...f, [key]: undefined }));
    setOpenFields((s) => ({ ...s, [key]: false }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!confirmed) { setError(CONSENT_REQUIRED_MSG); return; }
    if (!form) return;
    const pf = form.prefill;
    const errs: FErr = {};
    const de = validateDob(values.dob); if (de) errs.dob = de;
    if (!purposeCode) errs.purpose_code = 'Vui lòng chọn mục đích.';
    if (isProgram && !programName.trim()) errs.program_name = 'Vui lòng nhập tên chương trình.';
    setFieldErrors(errs);
    if (Object.keys(errs).length) { setError('Vui lòng kiểm tra lại các trường được đánh dấu.'); return; }
    setError('');
    setLoading(true);
    try {
      await api.requests.createEnglish({
        dob: values.dob.trim(),
        purpose_code: purposeCode,
        program_name: isProgram ? programName.trim() : undefined,
        note: note.trim() || undefined,
      });
      setSuccess(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gửi yêu cầu thất bại. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  }

  if (loadError) {
    return (
      <div className="max-w-[760px]">
        <div className="flex items-start gap-2.5 px-4 py-3 rounded-lg bg-danger-soft border border-danger-line text-danger-text text-sm">
          <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />{loadError}
        </div>
      </div>
    );
  }
  if (!form) {
    return <div className="flex items-center justify-center py-20 text-muted"><Loader2 size={22} className="animate-spin mr-2" /> Đang tải…</div>;
  }

  if (success) {
    return (
      <div className="max-w-[760px]">
        <div className={cn(ui.card, 'p-8 text-center')}>
          <div className="w-11 h-11 rounded-full bg-success-soft border border-success-line flex items-center justify-center mx-auto mb-4">
            <Check size={22} className="text-success-text" />
          </div>
          <h2 className="text-lg font-semibold text-ink">Đã gửi yêu cầu</h2>
          <p className="text-sm text-muted mt-2">Phòng CTSV sẽ phản hồi trong thời gian sớm nhất.</p>
          <div className="mt-6"><Link href="/dashboard" className={ui.btnPrimary}>Về Bảng thông tin</Link></div>
        </div>
      </div>
    );
  }

  const p = form.prefill;
  const originals: Record<FieldKey, string> = { dob: p.dob };
  const lockable: Record<FieldKey, boolean> = { dob: !!p.dob.trim() };
  const editCount = FIELD_KEYS.filter((k) => values[k].trim() !== originals[k].trim()).length;

  return (
    <div className="max-w-[760px] space-y-4">
      <nav className="flex items-center gap-1.5 text-[0.82rem] text-muted">
        <Link href="/dashboard" className="hover:text-ink">Bảng thông tin</Link>
        <ChevronRight size={14} className="text-slate-400" />
        <Link href="/dashboard/requests/new" className="hover:text-ink">Yêu cầu giấy tờ</Link>
        <ChevronRight size={14} className="text-slate-400" />
        <span className="text-ink font-medium">Xác nhận (mẫu tiếng Anh)</span>
      </nav>

      <div className={cn(ui.card, 'border-t-2 border-t-primary')}>
        <div className="px-6 py-5 border-b border-line">
          <h1 className="flex items-center gap-2 text-[1.05rem] font-semibold text-ink">
            <FileText size={17} className="text-primary" />
            Giấy xác nhận sinh viên — Mẫu tiếng Anh
          </h1>
          <p className="text-sm text-muted mt-1">
            Giấy được lập bằng tiếng Anh. Thông tin lấy từ hồ sơ; chọn mục đích và kiểm tra ngày sinh rồi gửi.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-6">
          {error && (
            <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-lg bg-danger-soft border border-danger-line text-danger-text text-sm">
              <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />{error}
            </div>
          )}

          {/* Thông tin chỉ xem */}
          <div>
            <h2 className="text-[0.82rem] font-semibold text-muted mb-2.5">Thông tin sinh viên</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              <ReadonlyField label="Họ và tên (không dấu)" value={p.student_name} />
              <ReadonlyField label="Mã số sinh viên" value={p.student_id} />
              <ReadonlyField label="Trạng thái (Status)" value={p.cur_status_en} />
              <ReadonlyField label="Đơn vị (School / Department)" value={p.academic_unit_label} />
              <ReadonlyField label="Thời gian nhập học" value={p.start_label} />
              <ReadonlyField label="Ra trường đúng tiến độ" value={p.graduation_label} />
            </div>
          </div>

          {/* Mục đích — chọn từ danh sách tiếng Anh */}
          <div>
            <label className={ui.fieldLabel}>Mục đích (Purpose) <span className="text-red-500">*</span></label>
            <select
              value={purposeCode}
              onChange={(e) => { setPurposeCode(e.target.value); setFieldErrors((f) => ({ ...f, purpose_code: undefined, program_name: undefined })); }}
              className={cn(ui.input, fieldErrors.purpose_code && 'border-danger-line focus:border-danger-line focus:ring-red-100')}
            >
              <option value="">— Chọn mục đích —</option>
              {form.purpose_choices.map((c) => (
                <option key={c.code} value={c.code}>{c.label}</option>
              ))}
            </select>
            {fieldErrors.purpose_code && <p className="mt-1 text-[0.75rem] text-danger-text">{fieldErrors.purpose_code}</p>}

            {isProgram && (
              <div className="mt-3">
                <label className={ui.fieldLabel}>Tên chương trình (Program name) <span className="text-red-500">*</span></label>
                <input
                  type="text" value={programName} maxLength={255}
                  onChange={(e) => { setProgramName(e.target.value); setFieldErrors((f) => ({ ...f, program_name: undefined })); }}
                  placeholder="Ví dụ: Master of Computer Science"
                  className={cn(ui.input, fieldErrors.program_name && 'border-danger-line focus:border-danger-line focus:ring-red-100')}
                />
                {fieldErrors.program_name && <p className="mt-1 text-[0.75rem] text-danger-text">{fieldErrors.program_name}</p>}
              </div>
            )}
          </div>

          {/* Thông tin có thể cập nhật */}
          <div>
            <h2 className="text-[0.82rem] font-semibold text-muted mb-2.5">Thông tin có thể cập nhật</h2>
            <div className="grid sm:grid-cols-2 gap-x-3 gap-y-4">
              <EditableField
                label="Ngày sinh" kind="date"
                value={values.dob} original={originals.dob}
                open={openFields.dob} lockable={lockable.dob}
                error={fieldErrors.dob} maxLength={10}
                onChange={(v) => setValue('dob', v)}
                onOpen={() => openField('dob')}
                onCancel={() => cancelField('dob', originals)}
              />
            </div>
            <p className="mt-3 text-[0.78rem] text-muted leading-relaxed">
              Thông tin đã có trong hồ sơ được khóa sẵn — bấm <strong className="font-medium text-ink">Yêu cầu chỉnh sửa</strong> nếu cần sửa.
              Nội dung sửa sẽ được Phòng CTSV duyệt trước khi in lên giấy.
            </p>
          </div>

          {/* Ghi chú */}
          <div>
            <label className={ui.fieldLabel}>Ghi chú thêm <span className="text-muted font-normal">(không bắt buộc)</span></label>
            <textarea
              value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000}
              placeholder="Số bản in, yêu cầu đặc biệt…" className={ui.textarea}
            />
          </div>

          {/* Cam đoan — chưa tích thì chưa hiện nút gửi */}
          <RequestConsent
            checked={confirmed}
            editCount={editCount}
            onChange={(v) => { setConfirmed(v); if (v) setError(''); }}
          />

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-line -mx-6 px-6 -mb-5 pb-5">
            <Link href="/dashboard/requests/new" className={ui.btnGhost}>
              <ArrowLeft size={15} /> Quay lại
            </Link>
            <ConsentGate checked={confirmed}>
              <button type="submit" disabled={loading} className={ui.btnPrimary}>
                {loading && <Loader2 size={15} className="animate-spin" />}
                {loading ? 'Đang gửi…' : 'Gửi yêu cầu'}
              </button>
            </ConsentGate>
          </div>
        </form>
      </div>

      <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-slate-50 border-l-2 border-primary">
        <Info size={16} className="text-primary flex-shrink-0 mt-0.5" />
        <p className="text-[0.85rem] text-slate-600 leading-relaxed">
          Thời gian xử lý: <strong className="text-ink font-medium">3–4 ngày làm việc</strong>.
        </p>
      </div>
    </div>
  );
}
