# IUOSS Hub — Design System

Phong cách: **cổng dịch vụ sinh viên của trường đại học** — chuyên nghiệp, rõ ràng,
mature, institutional. Có điểm nhấn thương hiệu (xanh) và thân thiện, **không** phải
"AI SaaS dashboard". Đây là nguồn chuẩn; mọi UI mới trong Hub phải theo.

## Nguyên tắc cốt lõi
- **Border-first, shadow tối thiểu.** Dùng `border border-line` để phân tách; shadow chỉ `shadow-card` (0 1px 2px) nếu cần.
- **Màu có kiểm soát.** Trắng/xám là nền; màu (blue/emerald/amber/red) chỉ để: CTA, active menu, link/action, badge trạng thái, accent icon nhỏ theo section. KHÔNG phủ màu diện rộng.
- **Radius 8px** (`rounded-lg`) cho card/input/button. Không bo 16–20px đại trà.
- **Một màu hành động** = primary blue. Không dùng 2 màu CTA khác nhau.
- **Hierarchy bằng typography/spacing + accent nhỏ**, không bằng nhiều màu/shadow.
- **1 icon nhỏ (16px) tối đa cho mỗi title section.** Không icon nền pastel nhiều màu.

## Design tokens (nguồn: code, KHÔNG hardcode màu rời rạc)
- **`tailwind.config.ts`** — color system:
  - `primary` (#2563eb / hover #1d4ed8 / text #1d4ed8 / soft #eff6ff / line #bfdbfe)
  - `success` emerald · `warning` amber · `danger` red — mỗi cái có `soft`/`line`/`text`
  - neutral: `ink #111827`, `muted #64748b`, `line #e5e7eb`, `line2 #eef1f5`, `canvas #f6f8fb`, `sidebar #f8fafc`
  - `shadow-card`, `max-w-content` (1120px)
- **`lib/ui.ts`** — className tái sử dụng: `ui.card`, `ui.cardHeader`, `ui.sectionTitle`, `ui.input`, `ui.textarea`, `ui.btnPrimary`, `ui.btnSecondary`, `ui.btnGhost`, `ui.btnOutline`, `ui.dtRow/dtLabel/dtValue`; `badge.{base,success,warning,danger,info,neutral}`; `accentIcon.{primary,success,warning,danger,neutral}`.
- **`lib/types.ts`** — `REQUEST_STATUS_STYLES` map trạng thái → token semantic.

> Thêm UI mới: dùng token có sẵn. Cần biến thể mới thì thêm vào `lib/ui.ts` / `tailwind.config.ts`, đừng rải class/màu ad-hoc.

## Khuôn mẫu component
- **Card**: `ui.card` + header `ui.cardHeader` (title `ui.sectionTitle` kèm 1 icon accent `accentIcon[...]`). Section quan trọng có thể thêm `border-t-2 border-t-primary` (như card form).
- **Badge trạng thái**: `cn(badge.base, badge.<variant>)`. pending=warning, processing=info, done=success, rejected=danger, "Đang học"=success.
- **Button**: chính = `ui.btnPrimary` (blue, h-40, radius 8); phụ = `ui.btnSecondary` (viền, chữ blue) / `ui.btnGhost` (text). Action phụ trong bảng dùng `btnSecondary` (có viền), không để text trần.
- **Bảng**: header `bg-[#f8fafc]` + `text-muted` label thường (không uppercase tracking-widest); row `border-b border-line2` + `hover:bg-[#f9fafb]`; mục đích dài `line-clamp-2` + `title`.
- **Definition list** (thông tin hành chính): `ui.dtRow`; giá trị trống → `italic text-slate-400` "Chưa cập nhật" / "—".
- **Hero/greeting**: panel tint `bg-[#f5f9ff]` + `border-primary-line`, tiêu đề + subtitle + CTA primary bên phải. Không emoji, không gradient đậm.
- **Sidebar**: nền `bg-sidebar` (#f8fafc), dải accent `h-1 bg-primary` trên đỉnh, brand IU. Active = `bg-primary-soft text-primary-text` + `border-l-[3px] border-primary`. Không sidebar navy full.
- **Form**: card viền (+ accent trên), header chữ + mô tả, breadcrumb nhỏ, option = tile (`border`, active `border-primary bg-primary-soft ring-primary-line`), `*` bắt buộc tinh tế, counter dưới input, footer căn phải, alert note `border-l-2 border-primary`.
- **Trang chờ / tính năng chưa mở** (`components/coming-soon.tsx`): card căn giữa `max-w-[560px]`, ô icon 56px `bg-primary-soft` + `border-primary-line`, tên tính năng, badge `badge.info` "Đang phát triển", một câu giải thích, divider `border-line2`, nút `btnSecondary` quay lại. Không minh hoạ lớn, không đồng hồ đếm ngược, không hứa mốc thời gian cụ thể. Ở sidebar, mục chưa mở chỉ mang **một chấm 6px** `bg-warning-line` + `title` — đánh dấu cái bất thường, không dán nhãn dài lên mọi mục.

## Tuyệt đối tránh
Gradient đậm · glassmorphism (`backdrop-blur`) · shadow dày · icon nền pastel nhiều màu · nhiều card metric kiểu SaaS · sidebar navy đậm full · emoji trong UI chính · copywriting kiểu marketing · phủ màu diện rộng · bo góc quá mức.

## Accessibility
Contrast đủ; `:focus-visible` outline rõ (đã set globals); trạng thái luôn có **text**, không chỉ dùng màu; click target ~40px.
