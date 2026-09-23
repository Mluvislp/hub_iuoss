# CLAUDE.md

Toàn bộ context của repo này nằm ở **[`CODEBASE.md`](CODEBASE.md)** — đọc file đó.

Trước đây `CLAUDE.md` và `CODEBASE.md` chép lại của nhau khoảng 80% (cùng mô tả
monorepo, luật không dùng `django.contrib.auth`, luật không `makemigrations`, cấu trúc
file, bảng tra tài liệu) và hai bản đã lệch nhau. Gộp về một chỗ ngày 23/09/2026.

Ứng dụng anh em dùng chung database: `dashboard_iuoss`. Quy ước áp dụng cho **cả hai**
app (`is_current`, phân quyền, hạ tầng email, bẫy MySQL/Excel) nằm ở
`dashboard_iuoss/docs/ARCHITECTURE.md`.
