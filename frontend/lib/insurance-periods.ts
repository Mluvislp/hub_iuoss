/**
 * Tính toán các đợt đăng ký BHYT dựa trên ngày hiện tại.
 * Đợt phụ (Q2, Q3, Q4): Mở trước 1.5 tháng, kéo dài 2 tuần.
 * Đợt chính (Quý 1 năm sau): Bắt đầu mở từ 15/9 năm nay.
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
  
  // Đợt cho Quý 2: 15/2 - cuối tháng 2
  const q2Start = new Date(year, 1, 15);
  const q2End = new Date(year, 1, new Date(year, 2, 0).getDate()); 
  
  // Đợt cho Quý 3: 15/5 - 31/5
  const q3Start = new Date(year, 4, 15);
  const q3End = new Date(year, 4, 31);
  
  // Đợt cho Quý 4: 15/8 - 31/8
  const q4Start = new Date(year, 7, 15);
  const q4End = new Date(year, 7, 31);
  
  // Đợt chính cho QUÝ 1 NĂM SAU: Mở từ 15/9 năm nay
  const mainStart = new Date(year, 8, 15); 
  // Bạn có thể tùy chỉnh ngày kết thúc đợt chính (VD: 31/10 hoặc 30/11)
  const mainEnd = new Date(year, 10, 31); 
  
  const periods = [
    { id: 'q2', name: 'Đăng ký Quý 2', startDate: q2Start, endDate: q2End },
    { id: 'q3', name: 'Đăng ký Quý 3', startDate: q3Start, endDate: q3End },
    { id: 'q4', name: 'Đăng ký Quý 4', startDate: q4Start, endDate: q4End },
    { id: 'main', name: `Đăng ký BHYT cho năm ${year + 1}`, startDate: mainStart, endDate: mainEnd },
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