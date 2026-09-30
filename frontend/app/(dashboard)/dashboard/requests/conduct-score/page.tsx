'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, ArrowLeft, Check, AlertCircle, Loader2, Info, FileText } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ui } from '@/lib/ui';
import type { ConductScoreFormData } from '@/lib/types';
import { RequestConsent, ConsentGate, CONSENT_REQUIRED_MSG } from '@/components/request-consent';
import { RequestNoteField } from '@/components/request-note';
import { ReadonlyField } from '@/components/editable-field';

// Bảng điểm rèn luyện: Phòng CTSV xuất từ hệ thống khác. Thông tin sinh viên chỉ
// để đối chiếu (không có ô xin sửa) — sai thì ghi vào ô ghi chú.
export default function ConductScoreRequestPage() {
  const [form, setForm] = useState<ConductScoreFormData | null>(null);
  const [loadError, setLoadError] = useState('');

  const [semesterCode, setSemesterCode] = useState('');
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [semesterError, setSemesterError] = useState('');

  useEffect(() => {
    api.requests.conductScoreForm()
      .then(setForm)
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Không tải được thông tin sinh viên.'));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!confirmed) { setError(CONSENT_REQUIRED_MSG); return; }
    if (!semesterCode) {
      setSemesterError('Vui lòng chọn học kỳ.');
      setError('Vui lòng kiểm tra lại các trường được đánh dấu.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await api.requests.createConductScore({
        semester_code: semesterCode,
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
  const noSemester = form.semester_choices.length === 0;

  return (
    <div className="max-w-[760px] space-y-4">
      <nav className="flex items-center gap-1.5 text-[0.82rem] text-muted">
        <Link href="/dashboard" className="hover:text-ink">Bảng thông tin</Link>
        <ChevronRight size={14} className="text-slate-400" />
        <Link href="/dashboard/requests/new" className="hover:text-ink">Yêu cầu giấy tờ</Link>
        <ChevronRight size={14} className="text-slate-400" />
        <span className="text-ink font-medium">Bảng điểm rèn luyện</span>
      </nav>

      <div className={cn(ui.card, 'border-t-2 border-t-primary')}>
        <div className="px-6 py-5 border-b border-line">
          <h1 className="flex items-center gap-2 text-[1.05rem] font-semibold text-ink">
            <FileText size={17} className="text-primary" />
            Bảng điểm rèn luyện
          </h1>
          <p className="text-sm text-muted mt-1">
            Thông tin lấy từ hồ sơ sinh viên. Kiểm tra thông tin, chọn học kỳ rồi gửi.
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
              <ReadonlyField label="Họ và tên" value={p.student_name} />
              <ReadonlyField label="Mã số sinh viên" value={p.student_id} />
              <ReadonlyField label="Ngày sinh" value={p.dob} />
              <ReadonlyField label="Số CCCD" value={p.citizen_id} />
              <ReadonlyField label="Khoa" value={p.department} />
              <ReadonlyField label="Khóa học" value={p.course_year} />
            </div>
            {/* Địa chỉ dài — hộp co giãn thay vì ReadonlyField cao cố định */}
            <div className="mt-3">
              <div className={ui.label}>Địa chỉ thường trú</div>
              <div className="mt-1 rounded-lg border border-line bg-slate-50 px-3 py-2.5 min-h-10 text-sm text-ink leading-relaxed">
                {p.permanent_address || '—'}
              </div>
            </div>
            <p className="mt-3 text-[0.78rem] text-muted leading-relaxed">
              Thông tin sai hoặc còn trống: ghi rõ vào ô <strong className="font-medium text-ink">Ghi chú thêm</strong> bên dưới.
            </p>
          </div>

          {/* Học kỳ */}
          <div>
            <label className={ui.fieldLabel}>Học kỳ cấp bảng điểm rèn luyện <span className="text-red-500">*</span></label>
            {noSemester ? (
              <p className="text-[0.85rem] text-muted">
                Chưa có học kỳ nào kết thúc để cấp bảng điểm rèn luyện. Liên hệ Phòng CTSV nếu cần hỗ trợ.
              </p>
            ) : (
              <>
                <select
                  value={semesterCode}
                  onChange={(e) => { setSemesterCode(e.target.value); setSemesterError(''); }}
                  className={cn(ui.input, semesterError && 'border-danger-line focus:border-danger-line focus:ring-red-100')}
                >
                  <option value="">— Chọn học kỳ —</option>
                  {form.semester_choices.map((c) => (
                    <option key={c.code} value={c.code}>{c.label}</option>
                  ))}
                </select>
                {semesterError && <p className="mt-1 text-[0.75rem] text-danger-text">{semesterError}</p>}
              </>
            )}
          </div>

          {/* Ghi chú — component dùng chung cho mọi form */}
          <RequestNoteField value={note} onChange={setNote} />

          <RequestConsent
            checked={confirmed}
            onChange={(v) => { setConfirmed(v); if (v) setError(''); }}
          />

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-line -mx-6 px-6 -mb-5 pb-5">
            <Link href="/dashboard/requests/new" className={ui.btnGhost}>
              <ArrowLeft size={15} /> Quay lại
            </Link>
            <ConsentGate checked={confirmed}>
              <button type="submit" disabled={loading || noSemester} className={ui.btnPrimary}>
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
