'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { ui, badge } from '@/lib/ui';
import { cn } from '@/lib/utils';
import { FEATURE_META, type FeatureKey } from '@/lib/features';

/**
 * Trang chờ dùng chung cho MỌI tính năng chưa mở (xem lib/features.ts).
 * Giữ đúng ngôn ngữ thiết kế Hub: border-first, tint xanh có kiểm soát,
 * không gradient/đổ bóng nặng, không emoji.
 */
export default function ComingSoon({ feature }: { feature: FeatureKey }) {
  const { label, icon: Icon } = FEATURE_META[feature];

  return (
    <div className="max-w-[560px] mx-auto">
      <section className={cn(ui.card, 'px-6 sm:px-10 py-10 text-center')}>
        <div
          className="w-14 h-14 mx-auto rounded-lg bg-primary-soft border border-primary-line
                     flex items-center justify-center"
        >
          <Icon size={24} className="text-primary" strokeWidth={1.75} />
        </div>

        <h1 className="mt-5 text-[1.15rem] font-semibold text-ink">{label}</h1>

        <div className="mt-2.5 flex justify-center">
          <span className={cn(badge.base, badge.info)}>Đang phát triển</span>
        </div>

        <p className="mt-5 text-sm text-muted leading-relaxed">
          Chức năng đang phát triển và sẽ sớm hoàn thiện, bạn vui lòng chờ thêm một thời gian.
        </p>

        <div className="mt-7 pt-6 border-t border-line2">
          <p className="text-[0.82rem] text-muted">
            Trong thời gian chờ, bạn có thể liên hệ trực tiếp Phòng Công tác Sinh viên nếu cần hỗ trợ.
          </p>
          <Link href="/dashboard" className={cn(ui.btnSecondary, 'mt-4')}>
            <ArrowLeft size={15} />
            Về Bảng thông tin
          </Link>
        </div>
      </section>
    </div>
  );
}
