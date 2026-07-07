/**
 * Design tokens dạng className (Tailwind) — "university service portal":
 * border-first, shadow tối thiểu, radius 8px, màu thương hiệu có kiểm soát.
 */
export const ui = {
  // Panel / card
  card: 'bg-white border border-line rounded-lg shadow-card',
  cardHeader: 'flex items-center justify-between gap-3 px-5 py-3 border-b border-line',
  sectionTitle: 'flex items-center gap-2 text-[0.95rem] font-semibold text-ink',

  // Text
  label: 'text-[0.8rem] font-medium text-muted',
  fieldLabel: 'block text-[0.82rem] font-medium text-ink mb-1.5',

  // Form controls
  input:
    'w-full h-10 px-3 rounded-lg border border-line bg-white text-sm text-ink ' +
    'placeholder:text-slate-400 transition-colors ' +
    'focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/15',
  textarea:
    'w-full px-3 py-2.5 rounded-lg border border-line bg-white text-sm text-ink ' +
    'placeholder:text-slate-400 resize-none transition-colors ' +
    'focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/15',

  // Buttons
  btnPrimary:
    'inline-flex items-center justify-center gap-2 h-10 px-4 rounded-lg ' +
    'bg-primary hover:bg-primary-hover text-white text-sm font-semibold ' +
    'transition-colors disabled:opacity-60 disabled:cursor-not-allowed ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2',
  btnSecondary:
    'inline-flex items-center justify-center gap-2 h-9 px-3.5 rounded-lg ' +
    'border border-line bg-white text-sm font-medium text-primary-text hover:bg-slate-50 transition-colors',
  btnGhost:
    'inline-flex items-center justify-center gap-2 h-10 px-4 rounded-lg ' +
    'text-sm font-medium text-muted hover:text-ink hover:bg-slate-100 transition-colors',
  btnOutline:
    'inline-flex items-center justify-center gap-2 h-10 px-4 rounded-lg ' +
    'border border-line bg-white text-sm font-medium text-ink hover:bg-slate-50 transition-colors',

  // Definition list row (thông tin hành chính)
  dtRow: 'flex items-start justify-between gap-4 py-2.5 border-b border-line2 last:border-0',
  dtLabel: 'text-sm text-muted',
  dtValue: 'text-sm font-medium text-ink text-right',
};

/** Badge trạng thái/section — viền hệ thống, tint nhẹ theo ngữ nghĩa. */
export const badge = {
  base: 'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium',
  success: 'bg-success-soft text-success-text border-success-line',
  warning: 'bg-warning-soft text-warning-text border-warning-line',
  danger: 'bg-danger-soft text-danger-text border-danger-line',
  info: 'bg-primary-soft text-primary-text border-primary-line',
  neutral: 'bg-slate-50 text-slate-600 border-slate-200',
};

/** Icon màu accent theo section. */
export const accentIcon = {
  primary: 'text-primary',
  success: 'text-success-text',
  warning: 'text-warning-text',
  danger: 'text-danger-text',
  neutral: 'text-slate-400',
};

// Backward-compat alias
export const statusChip = badge.base;
