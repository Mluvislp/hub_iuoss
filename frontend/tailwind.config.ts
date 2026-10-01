import type { Config } from 'tailwindcss';
import plugin from 'tailwindcss/plugin';

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    // lib/ui.ts chứa class token (ui.input, ui.btn*, badge…) — thiếu dòng này thì
    // class chỉ xuất hiện ở đó sẽ không được sinh CSS.
    './lib/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      // Màu theo VAI TRÒ, không theo bảng màu. Component chỉ dùng tên ở đây (và
      // white/black) — đổi nhận diện (vd màu HCMIU/OSS) thì sửa block này là đủ.
      // Ngoại lệ có chủ ý: panel tối trang đăng nhập và tông icon ô tải ảnh BHYT
      // là màu trang trí, không phải vai trò.
      colors: {
        // ── Brand / action ──
        primary: {
          DEFAULT: '#2563eb',
          hover: '#1d4ed8',
          active: '#1e40af',  // nút đang nhấn
          text: '#1d4ed8',
          soft: '#eff6ff',
          wash: '#f5f9ff',    // nền khối chào / khối thông tin nổi nhẹ
          line: '#bfdbfe',
        },
        // ── Semantic (tint nhẹ theo trạng thái/section) ──
        success: { text: '#047857', soft: '#ecfdf5', line: '#a7f3d0' },
        warning: { text: '#b45309', soft: '#fffbeb', line: '#fde68a' },
        danger: {
          DEFAULT: '#ef4444', // viền / ring của ô đang lỗi
          text: '#b91c1c',
          strong: '#991b1b',  // chữ nhấn trên nền danger-soft
          soft: '#fef2f2',
          line: '#fecaca',
        },
        // Trạng thái "SV cần làm gì đó" (chờ bổ sung thông tin) — tách khỏi warning.
        attention: { text: '#6d28d9', strong: '#4c1d95', soft: '#f5f3ff', line: '#ddd6fe' },

        // ── Neutral ──
        ink: {
          DEFAULT: '#111827', // text chính
          2: '#334155',       // text phụ đậm (nhãn, đoạn mô tả)
          3: '#475569',       // text phụ (cột bảng, mô tả ngắn)
        },
        muted: '#64748b',     // text phụ nhạt nhất còn đạt 4.5:1
        faint: '#94a3b8',     // CHỈ icon trang trí / trạng thái disabled — không dùng cho chữ
        line: {
          DEFAULT: '#e5e7eb', // border mặc định
          strong: '#cbd5e1',  // viền ô nhập trang đăng nhập, khung kéo thả
          hover: '#94a3b8',   // viền khi rê chuột
        },
        line2: '#eef1f5',     // border phụ (row separator)
        canvas: '#f6f8fb',    // nền trang
        sidebar: '#f8fafc',   // nền sidebar (hơi khác main)
        surface: {
          subtle: '#f8fafc',  // nền phụ: đầu bảng, ô khóa, hover hàng
          muted: '#f1f5f9',   // nền hover nút ghost, nút disabled
        },
        scrim: '#0f172a',     // lớp phủ sau modal/drawer — dùng kèm /opacity
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
      },
      // Thang cỡ chữ theo VAI TRÒ. Dùng cùng xs (12) / sm (14, nội dung) có sẵn;
      // không viết text-[0.82rem]… nữa. Thêm cỡ mới ở đây thì khai báo luôn trong
      // lib/utils.ts (tailwind-merge) — không thì cn() coi nó là màu chữ và xóa mất.
      fontSize: {
        meta: ['0.8125rem', { lineHeight: '1.25rem' }],     // 13px — mô tả phụ, nhãn ô nhập
        section: ['0.9375rem', { lineHeight: '1.375rem' }], // 15px — tiêu đề thẻ / mục
        title: ['1.125rem', { lineHeight: '1.625rem' }],    // 18px — tiêu đề trang
        headline: ['1.375rem', { lineHeight: '1.875rem' }], // 22px — lời chào trang chủ
      },
      boxShadow: {
        card: '0 1px 2px rgba(16,24,40,0.04)',
      },
      maxWidth: {
        content: '1120px',
      },
    },
  },
  plugins: [
    // `coarse:` = thiết bị cảm ứng (ngón tay). Dùng để nâng vùng chạm lên 44px
    // trên điện thoại mà desktop vẫn giữ mật độ gọn như cũ.
    plugin(({ addVariant }) => addVariant('coarse', '@media (pointer: coarse)')),
  ],
};

export default config;
