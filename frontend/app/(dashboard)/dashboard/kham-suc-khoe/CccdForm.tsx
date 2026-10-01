'use client';

/* Bổ sung CCCD cho SV đã khai ngoại trú (form khai báo đang khóa) nhưng hồ sơ chưa có
   CCCD — luồng khám sức khỏe bắt buộc CCCD (cột C file gửi PYT). Ghi qua
   POST /api/health-check/citizen-id/, nạp lại state để các bước sau thấy đã có. */

import { useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { ui } from '@/lib/ui';
import { cn, fromDateInput, todayInput } from '@/lib/utils';
import type { HealthCheckState } from '@/lib/types';

export default function CccdForm({ onSaved }: { onSaved: (next: HealthCheckState) => void }) {
  const [number, setNumber] = useState('');
  const [issuePlace, setIssuePlace] = useState('');
  const [issueDate, setIssueDate] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!/^\d{12}$/.test(number.trim())) { setError('Số CCCD gồm đúng 12 chữ số.'); return; }
    setSaving(true); setError('');
    try {
      onSaved(await api.healthCheck.addCitizenId({
        number: number.trim(), issue_place: issuePlace.trim(), issue_date: fromDateInput(issueDate),
      }));
    } catch (e) {
      const errs = e instanceof ApiError ? (e.data?.errors as Record<string, string> | undefined) : undefined;
      setError(errs?.citizen_id || (e instanceof ApiError ? e.message : 'Không lưu được số CCCD.'));
    } finally { setSaving(false); }
  }

  return (
    <div className="rounded-lg border border-warning-line border-l-4 border-l-warning-text bg-warning-soft px-4 py-3.5 space-y-3">
      <div className="flex items-start gap-2.5 text-sm text-warning-text">
        <AlertTriangle size={18} className="flex-shrink-0 mt-0.5" />
        <div>
          <div className="font-semibold">Hồ sơ chưa có số CCCD</div>
          <p className="mt-0.5">Khai báo khám sức khỏe bắt buộc có số CCCD. Bổ sung để tiếp tục.</p>
        </div>
      </div>
      <div className="grid sm:grid-cols-3 gap-2">
        <div>
          <label htmlFor="hc-cccd-number" className="block text-[0.75rem] text-ink mb-1">Số CCCD<span className="text-danger-text"> *</span></label>
          <input id="hc-cccd-number" aria-invalid={!!error} aria-describedby={error ? 'hc-cccd-error' : undefined}
                 type="text" inputMode="numeric" maxLength={12} value={number} placeholder="12 chữ số"
                 onChange={(e) => { setNumber(e.target.value.replace(/\D/g, '')); setError(''); }}
                 className={cn(ui.input, 'h-9 text-[0.85rem] bg-white', error && 'border-danger-line')} />
        </div>
        <div>
          <label htmlFor="hc-cccd-place" className="block text-[0.75rem] text-ink mb-1">Nơi cấp</label>
          <input id="hc-cccd-place" type="text" value={issuePlace} maxLength={255} placeholder="Cục Cảnh sát QLHC về TTXH"
                 onChange={(e) => setIssuePlace(e.target.value)}
                 className={cn(ui.input, 'h-9 text-[0.85rem] bg-white')} />
        </div>
        <div>
          <label htmlFor="hc-cccd-date" className="block text-[0.75rem] text-ink mb-1">Ngày cấp</label>
          <input id="hc-cccd-date" type="date" value={issueDate} max={todayInput()}
                 onChange={(e) => setIssueDate(e.target.value)}
                 className={cn(ui.input, 'h-9 text-[0.85rem] bg-white')} />
        </div>
      </div>
      {error && <p id="hc-cccd-error" className="text-[0.75rem] text-danger-text">{error}</p>}
      <div className="flex justify-end">
        <button type="button" onClick={save} disabled={saving} className={cn(ui.btnPrimary, 'h-9')}>
          {saving ? <><Loader2 size={15} className="animate-spin" /> Đang lưu…</> : 'Lưu số CCCD'}
        </button>
      </div>
    </div>
  );
}
