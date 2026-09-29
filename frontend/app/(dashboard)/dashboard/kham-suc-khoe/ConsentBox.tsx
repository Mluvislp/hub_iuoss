'use client';

/* Ô tích cam kết + đồng ý cung cấp thông tin ở cuối form của cả hai lựa chọn.
   Câu chữ lấy từ backend (`health_check.DATA_CONSENT_TEXT`) — backend lưu lại đúng câu
   SV đã đồng ý kèm thời điểm, nên không được viết lại câu ở frontend. */

import { cn } from '@/lib/utils';

export default function ConsentBox({
  checked, onChange, text, error,
}: { checked: boolean; onChange: (v: boolean) => void; text: string; error?: string }) {
  return (
    <div>
      <label className={cn(
        'flex items-start gap-3 rounded-lg border px-4 py-3 cursor-pointer transition-colors',
        checked ? 'border-primary bg-primary-soft' : error ? 'border-danger-line' : 'border-line hover:bg-slate-50',
      )}>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
               className="mt-0.5 w-4 h-4 flex-shrink-0 accent-[#2563eb]" />
        <span className="text-[0.84rem] text-ink leading-relaxed">
          {text}<span className="text-red-500"> *</span>
        </span>
      </label>
      {error && <p className="mt-1 text-[0.75rem] text-danger-text">{error}</p>}
    </div>
  );
}
