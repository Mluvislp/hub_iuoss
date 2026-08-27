'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { ui } from '@/lib/ui';
import { cn } from '@/lib/utils';

export interface SelectOption {
  value: string;
  /** Chuỗi chính, cũng là chuỗi đem đi so khi tìm. */
  label: string;
  /** Chuỗi phụ hiện mờ bên phải và cũng tìm được — ví dụ mã cơ sở KCB. */
  hint?: string;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  id?: string;
}

/**
 * Bỏ dấu tiếng Việt để gõ không dấu vẫn tìm được: "thong nhat" khớp "Thống Nhất".
 * `đ` không phải nguyên âm có dấu nên NFD không tách ra được, phải thay riêng.
 */
function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase();
}

/**
 * Số dòng render tối đa. Danh mục cơ sở KCB có tỉnh tới ~700 dòng; dựng hết vào
 * DOM làm khựng lúc mở. Phần dư được nói rõ ở chân danh sách chứ không giấu.
 */
const MAX_RENDERED = 100;

/**
 * Ô chọn có tìm kiếm ngay bên trong. Thay cho `<select>` khi danh mục dài tới
 * mức type-ahead của trình duyệt (chỉ khớp từ đầu chuỗi) không còn đủ dùng.
 */
export default function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = '-- Chọn --',
  searchPlaceholder = 'Gõ để tìm...',
  emptyText = 'Không tìm thấy kết quả nào',
  disabled = false,
  id,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = options.find((o) => o.value === value) ?? null;

  const filtered = useMemo(() => {
    const q = fold(query.trim());
    if (!q) return options;
    return options.filter(
      (o) => fold(o.label).includes(q) || (o.hint ? fold(o.hint).includes(q) : false),
    );
  }, [options, query]);

  const shown = filtered.slice(0, MAX_RENDERED);

  // Bấm ra ngoài thì đóng.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  // Mỗi lần mở là một lượt tìm mới.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    inputRef.current?.focus();
  }, [open]);

  // Giữ dòng đang trỏ trong tầm nhìn khi đi bằng phím.
  useEffect(() => {
    if (!open) return;
    (listRef.current?.children[active] as HTMLElement | undefined)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const pick = (opt: SelectOption) => {
    onChange(opt.value);
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, shown.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (shown[active]) pick(shown[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        id={id}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          ui.input,
          'flex items-center justify-between gap-2 text-left',
          disabled && 'cursor-not-allowed bg-slate-50 text-slate-500',
          !selected && !disabled && 'text-slate-400',
        )}
      >
        <span className="truncate">
          {selected ? selected.label : placeholder}
          {selected?.hint && <span className="ml-1.5 text-xs text-muted">({selected.hint})</span>}
        </span>
        <ChevronDown size={16} className="shrink-0 text-slate-400" />
      </button>

      {open && !disabled && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-line bg-white shadow-card">
          <div className="flex items-center gap-2 border-b border-line2 px-3">
            <Search size={14} className="shrink-0 text-slate-400" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setActive(0); }}
              onKeyDown={onKeyDown}
              placeholder={searchPlaceholder}
              className="h-10 w-full bg-transparent text-sm text-ink placeholder:text-slate-400 focus:outline-none"
            />
          </div>

          {shown.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted">{emptyText}</p>
          ) : (
            <ul ref={listRef} role="listbox" className="max-h-64 overflow-y-auto py-1">
              {shown.map((o, i) => (
                <li
                  key={o.value}
                  role="option"
                  aria-selected={o.value === value}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(o)}
                  className={cn(
                    'flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm',
                    i === active ? 'bg-primary-soft text-primary-text' : 'text-ink',
                  )}
                >
                  <span className="truncate">{o.label}</span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {o.hint && <span className="text-xs text-muted">{o.hint}</span>}
                    {o.value === value && <Check size={14} className="text-primary" />}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {filtered.length > shown.length && (
            <p className="border-t border-line2 px-3 py-2 text-xs text-muted">
              Đang hiện {shown.length} trong {filtered.length} kết quả — gõ thêm để thu hẹp.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
