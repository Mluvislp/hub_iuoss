'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Sidebar from '@/components/layout/sidebar';
import Topbar from '@/components/layout/topbar';
import { getSession } from '@/lib/auth';
import type { StudentSession } from '@/lib/types';

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/dashboard/requests/new': 'Tạo yêu cầu giấy tờ',
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
    <div className="min-h-screen bg-slate-50">
      <Sidebar
        session={session}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Main — pushed right on desktop */}
      <div className="lg:pl-[240px] flex flex-col min-h-screen">
        <Topbar
          title={title}
          session={session}
          onMenuClick={() => setSidebarOpen(true)}
        />
        <main className="flex-1 p-5 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
