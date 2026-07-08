'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, ArrowLeft, Check, AlertCircle, Loader2, Info, PencilLine, FileText } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ui } from '@/lib/ui';
import type { EnglishFormData } from '@/lib/types';

function validateDob(v: string): string | null {
  const s = v.trim();
  if (!s) return 'Vui lòng nhập ngày sinh.';
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (!m) return 'Ngày sinh phải theo định dạng dd/mm/yyyy.';
  const day = +m[1], mon = +m[2], year = +m[3];
  const dt = new Date(year, mon - 1, day);
  if (dt.getFullYear() !== year || dt.getMonth() !== mon - 1 || dt.getDate() !== day) return 'Ngày sinh không hợp lệ.';
  if (dt.getTime() > Date.now()) return 'Ngày sinh không được ở tương lai.';
  if (year < 1940) return 'Năm sinh không hợp lệ.';
  return null;
}

function ReadonlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className={ui.label}>{label}</div>
      <div className="mt-1 rounded-lg border border-line bg-slate-50 px-3 h-10 flex items-center text-sm text-ink">
        {value || '—'}
      </div>
    </div>
  );
}

type FErr = { dob?: string; purpose_code?: string; program_name?: string };

export default function EnglishRequestPage() {
  const [form, setForm] = useState<EnglishFormData | null>(null);
  const [loadError, setLoadError] = useState('');

  const [dob, setDob] = useState('');
  const [purposeCode, setPurposeCode] = useState('');
  const [programName, setProgramName] = useState('');
  const [note, setNote] = useState('');

  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FErr>({});

  useEffect(() => {
    api.requests.englishForm()
      .then((data) => {
        setForm(data);
        setDob(data.prefill.dob);
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Không tải được thông tin sinh viên.'));
  }, []);

  const isProgram = !!form && purposeCode === form.program_purpose_code;
  const dobChanged = form ? dob.trim() !== form.prefill.dob.trim() : false;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs: FErr = {};
    const de = validateDob(dob); if (de) errs.dob = de;
    if (!purposeCode) errs.purpose_code = 'Vui lòng chọn mục đích.';
    if (isProgram && !programName.trim()) errs.program_name = 'Vui lòng nhập tên chương trình.';
    setFieldErrors(errs);
    if (Object.keys(errs).length) { setError('Vui lòng kiểm tra lại các trường được đánh dấu.'); return; }
    setError('');
    setLoading(true);
    try {
      await api.requests.createEnglish({
        dob: dob.trim(),
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

          {/* Ngày sinh */}
          <div className="sm:max-w-[260px]">
            <label className={ui.fieldLabel}>
              Ngày sinh (dd/mm/yyyy)
              {dobChanged && (
                <span className="ml-1.5 inline-flex items-center gap-0.5 text-[0.75rem] font-normal text-warning-text">
                  <PencilLine size={11} /> sẽ gửi duyệt
                </span>
              )}
            </label>
            <input
              type="text" value={dob} maxLength={10} inputMode="numeric"
              onChange={(e) => { setDob(e.target.value); setFieldErrors((f) => ({ ...f, dob: undefined })); }}
              placeholder="dd/mm/yyyy"
              className={cn(ui.input, fieldErrors.dob ? 'border-danger-line focus:border-danger-line focus:ring-red-100' : dobChanged && 'border-warning-line')}
            />
            {fieldErrors.dob && <p className="mt-1 text-[0.75rem] text-danger-text">{fieldErrors.dob}</p>}
          </div>

          {/* Ghi chú */}
          <div>
            <label className={ui.fieldLabel}>Ghi chú thêm <span className="text-muted font-normal">(không bắt buộc)</span></label>
            <textarea
              value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000}
              placeholder="Số bản in, yêu cầu đặc biệt…" className={ui.textarea}
            />
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-line -mx-6 px-6 -mb-5 pb-5">
            <Link href="/dashboard/requests/new" className={ui.btnGhost}>
              <ArrowLeft size={15} /> Quay lại
            </Link>
            <button type="submit" disabled={loading} className={ui.btnPrimary}>
              {loading && <Loader2 size={15} className="animate-spin" />}
              {loading ? 'Đang gửi…' : 'Gửi yêu cầu'}
            </button>
          </div>
        </form>
      </div>

      <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-slate-50 border-l-2 border-primary">
        <Info size={16} className="text-primary flex-shrink-0 mt-0.5" />
        <p className="text-[0.85rem] text-slate-600 leading-relaxed">
          Thời gian xử lý thông thường: <strong className="text-ink font-medium">1–3 ngày làm việc</strong>.
        </p>
      </div>
    </div>
  );
}
