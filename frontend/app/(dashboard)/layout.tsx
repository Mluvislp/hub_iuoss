'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Sidebar from '@/components/layout/sidebar';
import Topbar from '@/components/layout/topbar';
import { getSession } from '@/lib/auth';
import type { StudentSession } from '@/lib/types';

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Bảng thông tin',
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

  useEffect(() => {
    setSession(getSession() as StudentSession | null);
  }, []);

  const title = PAGE_TITLES[pathname] ?? 'IUOSS Hub';

  return (
    <div className="min-h-screen bg-canvas">
      <Sidebar session={session} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="lg:pl-[260px] flex flex-col min-h-screen">
        <Topbar title={title} session={session} onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1">
          <div className="max-w-content px-5 sm:px-8 py-6 sm:py-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
