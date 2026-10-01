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
      colors: {
        // ── Brand / action ──
        primary: {
          DEFAULT: '#2563eb',
          hover: '#1d4ed8',
          text: '#1d4ed8',
          soft: '#eff6ff',
          line: '#bfdbfe',
        },
        // ── Semantic (tint nhẹ theo trạng thái/section) ──
        success: { text: '#047857', soft: '#ecfdf5', line: '#a7f3d0' },
        warning: { text: '#b45309', soft: '#fffbeb', line: '#fde68a' },
        danger:  { text: '#b91c1c', soft: '#fef2f2', line: '#fecaca' },

        // ── Neutral ──
        ink: '#111827',       // text chính
        muted: '#64748b',     // text phụ
        line: '#e5e7eb',      // border mặc định
        line2: '#eef1f5',     // border phụ (row separator)
        canvas: '#f6f8fb',    // nền trang
        sidebar: '#f8fafc',   // nền sidebar (hơi khác main)
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
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
