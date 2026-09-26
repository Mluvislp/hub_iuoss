'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, ArrowLeft, Check, AlertCircle, Loader2, Info, FileText } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ui } from '@/lib/ui';
import type { OtherRequestFormData } from '@/lib/types';
import { RequestConsent, ConsentGate, CONSENT_REQUIRED_MSG } from '@/components/request-consent';
import { ReadonlyField, EditableField } from '@/components/editable-field';
import { validateDob, validateCccd } from '@/lib/form-validators';

const CCCD12 = /^\d{12}$/;

// Hai ô sinh viên có thể xin sửa. Giữ trùng key với payload.editable của backend.
// Niên khóa / thời gian đào tạo tối đa thuộc NHÓM CỨNG — chỉ xem.
type FieldKey = 'dob' | 'citizen_id';
const FIELD_KEYS: FieldKey[] = ['dob', 'citizen_id'];

type FieldErrors = Partial<Record<FieldKey | 'program_name', string>>;

export default function OtherRequestPage() {
  const [form, setForm] = useState<OtherRequestFormData | null>(null);
  const [loadError, setLoadError] = useState('');

  const [purposeCode, setPurposeCode] = useState('');
  const [programName, setProgramName] = useState('');
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  const [values, setValues] = useState<Record<FieldKey, string>>({ dob: '', citizen_id: '' });
  const [openFields, setOpenFields] = useState<Record<FieldKey, boolean>>({ dob: false, citizen_id: false });

  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  useEffect(() => {
    api.requests.otherForm()
      .then((data) => {
        const pf = data.prefill;
        setForm(data);
        setValues({ dob: pf.dob, citizen_id: pf.citizen_id });
        // Hồ sơ trống thì không có gì để khóa → mở sẵn. CCCD không đủ 12 số
        // cũng mở sẵn vì backend buộc phải nhập mới.
        setOpenFields({
          dob: !pf.dob.trim(),
          citizen_id: !CCCD12.test(pf.citizen_id.trim()),
        });
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Không tải được thông tin sinh viên.'));
  }, []);

  const isProgram = form ? purposeCode === form.program_purpose_code : false;
  const cccdMustRenew = form ? !CCCD12.test(form.prefill.citizen_id.trim()) : false;

  function setValue(key: FieldKey, v: string) {
    setValues((s) => ({ ...s, [key]: v }));
    setFieldErrors((f) => ({ ...f, [key]: undefined }));
  }

  function openField(key: FieldKey) {
    setOpenFields((s) => ({ ...s, [key]: true }));
  }

  function cancelField(key: FieldKey, originals: Record<FieldKey, string>) {
    setValues((s) => ({ ...s, [key]: originals[key] }));
    setFieldErrors((f) => ({ ...f, [key]: undefined }));
    setOpenFields((s) => ({ ...s, [key]: false }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    const pf = form.prefill;

    if (!confirmed) {
      setError(CONSENT_REQUIRED_MSG);
      return;
    }

    const errs: FieldErrors = {};
    const de = validateDob(values.dob); if (de) errs.dob = de;
    const ce = validateCccd(values.citizen_id, pf.citizen_id); if (ce) errs.citizen_id = ce;
    if (isProgram && !programName.trim()) errs.program_name = 'Vui lòng nhập tên chương trình.';
    setFieldErrors(errs);

    if (!purposeCode) { setError('Vui lòng chọn mục đích làm giấy.'); return; }
    if (Object.keys(errs).length) { setError('Vui lòng kiểm tra lại các trường được đánh dấu.'); return; }
    setError('');
    setLoading(true);
    try {
      await api.requests.createOther({
        purpose_code: purposeCode,
        program_name: isProgram ? programName.trim() : undefined,
        dob: values.dob.trim(),
        citizen_id: values.citizen_id.trim(),
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
        <div className="flex items-start gap-2.5 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">
          <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
          {loadError}
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
          <div className="w-11 h-11 rounded-full bg-green-50 border border-green-200 flex items-center justify-center mx-auto mb-4">
            <Check size={22} className="text-green-700" />
          </div>
          <h2 className="text-lg font-semibold text-ink">Đã gửi yêu cầu</h2>
          <p className="text-sm text-muted mt-2">Phòng CTSV sẽ phản hồi trong thời gian sớm nhất.</p>
          <div className="mt-6"><Link href="/dashboard" className={ui.btnPrimary}>Về Bảng thông tin</Link></div>
        </div>
      </div>
    );
  }

  const p = form.prefill;
  const originals: Record<FieldKey, string> = { dob: p.dob, citizen_id: p.citizen_id };
  const lockable: Record<FieldKey, boolean> = { dob: !!p.dob.trim(), citizen_id: !cccdMustRenew };
  const editCount = FIELD_KEYS.filter((k) => values[k].trim() !== originals[k].trim()).length;

  return (
    <div className="max-w-[760px] space-y-4">
      <nav className="flex items-center gap-1.5 text-[0.82rem] text-muted">
        <Link href="/dashboard" className="hover:text-ink">Bảng thông tin</Link>
        <ChevronRight size={14} className="text-slate-400" />
        <Link href="/dashboard/requests/new" className="hover:text-ink">Yêu cầu giấy tờ</Link>
        <ChevronRight size={14} className="text-slate-400" />
        <span className="text-ink font-medium">Lý do khác</span>
      </nav>

      <div className={cn(ui.card, 'border-t-2 border-t-primary')}>
        <div className="px-6 py-5 border-b border-line">
          <h1 className="flex items-center gap-2 text-[1.05rem] font-semibold text-ink">
            <FileText size={17} className="text-primary" />
            Giấy xác nhận sinh viên (lý do khác)
          </h1>
          <p className="text-sm text-muted mt-1">Thông tin dưới đây lấy từ hồ sơ sinh viên. Kiểm tra, chỉnh sửa nếu cần rồi chọn mục đích.</p>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-6">
          {error && (
            <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">
              <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />{error}
            </div>
          )}

          {/* Thông tin chỉ xem */}
          <div>
            <h2 className="text-[0.82rem] font-semibold text-muted mb-2.5">Thông tin sinh viên</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              <ReadonlyField label="Họ và tên" value={p.student_name} />
              <ReadonlyField label="Mã số sinh viên" value={p.student_id} />
              <ReadonlyField label="Khoa" value={p.department} />
              <ReadonlyField label="Trạng thái" value={p.cur_status_vi} />
              <ReadonlyField label="Niên khóa" value={p.course_year} />
              <ReadonlyField label="Thời gian đào tạo tối đa" value={p.max_year} />
            </div>
          </div>

          {/* Thông tin có thể cập nhật */}
          <div>
            <h2 className="text-[0.82rem] font-semibold text-muted mb-2.5">Thông tin có thể cập nhật</h2>
            <div className="grid sm:grid-cols-2 gap-x-3 gap-y-4">
              <EditableField
                label="Ngày sinh"
                kind="date"
                value={values.dob} original={originals.dob}
                open={openFields.dob} lockable={lockable.dob}
                error={fieldErrors.dob}
                maxLength={10}
                onChange={(v) => setValue('dob', v)}
                onOpen={() => openField('dob')}
                onCancel={() => cancelField('dob', originals)}
              />
              <EditableField
                label="Số CCCD"
                value={values.citizen_id} original={originals.citizen_id}
                open={openFields.citizen_id} lockable={lockable.citizen_id}
                error={fieldErrors.citizen_id}
                hint={cccdMustRenew ? 'Hồ sơ chưa có CCCD 12 số — vui lòng nhập mới.' : undefined}
                maxLength={12} inputMode="numeric" placeholder="12 chữ số"
                onChange={(v) => setValue('citizen_id', v)}
                onOpen={() => openField('citizen_id')}
                onCancel={() => cancelField('citizen_id', originals)}
              />
            </div>
            <p className="mt-3 text-[0.78rem] text-muted leading-relaxed">
              Thông tin đã có trong hồ sơ được khóa sẵn — bấm{' '}
              <strong className="font-medium text-ink">Yêu cầu chỉnh sửa</strong> nếu cần sửa.
              Nội dung sửa sẽ được Phòng CTSV duyệt trước khi in lên giấy; riêng ngày sinh và CCCD
              nếu được duyệt sẽ cập nhật vào hồ sơ sinh viên.
            </p>
          </div>

          {/* Mục đích */}
          <div>
            <label className={ui.fieldLabel}>Mục đích làm giấy <span className="text-red-500">*</span></label>
            <select
              value={purposeCode}
              onChange={(e) => setPurposeCode(e.target.value)}
              className={cn(ui.input, 'appearance-none bg-white')}
            >
              <option value="">— Chọn mục đích —</option>
              {form.purpose_choices.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
            </select>

            {isProgram && (
              <div className="mt-2.5">
                <label className={ui.fieldLabel}>Tên chương trình <span className="text-red-500">*</span></label>
                <input
                  type="text" value={programName} maxLength={200}
                  onChange={(e) => { setProgramName(e.target.value); setFieldErrors((f) => ({ ...f, program_name: undefined })); }}
                  placeholder="Nhập tên chương trình tham gia…"
                  className={cn(ui.input, fieldErrors.program_name && 'border-red-400 focus:border-red-400 focus:ring-red-100')}
                />
                {fieldErrors.program_name && <p className="mt-1 text-[0.75rem] text-red-600">{fieldErrors.program_name}</p>}
              </div>
            )}
          </div>

          {/* Ghi chú */}
          <div>
            <label className={ui.fieldLabel}>Ghi chú thêm <span className="text-muted font-normal">(không bắt buộc)</span></label>
            <textarea
              value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000}
              placeholder="Số bản in, ngôn ngữ, yêu cầu đặc biệt…" className={ui.textarea}
            />
          </div>

          {/* Cam đoan — chưa tích thì chưa hiện nút gửi */}
          <RequestConsent
            checked={confirmed}
            editCount={editCount}
            onChange={(v) => { setConfirmed(v); if (v) setError(''); }}
          />

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-line -mx-6 px-6 -mb-5 pb-5">
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
