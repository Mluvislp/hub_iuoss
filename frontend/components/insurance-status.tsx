import { badge } from '@/lib/ui';
import { cn } from '@/lib/utils';

const names: Record<string, string> = {
  iu_processing: 'ĐHQT xử lý', waiting_bhxh: 'Chờ BHXH xử lý',
  issued: 'Phát hành', rejected: 'Từ chối',
  pending: 'Chờ xác nhận', confirmed: 'Đã xác nhận',
};
// Cùng bảng màu với badge của cổng (và pill trạng thái bên Dashboard).
const colors: Record<string, string> = {
  iu_processing: badge.neutral,
  waiting_bhxh: badge.info,
  issued: badge.success,
  rejected: badge.danger,
  pending: badge.warning,
  confirmed: badge.success,
};

export function InsuranceStatus({ status }: { status: string }) {
  return <span className={cn(badge.base, 'max-w-full whitespace-nowrap', colors[status] || badge.neutral)}>
    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-80" />
    {names[status] || status}
  </span>;
}
