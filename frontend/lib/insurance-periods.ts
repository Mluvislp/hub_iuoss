/**
 * Tính toán các đợt đăng ký BHYT dựa trên ngày hiện tại.
 * Đợt chính: Tháng 9 (4-5 tuần).
 * Đợt phụ Q2: 1.5 tháng trước Q2 (giữa tháng 2 đến hết tháng 2).
 * Đợt phụ Q3: 1.5 tháng trước Q3 (giữa tháng 5 đến hết tháng 5).
 * Đợt phụ Q4: 1.5 tháng trước Q4 (giữa tháng 8 đến hết tháng 8).
 */

export interface InsurancePeriod {
  id: string;
  name: string;
  startDate: Date;
  endDate: Date;
  status: 'expired' | 'open' | 'upcoming';
}

export function getInsurancePeriods(now = new Date()): InsurancePeriod[] {
  const year = now.getFullYear();
  
  // Tính toán thời gian các đợt trong năm
  // Q2: 15/2 - 28/2
  const q2Start = new Date(year, 1, 15);
  const q2End = new Date(year, 1, new Date(year, 2, 0).getDate()); // Ngày cuối T2
  
  // Q3: 15/5 - 31/5
  const q3Start = new Date(year, 4, 15);
  const q3End = new Date(year, 4, 31);
  
  // Q4: 15/8 - 31/8
  const q4Start = new Date(year, 7, 15);
  const q4End = new Date(year, 7, 31);
  
  // Đợt chính: 1/9 - 30/9
  const mainStart = new Date(year, 8, 1);
  const mainEnd = new Date(year, 8, 30);
  
  const periods = [
    { id: 'q2', name: 'Đợt phụ Quý 2', startDate: q2Start, endDate: q2End },
    { id: 'q3', name: 'Đợt phụ Quý 3', startDate: q3Start, endDate: q3End },
    { id: 'q4', name: 'Đợt phụ Quý 4', startDate: q4Start, endDate: q4End },
    { id: 'main', name: 'Đợt chính (Tháng 9)', startDate: mainStart, endDate: mainEnd },
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