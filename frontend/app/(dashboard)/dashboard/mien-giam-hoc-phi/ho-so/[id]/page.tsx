'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { BASE } from '../../shared';

/**
 * Chi tiết đơn nay là pop-up trên trang tổng quan (như "Chi tiết" đơn BHYT).
 * Giữ route này để link cũ (email, lịch sử trình duyệt) vẫn mở đúng đơn.
 */
export default function TuitionWaiverDetailRedirect() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = Number(params?.id);

  useEffect(() => {
    router.replace(id ? `${BASE}?don=${id}` : BASE);
  }, [id, router]);

  return (
    <div className="flex h-48 items-center justify-center text-muted">
      <Loader2 size={24} className="animate-spin" />
    </div>
  );
}
