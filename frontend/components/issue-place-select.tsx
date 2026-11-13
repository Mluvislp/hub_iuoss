'use client';

/* Ô "Nơi cấp" của CCCD: chọn 1 trong các cơ quan cấp chính thức, hoặc "Khác" để tự gõ.
   Giá trị lưu vẫn là CHUỖI tên cơ quan (cột student_identity_documents.issue_place),
   không phải mã — danh sách này chỉ để SV khỏi gõ sai. */

import { useState } from 'react';
import { ui } from '@/lib/ui';
import { cn } from '@/lib/utils';

export const CCCD_ISSUE_PLACES = [
  // Thẻ CCCD gắn chip, 2021 – 30/06/2024 (đa số SV).
  'Cục Cảnh sát Quản lý Hành chính về Trật tự Xã hội',
  // Thẻ Căn cước, từ 01/07/2024.
  'Bộ Công an',
  // Thẻ CCCD mã vạch, 2016 – 2021.
  'Cục Cảnh sát ĐKQL cư trú và DLQG về dân cư',
] as const;

const OTHER = '__other__';

const fold = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
    .toLowerCase().replace(/\s+/g, ' ').trim();

// Cách viết tắt hay gặp trong dữ liệu cũ → tên đầy đủ trong danh sách.
const ALIASES: Record<string, string> = {
  [fold('Cục Cảnh sát Quản lý Hành chính về TTXH')]: CCCD_ISSUE_PLACES[0],
  [fold('Cục Cảnh sát QLHC về TTXH')]: CCCD_ISSUE_PLACES[0],
};

/** Đưa giá trị đang có về đúng tên trong danh sách (nếu khớp); không khớp thì giữ nguyên. */
export function normalizeIssuePlace(value: string): string {
  const key = fold(value);
  if (!key) return '';
  return CCCD_ISSUE_PLACES.find((p) => fold(p) === key) ?? ALIASES[key] ?? value.trim();
}

export default function IssuePlaceSelect({
  id, value, onChange, className,
}: { id?: string; value: string; onChange: (value: string) => void; className?: string }) {
  const preset = (CCCD_ISSUE_PLACES as readonly string[]).includes(value);
  // "Khác" phải nhớ bằng state riêng: vừa chọn Khác thì value còn rỗng, không suy ra được.
  const [other, setOther] = useState(!!value && !preset);
  const selected = other ? OTHER : preset ? value : '';

  return (
    <div className="space-y-2">
      <select
        id={id}
        value={selected}
        onChange={(e) => {
          const v = e.target.value;
          if (v === OTHER) {
            setOther(true);
            onChange(preset ? '' : value);
          } else {
            setOther(false);
            onChange(v);
          }
        }}
        className={cn(ui.input, className)}
      >
        <option value="">Chọn nơi cấp</option>
        {CCCD_ISSUE_PLACES.map((p) => <option key={p} value={p}>{p}</option>)}
        <option value={OTHER}>Khác (tự nhập)</option>
      </select>
      {other && (
        <input
          type="text" value={value} maxLength={255}
          aria-label="Nơi cấp khác"
          placeholder="Nhập nơi cấp ghi trên thẻ"
          onChange={(e) => onChange(e.target.value)}
          className={cn(ui.input, className)}
          autoFocus
        />
      )}
    </div>
  );
}
