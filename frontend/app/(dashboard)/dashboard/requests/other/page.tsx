'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, ArrowLeft, Check, AlertCircle, Loader2, Info, PencilLine, FileText } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ui } from '@/lib/ui';
import type { OtherRequestFormData } from '@/lib/types';

const CCCD12 = /^\d{12}$/;

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

// CCCD trên giấy PHẢI 12 số; hồ sơ trống hoặc CMND cũ thì buộc nhập mới.
function validateCccd(v: string, original: string): string | null {
  const s = v.trim();
  if (CCCD12.test(s)) return null;
  if (!s) return 'Vui lòng nhập số CCCD (12 chữ số).';
  if (!CCCD12.test((original || '').trim()))
    return 'Hồ sơ chưa có CCCD hợp lệ (đang trống hoặc CMND cũ) — vui lòng nhập số CCCD mới gồm 12 chữ số.';
  return 'Số CCCD phải gồm 12 chữ số.';
}

// Ô thông tin chỉ xem
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
      .then((data) => { setForm(data); setDob(data.prefill.dob); setCitizenId(data.prefill.citizen_id); })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Không tải được thông tin sinh viên.'));
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
          <p className="text-sm text-muted mt-1">Thông tin dưới đây lấy từ hồ sơ của bạn. Kiểm tra, chỉnh sửa nếu cần rồi chọn mục đích.</p>
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
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className={ui.fieldLabel}>
                  Ngày sinh (dd/mm/yyyy)
                  {dobChanged && (
                    <span className="ml-1.5 inline-flex items-center gap-0.5 text-[0.75rem] font-normal text-amber-700">
                      <PencilLine size={11} /> sẽ gửi duyệt
                    </span>
                  )}
                </label>
                <input
                  type="text" value={dob} maxLength={10} inputMode="numeric"
                  onChange={(e) => { setDob(e.target.value); setFieldErrors((f) => ({ ...f, dob: undefined })); }}
                  placeholder="dd/mm/yyyy"
                  className={cn(ui.input, fieldErrors.dob ? 'border-red-400 focus:border-red-400 focus:ring-red-100' : dobChanged && 'border-amber-300')}
                />
                {fieldErrors.dob && <p className="mt-1 text-[0.75rem] text-red-600">{fieldErrors.dob}</p>}
              </div>
              <div>
                <label className={ui.fieldLabel}>
                  Số CCCD
                  {cccdChanged && (
                    <span className="ml-1.5 inline-flex items-center gap-0.5 text-[0.75rem] font-normal text-amber-700">
                      <PencilLine size={11} /> sẽ gửi duyệt
                    </span>
                  )}
                </label>
                <input
                  type="text" value={citizenId} maxLength={12} inputMode="numeric"
                  onChange={(e) => { setCitizenId(e.target.value); setFieldErrors((f) => ({ ...f, citizen_id: undefined })); }}
                  className={cn(ui.input, fieldErrors.citizen_id ? 'border-red-400 focus:border-red-400 focus:ring-red-100' : cccdChanged && 'border-amber-300')}
                />
                {fieldErrors.citizen_id
                  ? <p className="mt-1 text-[0.75rem] text-red-600">{fieldErrors.citizen_id}</p>
                  : cccdMustRenew && <p className="mt-1 text-[0.75rem] text-amber-700">Hồ sơ chưa có CCCD 12 số — vui lòng nhập mới.</p>}
              </div>
            </div>
            <p className="mt-2 text-[0.78rem] text-muted">
              Thay đổi ngày sinh / CCCD sẽ được gửi cho Phòng CTSV duyệt trước khi cập nhật hồ sơ.
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
                  placeholder="Nhập tên chương trình bạn tham gia…"
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
          Giấy sẽ dùng thông tin đã xác nhận ở trên. Thời gian xử lý thông thường:{' '}
          <strong className="text-ink font-medium">1–3 ngày làm việc</strong>.
        </p>
      </div>
    </div>
  );
}
