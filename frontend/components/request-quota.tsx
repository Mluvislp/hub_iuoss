'use client';

/**
 * Hạn mức xin giấy tờ: mỗi loại giấy 1 lần / 1 học kỳ (backend `core/request_quota.py`).
 *
 * Nguyên tắc người dùng chốt: KHÔNG ẩn loại giấy hết lượt — làm mờ + nêu rõ lý do + đề nghị
 * liên hệ qua email khi cần xin thêm. Backend vẫn chặn (409) nên giao diện chỉ để báo sớm.
 */

import { useEffect, useState } from 'react';
import { Ban } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { RequestAvailability } from '@/lib/types';

export function useRequestQuota(): RequestAvailability | null {
  const [data, setData] = useState<RequestAvailability | null>(null);
  useEffect(() => {
    let alive = true;
    api.requests
      .availability()
      .then((d) => alive && setData(d))
      .catch(() => {
        /* không tải được thì không chặn ở giao diện — backend vẫn kiểm khi gửi */
      });
    return () => {
      alive = false;
    };
  }, []);
  return data;
}

/** Khối thông báo lý do hết lượt (dùng ở trang chọn loại + đầu mỗi form). */
export function QuotaNotice({ reason, className }: { reason: string; className?: string }) {
  return (
    <div className={cn('flex items-start gap-2.5 rounded-lg border border-warning-line bg-warning-soft px-4 py-3', className)}>
      <Ban size={16} className="mt-0.5 shrink-0 text-warning-text" />
      <p className="text-[0.84rem] leading-relaxed text-warning-text">{reason}</p>
    </div>
  );
}

/**
 * Bọc nội dung form: loại giấy hết lượt ⇒ hiện lý do + khoá toàn bộ ô nhập (fieldset disabled,
 * làm mờ) thay vì ẩn form.
 */
export function QuotaGuard({ type, children }: { type: string; children: React.ReactNode }) {
  const quota = useRequestQuota();
  const state = quota?.types[type];
  const blocked = !!state?.blocked;
  return (
    <>
      {blocked && <QuotaNotice reason={state!.reason} />}
      <fieldset
        disabled={blocked}
        aria-disabled={blocked}
        className={cn('min-w-0 space-y-6', blocked && 'pointer-events-none select-none opacity-50')}
      >
        {children}
      </fieldset>
    </>
  );
}
