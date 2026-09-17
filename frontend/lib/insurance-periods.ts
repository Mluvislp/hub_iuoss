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
  const timeline = [...periods].sort(
    (a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime(),
  );
  const openIndex = timeline.findIndex((period) => period.status === 'open');
  if (openIndex >= 0) return timeline.slice(openIndex, openIndex + 2);

  const nextIndex = timeline.findIndex((period) => period.status === 'upcoming');
  if (nextIndex < 0) return timeline.slice(-2);

  const expiredBeforeNext = timeline
    .slice(0, nextIndex)
    .filter((period) => period.status === 'expired');
  const previousExpired = expiredBeforeNext[expiredBeforeNext.length - 1];
  if (previousExpired) return [previousExpired, timeline[nextIndex]];

  // Chu kỳ mới chưa có đợt vừa hết hạn: vẫn hiện đợt kế tiếp + đợt sau nó.
  return timeline.slice(nextIndex, nextIndex + 2);
}
