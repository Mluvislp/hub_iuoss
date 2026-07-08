'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, ArrowLeft, Check, AlertCircle, Loader2, Info, PencilLine, FileText } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ui } from '@/lib/ui';
import type { BankLoanFormData } from '@/lib/types';

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
function validateCccd(v: string): string | null {
  const s = v.trim();
  if (!s) return 'Vui lòng nhập số CCCD.';
  if (!/^\d{12}$/.test(s)) return 'Số CCCD phải gồm 12 chữ số.';
  return null;
}
function validateIssueDate(v: string): string | null {
  const s = v.trim();
  if (!s) return 'Vui lòng nhập ngày cấp CCCD.';
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (!m) return 'Ngày cấp phải theo định dạng dd/mm/yyyy.';
  const day = +m[1], mon = +m[2], year = +m[3];
  const dt = new Date(year, mon - 1, day);
  if (dt.getFullYear() !== year || dt.getMonth() !== mon - 1 || dt.getDate() !== day) return 'Ngày cấp không hợp lệ.';
  if (dt.getTime() > Date.now()) return 'Ngày cấp không được ở tương lai.';
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

type FErr = { dob?: string; citizen_id?: string; citizen_id_issue_date?: string; class_code?: string };

export default function BankLoanRequestPage() {
  const [form, setForm] = useState<BankLoanFormData | null>(null);
  const [loadError, setLoadError] = useState('');

  const [dob, setDob] = useState('');
  const [citizenId, setCitizenId] = useState('');
  const [issueDate, setIssueDate] = useState('');
  const [classCode, setClassCode] = useState('');
  const [note, setNote] = useState('');

  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FErr>({});

  useEffect(() => {
    api.requests.bankloanForm()
      .then((data) => {
        setForm(data);
        setDob(data.prefill.dob);
        setCitizenId(data.prefill.citizen_id);
        setIssueDate(data.prefill.citizen_id_issue_date);
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Không tải được thông tin sinh viên.'));
  }, []);

  const cccdLocked = !!form?.prefill.cccd_locked;
  const dobChanged = form ? dob.trim() !== form.prefill.dob.trim() : false;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs: FErr = {};
    const de = validateDob(dob); if (de) errs.dob = de;
    if (!cccdLocked) {
      const ce = validateCccd(citizenId); if (ce) errs.citizen_id = ce;
      const ie = validateIssueDate(issueDate); if (ie) errs.citizen_id_issue_date = ie;
    }
    if (!classCode.trim()) errs.class_code = 'Vui lòng nhập mã lớp.';
    setFieldErrors(errs);
    if (Object.keys(errs).length) { setError('Vui lòng kiểm tra lại các trường được đánh dấu.'); return; }
    setError('');
    setLoading(true);
    try {
      await api.requests.createBankLoan({
        dob: dob.trim(),
        citizen_id: citizenId.trim(),
        citizen_id_issue_date: issueDate.trim(),
        class_code: classCode.trim(),
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
        <span className="text-ink font-medium">Vay vốn ngân hàng</span>
      </nav>

      <div className={cn(ui.card, 'border-t-2 border-t-primary')}>
        <div className="px-6 py-5 border-b border-line">
          <h1 className="flex items-center gap-2 text-[1.05rem] font-semibold text-ink">
            <FileText size={17} className="text-primary" />
            Giấy xác nhận sinh viên — Vay vốn ngân hàng
          </h1>
          <p className="text-sm text-muted mt-1">Thông tin lấy từ hồ sơ. Kiểm tra, bổ sung mã lớp / CCCD nếu cần rồi gửi.</p>
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
              <ReadonlyField label="Họ và tên" value={p.student_name} />
              <ReadonlyField label="Mã số sinh viên" value={p.student_id} />
              <ReadonlyField label="Giới tính" value={p.sex} />
              <ReadonlyField label="Khoa" value={p.department} />
              <ReadonlyField label="Mã ngành" value={p.major_code} />
              <ReadonlyField label="Trạng thái" value={p.cur_status_vi} />
              <ReadonlyField label="Niên khóa" value={p.course_year} />
              <ReadonlyField label="Học kỳ hiện tại" value={p.current_semester} />
              <ReadonlyField label="Thời gian nhập học" value={p.start_label} />
              <ReadonlyField label="Ra trường đúng tiến độ" value={p.graduation_label} />
              <ReadonlyField label="Số năm / tháng đào tạo" value={p.course_year_number && p.course_month_number ? `${p.course_year_number} năm (${p.course_month_number} tháng)` : (p.course_year_number || '—')} />
              <ReadonlyField label="Tối đa (năm / tháng)" value={p.max_year_number && p.max_month_number ? `${p.max_year_number} năm (${p.max_month_number} tháng)` : (p.max_year_number || '—')} />
            </div>
          </div>

          {/* Mã lớp — SV tự điền */}
          <div className="sm:max-w-[320px]">
            <label className={ui.fieldLabel}>Mã lớp hiện tại <span className="text-red-500">*</span></label>
            <input
              type="text" value={classCode} maxLength={64}
              onChange={(e) => { setClassCode(e.target.value); setFieldErrors((f) => ({ ...f, class_code: undefined })); }}
              placeholder="Ví dụ: ITITIU20A1"
              className={cn(ui.input, fieldErrors.class_code && 'border-danger-line focus:border-danger-line focus:ring-red-100')}
            />
            {fieldErrors.class_code && <p className="mt-1 text-[0.75rem] text-danger-text">{fieldErrors.class_code}</p>}
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

          {/* CCCD */}
          <div>
            <h2 className="text-[0.82rem] font-semibold text-muted mb-2.5">Căn cước công dân</h2>
            {cccdLocked ? (
              <div className="grid sm:grid-cols-2 gap-3">
                <ReadonlyField label="Số CCCD" value={p.citizen_id} />
                <ReadonlyField label="Ngày cấp" value={p.citizen_id_issue_date} />
              </div>
            ) : (
              <>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className={ui.fieldLabel}>Số CCCD <span className="text-red-500">*</span></label>
                    <input
                      type="text" value={citizenId} maxLength={12} inputMode="numeric"
                      onChange={(e) => { setCitizenId(e.target.value); setFieldErrors((f) => ({ ...f, citizen_id: undefined })); }}
                      placeholder="12 chữ số"
                      className={cn(ui.input, fieldErrors.citizen_id && 'border-danger-line focus:border-danger-line focus:ring-red-100')}
                    />
                    {fieldErrors.citizen_id && <p className="mt-1 text-[0.75rem] text-danger-text">{fieldErrors.citizen_id}</p>}
                  </div>
                  <div>
                    <label className={ui.fieldLabel}>Ngày cấp (dd/mm/yyyy) <span className="text-red-500">*</span></label>
                    <input
                      type="text" value={issueDate} maxLength={10} inputMode="numeric"
                      onChange={(e) => { setIssueDate(e.target.value); setFieldErrors((f) => ({ ...f, citizen_id_issue_date: undefined })); }}
                      placeholder="dd/mm/yyyy"
                      className={cn(ui.input, fieldErrors.citizen_id_issue_date && 'border-danger-line focus:border-danger-line focus:ring-red-100')}
                    />
                    {fieldErrors.citizen_id_issue_date && <p className="mt-1 text-[0.75rem] text-danger-text">{fieldErrors.citizen_id_issue_date}</p>}
                  </div>
                </div>
                <p className="mt-2 text-[0.78rem] text-muted">Hồ sơ chưa có CCCD hợp lệ — vui lòng nhập; sẽ gửi Phòng CTSV duyệt.</p>
              </>
            )}
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
