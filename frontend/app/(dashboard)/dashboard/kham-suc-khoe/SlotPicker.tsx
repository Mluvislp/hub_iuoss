'use client';

import { CalendarDays, Check, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { HealthCheckSlotOptions } from '@/lib/types';

/** Chọn MỘT ngày + ca khám tại trường. Ca đã qua giờ hoặc đã đủ chỗ vẫn hiện nhưng khóa. */
export default function SlotPicker({ options, value, onChange, error }: {
  options: HealthCheckSlotOptions;
  value: string;
  onChange: (key: string) => void;
  error?: string;
}) {
  return (
    <div>
      <div className="text-[0.82rem] font-medium text-ink mb-2">
        Ngày và ca khám<span className="text-red-500"> *</span>
      </div>
      <div className={cn('rounded-lg border divide-y divide-line2', error ? 'border-danger-line' : 'border-line')}>
        {options.days.map((day) => (
          <div key={day.date} className="px-4 py-3">
            <div className="flex items-center gap-1.5 text-[0.82rem] font-semibold text-ink mb-2">
              <CalendarDays size={14} className="text-slate-500" /> {day.label}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {day.shifts.map((s) => {
                const active = value === s.key;
                return (
                  <button key={s.key} type="button" disabled={!s.available} aria-pressed={active}
                          onClick={() => onChange(s.key)}
                          className={cn(
                            'relative text-left rounded-lg border px-3 py-2 transition-colors',
                            active ? 'border-primary bg-primary-soft'
                              : s.available ? 'border-line hover:bg-slate-50'
                                : 'border-line bg-slate-50 cursor-not-allowed',
                          )}>
                    {active && <Check size={14} className="absolute top-2 right-2 text-primary" />}
                    <div className={cn('text-[0.8rem] font-medium', s.available ? 'text-ink' : 'text-slate-400')}>
                      {s.label}
                    </div>
                    <div className={cn('flex items-center gap-1 text-[0.78rem] mt-0.5',
                                       s.available ? 'text-muted' : 'text-slate-400')}>
                      <Clock size={12} /> {s.start} – {s.end}
                    </div>
                    {(!s.available || s.remaining !== null) && (
                      <div className={cn('text-[0.72rem] mt-0.5', s.available ? 'text-muted' : 'text-slate-400')}>
                        {s.available ? `Còn ${s.remaining} chỗ` : s.reason}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {error && <p className="text-[0.78rem] text-danger-text mt-1.5">{error}</p>}
    </div>
  );
}
