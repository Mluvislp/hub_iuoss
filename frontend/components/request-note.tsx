'use client';

import { ui } from '@/lib/ui';

/**
 * Ô "Ghi chú thêm" dùng chung cho MỌI form yêu cầu giấy xác nhận.
 *
 * Lời hướng dẫn chỉ viết ở đây. Không có placeholder: gợi ý "Số bản in…" cũ đã bỏ
 * vì giấy chỉ cấp 1 lần/HK/SV. Chuyên viên đọc nội dung ở dòng "Ghi chú SV" trên
 * trang chi tiết yêu cầu (Dashboard). Giới hạn 1000 ký tự khớp backend.
 */
export function RequestNoteField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className={ui.fieldLabel}>Ghi chú thêm <span className="text-muted font-normal">(không bắt buộc)</span></label>
      <textarea
        value={value} onChange={(e) => onChange(e.target.value)} rows={3} maxLength={1000}
        className={ui.textarea}
      />
      <ul className="mt-1.5 space-y-0.5 text-[0.75rem] text-muted">
        <li>• Thông tin sinh viên có sai sót: ghi rõ thông tin sai và thông tin đúng vào đây.</li>
        <li>• Nếu có yêu cầu đặc biệt, vui lòng ghi rõ nội dung.</li>
      </ul>
    </div>
  );
}
