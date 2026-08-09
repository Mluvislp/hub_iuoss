'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import Sidebar from '@/components/layout/sidebar';
import Topbar from '@/components/layout/topbar';
import ComingSoon from '@/components/coming-soon';
import { getSession } from '@/lib/auth';
import { useFeatures, featureForRoute, FEATURE_META } from '@/lib/features';
import type { StudentSession } from '@/lib/types';

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Bảng thông tin',
  '/dashboard/bao-hiem-y-te': 'Bảo hiểm y tế',
  '/dashboard/sinh-hoat-cong-dan': 'Sinh hoạt công dân',
  '/dashboard/khai-bao-ngoai-tru': 'Khai báo ngoại trú',
  '/dashboard/requests/new': 'Yêu cầu giấy tờ',
  '/dashboard/requests/other': 'Yêu cầu giấy tờ',
  '/dashboard/requests/deferment': 'Yêu cầu giấy tờ',
  '/dashboard/requests/thuong-binh': 'Yêu cầu giấy tờ',
  '/dashboard/requests/bank-loan': 'Yêu cầu giấy tờ',
  '/dashboard/requests/english': 'Yêu cầu giấy tờ',
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [session, setSession] = useState<StudentSession | null>(null);
  const { features, ready } = useFeatures();

  useEffect(() => {
    setSession(getSession() as StudentSession | null);
  }, []);

  // Chặn ở MỘT chỗ cho mọi tính năng chưa mở: route thuộc tính năng đang tắt thì
  // thay nội dung bằng trang chờ, không cần từng page tự kiểm tra.
  const routeFeature = featureForRoute(pathname);
  const pending = routeFeature !== null && !features[routeFeature];

  const title = pending && routeFeature
    ? FEATURE_META[routeFeature].label
    : PAGE_TITLES[pathname] ?? 'IUOSS Hub';

  return (
    <div className="min-h-screen bg-canvas">
      <Sidebar
        session={session}
        features={features}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="lg:pl-[260px] flex flex-col min-h-screen">
        <Topbar title={title} session={session} onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1">
          <div className="max-w-content px-5 sm:px-8 py-6 sm:py-8">
            {/* Chưa biết cờ → chờ, tránh chớp nội dung rồi đổi sang trang chờ. */}
            {!ready && routeFeature ? (
              <div className="flex items-center justify-center h-64 text-muted">
                <Loader2 size={26} className="animate-spin" />
              </div>
            ) : pending && routeFeature ? (
              <ComingSoon feature={routeFeature} />
            ) : (
              children
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
