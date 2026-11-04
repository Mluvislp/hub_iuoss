import type { Metadata } from 'next';
import { Be_Vietnam_Pro, Cormorant_Garamond } from 'next/font/google';

// Chỉ trang Lễ tốt nghiệp: tiêu đề serif cổ điển (Cormorant Garamond) cho không khí lễ,
// nội dung Be Vietnam Pro — font thiết kế cho tiếng Việt, dấu đặt đẹp hơn Inter.
const display = Cormorant_Garamond({
  subsets: ['latin', 'vietnamese'],
  weight: ['500', '600', '700'],
  style: ['normal', 'italic'],
  variable: '--font-display',
  display: 'swap',
});
const body = Be_Vietnam_Pro({
  subsets: ['latin', 'vietnamese'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-grad-body',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Lễ Tốt nghiệp 2026 — Trường Đại học Quốc tế',
  description: 'Chúc mừng Tân khoa 2026 — đăng ký tham dự Lễ Tốt nghiệp, Trường Đại học Quốc tế, ĐHQG-HCM.',
};

export default function GraduationLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${display.variable} ${body.variable} font-grad [font-variant-numeric:lining-nums]`}>{children}</div>;
}
