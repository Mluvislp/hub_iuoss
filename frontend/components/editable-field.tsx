'use client';

import { Lock, PencilLine, RotateCcw } from 'lucide-react';
import { cn, toDateInput, fromDateInput, todayInput, DATE_INPUT_MIN } from '@/lib/utils';
import { ui } from '@/lib/ui';

/** Ô thông tin chỉ xem, không bao giờ sửa được (họ tên, MSSV, khoa…). */
export function ReadonlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className={ui.label}>{label}</div>
      <div className="mt-1 rounded-lg border border-line bg-slate-50 px-3 h-10 flex items-center text-sm text-ink">
        {value || '—'}
      </div>
    </div>
  );
}

/** Hộp hiển thị giá trị đang khóa — dùng cho cả ô đơn lẫn từng ô trong cụm địa chỉ. */
export function LockedBox({ value }: { value: string }) {
  return (
    <div className="rounded-lg border border-line bg-slate-50 px-3 h-10 flex items-center justify-between gap-2 text-sm text-ink">
      <span className="truncate">{value || '—'}</span>
      <Lock size={13} className="flex-shrink-0 text-slate-400" />
    </div>
  );
}

/** Nút mở khóa một ô / một cụm ô. */
export function RequestEditButton({ onClick, label = 'Yêu cầu chỉnh sửa' }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-1.5 inline-flex items-center gap-1 text-[0.78rem] font-medium text-primary-text hover:underline"
    >
      <PencilLine size={12} /> {label}
    </button>
  );
}

/** Nút trả ô/cụm về giá trị gốc rồi khóa lại. */
export function CancelEditButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-1.5 inline-flex items-center gap-1 text-[0.78rem] font-medium text-muted hover:text-ink transition-colors"
    >
      <RotateCcw size={12} /> Hủy chỉnh sửa
    </button>
  );
}

/** Nhãn "sẽ gửi duyệt" gắn cạnh tên ô khi giá trị khác hồ sơ. */
export function ChangedTag() {
  return (
    <span className="ml-1.5 inline-flex items-center gap-0.5 text-[0.75rem] font-normal text-warning-text">
      <PencilLine size={11} /> sẽ gửi duyệt
    </span>
  );
}

/**
 * Ô có thể xin sửa. Hồ sơ đã có dữ liệu ⇒ khóa sẵn, chỉ mở khi SV bấm
 * "Yêu cầu chỉnh sửa" — để không ai sửa nhầm thông tin vốn đã đúng.
 * Hồ sơ trống ⇒ `lockable=false`, ô mở sẵn và không có nút hủy vì không có
 * giá trị gốc nào để quay về.
 *
 * `kind="date"` render ô chọn lịch; state bên ngoài vẫn giữ chuỗi dd/mm/yyyy
 * đúng contract với backend.
 */
export function EditableField({
  label, value, original, open, lockable, error, hint,
  maxLength, placeholder, inputMode, kind = 'text', onChange, onOpen, onCancel,
}: {
  label: string;
  value: string;
  original: string;
  open: boolean;
  lockable: boolean;
  error?: string;
  hint?: string;
  maxLength: number;
  placeholder?: string;
  inputMode?: 'numeric' | 'text';
  kind?: 'text' | 'date';
  onChange: (v: string) => void;
  onOpen: () => void;
  onCancel: () => void;
}) {
  const changed = value.trim() !== original.trim();
  const inputCls = cn(
    ui.input,
    error ? 'border-danger-line focus:border-danger-line focus:ring-red-100' : changed && 'border-warning-line',
  );

  return (
    <div>
      <label className={ui.fieldLabel}>
        {label}
        {changed && <ChangedTag />}
      </label>

      {open ? (
        <>
          {kind === 'date' ? (
            <input
              type="date"
              value={toDateInput(value)}
              min={DATE_INPUT_MIN}
              max={todayInput()}
              autoFocus={lockable}
              onChange={(e) => onChange(fromDateInput(e.target.value))}
              className={inputCls}
            />
          ) : (
            <input
              type="text"
              value={value}
              maxLength={maxLength}
              inputMode={inputMode}
              placeholder={placeholder}
              autoFocus={lockable}
              onChange={(e) => onChange(e.target.value)}
              className={inputCls}
            />
          )}
          {error
            ? <p className="mt-1 text-[0.75rem] text-danger-text">{error}</p>
            : hint && <p className="mt-1 text-[0.75rem] text-warning-text">{hint}</p>}
          {lockable && <CancelEditButton onClick={onCancel} />}
        </>
      ) : (
        <>
          <LockedBox value={value} />
          <RequestEditButton onClick={onOpen} />
        </>
      )}
    </div>
  );
}
