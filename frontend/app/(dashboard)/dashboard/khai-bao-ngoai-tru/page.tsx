'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle, Check, ChevronRight, Home, Loader2, Lock, MapPin, PencilLine, ShieldCheck, User,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { ui, badge, accentIcon } from '@/lib/ui';
import { cn } from '@/lib/utils';
import type { CccdValue, OffCampusForm, Province } from '@/lib/types';
import AddressFields, { AddressValue } from './AddressFields';
import PersonalField from './PersonalField';

const EMPTY_ADDRESS: AddressValue = { provinceCode: '', wardCode: '', street: '' };

/* API dùng dd/mm/yyyy (thống nhất với các form giấy tờ khác), còn
   <input type="date"> chỉ nhận yyyy-mm-dd — đổi qua lại ở đúng biên này. */
const toISODate = (vn: string) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((vn || '').trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
};
const toVNDate = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso || '').trim());
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};
const TODAY_ISO = new Date().toISOString().slice(0, 10);

/** Ô thông tin cá nhân chỉ xem, không có nút sửa (họ tên, email trường). */
function ReadonlyField({ label, value, note }: { label: string; value: string; note?: string }) {
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

/** Tile chọn Có / Không — theo khuôn option tile của DESIGN.md. */
function ChoiceTile({
  active, title, desc, onClick,
}: { active: boolean; title: string; desc: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex items-start gap-3 w-full text-left px-4 py-3 rounded-lg border transition-colors',
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

export default function OffCampusDeclarationPage() {
  const [form, setForm] = useState<OffCampusForm | null>(null);
  const [provinces, setProvinces] = useState<Province[]>([]);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);

  const [drafts, setDrafts] = useState<Record<string, string | undefined>>({});
  // CCCD gồm 3 phần; `drafts['student.citizen_id']` giữ số thẻ, 2 phần còn lại ở đây.
  const [cccdExtra, setCccdExtra] = useState({ issue_place: '', issue_date: '' });
  const [asking, setAsking] = useState(false);
  const [askReason, setAskReason] = useState('');
  const [permanent, setPermanent] = useState<AddressValue>(EMPTY_ADDRESS);
  const [temporary, setTemporary] = useState<AddressValue>(EMPTY_ADDRESS);
  const [inHcmc, setInHcmc] = useState<boolean | null>(null);

  useEffect(() => {
    api.offcampus
      .form()
      .then((data) => {
        setForm(data);
        setPermanent({
          provinceCode: data.permanent.prefill.province_code,
          wardCode: data.permanent.prefill.ward_code,
          street: data.permanent.prefill.street,
        });
        setTemporary({
          provinceCode: data.temporary.prefill.province_code,
          wardCode: data.temporary.prefill.ward_code,
          street: data.temporary.prefill.street,
        });
        setInHcmc(data.temporary_in_hcmc);
        // Trường đang trống thì mở sẵn ô nhập — không bắt bấm "Bổ sung" mới nhập được.
        const cccd = (data.fields['student.citizen_id']?.value ?? {}) as CccdValue;
        setCccdExtra({
          issue_place: cccd.issue_place || '',
          issue_date: toISODate(cccd.issue_date || ''),
        });
        const open: Record<string, string | undefined> = {};
        Object.entries(data.fields).forEach(([key, f]) => {
          const shown = key === 'student.citizen_id'
            ? (f.value as CccdValue)?.number : (f.value as string);
          if (!shown) open[key] = '';
        });
        setDrafts(open);
      })
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : 'Không tải được dữ liệu.'));
    api.locations.provinces().then(setProvinces).catch(() => {});
  }, []);

  if (loadError) {
    return (
      <div className="max-w-[820px]">
        <div className="flex items-start gap-2.5 px-4 py-3 rounded-lg bg-danger-soft border border-danger-line text-danger-text text-sm">
          <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />{loadError}
        </div>
      </div>
    );
  }
  if (!form) {
    return (
      <div className="flex items-center justify-center py-20 text-muted">
        <Loader2 size={22} className="animate-spin mr-2" /> Đang tải…
      </div>
    );
  }

  if (success) {
    return (
      <div className="max-w-[820px]">
        <div className={cn(ui.card, 'p-8 text-center')}>
          <div className="w-11 h-11 rounded-full bg-success-soft border border-success-line flex items-center justify-center mx-auto mb-4">
            <Check size={22} className="text-success-text" />
          </div>
          <h2 className="text-lg font-semibold text-ink">Đã ghi nhận khai báo</h2>
          <p className="text-sm text-muted mt-2">
            Thông tin của bạn đã được cập nhật vào hồ sơ. Cần sửa lại thì gửi yêu cầu
            chỉnh sửa ở màn hình xem lại.
          </p>
          <div className="mt-6 flex items-center justify-center gap-2">
            <Link href="/dashboard" className={ui.btnPrimary}>Về Bảng thông tin</Link>
            <button type="button" className={ui.btnOutline}
                    onClick={() => { setSuccess(false); window.location.reload(); }}>
              Xem lại khai báo
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Đã khai và chưa được mở lại → chỉ xem, không hiện form.
  if (form.locked) {
    const row = (label: string, value: string) => (
      <div key={label} className="flex items-start justify-between gap-4 py-2.5 border-b border-line2 last:border-0">
        <span className="text-sm text-muted">{label}</span>
        <span className={cn('text-sm text-right', value ? 'font-medium text-ink' : 'italic text-slate-400')}>
          {value || 'Chưa có'}
        </span>
      </div>
    );
    return (
      <div className="max-w-[820px] space-y-4">
        <nav className="flex items-center gap-1.5 text-[0.82rem] text-muted">
          <Link href="/dashboard" className="hover:text-ink">Bảng thông tin</Link>
          <ChevronRight size={14} className="text-slate-400" />
          <span className="text-ink font-medium">Khai báo ngoại trú</span>
        </nav>

        <div className={cn(ui.card, 'border-t-2 border-t-primary')}>
          <div className="px-6 py-5 border-b border-line">
            <h1 className="flex items-center gap-2 text-[1.05rem] font-semibold text-ink">
              <ShieldCheck size={17} className="text-success-text" />
              Bạn đã hoàn tất khai báo
            </h1>
            <p className="text-sm text-muted mt-1">
              {form.declared_on
                ? `Bạn đã gửi khai báo ngày ${new Date(form.declared_on).toLocaleDateString('vi-VN')}. `
                : ''}
              Thông tin bên dưới đang được dùng làm hồ sơ chính thức. Nếu có thay đổi,
              hãy gửi yêu cầu chỉnh sửa để phòng CTSV mở lại biểu mẫu cho bạn.
            </p>
          </div>

          <div className="px-6 py-5 space-y-6">
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

            {!form.reopen_requested && (
              <div>
                <label className="block text-[0.78rem] text-muted mb-1">
                  Lý do cần chỉnh sửa <span className="text-slate-400">(không bắt buộc)</span>
                </label>
                <input
                  type="text" value={askReason} maxLength={255}
                  placeholder="Ví dụ: đã chuyển chỗ trọ, sai số nhà…"
                  onChange={(e) => setAskReason(e.target.value)}
                  className={cn(ui.input, 'h-9 text-[0.85rem]')}
                />
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              {form.reopen_requested ? (
                <span className={cn(badge.base, badge.warning)}>
                  Đã gửi yêu cầu chỉnh sửa
                  {form.reopen_requested_at ? ` ngày ${form.reopen_requested_at}` : ''} — chờ phòng CTSV xử lý
                </span>
              ) : (
                <button
                  type="button"
                  className={ui.btnOutline}
                  disabled={asking}
                  onClick={async () => {
                    setAsking(true);
                    setError('');
                    try {
                      await api.offcampus.requestReopen(askReason.trim());
                      const fresh = await api.offcampus.form();
                      setForm(fresh);
                    } catch (e) {
                      setError(e instanceof ApiError ? e.message : 'Không gửi được yêu cầu.');
                    } finally {
                      setAsking(false);
                    }
                  }}
                >
                  {asking ? <><Loader2 size={15} className="animate-spin" /> Đang gửi…</>
                          : <><PencilLine size={15} /> Yêu cầu chỉnh sửa lại</>}
                </button>
              )}
              <Link href="/dashboard" className={ui.btnPrimary}>Về Bảng thông tin</Link>
            </div>
            {error && (
              <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-danger-soft border border-danger-line text-danger-text text-sm">
                <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />{error}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const cccdCurrent = (form.fields['student.citizen_id']?.value ?? {}) as CccdValue;

  const setDraft = (key: string, value: string | undefined) =>
    setDrafts((d) => ({ ...d, [key]: value }));

  const clearError = (key: string) =>
    setFieldErrors((f) => { const next = { ...f }; delete next[key]; return next; });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setError('');
    setFieldErrors({});

    // Chặn sớm ở client cho các ô bắt buộc — lỗi còn lại để server quyết.
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
    if (Object.keys(local).length) {
      setFieldErrors(local);
      setError('Vui lòng kiểm tra lại các ô được đánh dấu.');
      return;
    }

    setSaving(true);
    try {
      await api.offcampus.submit({
        citizen_id: drafts['student.citizen_id']?.trim()
          ? {
              number: drafts['student.citizen_id']!.trim(),
              issue_place: cccdExtra.issue_place.trim(),
              issue_date: toVNDate(cccdExtra.issue_date),
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
          province_code: inHcmc ? form.hcmc_province_code : temporary.provinceCode,
          ward_code: temporary.wardCode,
          street: temporary.street,
        },
      });
      setSuccess(true);
    } catch (e) {
      if (e instanceof ApiError && e.data?.errors) {
        setFieldErrors(e.data.errors as Record<string, string>);
        setError('Vui lòng kiểm tra lại các ô được đánh dấu.');
      } else {
        setError(e instanceof ApiError ? e.message : 'Không gửi được khai báo.');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-[820px] space-y-4">
      <nav className="flex items-center gap-1.5 text-[0.82rem] text-muted">
        <Link href="/dashboard" className="hover:text-ink">Bảng thông tin</Link>
        <ChevronRight size={14} className="text-slate-400" />
        <span className="text-ink font-medium">Khai báo ngoại trú</span>
      </nav>

      <div className={cn(ui.card, 'border-t-2 border-t-primary')}>
        <div className="px-6 py-5 border-b border-line">
          <h1 className="flex items-center gap-2 text-[1.05rem] font-semibold text-ink">
            <Home size={17} className="text-primary" />
            Khai báo thông tin ngoại trú
          </h1>
          <p className="text-sm text-muted mt-1">
            Cập nhật địa chỉ thường trú và tạm trú theo đơn vị hành chính mới (áp dụng từ 2025 —
            bỏ cấp quận/huyện, chỉ còn Tỉnh/Thành phố và Phường/Xã).
          </p>
          <p className="mt-2 text-[0.78rem] text-muted">
            Kiểm tra kỹ thông tin trước khi gửi.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-7">
          {error && (
            <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-lg bg-danger-soft border border-danger-line text-danger-text text-sm">
              <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />{error}
            </div>
          )}

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
                        max={TODAY_ISO}
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
                  clearError('temporary_in_hcmc');
                }}
              />
              <ChoiceTile
                active={inHcmc === false}
                title="Không"
                desc="Đang ở tỉnh/thành phố khác"
                onClick={() => {
                  setInHcmc(false);
                  setTemporary((t) => ({ ...t, provinceCode: '', wardCode: '' }));
                  clearError('temporary_in_hcmc');
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
                  provinces={provinces}
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

          <div className="flex items-center justify-end gap-2 pt-1 border-t border-line2">
            <Link href="/dashboard" className={ui.btnGhost}>Hủy</Link>
            <button type="submit" disabled={saving} className={ui.btnPrimary}>
              {saving ? <><Loader2 size={15} className="animate-spin" /> Đang gửi…</> : 'Gửi khai báo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
