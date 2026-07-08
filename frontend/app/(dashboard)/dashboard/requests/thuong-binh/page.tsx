'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, ArrowLeft, Check, AlertCircle, Loader2, Info, FileText } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ui } from '@/lib/ui';
import type { ThuongBinhFormData } from '@/lib/types';

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

type FErr = { citizen_id?: string; citizen_id_issue_date?: string };

export default function ThuongBinhRequestPage() {
  const [form, setForm] = useState<ThuongBinhFormData | null>(null);
  const [loadError, setLoadError] = useState('');

  const [citizenId, setCitizenId] = useState('');
  const [issueDate, setIssueDate] = useState('');
  const [note, setNote] = useState('');

  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FErr>({});

  useEffect(() => {
    api.requests.thuongbinhForm()
      .then((data) => {
        setForm(data);
        setCitizenId(data.prefill.citizen_id);
        setIssueDate(data.prefill.citizen_id_issue_date);
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Không tải được thông tin sinh viên.'));
  }, []);

  const cccdLocked = !!form?.prefill.cccd_locked;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs: FErr = {};
    if (!cccdLocked) {
      const ce = validateCccd(citizenId); if (ce) errs.citizen_id = ce;
      const ie = validateIssueDate(issueDate); if (ie) errs.citizen_id_issue_date = ie;
    }
    setFieldErrors(errs);
    if (Object.keys(errs).length) { setError('Vui lòng kiểm tra lại các trường được đánh dấu.'); return; }
    setError('');
    setLoading(true);
    try {
      await api.requests.createThuongBinh({
        citizen_id: citizenId.trim(),
        citizen_id_issue_date: issueDate.trim(),
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
        <span className="text-ink font-medium">Ưu đãi giáo dục (thương binh)</span>
      </nav>

      <div className={cn(ui.card, 'border-t-2 border-t-primary')}>
        <div className="px-6 py-5 border-b border-line">
          <h1 className="flex items-center gap-2 text-[1.05rem] font-semibold text-ink">
            <FileText size={17} className="text-primary" />
            Giấy xác nhận sinh viên — Ưu đãi giáo dục (thương binh)
          </h1>
          <p className="text-sm text-muted mt-1">Thông tin lấy từ hồ sơ của bạn. Kiểm tra, bổ sung CCCD nếu cần rồi gửi yêu cầu.</p>
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
              <ReadonlyField label="Khoa" value={p.department} />
              <ReadonlyField label="Sinh viên năm thứ" value={p.study_year} />
              <ReadonlyField label="Học kỳ hiện tại" value={p.current_semester} />
              <ReadonlyField label="Năm học hiện tại" value={p.current_academic_year} />
              <ReadonlyField label="Niên khóa" value={p.course_year} />
              <ReadonlyField label="Số năm đào tạo" value={p.course_year_number} />
              <ReadonlyField label="Số năm đào tạo tối đa" value={p.max_year_number} />
            </div>
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
                <p className="mt-2 text-[0.78rem] text-muted">
                  Hồ sơ chưa có CCCD hợp lệ — vui lòng nhập; thông tin sẽ được gửi cho Phòng CTSV duyệt.
                </p>
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
