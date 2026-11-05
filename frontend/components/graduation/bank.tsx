'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, ChevronDown, Landmark, Loader2, Pencil, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  GradError, checkBank, gradApi, normalizeHolder, type BankInput, type GradBank, type GradMember,
} from '@/lib/graduation';
import { g } from './styles';

const field =
  'block w-full h-11 rounded-lg border border-slate-300 bg-white px-3.5 text-[0.95rem] text-ink ' +
  'placeholder:text-slate-400 transition-colors hover:border-slate-400 ' +
  'focus:outline-none focus:border-[#0f2a5c] focus:ring-4 focus:ring-[#0f2a5c]/10';
const label = 'block text-[0.83rem] font-semibold text-slate-700 mb-1.5';

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();

/** Ô chọn ngân hàng có tìm kiếm (theo tên viết tắt hoặc tên đầy đủ, gõ có dấu / không dấu đều được). */
function BankSelect({ banks, value, onChange, disabled }: {
  banks: GradBank[]; value: string; onChange: (id: string) => void; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const selected = banks.find((b) => String(b.id) === value);
  const list = useMemo(() => {
    const k = fold(q.trim());
    return k ? banks.filter((b) => fold(`${b.short_name} ${b.full_name}`).includes(k)) : banks;
  }, [banks, q]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button type="button" disabled={disabled} onClick={() => { setOpen((v) => !v); setQ(''); }}
              aria-haspopup="listbox" aria-expanded={open}
              className={cn(field, 'flex items-center gap-2 text-left pr-9', !selected && 'text-slate-400')}>
        <span className="min-w-0 flex-1 truncate">
          {selected ? <><b className="font-semibold text-ink">{selected.short_name}</b>
            <span className="text-muted"> — {selected.full_name}</span></> : 'Chọn ngân hàng'}
        </span>
        <ChevronDown size={16} className="absolute right-3 text-slate-400" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1.5 w-full overflow-hidden rounded-lg border border-line bg-white shadow-lg">
          <div className="relative border-b border-line2">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm ngân hàng (VD: vietcom, mb, acb)"
                   className="h-11 w-full pl-9 pr-3 text-sm focus:outline-none"
                   onKeyDown={(e) => {
                     if (e.key === 'Escape') setOpen(false);
                     if (e.key === 'Enter' && list[0]) { e.preventDefault(); onChange(String(list[0].id)); setOpen(false); }
                   }} />
          </div>
          <ul role="listbox" className="max-h-64 overflow-y-auto py-1">
            {list.length === 0 && <li className="px-3.5 py-3 text-sm text-muted">Không tìm thấy ngân hàng.</li>}
            {list.map((b) => {
              const active = String(b.id) === value;
              return (
                <li key={b.id}>
                  <button type="button" role="option" aria-selected={active}
                          onClick={() => { onChange(String(b.id)); setOpen(false); }}
                          className={cn('flex w-full items-start gap-2 px-3.5 py-2 text-left text-sm hover:bg-[#fffbf0]',
                                        active && 'bg-[#fdf6e3]')}>
                    <Check size={15} className={cn('mt-0.5 shrink-0 text-[#a07d1c]', !active && 'invisible')} />
                    <span className="min-w-0">
                      <span className="block font-semibold text-ink">{b.short_name}</span>
                      <span className="block text-xs text-muted">{b.full_name}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/** 3 ô tài khoản hoàn tiền cọc — dùng cho form đăng ký và cho thẻ sửa sau khi đã đăng ký. */
export function BankFields({ banks, value, onChange, disabled }: {
  banks: GradBank[]; value: BankInput; onChange: (v: BankInput) => void; disabled?: boolean;
}) {
  const set = (k: keyof BankInput, v: string) => onChange({ ...value, [k]: v });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className={label}>Ngân hàng <span className="text-danger-text">*</span></label>
        <BankSelect banks={banks} value={value.bank_id} onChange={(id) => set('bank_id', id)} disabled={disabled} />
      </div>
      <div>
        <label htmlFor="bank-number" className={label}>Số tài khoản <span className="text-danger-text">*</span></label>
        <input id="bank-number" inputMode="numeric" autoComplete="off" className={cn(field, 'font-mono tracking-wide')}
               value={value.bank_account_number} disabled={disabled} placeholder="Chỉ gồm chữ số"
               onChange={(e) => set('bank_account_number', e.target.value.replace(/[^\d\s.-]/g, ''))} />
      </div>
      <div>
        <label htmlFor="bank-holder" className={label}>Tên chủ tài khoản <span className="text-danger-text">*</span></label>
        <input id="bank-holder" autoComplete="off" className={cn(field, 'uppercase placeholder:normal-case')}
               value={value.bank_account_holder} disabled={disabled} placeholder="Đúng như trên app ngân hàng"
               onChange={(e) => set('bank_account_holder', e.target.value)}
               onBlur={(e) => set('bank_account_holder', normalizeHolder(e.target.value))} />
      </div>
    </div>
  );
}

export function emptyBank(m: GradMember): BankInput {
  const s = m.bank_suggestion;
  return {
    bank_id: s?.bank_id ? String(s.bank_id) : '',
    bank_account_number: s?.account_number ?? '',
    bank_account_holder: s?.holder ?? '',
  };
}

export const BANK_NOTE = 'Dùng để hoàn tiền cọc thuê lễ phục sau lễ tốt nghiệp. Kiểm tra kỹ — chuyển khoản sai tài khoản sẽ không hoàn lại được.';

/** Sau khi đã đăng ký: xem / sửa tài khoản (khi còn hạn). Chưa có tài khoản (đăng ký trước khi có mục này) ⇒ mở form ngay. */
export function BankCard({ member, banks, onChange }: {
  member: GradMember; banks: GradBank[]; onChange: (m: GradMember) => void;
}) {
  const bank = member.bank;
  const canEdit = member.registration.can_edit;
  const [editing, setEditing] = useState(!bank && canEdit);
  const [value, setValue] = useState<BankInput>(() => bank
    ? { bank_id: String(bank.bank_id), bank_account_number: bank.account_number, bank_account_holder: bank.holder }
    : emptyBank(member));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    const problem = checkBank(value);
    if (problem) { setError(problem); return; }
    setBusy(true); setError('');
    try { onChange(await gradApi.updateBank(value)); setEditing(false); } catch (err) {
      setError(err instanceof GradError ? err.message : 'Không lưu được tài khoản.');
    } finally { setBusy(false); }
  }

  return (
    <div className={cn(g.card, 'p-6', !bank && 'border-amber-300')}>
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className={g.eyebrow}>Hoàn tiền cọc lễ phục</p>
          <h4 className="mt-1 font-semibold text-ink">Tài khoản nhận hoàn tiền</h4>
        </div>
        {bank && canEdit && !editing && (
          <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-1.5 text-sm font-medium text-[#a07d1c] hover:underline">
            <Pencil size={14} /> Sửa
          </button>
        )}
      </div>
      {!bank && (
        <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-900">
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-amber-600" />
          <span>Chưa có tài khoản nhận hoàn tiền cọc — thông tin <b>bắt buộc</b>. {canEdit ? 'Vui lòng bổ sung bên dưới.' : 'Liên hệ Phòng Công tác Sinh viên.'}</span>
        </div>
      )}
      {editing ? (
        <div className="mt-4 space-y-4">
          <p className="text-sm text-muted">{BANK_NOTE}</p>
          <BankFields banks={banks} value={value} onChange={setValue} disabled={busy} />
          {error && <p role="alert" className="text-sm text-danger-text">{error}</p>}
          <div className="flex justify-end gap-2">
            {bank && <button type="button" className={g.btnGhost} onClick={() => { setEditing(false); setError(''); }} disabled={busy}>Thôi</button>}
            <button type="button" className={cn(g.btnPrimary, 'h-11')} onClick={save} disabled={busy}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Lưu tài khoản
            </button>
          </div>
        </div>
      ) : bank ? (
        <div className="mt-4 flex items-start gap-3.5 rounded-xl border border-line bg-[#fbfcfe] p-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#fdf6e3] text-[#a07d1c]"><Landmark size={18} /></span>
          <dl className="min-w-0 space-y-1 text-sm">
            <div><dt className="sr-only">Ngân hàng</dt><dd className="font-semibold text-ink">{bank.bank_short_name} <span className="font-normal text-muted">— {bank.bank_full_name}</span></dd></div>
            <div className="flex gap-2"><dt className="w-24 shrink-0 text-muted">Số tài khoản</dt><dd className="font-mono font-semibold tracking-wide text-ink">{bank.account_number}</dd></div>
            <div className="flex gap-2"><dt className="w-24 shrink-0 text-muted">Chủ tài khoản</dt><dd className="font-semibold text-ink">{bank.holder}</dd></div>
          </dl>
        </div>
      ) : null}
    </div>
  );
}
