/** Một trong bốn slot đăng ký BHYT do staff cấu hình trên Dashboard. */
export interface InsurancePeriod {
  id: string;
  registration_period: 'MAIN' | 'Q2' | 'Q3' | 'Q4';
  registration_year: number;
  name: string;
  start_date: string;
  end_date: string;
  coverage_start: string;
  coverage_end: string;
  status: 'expired' | 'open' | 'upcoming';
  is_active: boolean;
}

/**
 * Hai đợt gần thời điểm hiện tại để trang BHYT không bị quá dài.
 * Trạng thái và thời gian đều do backend trả về; frontend không tự mở đợt.
 */
export function getVisibleInsurancePeriods(periods: InsurancePeriod[]): InsurancePeriod[] {
  const sequence: InsurancePeriod['registration_period'][] = ['MAIN', 'Q2', 'Q3', 'Q4'];
  const timeline = [...periods].sort(
    (a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime(),
  );
  const open = timeline.find((period) => period.status === 'open');
  if (open) {
    // Khi một đợt đang mở, thẻ kế bên luôn là mã đợt tiếp theo. Ngày nhận hồ sơ
    // và năm hưởng do staff cấu hình độc lập nên không được dùng để suy mã kế tiếp.
    const nextCode = sequence[(sequence.indexOf(open.registration_period) + 1) % sequence.length];
    const next = periods.find((period) => period.registration_period === nextCode);
    return next ? [open, next] : [open];
  }

  const previousExpired = [...timeline].reverse().find((period) => period.status === 'expired');
  const upcoming = timeline.find((period) => period.status === 'upcoming');
  if (previousExpired && upcoming) return [previousExpired, upcoming];
  if (!upcoming) return timeline.slice(-2);

  // Chu kỳ mới chưa có đợt vừa hết hạn: vẫn hiện đợt kế tiếp + đợt sau nó.
  const nextIndex = timeline.indexOf(upcoming);
  return timeline.slice(nextIndex, nextIndex + 2);
}
