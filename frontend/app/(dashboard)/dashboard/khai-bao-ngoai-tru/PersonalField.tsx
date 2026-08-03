'use client';

import { Lock, PencilLine, Clock } from 'lucide-react';
import { ui, badge } from '@/lib/ui';
import { cn } from '@/lib/utils';
import type { OffCampusField } from '@/lib/types';

interface Props {
  field: OffCampusField;
  /** Giá trị đang nhập; undefined = đang khóa */
  draft?: string;
  onUnlock: () => void;
  onChange: (value: string) => void;
  onCancel: () => void;
  error?: string;
  placeholder?: string;
  /** Trường đang trống thì mở sẵn, không cần bấm "Yêu cầu chỉnh sửa" */
  hint?: string;
}

export default function PersonalField({
  field, draft, onUnlock, onChange, onCancel, error, placeholder, hint,
}: Props) {
  const pending = field.pending_value;
  const unlocked = draft !== undefined;
  const blank = !field.value;

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <label className="text-[0.82rem] font-medium text-ink">{field.label}</label>

        {pending ? (
          <span className={cn(badge.base, badge.warning)}>
            <Clock size={11} /> Chờ duyệt
          </span>
        ) : unlocked ? (
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
          {!error && !blank && (
            <p className="mt-1 inline-flex items-center gap-1 text-[0.75rem] text-warning-text">
              <PencilLine size={10} /> Thay đổi sẽ được gửi cho phòng CTSV duyệt.
            </p>
          )}
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

      {pending && (
        <p className="mt-1 text-[0.75rem] text-muted">
          Đã gửi: <span className="font-medium text-ink">{pending}</span> — đang chờ duyệt,
          chưa gửi thêm được.
        </p>
      )}
      {error && <p className="mt-1 text-[0.75rem] text-danger-text">{error}</p>}
      {hint && !error && !unlocked && (
        <p className="mt-1 text-[0.75rem] text-muted">{hint}</p>
      )}
    </div>
  );
}
