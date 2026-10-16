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
    'transition-colors disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-primary ' +
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

  // Thanh nút cuối form yêu cầu: điện thoại xếp dọc full-width (nút chính trên cùng — thứ tự DOM
  // là Quay lại · Xem trước · Gửi nên dùng flex-col-reverse), từ sm trở lên một hàng canh phải.
  formFooter:
    'flex flex-col-reverse gap-2 pt-2 border-t border-line -mx-6 px-6 -mb-5 pb-5 ' +
    'sm:flex-row sm:items-center sm:justify-end',
  formFooterBtn: 'w-full whitespace-nowrap sm:w-auto',

  // Definition list row (thông tin hành chính) — kiểu "summary list" của GOV.UK: nhãn và giá trị
  // cùng căn TRÁI theo hai cột cố định tỉ lệ, đọc dọc một mạch; không đẩy giá trị dạt mép phải.
  dtRow: 'grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4 py-2.5 border-b border-line2 last:border-0',
  dtLabel: 'text-sm text-muted',
  dtValue: 'text-sm font-medium text-ink break-words',
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

/**
 * Icon cạnh tiêu đề section — MỘT màu trung tính cho mọi section (16/10/2026). Trước đây mỗi
 * section một màu (xanh/lục/vàng) làm trang loang lổ; màu chỉ còn ở badge trạng thái & nút.
 * Giữ các khoá cũ để không phải sửa chỗ gọi.
 */
export const accentIcon = {
  primary: 'text-slate-500',
  success: 'text-slate-500',
  warning: 'text-slate-500',
  danger: 'text-slate-500',
  neutral: 'text-slate-500',
};

/**
 * Hộp thông báo / ghi chú trong trang. Nền TRẮNG, viền xám, màu ngữ nghĩa chỉ ở vạch trái 3px
 * và icon — không tô nền pastel. Lỗi chặn thao tác (form không gửi được) vẫn dùng `notice.error`.
 *   <div className={cn(notice.base, notice.warning)}><AlertCircle className={noticeIcon.warning} />…</div>
 */
export const notice = {
  base: 'flex items-start gap-2.5 rounded-lg border border-line bg-white px-4 py-3 text-sm text-ink border-l-[3px]',
  info: 'border-l-primary',
  warning: 'border-l-[#d97706]',
  success: 'border-l-[#059669]',
  neutral: 'border-l-slate-300',
  error: 'border-danger-line border-l-danger-text bg-danger-soft text-danger-text',
};
export const noticeIcon = {
  info: 'mt-0.5 h-4 w-4 shrink-0 text-primary',
  warning: 'mt-0.5 h-4 w-4 shrink-0 text-[#d97706]',
  success: 'mt-0.5 h-4 w-4 shrink-0 text-[#059669]',
  neutral: 'mt-0.5 h-4 w-4 shrink-0 text-slate-400',
  error: 'mt-0.5 h-4 w-4 shrink-0 text-danger-text',
};

/** Ô số liệu / khối phụ trong card: nền xám rất nhạt, không tô màu ngữ nghĩa. */
export const subtle = 'rounded-lg border border-line2 bg-[#f8fafc]';

// Backward-compat alias
export const statusChip = badge.base;
