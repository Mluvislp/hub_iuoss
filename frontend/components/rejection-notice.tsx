import type { ReactNode } from 'react';
import { AlertTriangle, MessageSquareText } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Khối hiển thị phản hồi của cán bộ, dùng chung cho mọi loại từ chối (BHYT, khai ngoài trường,
 * khám sức khỏe…). `rejected` → viền đỏ + tiêu đề lý do; ngược lại → khối trung tính chỉ có ghi chú.
 * `children` là vùng hành động/hướng dẫn tiếp theo, đặt dưới phần phản hồi.
 */
export function RejectionNotice({ rejected = true, title, note, noteLabel = 'Phản hồi của cán bộ', eyebrow = 'Bị từ chối', children, className }: {
  rejected?: boolean;
  title?: string;
  note?: string | null;
  noteLabel?: string;
  eyebrow?: string;
  children?: ReactNode;
  className?: string;
}) {
  if (!rejected && !note) return null;
  return (
    <section className={cn('overflow-hidden rounded-lg border bg-white', rejected ? 'border-danger-line' : 'border-line', className)}>
      {rejected && (
        <div className="flex items-start gap-3 border-b border-danger-line bg-danger-soft px-4 py-3 text-danger-text">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide opacity-80">{eyebrow}</p>
            <p className="font-semibold leading-snug">{title || 'Vui lòng xem phản hồi bên dưới'}</p>
          </div>
        </div>
      )}
      <div className="space-y-3 p-4">
        {note && (
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
              {!rejected && <MessageSquareText className="h-3.5 w-3.5" />}{noteLabel}
            </p>
            <blockquote className={cn(
              'whitespace-pre-wrap break-words rounded-lg border bg-surface-subtle px-3.5 py-3 text-sm leading-6 text-ink',
              rejected ? 'border-danger-line' : 'border-line',
            )}>{note}</blockquote>
          </div>
        )}
        {children}
      </div>
    </section>
  );
}
