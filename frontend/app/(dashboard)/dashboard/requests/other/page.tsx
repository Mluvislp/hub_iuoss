'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  FileText, ChevronLeft, Loader2, CheckCircle2, AlertCircle, PencilLine,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { OtherRequestFormData } from '@/lib/types';

function ReadonlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-semibold text-slate-500">{label}</label>
      <div className="px-3.5 py-2.5 rounded-lg border border-slate-200 bg-slate-50
                      text-sm text-slate-700">
        {value || '—'}
      </div>
    </div>
  );
}

function validateDob(v: string): string | null {
  const s = v.trim();
  if (!s) return 'Vui lòng nhập ngày sinh.';
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (!m) return 'Ngày sinh phải theo định dạng dd/mm/yyyy.';
  const day = +m[1], mon = +m[2], year = +m[3];
  const dt = new Date(year, mon - 1, day);
  if (dt.getFullYear() !== year || dt.getMonth() !== mon - 1 || dt.getDate() !== day)
    return 'Ngày sinh không hợp lệ.';
  if (dt.getTime() > Date.now()) return 'Ngày sinh không được ở tương lai.';
  if (year < 1940) return 'Năm sinh không hợp lệ.';
  return null;
}

const CCCD12 = /^\d{12}$/;

// CCCD dùng trên giấy PHẢI là 12 chữ số. Nếu hồ sơ gốc trống hoặc là CMND cũ
// (không phải 12 số) thì bắt buộc SV nhập CCCD mới 12 số.
function validateCccd(v: string, original: string): string | null {
  const s = v.trim();
  if (CCCD12.test(s)) return null;
  if (!s) return 'Vui lòng nhập số CCCD (12 chữ số).';
  if (!CCCD12.test((original || '').trim()))
    return 'Hồ sơ chưa có CCCD hợp lệ (đang trống hoặc CMND cũ) — vui lòng nhập số CCCD mới gồm 12 chữ số.';
  return 'Số CCCD phải gồm 12 chữ số.';
}

export default function OtherRequestPage() {
  const [form, setForm] = useState<OtherRequestFormData | null>(null);
  const [loadError, setLoadError] = useState('');

  const [purposeCode, setPurposeCode] = useState('');
  const [programName, setProgramName] = useState('');
  const [dob, setDob] = useState('');
  const [citizenId, setCitizenId] = useState('');
  const [note, setNote] = useState('');

  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] =
    useState<{ dob?: string; citizen_id?: string; program_name?: string }>({});

  useEffect(() => {
    api.requests.otherForm()
      .then((data) => {
        setForm(data);
        setDob(data.prefill.dob);
        setCitizenId(data.prefill.citizen_id);
      })
      .catch((err) => {
        setLoadError(err instanceof ApiError ? err.message : 'Không tải được thông tin sinh viên.');
      });
  }, []);

  const isProgram = form ? purposeCode === form.program_purpose_code : false;
  const dobChanged = form ? dob.trim() !== form.prefill.dob.trim() : false;
  const cccdChanged = form ? citizenId.trim() !== form.prefill.citizen_id.trim() : false;
  const cccdMustRenew = form ? !CCCD12.test(form.prefill.citizen_id.trim()) : false;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const errs: { dob?: string; citizen_id?: string; program_name?: string } = {};
    const de = validateDob(dob); if (de) errs.dob = de;
    const ce = validateCccd(citizenId, form?.prefill.citizen_id ?? ''); if (ce) errs.citizen_id = ce;
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
        dob: dob.trim(),
        citizen_id: citizenId.trim(),
        note: note.trim() || undefined,
      });
      setSuccess(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gửi yêu cầu thất bại. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  }

  // ── Loading / load error ──────────────────────────────────
  if (loadError) {
    return (
      <div className="max-w-lg mx-auto mt-10 flex items-start gap-2.5 p-4 rounded-xl
                      bg-red-50 border border-red-200 text-red-700 text-sm">
        <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
        {loadError}
      </div>
    );
  }
  if (!form) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        <Loader2 size={22} className="animate-spin mr-2" /> Đang tải...
      </div>
    );
  }

  // ── Success ───────────────────────────────────────────────
  if (success) {
    return (
      <div className="max-w-lg mx-auto mt-10">
        <div className="bg-white rounded-2xl border border-slate-200/80 p-8 text-center shadow-sm">
          <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center
                          mx-auto mb-4 ring-4 ring-emerald-100">
            <CheckCircle2 size={28} className="text-emerald-600" />
          </div>
          <h2 className="text-lg font-bold text-slate-900 mb-2">Gửi yêu cầu thành công!</h2>
          <p className="text-sm text-slate-500 leading-relaxed">
            Phòng CTSV đã nhận được yêu cầu của bạn và sẽ xử lý trong thời gian sớm nhất.
          </p>
          <div className="mt-6">
            <Link href="/dashboard" className="px-4 py-2 rounded-lg text-sm font-semibold
                         bg-blue-600 hover:bg-blue-700 text-white transition-colors">
              Về Dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const p = form.prefill;

  // ── Form ──────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-center gap-2 text-sm">
        <Link href="/dashboard" className="flex items-center gap-1 text-slate-500 hover:text-slate-700">
          <ChevronLeft size={15} /> Dashboard
        </Link>
        <span className="text-slate-300">/</span>
        <span className="text-slate-700 font-medium">Giấy xác nhận (lý do khác)</span>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100
                        bg-gradient-to-r from-slate-50 to-white">
          <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center">
            <FileText size={17} className="text-blue-600" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Giấy xác nhận sinh viên (lý do khác)</h2>
            <p className="text-xs text-slate-500 mt-0.5">Thông tin lấy từ hồ sơ; kiểm tra rồi chọn mục đích.</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && (
            <div className="flex items-start gap-2.5 p-3.5 rounded-lg
                            bg-red-50 border border-red-200 text-red-700 text-sm">
              <AlertCircle size={16} className="flex-shrink-0 mt-0.5" /> {error}
            </div>
          )}

          {/* View-only */}
          <div className="grid sm:grid-cols-2 gap-3">
            <ReadonlyField label="Họ và tên" value={p.student_name} />
            <ReadonlyField label="Mã số sinh viên" value={p.student_id} />
            <ReadonlyField label="Khoa" value={p.department} />
            <ReadonlyField label="Trạng thái" value={p.cur_status_vi} />
            <ReadonlyField label="Niên khóa" value={p.course_year} />
            <ReadonlyField label="Thời gian đào tạo tối đa" value={p.max_year} />
          </div>

          {/* Editable: DOB + CCCD */}
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-slate-500">
                Ngày sinh (dd/mm/yyyy)
                {dobChanged && (
                  <span className="ml-1.5 inline-flex items-center gap-0.5 text-amber-600">
                    <PencilLine size={11} /> sẽ gửi yêu cầu chỉnh sửa
                  </span>
                )}
              </label>
              <input
                type="text" value={dob} maxLength={10}
                onChange={(e) => { setDob(e.target.value); setFieldErrors((p) => ({ ...p, dob: undefined })); }}
                placeholder="dd/mm/yyyy"
                className={cn('w-full px-3.5 py-2.5 rounded-lg border text-sm bg-white text-slate-900',
                  'focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500',
                  fieldErrors.dob ? 'border-red-400'
                    : dobChanged ? 'border-amber-300' : 'border-slate-300 hover:border-slate-400')}
              />
              {fieldErrors.dob && <p className="text-xs text-red-500">{fieldErrors.dob}</p>}
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-slate-500">
                Số CCCD
                {cccdChanged && (
                  <span className="ml-1.5 inline-flex items-center gap-0.5 text-amber-600">
                    <PencilLine size={11} /> sẽ gửi yêu cầu chỉnh sửa
                  </span>
                )}
              </label>
              <input
                type="text" value={citizenId} maxLength={12} inputMode="numeric"
                onChange={(e) => { setCitizenId(e.target.value); setFieldErrors((p) => ({ ...p, citizen_id: undefined })); }}
                className={cn('w-full px-3.5 py-2.5 rounded-lg border text-sm bg-white text-slate-900',
                  'focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500',
                  fieldErrors.citizen_id ? 'border-red-400'
                    : cccdChanged ? 'border-amber-300' : 'border-slate-300 hover:border-slate-400')}
              />
              {fieldErrors.citizen_id && <p className="text-xs text-red-500">{fieldErrors.citizen_id}</p>}
              {cccdMustRenew && !fieldErrors.citizen_id && (
                <p className="text-xs text-amber-600">
                  Hồ sơ chưa có CCCD 12 số — vui lòng nhập số CCCD mới.
                </p>
              )}
            </div>
          </div>
          <p className="text-xs text-slate-400 -mt-2">
            Ngày sinh và CCCD có thể sửa; thay đổi sẽ được gửi cho phòng CTSV duyệt.
          </p>

          {/* Purpose */}
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-slate-700">
              Mục đích làm giấy <span className="text-red-500">*</span>
            </label>
            <select
              value={purposeCode} onChange={(e) => setPurposeCode(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 hover:border-slate-400
                         text-sm bg-white text-slate-900 focus:outline-none focus:ring-2
                         focus:ring-blue-500/30 focus:border-blue-500"
            >
              <option value="">-- Chọn mục đích --</option>
              {form.purpose_choices.map((c) => (
                <option key={c.code} value={c.code}>{c.label}</option>
              ))}
            </select>

            {isProgram && (
              <div className="p-3 rounded-lg bg-blue-50/70 border border-blue-100 space-y-2">
                <p className="text-xs text-blue-700">Vui lòng nhập tên chương trình bạn tham gia:</p>
                <input
                  type="text" value={programName} maxLength={200}
                  onChange={(e) => { setProgramName(e.target.value); setFieldErrors((p) => ({ ...p, program_name: undefined })); }}
                  placeholder="Tên chương trình..."
                  className={cn('w-full px-3.5 py-2.5 rounded-lg border text-sm bg-white text-slate-900',
                    'focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500',
                    fieldErrors.program_name ? 'border-red-400' : 'border-slate-300')}
                />
                {fieldErrors.program_name && (
                  <p className="text-xs text-red-500">{fieldErrors.program_name}</p>
                )}
              </div>
            )}
          </div>

          {/* Note */}
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-slate-700">
              Ghi chú thêm <span className="text-slate-400 font-normal">(không bắt buộc)</span>
            </label>
            <textarea
              value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000}
              placeholder="Thông tin thêm nếu có..."
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 hover:border-slate-400
                         text-sm bg-white text-slate-900 resize-none focus:outline-none
                         focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
            />
          </div>

          <div className="flex items-center justify-between gap-3 pt-1">
            <Link href="/dashboard" className="px-4 py-2.5 rounded-lg text-sm font-semibold
                         text-slate-600 hover:text-slate-800 hover:bg-slate-100">
              Huỷ
            </Link>
            <button
              type="submit" disabled={loading}
              className={cn('flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-white',
                'bg-blue-600 hover:bg-blue-700 active:bg-blue-800 shadow-sm shadow-blue-600/20',
                'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2',
                'disabled:opacity-70 disabled:cursor-not-allowed')}
            >
              {loading ? <Loader2 size={15} className="animate-spin" /> : null}
              {loading ? 'Đang gửi...' : 'Gửi yêu cầu'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
