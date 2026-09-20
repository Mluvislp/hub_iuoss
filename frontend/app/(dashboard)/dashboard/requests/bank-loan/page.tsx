'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, ArrowLeft, Check, AlertCircle, Loader2, Info, FileText } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn, toDateInput, fromDateInput, todayInput, DATE_INPUT_MIN } from '@/lib/utils';
import { ReadonlyField, EditableField } from '@/components/editable-field';
import { validateDob, validateCccd, validateIssueDate } from '@/lib/form-validators';
import { ui } from '@/lib/ui';
import type { BankLoanFormData } from '@/lib/types';
import { RequestConsent, ConsentGate, CONSENT_REQUIRED_MSG } from '@/components/request-consent';

// Chỉ ngày sinh dùng cơ chế khóa/mở. Các nhãn tiến độ học thuộc NHÓM CỨNG — chỉ xem.
type FieldKey = 'dob';
const FIELD_KEYS: FieldKey[] = ['dob'];

type FErr = Partial<Record<FieldKey | 'citizen_id' | 'citizen_id_issue_date' | 'class_code', string>>;

export default function BankLoanRequestPage() {
  const [form, setForm] = useState<BankLoanFormData | null>(null);
  const [loadError, setLoadError] = useState('');

  const [values, setValues] = useState<Record<FieldKey, string>>({ dob: '' });
  const [openFields, setOpenFields] = useState<Record<FieldKey, boolean>>({ dob: false });
  const [citizenId, setCitizenId] = useState('');
  const [issueDate, setIssueDate] = useState('');
  const [classCode, setClassCode] = useState('');
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FErr>({});

  useEffect(() => {
    api.requests.bankloanForm()
      .then((data) => {
        const pf = data.prefill;
        setForm(data);
        setCitizenId(pf.citizen_id);
        setIssueDate(pf.citizen_id_issue_date);
        // Mã lớp đã có trong hồ sơ thì điền sẵn, SV chỉ gõ khi hồ sơ còn trống.
        setClassCode(pf.class_code ?? '');
        setValues({ dob: pf.dob });
        // Hồ sơ đã có ngày sinh thì khóa sẵn; trống thì mở sẵn.
        setOpenFields({ dob: !pf.dob.trim() });
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Không tải được thông tin sinh viên.'));
  }, []);

  const cccdLocked = !!form?.prefill.cccd_locked;
  // Hồ sơ đã có mã lớp ⇒ khoá ô. Mã lớp trên hồ sơ do phòng đào tạo cập nhật hàng
  // loạt, không để SV gõ đè lên giấy tờ nhà trường cấp.
  const classLocked = !!form?.prefill.class_code_locked;

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
    if (!cccdLocked) {
      const ce = validateCccd(citizenId, pf.citizen_id); if (ce) errs.citizen_id = ce;
      const ie = validateIssueDate(issueDate); if (ie) errs.citizen_id_issue_date = ie;
    }
    if (!classLocked && !classCode.trim()) errs.class_code = 'Vui lòng nhập mã lớp.';
    setFieldErrors(errs);
    if (Object.keys(errs).length) { setError('Vui lòng kiểm tra lại các trường được đánh dấu.'); return; }
    setError('');
    setLoading(true);
    try {
      await api.requests.createBankLoan({
        dob: values.dob.trim(),
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
  const originals: Record<FieldKey, string> = { dob: p.dob };
  const lockable: Record<FieldKey, boolean> = { dob: !!p.dob.trim() };
  const editCount = (values.dob.trim() !== originals.dob.trim() ? 1 : 0)
    + (cccdLocked ? 0 : 2) + (classLocked ? 0 : 1);

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

          {/* Mã lớp — lấy từ hồ sơ, chỉ cho gõ khi hồ sơ còn trống */}
          <div className="sm:max-w-[320px]">
            {classLocked ? (
              <ReadonlyField label="Mã lớp hiện tại" value={p.class_code} />
            ) : (
              <>
                <label className={ui.fieldLabel}>Mã lớp hiện tại <span className="text-red-500">*</span></label>
                <input
                  type="text" value={classCode} maxLength={64}
                  onChange={(e) => { setClassCode(e.target.value); setFieldErrors((f) => ({ ...f, class_code: undefined })); }}
                  placeholder="Ví dụ: ITITIU20A1"
                  className={cn(ui.input, fieldErrors.class_code && 'border-danger-line focus:border-danger-line focus:ring-red-100')}
                />
                {fieldErrors.class_code && <p className="mt-1 text-[0.75rem] text-danger-text">{fieldErrors.class_code}</p>}
                <p className="mt-1 text-[0.75rem] text-muted">
                  Hồ sơ chưa có mã lớp, vui lòng nhập.
                </p>
              </>
            )}
          </div>

          {/* Ngày sinh */}
          <div className="sm:max-w-[260px]">
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
                    <label className={ui.fieldLabel}>Ngày cấp <span className="text-red-500">*</span></label>
                    <input
                      type="date" value={toDateInput(issueDate)}
                      min={DATE_INPUT_MIN} max={todayInput()}
                      onChange={(e) => { setIssueDate(fromDateInput(e.target.value)); setFieldErrors((f) => ({ ...f, citizen_id_issue_date: undefined })); }}
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
          Thời gian xử lý thông thường: <strong className="text-ink font-medium">1–3 ngày làm việc</strong>.
        </p>
      </div>
    </div>
  );
}
