'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ChevronRight, Info, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { ui } from '@/lib/ui';
import { cn } from '@/lib/utils';
import DeclarationPage from './DeclarationPage';

/* Khai báo ngoại trú TẠM ĐÓNG (11/2026), thay bằng Khai báo địa chỉ. Đã gỡ khỏi menu
   nhưng giữ đường link (thư cũ, bookmark): cờ backend FEATURE_OFFCAMPUS tắt ⇒ hiện
   thông báo + nút sang trang mới. API /offcampus/ cũng trả 404. */
export default function OffCampusDeclarationPage() {
  const [open, setOpen] = useState<boolean | null>(null);

  useEffect(() => {
    api.features
      .get()
      .then((f) => setOpen(f.offcampus === true))
      .catch(() => setOpen(false));
  }, []);

  if (open === null) {
    return (
      <div className="flex items-center justify-center py-20 text-muted">
        <Loader2 size={22} className="animate-spin mr-2" /> Đang tải…
      </div>
    );
  }
  if (open) return <DeclarationPage variant="offcampus" />;

  return (
    <div className="max-w-[820px] space-y-4">
      <nav className="flex items-center gap-1.5 text-[0.82rem] text-muted">
        <Link href="/dashboard" className="hover:text-ink">Bảng thông tin</Link>
        <ChevronRight size={14} className="text-slate-400" />
        <span className="text-ink font-medium">Khai báo ngoại trú</span>
      </nav>

      <div className={cn(ui.card, 'p-8 text-center')}>
        <div className="w-11 h-11 rounded-full bg-slate-50 border border-line flex items-center justify-center mx-auto mb-4">
          <Info size={20} className="text-slate-500" />
        </div>
        <h1 className="text-lg font-semibold text-ink">Chức năng Khai báo ngoại trú hiện không còn sử dụng</h1>
        <p className="text-sm text-muted mt-2 max-w-[560px] mx-auto">
          Việc khai báo địa chỉ thường trú, tạm trú và cập nhật thông tin cá nhân nay thực hiện
          tại mục <b className="text-ink">Khai báo địa chỉ</b>. Thông tin đã khai báo ngoại trú
          trước đây vẫn được giữ nguyên và hiển thị tại trang mới.
        </p>
        <div className="mt-6 flex items-center justify-center gap-2">
          <Link href="/dashboard" className={ui.btnOutline}>Về Bảng thông tin</Link>
          <Link href="/dashboard/khai-bao-dia-chi" className={ui.btnPrimary}>
            Đến trang Khai báo địa chỉ <ArrowRight size={15} />
          </Link>
        </div>
      </div>
    </div>
  );
}
