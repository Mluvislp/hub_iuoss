'use client';

/* Phần thân form "Khai báo ngoại trú" — dùng chung cho 2 trang:
   - /dashboard/khai-bao-ngoai-tru  (khai báo độc lập)
   - /dashboard/kham-suc-khoe       (phần 1 của đăng ký khám, gửi kèm đăng ký)
   Trạng thái nằm trong hook `useDeclarationDraft`, trang nào cũng tự quyết khi
   nào gửi và gửi tới đâu; component chỉ vẽ 3 khối cá nhân / thường trú / tạm trú. */

import { useEffect, useState } from 'react';
import { Home, Lock, MapPin, User } from 'lucide-react';
import { accentIcon, ui } from '@/lib/ui';
import { cn, fromDateInput, toDateInput, todayInput } from '@/lib/utils';
import type { CccdValue, OffCampusForm, OffCampusSubmit, Province } from '@/lib/types';
import AddressFields, { AddressValue } from './AddressFields';
import PersonalField from './PersonalField';

const EMPTY_ADDRESS: AddressValue = { provinceCode: '', wardCode: '', street: '' };

/** Ô thông tin cá nhân chỉ xem, không có nút sửa (họ tên, email trường). */
export function ReadonlyField({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <div className="text-[0.82rem] font-medium text-ink mb-1.5">{label}</div>
      <div className={cn(
        'flex items-center gap-2 h-10 px-3 rounded-lg border border-line bg-slate-50 text-sm',
        value ? 'text-ink' : 'text-slate-400 italic',
      )}>
        <Lock size={13} className="text-slate-400 flex-shrink-0" />
        {value || 'Chưa có thông tin'}
      </div>
      {note && <p className="mt-1 text-[0.75rem] text-muted">{note}</p>}
    </div>
  );
}

/** Tile chọn một phương án — theo khuôn option tile của DESIGN.md. */
export function ChoiceTile({
  active, title, desc, onClick, disabled,
}: { active: boolean; title: string; desc: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        'flex items-start gap-3 w-full text-left px-4 py-3 rounded-lg border transition-colors',
        'disabled:opacity-60 disabled:cursor-not-allowed',
        active
          ? 'border-primary bg-primary-soft ring-2 ring-primary-line'
          : 'border-line bg-white hover:bg-slate-50',
      )}
    >
      <span className={cn(
        'mt-0.5 w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center',
        active ? 'border-primary' : 'border-slate-300',
      )}>
        {active && <span className="w-2 h-2 rounded-full bg-primary" />}
      </span>
      <span>
        <span className={cn('block text-sm font-semibold', active ? 'text-primary-text' : 'text-ink')}>
          {title}
        </span>
        <span className="block text-[0.78rem] text-muted mt-0.5">{desc}</span>
      </span>
    </button>
  );
}

/** Toàn bộ trạng thái đang nhập của form khai báo. */
export function useDeclarationDraft(form: OffCampusForm | null) {
  const [drafts, setDrafts] = useState<Record<string, string | undefined>>({});
  // CCCD gồm 3 phần; `drafts['student.citizen_id']` giữ số thẻ, 2 phần còn lại ở đây.
  const [cccdExtra, setCccdExtra] = useState({ issue_place: '', issue_date: '' });
  const [permanent, setPermanent] = useState<AddressValue>(EMPTY_ADDRESS);
  const [temporary, setTemporary] = useState<AddressValue>(EMPTY_ADDRESS);
  const [inHcmc, setInHcmc] = useState<boolean | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Nạp giá trị ban đầu MỘT lần khi form về — tải lại form (sau khi gửi yêu cầu
  // mở lại…) không được xoá những gì SV đang gõ dở.
  const formKey = form ? 'ready' : '';
  useEffect(() => {
    if (!form) return;
    setPermanent({
      provinceCode: form.permanent.prefill.province_code,
      wardCode: form.permanent.prefill.ward_code,
      street: form.permanent.prefill.street,
    });
    setTemporary({
      provinceCode: form.temporary.prefill.province_code,
      wardCode: form.temporary.prefill.ward_code,
      street: form.temporary.prefill.street,
    });
    setInHcmc(form.temporary_in_hcmc);
    const cccd = (form.fields['student.citizen_id']?.value ?? {}) as CccdValue;
    setCccdExtra({
      issue_place: cccd.issue_place || '',
      issue_date: toDateInput(cccd.issue_date || ''),
    });
    // Trường đang trống thì mở sẵn ô nhập — không bắt bấm "Bổ sung" mới nhập được.
    const open: Record<string, string | undefined> = {};
    Object.entries(form.fields).forEach(([key, f]) => {
      const shown = key === 'student.citizen_id'
        ? (f.value as CccdValue)?.number : (f.value as string);
      if (!shown) open[key] = '';
    });
    setDrafts(open);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formKey]);

  const clearError = (key: string) =>
    setFieldErrors((f) => { const next = { ...f }; delete next[key]; return next; });

  /** Chặn sớm ở client các ô bắt buộc; trả về map lỗi (rỗng = qua). */
  function validate(): Record<string, string> {
    const local: Record<string, string> = {};
    if (!permanent.provinceCode) local.permanent_province = 'Vui lòng chọn tỉnh/thành.';
    if (!permanent.wardCode) local.permanent_ward = 'Vui lòng chọn phường/xã.';
    if (!permanent.street.trim()) local.permanent_street = 'Vui lòng nhập địa chỉ chi tiết.';
    if (inHcmc === null) local.temporary_in_hcmc = 'Vui lòng chọn có hoặc không.';
    else {
      if (!inHcmc && !temporary.provinceCode) local.temporary_province = 'Vui lòng chọn tỉnh/thành.';
      if (!temporary.wardCode) local.temporary_ward = 'Vui lòng chọn phường/xã.';
      if (!temporary.street.trim()) local.temporary_street = 'Vui lòng nhập địa chỉ chi tiết.';
    }
    return local;
  }

  function payload(): OffCampusSubmit {
    return {
      citizen_id: drafts['student.citizen_id']?.trim()
        ? {
            number: drafts['student.citizen_id']!.trim(),
            issue_place: cccdExtra.issue_place.trim(),
            issue_date: fromDateInput(cccdExtra.issue_date),
          }
        : undefined,
      personal_email: drafts['contact.personal_email']?.trim() || undefined,
      mobile_phone: drafts['contact.mobile_phone']?.trim() || undefined,
      permanent: {
        province_code: permanent.provinceCode,
        ward_code: permanent.wardCode,
        street: permanent.street,
      },
      temporary_in_hcmc: inHcmc,
      temporary: {
        province_code: inHcmc ? (form?.hcmc_province_code ?? '') : temporary.provinceCode,
        ward_code: temporary.wardCode,
        street: temporary.street,
      },
    };
  }

  return {
    drafts, setDrafts, cccdExtra, setCccdExtra,
    permanent, setPermanent, temporary, setTemporary, inHcmc, setInHcmc,
    fieldErrors, setFieldErrors, clearError, validate, payload,
  };
}

export type DeclarationDraft = ReturnType<typeof useDeclarationDraft>;

/** 3 khối nhập: cá nhân · thường trú · tạm trú. */
export function DeclarationFields({
  form, draft, provinces,
}: { form: OffCampusForm; draft: DeclarationDraft; provinces: Province[] }) {
  const {
    drafts, setDrafts, cccdExtra, setCccdExtra, permanent, setPermanent,
    temporary, setTemporary, inHcmc, setInHcmc, fieldErrors, clearError,
  } = draft;
  const cccdCurrent = (form.fields['student.citizen_id']?.value ?? {}) as CccdValue;
  const setDraft = (key: string, value: string | undefined) =>
    setDrafts((d) => ({ ...d, [key]: value }));

  return (
    <>
      {/* ── 1. Thông tin cá nhân ── */}
      <section>
        <h2 className="flex items-center gap-2 text-[0.88rem] font-semibold text-ink mb-1">
          <User size={15} className={accentIcon.primary} /> Thông tin cá nhân
        </h2>
        <p className="text-[0.78rem] text-muted mb-3">
          Thông tin lấy từ hồ sơ của trường. Cần sửa thì bấm <b>Yêu cầu chỉnh sửa</b> —
          thay đổi sẽ được phòng CTSV duyệt trước khi có hiệu lực.
        </p>

        <div className="grid sm:grid-cols-2 gap-4">
          <ReadonlyField label="Họ và tên" value={form.student.full_name} />
          <ReadonlyField label="Mã số sinh viên" value={form.student.student_code} />
          <ReadonlyField
            label="Email trường cấp"
            value={form.student.university_email}
            note="Do trường cấp, không tự sửa được."
          />
          <PersonalField
            field={{ ...form.fields['student.citizen_id'], value: cccdCurrent.number }}
            draft={drafts['student.citizen_id']}
            placeholder="12 chữ số"
            onUnlock={() => setDraft('student.citizen_id', cccdCurrent.number)}
            onCancel={() => setDraft('student.citizen_id', undefined)}
            onChange={(v) => { setDraft('student.citizen_id', v); clearError('citizen_id'); }}
            error={fieldErrors.citizen_id}
            extra={
              <div className="grid sm:grid-cols-2 gap-2 mt-2">
                <div>
                  <label className="block text-[0.75rem] text-muted mb-1">Nơi cấp</label>
                  <input
                    type="text" value={cccdExtra.issue_place} maxLength={255}
                    placeholder="Cục Cảnh sát QLHC về TTXH"
                    onChange={(e) => setCccdExtra((s) => ({ ...s, issue_place: e.target.value }))}
                    className={cn(ui.input, 'h-9 text-[0.85rem]')}
                  />
                </div>
                <div>
                  <label className="block text-[0.75rem] text-muted mb-1">Ngày cấp</label>
                  <input
                    type="date"
                    value={cccdExtra.issue_date}
                    max={todayInput()}
                    onChange={(e) => setCccdExtra((s) => ({ ...s, issue_date: e.target.value }))}
                    className={cn(ui.input, 'h-9 text-[0.85rem]')}
                  />
                </div>
              </div>
            }
          />
          <PersonalField
            field={{ ...form.fields['contact.personal_email'],
                     value: form.fields['contact.personal_email'].value as string }}
            draft={drafts['contact.personal_email']}
            placeholder="vidu@gmail.com"
            onUnlock={() => setDraft('contact.personal_email', form.fields['contact.personal_email'].value as string)}
            onCancel={() => setDraft('contact.personal_email', undefined)}
            onChange={(v) => { setDraft('contact.personal_email', v); clearError('personal_email'); }}
            error={fieldErrors.personal_email}
            hint="Không dùng email do trường cấp."
          />
          <PersonalField
            field={{ ...form.fields['contact.mobile_phone'],
                     value: form.fields['contact.mobile_phone'].value as string }}
            draft={drafts['contact.mobile_phone']}
            placeholder="0912345678"
            onUnlock={() => setDraft('contact.mobile_phone', form.fields['contact.mobile_phone'].value as string)}
            onCancel={() => setDraft('contact.mobile_phone', undefined)}
            onChange={(v) => { setDraft('contact.mobile_phone', v); clearError('mobile_phone'); }}
            error={fieldErrors.mobile_phone}
          />
        </div>
      </section>

      {/* ── 2. Thường trú ── */}
      <section>
        <h2 className="flex items-center gap-2 text-[0.88rem] font-semibold text-ink mb-1">
          <MapPin size={15} className={accentIcon.primary} /> Địa chỉ thường trú
        </h2>
        <p className="text-[0.78rem] text-muted mb-3">Địa chỉ theo hộ khẩu / nơi ở lâu dài của gia đình.</p>
        <AddressFields
          idPrefix="perm"
          value={permanent}
          onChange={(v) => {
            setPermanent(v);
            ['permanent_province', 'permanent_ward', 'permanent_street', 'permanent_location']
              .forEach(clearError);
          }}
          provinces={provinces}
          errors={{
            province: fieldErrors.permanent_province || fieldErrors.permanent_location,
            ward: fieldErrors.permanent_ward,
            street: fieldErrors.permanent_street,
          }}
        />
      </section>

      {/* ── 3. Tạm trú ── */}
      <section>
        <h2 className="flex items-center gap-2 text-[0.88rem] font-semibold text-ink mb-1">
          <Home size={15} className={accentIcon.primary} /> Nơi tạm trú hiện tại
        </h2>
        <p className="text-[0.78rem] text-muted mb-3">
          Sinh viên hiện có đang tạm trú tại Thành phố Hồ Chí Minh hay không?
          <span className="text-red-500"> *</span>
        </p>

        <div className="grid sm:grid-cols-2 gap-3">
          <ChoiceTile
            active={inHcmc === true}
            title="Có"
            desc="Đang tạm trú tại TP. Hồ Chí Minh"
            onClick={() => {
              setInHcmc(true);
              setTemporary((t) => ({ ...t, provinceCode: form.hcmc_province_code, wardCode: '' }));
              ['temporary_in_hcmc', 'temporary_province', 'temporary_location']
                .forEach(clearError);
            }}
          />
          <ChoiceTile
            active={inHcmc === false}
            title="Không"
            desc="Đang ở tỉnh/thành phố khác"
            onClick={() => {
              setInHcmc(false);
              setTemporary((t) => ({ ...t, provinceCode: '', wardCode: '' }));
              ['temporary_in_hcmc', 'temporary_province', 'temporary_location']
                .forEach(clearError);
            }}
          />
        </div>
        {fieldErrors.temporary_in_hcmc && (
          <p className="mt-1.5 text-[0.75rem] text-danger-text">{fieldErrors.temporary_in_hcmc}</p>
        )}

        {inHcmc !== null && (
          <div className="mt-4">
            <AddressFields
              idPrefix="temp"
              value={temporary}
              onChange={(v) => {
                setTemporary(v);
                ['temporary_province', 'temporary_ward', 'temporary_street', 'temporary_location']
                  .forEach(clearError);
              }}
              /* Nhánh "Không" không được phép chọn lại TP.HCM — để lại
                 trong danh sách là hai câu trả lời chọi nhau. */
              provinces={inHcmc
                ? provinces
                : provinces.filter((p) => p.code !== form.hcmc_province_code)}
              lockedProvinceCode={inHcmc ? form.hcmc_province_code : undefined}
              errors={{
                province: fieldErrors.temporary_province || fieldErrors.temporary_location,
                ward: fieldErrors.temporary_ward,
                street: fieldErrors.temporary_street,
              }}
            />
          </div>
        )}
      </section>
    </>
  );
}

/** Bản xem lại (form đã khóa): thông tin cá nhân + địa chỉ đã khai. */
export function DeclarationSummary({ form }: { form: OffCampusForm }) {
  const row = (label: string, value: string) => (
    <div key={label} className="flex items-start justify-between gap-4 py-2.5 border-b border-line2 last:border-0">
      <span className="text-sm text-muted">{label}</span>
      <span className={cn('text-sm text-right', value ? 'font-medium text-ink' : 'italic text-slate-400')}>
        {value || 'Chưa có'}
      </span>
    </div>
  );
  return (
    <>
      <section>
        <h2 className="flex items-center gap-2 text-[0.88rem] font-semibold text-ink mb-2">
          <User size={15} className={accentIcon.primary} /> Thông tin cá nhân
        </h2>
        <div className="rounded-lg border border-line px-4 py-1">
          {row('Họ và tên', form.student.full_name)}
          {row('Mã số sinh viên', form.student.student_code)}
          {row('Email trường cấp', form.student.university_email)}
          {Object.entries(form.fields).map(([key, f]) => row(
            f.label,
            key === 'student.citizen_id'
              ? [(f.value as CccdValue).number,
                 (f.value as CccdValue).issue_place,
                 (f.value as CccdValue).issue_date
                   ? 'cấp ngày ' + (f.value as CccdValue).issue_date : '']
                  .filter(Boolean).join(' · ')
              : (f.value as string),
          ))}
        </div>
      </section>

      <section>
        <h2 className="flex items-center gap-2 text-[0.88rem] font-semibold text-ink mb-2">
          <MapPin size={15} className={accentIcon.primary} /> Địa chỉ đã khai
        </h2>
        <div className="rounded-lg border border-line px-4 py-1">
          {row('Thường trú', form.permanent.display)}
          {row('Tạm trú', form.temporary.display)}
          {row('Tạm trú tại TP.HCM', form.temporary_in_hcmc ? 'Có' : 'Không')}
        </div>
      </section>
    </>
  );
}
