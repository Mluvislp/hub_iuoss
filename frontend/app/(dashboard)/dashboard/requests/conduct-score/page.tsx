'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, ArrowLeft, Check, AlertCircle, Loader2, Info, FileText } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ui } from '@/lib/ui';
import type { ConductScoreFormData, Province, Ward } from '@/lib/types';
import { RequestConsent, ConsentGate, CONSENT_REQUIRED_MSG } from '@/components/request-consent';
import { RequestNoteField } from '@/components/request-note';
import {
  ReadonlyField, EditableField, LockedBox, RequestEditButton, CancelEditButton, ChangedTag,
} from '@/components/editable-field';
import {
  validateDob, validateCccd, validateIssueDate,
  isValidDob, isValidIssueDate,
} from '@/lib/form-validators';
import { STREET_PLACEHOLDER, StreetHint } from '@/components/street-hint';
import { QuotaGuard, QuotaNotice, useRequestQuota } from '@/components/request-quota';
import { useEditRequest, EditRequestBanner, submitOrUpdate, pendingValue, purposeOf, pendingAddress } from '@/components/request-edit';

// Bảng điểm rèn luyện: Phòng CTSV xuất từ hệ thống khác. Ngày sinh / CCCD + ngày cấp /
// địa chỉ thường trú là ô XIN SỬA như các loại giấy khác (khóa sẵn, "Yêu cầu chỉnh
// sửa"; trống / không hợp lệ thì mở sẵn) — chuyên viên duyệt ở Dashboard.
// Họ tên, MSSV, khoa, khóa học thuộc NHÓM CỨNG — chỉ xem.
type FieldKey = 'dob' | 'citizen_id' | 'citizen_id_issue_date';
const FIELD_KEYS: FieldKey[] = ['dob', 'citizen_id', 'citizen_id_issue_date'];

type FErr = Partial<Record<FieldKey | 'semester' | 'delivery' | 'province' | 'ward' | 'street', string>>;

export default function ConductScoreRequestPage() {
  const [form, setForm] = useState<ConductScoreFormData | null>(null);
  const [loadError, setLoadError] = useState('');

  const [semesterCode, setSemesterCode] = useState('');
  const [delivery, setDelivery] = useState('');
  // Học kỳ bảng điểm đã xin trong học kỳ hiện tại — làm mờ trong danh sách, không ẩn.
  const quota = useRequestQuota();
  const usedSemesters = quota?.types.conduct_score?.blocked_semesters ?? {};
  const [values, setValues] = useState<Record<FieldKey, string>>(
    { dob: '', citizen_id: '', citizen_id_issue_date: '' });
  const [openFields, setOpenFields] = useState<Record<FieldKey, boolean>>(
    { dob: false, citizen_id: false, citizen_id_issue_date: false });

  const [provinces, setProvinces] = useState<Province[]>([]);
  const [wards, setWards] = useState<Ward[]>([]);
  const [wardsLoading, setWardsLoading] = useState(false);
  const [provinceCode, setProvinceCode] = useState('');
  const [wardCode, setWardCode] = useState('');
  const [street, setStreet] = useState('');
  const [addressOpen, setAddressOpen] = useState(false);
  const pendingWardRef = useRef('');   // ward_code prefill, set sau khi nạp xong danh sách xã

  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FErr>({});

  // Sửa yêu cầu "Chờ bổ sung" (?edit=<id>) — điền lại ô từ yêu cầu cũ một lần khi cả hai đã nạp.
  const edit = useEditRequest('conduct_score');
  const isEdit = edit.id !== null;
  const editApplied = useRef(false);
  useEffect(() => {
    const r = edit.request;
    if (!form || !r || editApplied.current) return;
    editApplied.current = true;
    setNote(r.note ?? '');
    FIELD_KEYS.forEach((k) => {
      const v = pendingValue(r, k);
      if (v !== null) {
        setValues((s) => ({ ...s, [k]: v }));
        setOpenFields((s) => ({ ...s, [k]: true }));
      }
    });
    setSemesterCode(purposeOf(r).code);
    const prevDelivery = ((r.payload ?? {}) as { delivery?: { code?: string } }).delivery?.code;
    if (prevDelivery) setDelivery(prevDelivery);
    const a = pendingAddress(r);
    if (a) {
      setStreet(a.street);
      setAddressOpen(true);
      // Danh sách xã có thể chưa nạp xong ⇒ để effect nạp xã chọn giúp; đã nạp thì chọn luôn.
      pendingWardRef.current = a.ward_code;
      if (a.province_code === provinceCode) setWardCode(a.ward_code);
      else setProvinceCode(a.province_code);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, edit.request]);

  useEffect(() => {
    api.requests.conductScoreForm()
      .then((data) => {
        const pf = data.prefill;
        setForm(data);
        setValues({
          dob: pf.dob,
          citizen_id: pf.citizen_id,
          citizen_id_issue_date: pf.citizen_id_issue_date,
        });
        // Hồ sơ có giá trị hợp lệ thì khóa sẵn; trống hoặc không hợp lệ ⇒ mở sẵn.
        setOpenFields({
          dob: !isValidDob(pf.dob),
          citizen_id: !pf.cccd_valid,
          citizen_id_issue_date: !pf.cccd_valid || !isValidIssueDate(pf.citizen_id_issue_date),
        });
        setStreet(pf.street);
        pendingWardRef.current = pf.ward_code || '';
        setProvinceCode(pf.province_code || '');   // trigger nạp xã + pre-select
        // Chỉ khóa cụm địa chỉ khi hồ sơ đã CHUẨN HÓA và đủ cả 3 phần. Bản đoán
        // từ dữ liệu cũ không đáng tin nên để mở cho SV chọn lại.
        setAddressOpen(!(pf.address_standardized && pf.province_code && pf.ward_code && pf.street.trim()));
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Không tải được thông tin sinh viên.'));
    api.locations.provinces().then(setProvinces).catch(() => {});
  }, []);

  // Nạp phường/xã khi đổi tỉnh; pre-select nếu có prefill khớp
  useEffect(() => {
    if (!provinceCode) { setWards([]); setWardCode(''); return; }
    setWardsLoading(true);
    api.locations.wards(provinceCode)
      .then((ws) => {
        setWards(ws);
        const pending = pendingWardRef.current;
        pendingWardRef.current = '';
        setWardCode((prev) => {
          if (pending && ws.some((w) => w.code === pending)) return pending;
          return prev && ws.some((w) => w.code === prev) ? prev : '';
        });
      })
      .catch(() => { setWards([]); setWardCode(''); })
      .finally(() => setWardsLoading(false));
  }, [provinceCode]);

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

  function cancelAddress() {
    if (!form) return;
    const pf = form.prefill;
    setStreet(pf.street);
    pendingWardRef.current = pf.ward_code || '';
    setProvinceCode(pf.province_code || '');
    setFieldErrors((f) => ({ ...f, province: undefined, ward: undefined, street: undefined }));
    setAddressOpen(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    if (!confirmed) { setError(CONSENT_REQUIRED_MSG); return; }
    const pf = form.prefill;

    const errs: FErr = {};
    if (!semesterCode) errs.semester = 'Vui lòng chọn học kỳ hoặc cả năm học.';
    if (!delivery) errs.delivery = 'Vui lòng chọn hình thức nhận.';
    const de = validateDob(values.dob); if (de) errs.dob = de;
    const ce = validateCccd(values.citizen_id, pf.citizen_id); if (ce) errs.citizen_id = ce;
    // Ngày cấp soi khi SV đổi số / đổi ngày, hoặc ngày trong hồ sơ không dùng được —
    // cùng điều kiện với `_cccd_fields` bên backend.
    const cidChanged = values.citizen_id.trim() !== pf.citizen_id.trim();
    const issueChanged = values.citizen_id_issue_date.trim() !== pf.citizen_id_issue_date.trim();
    if (cidChanged || issueChanged || !isValidIssueDate(pf.citizen_id_issue_date)) {
      const ie = validateIssueDate(values.citizen_id_issue_date); if (ie) errs.citizen_id_issue_date = ie;
    }
    // Địa chỉ luôn bắt buộc đủ 3 phần — backend cũng vậy, kể cả khi ô đang khóa.
    if (!provinceCode) errs.province = 'Vui lòng chọn tỉnh/thành.';
    if (!wardCode) errs.ward = 'Vui lòng chọn phường/xã.';
    if (!street.trim()) errs.street = 'Vui lòng nhập địa chỉ chi tiết.';

    setFieldErrors(errs);
    if (Object.keys(errs).length) { setError('Vui lòng kiểm tra lại các trường được đánh dấu.'); return; }
    setError('');
    setLoading(true);
    try {
      await submitOrUpdate(edit, 'conduct_score', api.requests.createConductScore, {
        semester_code: semesterCode,
        delivery,
        dob: values.dob.trim(),
        citizen_id: values.citizen_id.trim(),
        citizen_id_issue_date: values.citizen_id_issue_date.trim(),
        province_code: provinceCode,
        ward_code: wardCode,
        street: street.trim(),
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
          <h2 className="text-lg font-semibold text-ink">{isEdit ? 'Đã cập nhật yêu cầu' : 'Đã gửi yêu cầu'}</h2>
          <p className="text-sm text-muted mt-2">Phòng CTSV sẽ phản hồi trong thời gian sớm nhất.</p>
          <div className="mt-6"><Link href={isEdit ? `/dashboard/requests/${edit.id}` : '/dashboard'} className={ui.btnPrimary}>{isEdit ? 'Xem yêu cầu' : 'Về Bảng thông tin'}</Link></div>
        </div>
      </div>
    );
  }

  const p = form.prefill;
  const noSemester = form.semester_choices.length === 0;
  const originals: Record<FieldKey, string> = {
    dob: p.dob,
    citizen_id: p.citizen_id,
    citizen_id_issue_date: p.citizen_id_issue_date,
  };
  // Giá trị gốc hợp lệ thì có chỗ để quay về ⇒ khóa được + có nút hủy.
  const lockable: Record<FieldKey, boolean> = {
    dob: isValidDob(p.dob),
    citizen_id: p.cccd_valid,
    citizen_id_issue_date: p.cccd_valid && isValidIssueDate(p.citizen_id_issue_date),
  };
  const addressLockable = !!(p.address_standardized && p.province_code && p.ward_code && p.street.trim());
  const addressChanged =
    provinceCode !== p.province_code || wardCode !== p.ward_code || street.trim() !== p.street.trim();
  const editCount =
    FIELD_KEYS.filter((k) => values[k].trim() !== originals[k].trim()).length + (addressChanged ? 1 : 0);

  return (
    <div className="max-w-[760px] space-y-4">
      <nav className="flex items-center gap-1.5 text-[0.82rem] text-muted">
        <Link href="/dashboard" className="hover:text-ink">Bảng thông tin</Link>
        <ChevronRight size={14} className="text-slate-400" />
        <Link href="/dashboard/requests/new" className="hover:text-ink">Yêu cầu giấy tờ</Link>
        <ChevronRight size={14} className="text-slate-400" />
        <span className="text-ink font-medium">Bảng điểm rèn luyện</span>
      </nav>

      <EditRequestBanner edit={edit} />

      <div className={cn(ui.card, 'border-t-2 border-t-primary')}>
        <div className="px-6 py-5 border-b border-line">
          <h1 className="flex items-center gap-2 text-[1.05rem] font-semibold text-ink">
            <FileText size={17} className="text-primary" />
            Bảng điểm rèn luyện
          </h1>
          <p className="text-sm text-muted mt-1">
            Thông tin lấy từ hồ sơ. Chọn học kỳ hoặc cả năm học và hình thức nhận, kiểm tra thông tin, yêu cầu chỉnh sửa nếu sai rồi gửi.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-6">
          <QuotaGuard type="conduct_score" bypass={isEdit}>
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
              <ReadonlyField label="Khóa học" value={p.course_year} />
            </div>
          </div>

          {/* Học kỳ */}
          <div className="sm:max-w-[360px]">
            <label className={ui.fieldLabel}>Học kỳ / năm học cấp bảng điểm rèn luyện <span className="text-red-500">*</span></label>
            {noSemester ? (
              <p className="text-[0.85rem] text-muted">
                Chưa có học kỳ nào kết thúc để cấp bảng điểm rèn luyện. Liên hệ Phòng CTSV nếu cần hỗ trợ.
              </p>
            ) : (
              <>
                <select
                  value={semesterCode}
                  onChange={(e) => { setSemesterCode(e.target.value); setFieldErrors((f) => ({ ...f, semester: undefined })); }}
                  disabled={isEdit}
                  className={cn(ui.input, fieldErrors.semester && 'border-danger-line focus:border-danger-line focus:ring-red-100')}
                >
                  <option value="">— Chọn học kỳ hoặc cả năm học —</option>
                  {form.semester_choices.map((c) => {
                    const used = !isEdit ? usedSemesters[c.code] : undefined;
                    // Đã xin cả năm ⇒ học kỳ lẻ của năm đó bị khoá ⇒ nêu lựa chọn đã xin nếu khác.
                    const usedLabel = used?.semester_label;
                    const suffix = !used ? ''
                      : usedLabel && usedLabel !== c.label ? ` — đã xin ${usedLabel.toLowerCase()}`
                      : ' — đã xin trong học kỳ này';
                    return (
                      <option key={c.code} value={c.code} disabled={!!used}>
                        {c.label}{suffix}
                      </option>
                    );
                  })}
                </select>
                {fieldErrors.semester && <p className="mt-1 text-[0.75rem] text-danger-text">{fieldErrors.semester}</p>}
                {!isEdit && Object.keys(usedSemesters).length > 0 && quota && (
                  <QuotaNotice
                    className="mt-2"
                    reason={`Lựa chọn đã xin trong ${quota.term.label.toLowerCase()} được làm mờ: mỗi học kỳ bảng điểm chỉ được xin 1 lần trong một học kỳ, đã xin cả năm học thì không xin lẻ từng học kỳ của năm học đó, được xin lại khi yêu cầu trước bị từ chối. Trường hợp cần xin cấp thêm, đề nghị liên hệ Phòng Công tác Sinh viên qua email ${quota.contact_email}.`}
                  />
                )}
              </>
            )}
          </div>

          {/* Hình thức nhận */}
          <div>
            <span className={ui.fieldLabel}>Hình thức nhận <span className="text-red-500">*</span></span>
            <div className="grid sm:grid-cols-2 gap-2 sm:max-w-[480px]">
              {form.delivery_choices.map((d) => (
                <label
                  key={d.code}
                  className={cn(
                    'flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg border text-sm cursor-pointer transition-colors',
                    delivery === d.code
                      ? 'border-primary bg-primary-soft text-primary-text font-medium'
                      : 'border-line bg-white text-ink hover:border-slate-400',
                    fieldErrors.delivery && delivery !== d.code && 'border-danger-line',
                  )}
                >
                  <input
                    type="radio" name="delivery" value={d.code}
                    checked={delivery === d.code}
                    onChange={() => { setDelivery(d.code); setFieldErrors((f) => ({ ...f, delivery: undefined })); }}
                    className="accent-primary"
                  />
                  {d.label}
                </label>
              ))}
            </div>
            {fieldErrors.delivery && <p className="mt-1 text-[0.75rem] text-danger-text">{fieldErrors.delivery}</p>}
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
                ? 'Ngày sinh và thông tin CCCD mới được Phòng Công tác Sinh viên duyệt trước khi cập nhật vào hồ sơ.'
                : 'Hồ sơ chưa có CCCD hợp lệ (trống hoặc CMND cũ) — vui lòng nhập số CCCD 12 chữ số và ngày cấp.'}
            </p>
          </div>

          {/* Địa chỉ thường trú — luôn sửa được, tách riêng 3 ô */}
          <div>
            <h2 className="text-[0.82rem] font-semibold text-muted mb-2.5">
              Địa chỉ thường trú
              {addressChanged && <ChangedTag />}
            </h2>

            {addressOpen ? (
              <>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className={ui.fieldLabel}>Tỉnh / Thành phố <span className="text-red-500">*</span></label>
                    <select
                      value={provinceCode}
                      onChange={(e) => { setProvinceCode(e.target.value); setFieldErrors((f) => ({ ...f, province: undefined, ward: undefined })); }}
                      className={cn(ui.input, 'bg-white', fieldErrors.province && 'border-danger-line')}
                    >
                      <option value="">— Chọn tỉnh/thành —</option>
                      {provinces.map((pv) => <option key={pv.code} value={pv.code}>{pv.name}</option>)}
                    </select>
                    {fieldErrors.province && <p className="mt-1 text-[0.75rem] text-danger-text">{fieldErrors.province}</p>}
                  </div>
                  <div>
                    <label className={ui.fieldLabel}>Phường / Xã <span className="text-red-500">*</span></label>
                    <select
                      value={wardCode}
                      disabled={!provinceCode || wardsLoading}
                      onChange={(e) => { setWardCode(e.target.value); setFieldErrors((f) => ({ ...f, ward: undefined })); }}
                      className={cn(ui.input, 'bg-white disabled:bg-slate-50 disabled:text-slate-400', fieldErrors.ward && 'border-danger-line')}
                    >
                      <option value="">{!provinceCode ? '— Chọn tỉnh trước —' : wardsLoading ? 'Đang tải…' : '— Chọn phường/xã —'}</option>
                      {wards.map((w) => <option key={w.code} value={w.code}>{w.name}</option>)}
                    </select>
                    {fieldErrors.ward && <p className="mt-1 text-[0.75rem] text-danger-text">{fieldErrors.ward}</p>}
                  </div>
                </div>
                <div className="mt-3">
                  <label className={ui.fieldLabel}>Địa chỉ chi tiết <span className="text-red-500">*</span></label>
                  <input
                    type="text" value={street} maxLength={255}
                    onChange={(e) => { setStreet(e.target.value); setFieldErrors((f) => ({ ...f, street: undefined })); }}
                    placeholder={STREET_PLACEHOLDER}
                    className={cn(ui.input, fieldErrors.street && 'border-danger-line')}
                  />
                  {fieldErrors.street
                    ? <p className="mt-1 text-[0.75rem] text-danger-text">{fieldErrors.street}</p>
                    : <StreetHint />}
                </div>
                {addressLockable && <CancelEditButton onClick={cancelAddress} />}
                <p className="mt-2 text-[0.78rem] text-muted">
                  {p.address_standardized
                    ? 'Địa chỉ mới được Phòng Công tác Sinh viên duyệt trước khi cập nhật vào hồ sơ.'
                    : 'Hồ sơ chưa có địa chỉ theo đơn vị hành chính hiện hành — vui lòng chọn lại. Địa chỉ chuẩn hóa sẽ được Phòng CTSV duyệt và cập nhật vào hồ sơ.'}
                </p>
              </>
            ) : (
              <>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <div className={ui.label}>Tỉnh / Thành phố</div>
                    <div className="mt-1"><LockedBox value={p.province_name} /></div>
                  </div>
                  <div>
                    <div className={ui.label}>Phường / Xã</div>
                    <div className="mt-1"><LockedBox value={p.ward_name} /></div>
                  </div>
                </div>
                <div className="mt-3">
                  <div className={ui.label}>Địa chỉ chi tiết</div>
                  <div className="mt-1"><LockedBox value={p.street} /></div>
                </div>
                <RequestEditButton onClick={() => setAddressOpen(true)} />
              </>
            )}
          </div>

          {/* Ghi chú — component dùng chung cho mọi form */}
          <RequestNoteField value={note} onChange={setNote} />

          {/* Cam đoan — chưa tích thì nút gửi mờ và khóa */}
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
              <button type="submit" disabled={loading || noSemester || (isEdit && !edit.request)} className={ui.btnPrimary}>
                {loading && <Loader2 size={15} className="animate-spin" />}
                {loading ? 'Đang gửi…' : isEdit ? 'Cập nhật yêu cầu' : 'Gửi yêu cầu'}
              </button>
            </ConsentGate>
          </div>
        </QuotaGuard>
        </form>
      </div>

      <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-slate-50 border-l-2 border-primary">
        <Info size={16} className="text-primary flex-shrink-0 mt-0.5" />
        <p className="text-[0.85rem] text-slate-600 leading-relaxed">
          Thời gian xử lý: <strong className="text-ink font-medium">2–3 ngày làm việc</strong>.
        </p>
      </div>
    </div>
  );
}
