'use client';

import { Lock, PencilLine } from 'lucide-react';
import { ui } from '@/lib/ui';
import { cn } from '@/lib/utils';
import type { OffCampusField } from '@/lib/types';

interface Props {
  /** `value` luôn là chuỗi để hiển thị — target có cấu trúc thì page rút gọn trước. */
  field: Omit<OffCampusField, 'value' | 'pending_value'> & { value: string };
  /** Giá trị đang nhập; undefined = đang khóa */
  draft?: string;
  onUnlock: () => void;
  onChange: (value: string) => void;
  onCancel: () => void;
  error?: string;
  placeholder?: string;
  hint?: string;
  /** Ô phụ hiện thêm khi mở khóa (CCCD có nơi cấp + ngày hết hạn) */
  extra?: React.ReactNode;
}

export default function PersonalField({
  field, draft, onUnlock, onChange, onCancel, error, placeholder, hint, extra,
}: Props) {
  const unlocked = draft !== undefined;
  const blank = !field.value;

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <label className="text-[0.82rem] font-medium text-ink">{field.label}</label>

        {unlocked ? (
          <button type="button" onClick={onCancel}
                  className="text-[0.75rem] font-medium text-muted hover:text-ink">
            Hủy sửa
          </button>
        ) : (
          <button type="button" onClick={onUnlock}
                  className="inline-flex items-center gap-1 text-[0.75rem] font-medium text-primary-text hover:underline">
            <PencilLine size={11} />
            {blank ? 'Bổ sung' : 'Yêu cầu chỉnh sửa'}
          </button>
        )}
      </div>

      {unlocked ? (
        <>
          <input
            type="text"
            value={draft}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            className={cn(ui.input, error ? 'border-danger-line' : 'border-warning-line')}
            autoFocus
          />
          {extra}
        </>
      ) : (
        <div className={cn(
          'flex items-center gap-2 h-10 px-3 rounded-lg border text-sm',
          blank ? 'border-line bg-slate-50 text-slate-400 italic' : 'border-line bg-slate-50 text-ink',
        )}>
          <Lock size={13} className="text-slate-400 flex-shrink-0" />
          {field.value || 'Chưa có thông tin'}
        </div>
      )}

      {error && <p className="mt-1 text-[0.75rem] text-danger-text">{error}</p>}
      {hint && !error && !unlocked && (
        <p className="mt-1 text-[0.75rem] text-muted">{hint}</p>
      )}
    </div>
  );
}
