'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, ArrowLeft, Check, AlertCircle, Loader2, Info, FileText } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ReadonlyField, EditableField } from '@/components/editable-field';
import {
  validateDob, validateCccd, validateIssueDate, validateClassCode,
  isValidDob, isValidCccd, isValidIssueDate, isValidClassCode,
} from '@/lib/form-validators';
import { ui } from '@/lib/ui';
import type { BankLoanFormData } from '@/lib/types';
import { RequestConsent, ConsentGate, CONSENT_REQUIRED_MSG } from '@/components/request-consent';
import { RequestNoteField } from '@/components/request-note';

// Ô XIN SỬA (khóa sẵn, "Yêu cầu chỉnh sửa"; trống / không hợp lệ thì mở sẵn) —
// chuyên viên duyệt ở Dashboard. Các nhãn tiến độ học thuộc NHÓM CỨNG — chỉ xem.
type FieldKey = 'dob' | 'class_code' | 'citizen_id' | 'citizen_id_issue_date';
const FIELD_KEYS: FieldKey[] = ['dob', 'class_code', 'citizen_id', 'citizen_id_issue_date'];
const EMPTY: Record<FieldKey, string> = { dob: '', class_code: '', citizen_id: '', citizen_id_issue_date: '' };

type FErr = Partial<Record<FieldKey, string>>;

export default function BankLoanRequestPage() {
  const [form, setForm] = useState<BankLoanFormData | null>(null);
  const [loadError, setLoadError] = useState('');

  const [values, setValues] = useState<Record<FieldKey, string>>(EMPTY);
  const [openFields, setOpenFields] = useState<Record<FieldKey, boolean>>(
    { dob: false, class_code: false, citizen_id: false, citizen_id_issue_date: false });
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
        setValues({
          dob: pf.dob,
          class_code: pf.class_code ?? '',
          citizen_id: pf.citizen_id,
          citizen_id_issue_date: pf.citizen_id_issue_date,
        });
        // Hồ sơ có giá trị hợp lệ thì khóa sẵn; trống hoặc không hợp lệ ⇒ mở sẵn.
        setOpenFields({
          dob: !isValidDob(pf.dob),
          class_code: !isValidClassCode(pf.class_code ?? ''),
          citizen_id: !pf.cccd_valid,
          citizen_id_issue_date: !pf.cccd_valid || !isValidIssueDate(pf.citizen_id_issue_date),
        });
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Không tải được thông tin sinh viên.'));
  }, []);

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
    const le = validateClassCode(values.class_code); if (le) errs.class_code = le;
    const ce = validateCccd(values.citizen_id, pf.citizen_id); if (ce) errs.citizen_id = ce;
    // Ngày cấp soi khi SV đổi số / đổi ngày, hoặc ngày trong hồ sơ không dùng được —
    // cùng điều kiện với build_bankloan_payload bên backend.
    const cidChanged = values.citizen_id.trim() !== pf.citizen_id.trim();
    const issueChanged = values.citizen_id_issue_date.trim() !== pf.citizen_id_issue_date.trim();
    if (cidChanged || issueChanged || !isValidIssueDate(pf.citizen_id_issue_date)) {
      const ie = validateIssueDate(values.citizen_id_issue_date); if (ie) errs.citizen_id_issue_date = ie;
    }
    setFieldErrors(errs);
    if (Object.keys(errs).length) { setError('Vui lòng kiểm tra lại các trường được đánh dấu.'); return; }
    setError('');
    setLoading(true);
    try {
      await api.requests.createBankLoan({
        dob: values.dob.trim(),
        citizen_id: values.citizen_id.trim(),
        citizen_id_issue_date: values.citizen_id_issue_date.trim(),
        class_code: values.class_code.trim(),
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
  const originals: Record<FieldKey, string> = {
    dob: p.dob,
    class_code: p.class_code ?? '',
    citizen_id: p.citizen_id,
    citizen_id_issue_date: p.citizen_id_issue_date,
  };
  // Giá trị gốc hợp lệ thì có chỗ để quay về ⇒ khóa được + có nút hủy.
  const lockable: Record<FieldKey, boolean> = {
    dob: isValidDob(p.dob),
    class_code: isValidClassCode(p.class_code ?? ''),
    citizen_id: p.cccd_valid,
    citizen_id_issue_date: p.cccd_valid && isValidIssueDate(p.citizen_id_issue_date),
  };
  // Mã lớp so sau khi viết hoa — backend coi khác hoa/thường là không sửa.
  const editCount = FIELD_KEYS.filter((k) => (k === 'class_code'
    ? values[k].trim().toUpperCase() !== originals[k].trim().toUpperCase()
    : values[k].trim() !== originals[k].trim())).length;

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
          <p className="text-sm text-muted mt-1">Thông tin lấy từ hồ sơ. Kiểm tra, yêu cầu chỉnh sửa mã lớp / CCCD nếu sai rồi gửi.</p>
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

          {/* Mã lớp — ô xin sửa, chuyên viên duyệt */}
          <div className="sm:max-w-[320px]">
            <EditableField
              label="Mã lớp hiện tại"
              value={values.class_code} original={originals.class_code}
              open={openFields.class_code} lockable={lockable.class_code}
              error={fieldErrors.class_code} maxLength={64}
              placeholder="Ví dụ: ITITIU20A1"
              onChange={(v) => setValue('class_code', v)}
              onOpen={() => openField('class_code')}
              onCancel={() => cancelField('class_code', originals)}
            />
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

          {/* CCCD — ô xin sửa, chuyên viên duyệt */}
          <div>
            <h2 className="text-[0.82rem] font-semibold text-muted mb-2.5">Căn cước công dân</h2>
            <div className="grid sm:grid-cols-2 gap-x-3 gap-y-4">
              <EditableField
                label="Số CCCD"
                value={values.citizen_id} original={originals.citizen_id}
                open={openFields.citizen_id} lockable={lockable.citizen_id}
                error={fieldErrors.citizen_id}
                maxLength={12} inputMode="numeric" placeholder="12 chữ số"
                onChange={(v) => setValue('citizen_id', v)}
                onOpen={() => openField('citizen_id')}
                onCancel={() => cancelField('citizen_id', originals)}
              />
              <EditableField
                label="Ngày cấp"
                kind="date"
                value={values.citizen_id_issue_date} original={originals.citizen_id_issue_date}
                open={openFields.citizen_id_issue_date} lockable={lockable.citizen_id_issue_date}
                error={fieldErrors.citizen_id_issue_date}
                maxLength={10}
                onChange={(v) => setValue('citizen_id_issue_date', v)}
                onOpen={() => openField('citizen_id_issue_date')}
                onCancel={() => cancelField('citizen_id_issue_date', originals)}
              />
            </div>
            <p className="mt-2 text-[0.78rem] text-muted">
              {p.cccd_valid
                ? 'Mã lớp và thông tin CCCD mới được Phòng Công tác Sinh viên duyệt trước khi cập nhật vào hồ sơ.'
                : 'Hồ sơ chưa có CCCD hợp lệ (đang trống hoặc CMND cũ) — vui lòng nhập; thông tin được Phòng Công tác Sinh viên duyệt trước khi cập nhật vào hồ sơ.'}
            </p>
          </div>

          {/* Ghi chú — component dùng chung cho 5 form */}
          <RequestNoteField value={note} onChange={setNote} />

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
