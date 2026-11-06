'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import DeclarationPage from './DeclarationPage';

/* Khai báo ngoại trú TẠM ĐÓNG (11/2026), thay bằng Khai báo địa chỉ. Cờ backend
   FEATURE_OFFCAMPUS tắt ⇒ link cũ (thư, bookmark) chuyển thẳng sang trang mới;
   API /offcampus/ cũng trả 404 nên không ai gửi được theo luật cũ. */
export default function OffCampusDeclarationPage() {
  const router = useRouter();
  const [open, setOpen] = useState<boolean | null>(null);

  useEffect(() => {
    api.features
      .get()
      .then((f) => {
        if (f.offcampus) setOpen(true);
        else router.replace('/dashboard/khai-bao-dia-chi');
      })
      .catch(() => router.replace('/dashboard/khai-bao-dia-chi'));
  }, [router]);

  if (!open) {
    return (
      <div className="flex items-center justify-center py-20 text-muted">
        <Loader2 size={22} className="animate-spin mr-2" /> Đang tải…
      </div>
    );
  }
  return <DeclarationPage variant="offcampus" />;
}
