'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { AlertCircle, Check, ChevronRight, Clock, Loader2, Lock, PencilLine, RotateCcw, UserRound } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { ui, badge } from '@/lib/ui';
import { cn, toDateInput, fromDateInput, todayInput, DATE_INPUT_MIN } from '@/lib/utils';
import { ReadonlyField } from '@/components/editable-field';
import { RejectionNotice } from '@/components/rejection-notice';
import SearchableSelect from '@/components/searchable-select';
import type {
  BankAccountValue, CitizenIdValue, HighSchoolValue, ParentValue, PersonalInfoData,
  PersonalInfoGroup, PersonalInfoKey, PersonalInfoValue, Province,
} from '@/lib/types';

/* Mọi cụm sửa được đều gửi Phòng Công tác Sinh viên duyệt (kể cả khai lần đầu).
   Cụm đang chờ duyệt bị khóa; cụm bị từ chối mở sẵn với giá trị đã gửi để sửa lại.
   Chỉ gửi những cụm khác hồ sơ. */

type Drafts = Partial<Record<PersonalInfoKey, PersonalInfoValue>>;

const EMPTY: Record<PersonalInfoKey, PersonalInfoValue> = {
  personal_email: '',
  mobile_phone: '',
  citizen_id: { number: '', issue_place: '', issue_date: '' },
  bank_account: { bank_name: '', account_number: '', branch_address: '' },
  father: { orphan: false, full_name: '', phone: '', email: '', occupation: '' },
  mother: { orphan: false, full_name: '', phone: '', email: '', occupation: '' },
  high_school: { province: '', school_name: '' },
};

function same(a: PersonalInfoValue | undefined, b: PersonalInfoValue | undefined): boolean {
  const norm = (v: PersonalInfoValue | undefined) =>
    typeof v === 'string' || v === undefined
      ? (v ?? '').trim()
      : JSON.stringify(Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === 'string' ? x.trim() : x])));
  return norm(a) === norm(b);
}

function initialDrafts(groups: PersonalInfoGroup[]): Drafts {
  const d: Drafts = {};
  for (const g of groups) {
    if (g.pending) continue;
    if (g.rejection) d[g.key] = g.rejection.value;
    else if (g.is_blank) d[g.key] = typeof g.value === 'string' ? g.value : { ...EMPTY[g.key] as object, ...g.value as object } as PersonalInfoValue;
  }
  return d;
}

function fmtDateTime(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }) : '';
}

// ── Ô nhập dùng chung ────────────────────────────────────────────────────────

function Field({ label, required, children, className }: {
  label: string; required?: boolean; children: ReactNode; className?: string;
}) {
  return (
    <div className={className}>
      <label className={ui.fieldLabel}>
        {label}{required && <span className="text-danger-text"> *</span>}
      </label>
      {children}
    </div>
  );
}

function TextInput({ value, onChange, maxLength = 255, placeholder, inputMode, list }: {
  value: string; onChange: (v: string) => void; maxLength?: number; placeholder?: string;
  inputMode?: 'numeric' | 'text' | 'email' | 'tel'; list?: string;
}) {
  return (
    <input type="text" value={value} maxLength={maxLength} placeholder={placeholder}
           inputMode={inputMode} list={list} onChange={(e) => onChange(e.target.value)}
           className={ui.input} />
  );
}

function DateInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input type="date" value={toDateInput(value)} min={DATE_INPUT_MIN} max={todayInput()}
           onChange={(e) => onChange(fromDateInput(e.target.value))} className={ui.input} />
  );
}

/** Một dòng giá trị đang khóa. */
function LockedRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className={ui.label}>{label}</div>
      <div className="mt-1 flex items-center gap-2 h-10 px-3 rounded-lg border border-line bg-slate-50 text-sm text-ink">
        <Lock size={13} className="text-slate-400 flex-shrink-0" />
        <span className={cn('truncate', !value && 'text-slate-400 italic')}>{value || 'Chưa có thông tin'}</span>
      </div>
    </div>
  );
}

// ── Hiển thị khi khóa ────────────────────────────────────────────────────────

function LockedView({ k, value }: { k: PersonalInfoKey; value: PersonalInfoValue }) {
  switch (k) {
    case 'personal_email':
    case 'mobile_phone':
      return <LockedRow label={k === 'personal_email' ? 'Email cá nhân' : 'Số điện thoại'} value={value as string} />;
    case 'citizen_id': {
      const v = value as CitizenIdValue;
      return (
        <div className="grid sm:grid-cols-3 gap-3">
          <LockedRow label="Số CCCD" value={v.number} />
          <LockedRow label="Ngày cấp" value={v.issue_date} />
          <LockedRow label="Nơi cấp" value={v.issue_place} />
        </div>
      );
    }
    case 'bank_account': {
      const v = value as BankAccountValue;
      return (
        <div className="grid sm:grid-cols-2 gap-3">
          <LockedRow label="Ngân hàng" value={v.bank_name} />
          <LockedRow label="Số tài khoản" value={v.account_number} />
          <div className="sm:col-span-2"><LockedRow label="Chi nhánh" value={v.branch_address} /></div>
        </div>
      );
    }
    case 'father':
    case 'mother': {
      const v = value as ParentValue;
      return (
        <div className="grid sm:grid-cols-2 gap-3">
          {v.orphan && (
            <div className="sm:col-span-2">
              <span className={cn(badge.base, badge.neutral)}>{k === 'father' ? 'Mồ côi cha' : 'Mồ côi mẹ'}</span>
            </div>
          )}
          <LockedRow label="Họ tên" value={v.full_name} />
          {!v.orphan && <LockedRow label="Số điện thoại" value={v.phone} />}
          {!v.orphan && <LockedRow label="Nghề nghiệp" value={v.occupation} />}
          {!v.orphan && <LockedRow label="Email" value={v.email} />}
        </div>
      );
    }
    case 'high_school': {
      const v = value as HighSchoolValue;
      return (
        <div className="grid sm:grid-cols-2 gap-3">
          <LockedRow label="Tỉnh/thành" value={v.province} />
          <LockedRow label="Tên trường" value={v.school_name} />
        </div>
      );
    }
  }
}

// ── Ô nhập khi mở ────────────────────────────────────────────────────────────

function EditView({ k, value, onChange, provinces, bankSuggestions }: {
  k: PersonalInfoKey;
  value: PersonalInfoValue;
  onChange: (v: PersonalInfoValue) => void;
  provinces: Province[];
  bankSuggestions: string[];
}) {
  switch (k) {
    case 'personal_email':
      return (
        <Field label="Email cá nhân" required>
          <TextInput value={value as string} onChange={onChange} inputMode="email" placeholder="ten@gmail.com" />
        </Field>
      );
    case 'mobile_phone':
      return (
        <Field label="Số điện thoại" required>
          <TextInput value={value as string} onChange={onChange} inputMode="tel" maxLength={15} placeholder="09xxxxxxxx" />
        </Field>
      );
    case 'citizen_id': {
      const v = value as CitizenIdValue;
      const set = (p: Partial<CitizenIdValue>) => onChange({ ...v, ...p });
      return (
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Số CCCD" required>
            <TextInput value={v.number} onChange={(x) => set({ number: x })} inputMode="numeric" maxLength={12} placeholder="12 chữ số" />
          </Field>
          <Field label="Ngày cấp" required>
            <DateInput value={v.issue_date} onChange={(x) => set({ issue_date: x })} />
          </Field>
          <Field label="Nơi cấp" required>
            <TextInput value={v.issue_place} onChange={(x) => set({ issue_place: x })}
                       placeholder="Cục Cảnh sát QLHC về TTXH" />
          </Field>
        </div>
      );
    }
    case 'bank_account': {
      const v = value as BankAccountValue;
      const set = (p: Partial<BankAccountValue>) => onChange({ ...v, ...p });
      return (
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Ngân hàng" required>
            <TextInput value={v.bank_name} onChange={(x) => set({ bank_name: x })} list="pi-banks"
                       placeholder="Chọn hoặc nhập tên ngân hàng" />
            <datalist id="pi-banks">{bankSuggestions.map((b) => <option key={b} value={b} />)}</datalist>
          </Field>
          <Field label="Số tài khoản" required>
            <TextInput value={v.account_number} onChange={(x) => set({ account_number: x })} inputMode="numeric" maxLength={24} />
          </Field>
          <Field label="Chi nhánh" className="sm:col-span-2">
            <TextInput value={v.branch_address} onChange={(x) => set({ branch_address: x })} maxLength={500}
                       placeholder="Ví dụ: Chi nhánh Thủ Đức" />
          </Field>
        </div>
      );
    }
    case 'father':
    case 'mother': {
      const v = value as ParentValue;
      const set = (p: Partial<ParentValue>) => onChange({ ...v, ...p });
      const who = k === 'father' ? 'cha' : 'mẹ';
      return (
        <div className="space-y-3">
          <label className="inline-flex items-center gap-2 text-sm text-ink cursor-pointer select-none">
            <input type="checkbox" checked={v.orphan} onChange={(e) => set({ orphan: e.target.checked })}
                   className="h-4 w-4 rounded border-line accent-[var(--color-primary,#155e75)]" />
            Mồ côi {who}
          </label>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label={`Họ tên ${who}`} required={!v.orphan}>
              <TextInput value={v.full_name} onChange={(x) => set({ full_name: x })} />
            </Field>
            {!v.orphan && (
              <>
                <Field label="Số điện thoại" required>
                  <TextInput value={v.phone} onChange={(x) => set({ phone: x })} inputMode="tel" maxLength={15} />
                </Field>
                <Field label="Nghề nghiệp" required>
                  <TextInput value={v.occupation} onChange={(x) => set({ occupation: x })} />
                </Field>
                <Field label="Email">
                  <TextInput value={v.email} onChange={(x) => set({ email: x })} inputMode="email" />
                </Field>
              </>
            )}
          </div>
        </div>
      );
    }
    case 'high_school': {
      const v = value as HighSchoolValue;
      const set = (p: Partial<HighSchoolValue>) => onChange({ ...v, ...p });
      const options = provinces.map((p) => ({ value: p.name, label: p.name }));
      if (v.province && !options.some((o) => o.value === v.province)) {
        options.unshift({ value: v.province, label: v.province });
      }
      return (
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Tỉnh/thành" required>
            <SearchableSelect value={v.province} onChange={(x) => set({ province: x })} options={options}
                              placeholder="Chọn tỉnh/thành" searchPlaceholder="Tìm tỉnh/thành…" />
          </Field>
          <Field label="Tên trường" required>
            <TextInput value={v.school_name} onChange={(x) => set({ school_name: x })} placeholder="THPT …" />
          </Field>
        </div>
      );
    }
  }
}

// ── Một cụm ──────────────────────────────────────────────────────────────────

function GroupBlock({ group, draft, error, onOpen, onCancel, onChange, provinces, bankSuggestions }: {
  group: PersonalInfoGroup;
  draft: PersonalInfoValue | undefined;
  error?: string;
  onOpen: () => void;
  onCancel: () => void;
  onChange: (v: PersonalInfoValue) => void;
  provinces: Province[];
  bankSuggestions: string[];
}) {
  const open = draft !== undefined;
  const changed = open && !same(draft, group.value);
  // Hồ sơ trống ⇒ không có giá trị gốc để quay về, cụm luôn mở.
  const canCancel = open && !group.is_blank;

  return (
    <div className="py-4 first:pt-0 last:pb-0 border-b border-line2 last:border-0">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <span className="text-[0.9rem] font-semibold text-ink">{group.label}</span>
          {group.pending && <span className={cn(badge.base, badge.warning)}><Clock size={11} /> Chờ duyệt</span>}
          {changed && <span className={cn(badge.base, badge.info)}><PencilLine size={11} /> Sẽ gửi duyệt</span>}
        </div>
        {!group.pending && (open
          ? canCancel && (
            <button type="button" onClick={onCancel}
                    className="inline-flex items-center gap-1 text-[0.78rem] font-medium text-muted hover:text-ink">
              <RotateCcw size={12} /> Hủy chỉnh sửa
            </button>
          )
          : (
            <button type="button" onClick={onOpen}
                    className="inline-flex items-center gap-1 text-[0.78rem] font-medium text-primary-text hover:underline">
              <PencilLine size={12} /> Yêu cầu chỉnh sửa
            </button>
          ))}
      </div>

      {group.rejection && !group.pending && (
        <RejectionNotice className="mb-3" title="Yêu cầu cập nhật trước chưa được chấp nhận"
                         noteLabel="Lý do" note={group.rejection.note} />
      )}

      {group.pending ? (
        <>
          <LockedView k={group.key} value={group.pending.value} />
          <p className="mt-2 text-[0.75rem] text-muted">
            Đã gửi {fmtDateTime(group.pending.submitted_at)}, đang chờ Phòng Công tác Sinh viên duyệt.
          </p>
        </>
      ) : open ? (
        <EditView k={group.key} value={draft} onChange={onChange} provinces={provinces} bankSuggestions={bankSuggestions} />
      ) : (
        <LockedView k={group.key} value={group.value} />
      )}

      {error && (
        <p className="mt-2 flex items-center gap-1.5 text-[0.78rem] text-danger-text">
          <AlertCircle size={13} />{error}
        </p>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={ui.card}>
      <div className={ui.cardHeader}><h2 className={ui.sectionTitle}>{title}</h2></div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

// ── Trang ────────────────────────────────────────────────────────────────────

const SECTIONS: { title: string; keys: PersonalInfoKey[] }[] = [
  { title: 'Liên hệ và giấy tờ', keys: ['personal_email', 'mobile_phone', 'citizen_id'] },
  { title: 'Tài khoản ngân hàng', keys: ['bank_account'] },
  { title: 'Gia đình', keys: ['father', 'mother'] },
  { title: 'Trường THPT', keys: ['high_school'] },
];

export default function PersonalInfoPage() {
  const [data, setData] = useState<PersonalInfoData | null>(null);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [errors, setErrors] = useState<Partial<Record<PersonalInfoKey, string>>>({});
  const [provinces, setProvinces] = useState<Province[]>([]);
  const [loadError, setLoadError] = useState('');
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  const load = (next: PersonalInfoData) => {
    setData(next);
    setDrafts(initialDrafts(next.groups));
    setErrors({});
  };

  useEffect(() => {
    api.personalInfo.get().then(load)
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : 'Không tải được dữ liệu.'));
    api.locations.provinces().then(setProvinces).catch(() => {});
  }, []);

  const byKey = useMemo(
    () => Object.fromEntries((data?.groups ?? []).map((g) => [g.key, g])) as Record<PersonalInfoKey, PersonalInfoGroup>,
    [data],
  );

  const changes = useMemo(() => {
    const out: Drafts = {};
    for (const [k, v] of Object.entries(drafts) as [PersonalInfoKey, PersonalInfoValue][]) {
      const g = byKey[k];
      if (g && !g.pending && !same(v, g.value)) out[k] = v;
    }
    return out;
  }, [drafts, byKey]);
  const changeCount = Object.keys(changes).length;

  if (loadError) {
    return (
      <div className="max-w-[860px]">
        <div className="flex items-start gap-2.5 px-4 py-3 rounded-lg bg-danger-soft border border-danger-line text-danger-text text-sm">
          <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />{loadError}
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex items-center justify-center py-20 text-muted">
        <Loader2 size={22} className="animate-spin mr-2" /> Đang tải…
      </div>
    );
  }

  const setDraft = (k: PersonalInfoKey, v: PersonalInfoValue | undefined) => {
    setDrafts((d) => {
      const n = { ...d };
      if (v === undefined) delete n[k]; else n[k] = v;
      return n;
    });
    setErrors((e) => ({ ...e, [k]: undefined }));
    setNotice('');
  };

  const submit = async () => {
    setSaving(true);
    setFormError('');
    setNotice('');
    try {
      const next = await api.personalInfo.submit(changes);
      load(next);
      setNotice(`Đã gửi ${next.sent ?? changeCount} mục chờ Phòng Công tác Sinh viên duyệt.`);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors((e.data['errors'] as Partial<Record<PersonalInfoKey, string>>) ?? {});
        setFormError(e.message);
      } else {
        setFormError('Không gửi được yêu cầu. Vui lòng thử lại.');
      }
    } finally {
      setSaving(false);
    }
  };

  const r = data.readonly;

  return (
    <div className="max-w-[860px] space-y-4 pb-24">
      <nav className="flex items-center gap-1.5 text-[0.82rem] text-muted">
        <Link href="/dashboard" className="hover:text-ink">Bảng thông tin</Link>
        <ChevronRight size={14} className="text-slate-400" />
        <span className="text-ink font-medium">Thông tin cá nhân</span>
      </nav>

      {notice && (
        <div className="flex items-start gap-2.5 px-4 py-3 rounded-lg bg-success-soft border border-success-line text-success-text text-sm">
          <Check size={16} className="flex-shrink-0 mt-0.5" />{notice}
        </div>
      )}

      <section className={cn(ui.card, 'border-t-2 border-t-primary')}>
        <div className={ui.cardHeader}>
          <h1 className={ui.sectionTitle}><UserRound size={17} className="text-primary" /> Thông tin cá nhân</h1>
        </div>
        <div className="px-5 py-4 grid sm:grid-cols-2 gap-3">
          <ReadonlyField label="Họ tên" value={r.full_name} />
          <ReadonlyField label="Mã số sinh viên" value={r.student_code} />
          <ReadonlyField label="Giới tính" value={r.sex} />
          <ReadonlyField label="Ngày sinh" value={r.date_of_birth} />
          <ReadonlyField label="Khoa/Bộ môn" value={r.department} />
          <ReadonlyField label="Email trường" value={r.university_email} />
        </div>
        <p className="px-5 pb-4 -mt-1 text-[0.75rem] text-muted">
          Thông tin trên không chỉnh sửa được tại đây. Các mục bên dưới gửi Phòng Công tác Sinh viên duyệt trước khi cập nhật vào hồ sơ.
        </p>
      </section>

      {SECTIONS.map((s) => (
        <Section key={s.title} title={s.title}>
          {s.keys.map((k) => byKey[k] && (
            <GroupBlock
              key={k}
              group={byKey[k]}
              draft={drafts[k]}
              error={errors[k]}
              onOpen={() => setDraft(k, byKey[k].value)}
              onCancel={() => setDraft(k, undefined)}
              onChange={(v) => setDraft(k, v)}
              provinces={provinces}
              bankSuggestions={data.bank_suggestions}
            />
          ))}
        </Section>
      ))}

      <div className="sticky bottom-0 -mx-1 px-1 py-3 bg-gradient-to-t from-canvas via-canvas to-transparent">
        <div className={cn(ui.card, 'px-5 py-3 flex flex-wrap items-center justify-between gap-3')}>
          <div className="text-sm">
            {formError
              ? <span className="text-danger-text">{formError}</span>
              : <span className="text-muted">{changeCount ? `${changeCount} mục sẽ gửi duyệt` : 'Chưa có thay đổi.'}</span>}
          </div>
          <button type="button" className={ui.btnPrimary} disabled={!changeCount || saving} onClick={submit}>
            {saving && <Loader2 size={15} className="animate-spin" />}
            Gửi yêu cầu cập nhật
          </button>
        </div>
      </div>
    </div>
  );
}
