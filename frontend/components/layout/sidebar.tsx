'use client';

import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  LayoutDashboard,
  FileText,
  LogOut,
  X,
} from 'lucide-react';
import { cn, getInitials } from '@/lib/utils';
import { clearAuth } from '@/lib/auth';
import type { StudentSession } from '@/lib/types';

interface SidebarProps {
  session: StudentSession | null;
  open: boolean;
  onClose: () => void;
}

interface NavItem {
  href: string;
  icon: React.ElementType;
  label: string;
}

const NAV_SECTIONS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Tổng quan',
    items: [{ href: '/dashboard', icon: LayoutDashboard, label: 'Bảng thông tin' }],
  },
  {
    label: 'Dịch vụ sinh viên',
    items: [{ href: '/dashboard/requests/new', icon: FileText, label: 'Yêu cầu giấy tờ' }],
  },
];

export default function Sidebar({ session, open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  function handleLogout() {
    clearAuth();
    router.replace('/login');
  }

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div className="fixed inset-0 bg-slate-900/40 z-40 lg:hidden" onClick={onClose} />
      )}

      <aside
        className={cn(
          'fixed top-0 left-0 bottom-0 z-50 w-[260px]',
          'bg-sidebar border-r border-line flex flex-col',
          'sidebar-transition lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Dải accent thương hiệu */}
        <div className="h-1 bg-primary" />

        {/* Brand — identity IU/HCMIU */}
        <div className="flex items-center justify-between h-[55px] px-5 bg-white border-b border-line">
          <Link href="/dashboard" className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-md bg-primary text-white flex items-center justify-center
                            text-[0.82rem] font-bold tracking-tight shadow-sm shadow-primary/25">
              IU
            </div>
            <div className="leading-tight">
              <div className="text-ink font-semibold text-[0.9rem]">IUOSS Hub</div>
              <div className="text-muted text-[0.68rem]">Cổng dịch vụ sinh viên</div>
            </div>
          </Link>
          <button
            onClick={onClose}
            className="lg:hidden p-1.5 -mr-1.5 text-muted hover:text-ink"
            aria-label="Đóng menu"
          >
            <X size={18} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto sidebar-scroll py-4">
          {NAV_SECTIONS.map((section, i) => (
            <div key={section.label} className={cn('px-3', i > 0 && 'mt-5 pt-5 border-t border-line2')}>
              <p className="px-2.5 mb-2 text-[0.68rem] font-semibold text-slate-400">
                {section.label}
              </p>
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = pathname === item.href;

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onClose}
                      className={cn(
                        'flex items-center gap-3 px-2.5 h-10 rounded-md text-sm transition-colors border-l-[3px]',
                        isActive
                          ? 'bg-primary-soft border-primary text-primary-text font-semibold'
                          : 'border-transparent text-slate-600 hover:text-ink hover:bg-slate-100',
                      )}
                    >
                      <Icon size={17} className="flex-shrink-0" />
                      <span className="flex-1">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* User block */}
        <div className="border-t border-line p-3">
          {session && (
            <div className="flex items-center gap-3 px-2 py-2">
              <div className="w-8 h-8 rounded-md bg-slate-100 border border-line text-ink
                              flex items-center justify-center text-sm font-semibold flex-shrink-0">
                {getInitials(session.full_name)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-ink text-sm font-medium truncate leading-tight">
                  {session.full_name}
                </div>
                <div className="text-muted text-xs truncate mt-0.5">{session.student_code}</div>
              </div>
            </div>
          )}
          <button
            onClick={handleLogout}
            className="mt-1 w-full flex items-center gap-2.5 px-2.5 h-9 rounded-md text-sm
                       text-slate-600 hover:text-red-600 hover:bg-red-50 transition-colors"
          >
            <LogOut size={16} />
            Đăng xuất
          </button>
        </div>
      </aside>
    </>
  );
}
