'use client';

/* Dựng một bước của form "Kết quả khám sức khỏe" từ danh mục trường backend gửi xuống
   (`core/health_check_result.py`). Không khai trường nào ở đây — thêm/sửa trường là
   sửa backend. Hai luật tính (BMI, phân loại sức khỏe gợi ý) chép lại từ backend để
   hiện ngay khi gõ; server vẫn tính lại lúc nhận. */

import { useId } from 'react';
import { ChevronDown } from 'lucide-react';
import { ui } from '@/lib/ui';
import { cn, todayInput } from '@/lib/utils';
import type { ResultField, ResultGroup, ResultSection } from '@/lib/types';

export type ResultValues = Record<string, string>;

const ROMANS = ['I', 'II', 'III', 'IV', 'V'];
const HEALTH_KEY = 'health_class';

const num = (v: string | undefined) => {
  const n = Number(String(v ?? '').trim().replace(',', '.'));
  return String(v ?? '').trim() !== '' && Number.isFinite(n) ? n : null;
};

export function computeBmi(v: ResultValues): string {
  const h = num(v.height_cm), w = num(v.weight_kg);
  return h && w ? (w / ((h / 100) ** 2)).toFixed(2) : '';
}

/** "Loại III" / "III" → 2; không phải phân loại → -1 (cùng luật backend `class_rank`). */
const classRank = (value: string | undefined) =>
  ROMANS.indexOf(String(value ?? '').replace('Loại', '').trim());

/** Phân loại sức khỏe gợi ý = loại cao nhất trong MỌI ô phân loại khác của danh mục. */
export function suggestHealthClass(schema: ResultSection[], v: ResultValues): string {
  const ranks = schema.flatMap(sectionFields)
    .filter((f) => f.type === 'class' && f.key !== HEALTH_KEY)
    .map((f) => classRank(v[f.key]));
  return `Loại ${ROMANS[Math.max(0, ...ranks)]}`;
}

export function sectionFields(section: ResultSection): ResultField[] {
  return section.groups.flatMap((g) => [
    ...(g.organs ?? []).flatMap((o) => [o.result, o.class]),
    ...(g.fields ?? []),
  ]);
}

/** Kiểm sớm ở client — cùng luật với backend `clean()`, lỗi còn lại để server quyết. */
export function validateSection(section: ResultSection, v: ResultValues): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of sectionFields(section)) {
    if (f.type === 'computed') continue;
    const value = (v[f.key] ?? '').trim();
    if (!value) {
      if (f.required) errors[f.key] = 'Không được để trống.';
      continue;
    }
    if (f.type === 'number') {
      const n = num(value);
      if (n === null) errors[f.key] = 'Phải là số.';
      else if (f.min !== null && f.max !== null && (n < f.min || n > f.max))
        errors[f.key] = `Ngoài khoảng hợp lệ ${f.min}–${f.max}.`;
    }
    if (f.type === 'date' && value > todayInput()) errors[f.key] = 'Ngày khám không được ở tương lai.';
    if (f.type === 'pressure') {
      // Như trên phiếu: "110/70", "110 / 70", "110/70 mmHg".
      const m = /^\s*(\d{2,3})\s*\/\s*(\d{2,3})\s*(mmhg)?\s*$/i.exec(value);
      if (!m) errors[f.key] = 'Nhập theo dạng tâm thu/tâm trương, VD 110/70.';
      else if (Number(m[2]) >= Number(m[1])) errors[f.key] = 'Số sau (tâm trương) phải nhỏ hơn số trước (tâm thu).';
    }
    if (f.type === 'vision') {
      // Như trên phiếu: "10/10" hoặc "8".
      const m = /^\s*(\d{1,2}(?:[.,]\d+)?)\s*(?:\/\s*10)?\s*$/.exec(value);
      const n = m ? num(m[1]) : null;
      if (n === null || n < 0 || n > 10) errors[f.key] = 'Nhập điểm thang 10, VD 10/10 hoặc 8.';
    }
  }
  return errors;
}

const GRID: Record<number, string> = {
  1: 'grid gap-3',
  2: 'grid sm:grid-cols-2 gap-3',
  3: 'grid sm:grid-cols-3 gap-3',
  4: 'grid sm:grid-cols-2 lg:grid-cols-4 gap-3',
  5: 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3',
};

interface FieldProps {
  field: ResultField;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  computed?: string;
  compact?: boolean;
  label?: boolean;
}

function FieldInput({ field, value, onChange, error, computed, compact, label = true }: FieldProps) {
  const base = cn(ui.input, compact ? 'h-9 text-[0.85rem]' : 'h-10', error && 'border-danger-line');
  const id = useId();
  const msgId = `${id}-msg`;
  // label={false} (ô nằm trong bảng có tiêu đề cột) → vẫn cần tên cho trình đọc màn hình.
  const a11y = {
    id,
    'aria-label': label ? undefined : field.label,
    'aria-invalid': !!error,
    'aria-describedby': error || field.hint ? msgId : undefined,
  };
  let control: React.ReactNode;
  if (field.type === 'computed') {
    control = (
      <div className={cn(base, 'flex items-center bg-slate-50 text-ink font-medium')}>
        {computed || <span className="text-muted font-normal">—</span>}
      </div>
    );
  } else if (field.type === 'class' || field.type === 'choice') {
    control = (
      <select {...a11y} value={value} onChange={(e) => onChange(e.target.value)} className={cn(base, 'pr-8')}>
        {!field.required && <option value="">—</option>}
        {(field.choices ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
    );
  } else {
    control = (
      <div className="relative">
        <input
          {...a11y}
          type={field.type === 'date' ? 'date' : 'text'}
          inputMode={field.type === 'number' ? 'decimal' : undefined}
          max={field.type === 'date' ? todayInput() : undefined}
          value={value}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={cn(base, field.unit && 'pr-16')}
        />
        {field.unit && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[0.72rem] text-muted pointer-events-none">
            {field.unit}
          </span>
        )}
      </div>
    );
  }
  return (
    <div>
      {label && (
        <label htmlFor={field.type === 'computed' ? undefined : id} className="block text-[0.78rem] font-medium text-ink mb-1">
          {field.label}{field.required && field.type !== 'computed' && <span className="text-red-500"> *</span>}
        </label>
      )}
      {control}
      {error ? <p id={msgId} className="mt-1 text-[0.72rem] text-danger-text">{error}</p>
        : field.hint ? <p id={msgId} className="mt-1 text-[0.72rem] text-muted">{field.hint}</p> : null}
    </div>
  );
}

function Group({ group, values, set, errors }: {
  group: ResultGroup; values: ResultValues; set: (k: string, v: string) => void;
  errors: Record<string, string>;
}) {
  const fields = group.fields ?? [];
  const organs = group.organs ?? [];
  const body = (
    <div className="space-y-3">
      {fields.length > 0 && (
        <div className={GRID[group.cols ?? 2] ?? GRID[2]}>
          {fields.map((f) => (
            <FieldInput key={f.key} field={f} value={values[f.key] ?? ''} error={errors[f.key]}
                        computed={f.key === 'bmi' ? computeBmi(values) : undefined}
                        compact={group.collapsible} onChange={(v) => set(f.key, v)} />
          ))}
        </div>
      )}
      {organs.length > 0 && (
        <div className="rounded-lg border border-line divide-y divide-line2">
          {organs.map((o) => (
            <div key={o.key} className="grid grid-cols-[1fr_5.5rem] sm:grid-cols-[11rem_1fr_5.5rem] items-start gap-2 px-3 py-2">
              <div className="col-span-2 sm:col-span-1 text-[0.82rem] font-medium text-ink sm:pt-2">{o.label}</div>
              <FieldInput field={o.result} value={values[o.result.key] ?? ''} error={errors[o.result.key]}
                          compact label={false} onChange={(v) => set(o.result.key, v)} />
              <FieldInput field={o.class} value={values[o.class.key] ?? ''} error={errors[o.class.key]}
                          compact label={false} onChange={(v) => set(o.class.key, v)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );

  if (group.collapsible) {
    const filled = fields.filter((f) => (values[f.key] ?? '').trim()).length;
    const hasError = fields.some((f) => errors[f.key]);
    return (
      <details className="group rounded-lg border border-line" open={hasError || undefined}>
        <summary className="flex items-center justify-between gap-2 px-4 py-2.5 cursor-pointer list-none">
          <span className="text-[0.84rem] font-semibold text-ink">{group.title}</span>
          <span className="flex items-center gap-2 text-[0.75rem] text-muted">
            đã nhập {filled}/{fields.length}
            <ChevronDown size={15} className="transition-transform group-open:rotate-180" />
          </span>
        </summary>
        <div className="px-4 pb-4 pt-1">{body}</div>
      </details>
    );
  }
  return (
    <section>
      <h3 className="text-[0.84rem] font-semibold text-ink mb-2">{group.title}</h3>
      {organs.length > 0 && (
        <div className="hidden sm:grid grid-cols-[11rem_1fr_5.5rem] gap-2 px-3 pb-1 text-[0.72rem] text-muted">
          <span />
          <span>Kết quả</span>
          <span>Phân loại</span>
        </div>
      )}
      {body}
    </section>
  );
}

export default function ResultSectionFields({ section, values, set, errors }: {
  section: ResultSection; values: ResultValues; set: (k: string, v: string) => void;
  errors: Record<string, string>;
}) {
  return (
    <div className="space-y-5">
      {section.groups.map((g) => (
        <Group key={g.title} group={g} values={values} set={set} errors={errors} />
      ))}
    </div>
  );
}
