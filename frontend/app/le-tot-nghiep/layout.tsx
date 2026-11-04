import type { Metadata } from 'next';
import { Playfair_Display } from 'next/font/google';

// Font tiêu đề trang trọng — chỉ nạp cho trang Lễ tốt nghiệp (tailwind `font-display`).
const display = Playfair_Display({
  subsets: ['latin', 'vietnamese'],
  weight: ['600', '700'],
  variable: '--font-display',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Lễ Tốt nghiệp 2026 — Trường Đại học Quốc tế',
  description: 'Chúc mừng Tân khoa 2026 — đăng ký tham dự Lễ Tốt nghiệp, Trường Đại học Quốc tế, ĐHQG-HCM.',
};

export default function GraduationLayout({ children }: { children: React.ReactNode }) {
  return <div className={display.variable}>{children}</div>;
}
