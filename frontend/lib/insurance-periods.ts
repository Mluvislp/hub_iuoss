/**
 * Tính toán các đợt đăng ký BHYT dựa trên ngày hiện tại.
 * Đợt phụ (Q2, Q3, Q4): Mở trước 1.5 tháng, kéo dài 2 tuần.
 * Đợt chính (Quý 1 năm sau): Mở từ 15/9 đến hết 30/11 năm nay.
 */

export interface InsurancePeriod {
  id: string;
  name: string;
  startDate: Date;
  endDate: Date;
  status: 'expired' | 'open' | 'upcoming';
}

/**
 * Ngày cuối của đợt, lấy tới 23:59:59.
 *
 * ⚠️ Đặt mốc kết thúc ở 00:00 là mất trọn ngày cuối: 00:00:01 của chính ngày đó
 * đã lớn hơn mốc, đợt bị coi là đã đóng.
 */
const endOfDay = (year: number, monthIndex: number, day: number) =>
  new Date(year, monthIndex, day, 23, 59, 59, 999);

/**
 * Ngày cuối cùng của tháng.
 *
 * ⚠️ Dùng hàm này thay vì viết tay số 30/31: `new Date(y, 10, 31)` không báo lỗi
 * mà tự tràn sang 01/12 (tháng 11 chỉ có 30 ngày).
 */
const lastDayOfMonth = (year: number, monthIndex: number) =>
  new Date(year, monthIndex + 1, 0).getDate();

export function getInsurancePeriods(now = new Date()): InsurancePeriod[] {
  const year = now.getFullYear();

  // Đợt cho Quý 2: 15/2 - hết tháng 2
  const q2Start = new Date(year, 1, 15);
  const q2End = endOfDay(year, 1, lastDayOfMonth(year, 1));

  // Đợt cho Quý 3: 15/5 - hết tháng 5
  const q3Start = new Date(year, 4, 15);
  const q3End = endOfDay(year, 4, lastDayOfMonth(year, 4));

  // Đợt cho Quý 4: 15/8 - hết tháng 8
  const q4Start = new Date(year, 7, 15);
  const q4End = endOfDay(year, 7, lastDayOfMonth(year, 7));

  // Đợt chính cho QUÝ 1 NĂM SAU: 15/9 - hết tháng 11
  const mainStart = new Date(year, 8, 15);
  const mainEnd = endOfDay(year, 10, lastDayOfMonth(year, 10));

  const periods = [
    { id: 'q2', name: 'Đợt 2', startDate: q2Start, endDate: q2End },
    { id: 'q3', name: 'Đợt 3', startDate: q3Start, endDate: q3End },
    { id: 'q4', name: 'Đợt 4', startDate: q4Start, endDate: q4End },
    { id: 'main', name: `Đợt 1 ${year + 1}`, startDate: mainStart, endDate: mainEnd },
  ];

  return periods.map(p => {
    let status: 'expired' | 'open' | 'upcoming' = 'upcoming';
    if (now > p.endDate) {
      status = 'expired';
    } else if (now >= p.startDate && now <= p.endDate) {
      status = 'open';
    }

    return {
      ...p,
      status,
    };
  });
}
