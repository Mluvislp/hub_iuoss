'use client';

import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  LayoutDashboard,
  FileText,
  Bell,
  Calendar,
  CreditCard,
  GraduationCap,
  LogOut,
  X,
  ChevronRight,
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
  href?: string;
  icon: React.ElementType;
  label: string;
  disabled?: boolean;
  soon?: boolean;
}

const NAV_SECTIONS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Tổng quan',
    items: [
      { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    ],
  },
  {
    label: 'Dịch vụ',
    items: [
      { href: '/dashboard/requests/new', icon: FileText, label: 'Yêu cầu giấy tờ' },
    ],
  },
  {
    label: 'Sắp ra mắt',
    items: [
      { icon: Bell,       label: 'Thông báo',  disabled: true, soon: true },
      { icon: Calendar,   label: 'Lịch học',   disabled: true, soon: true },
      { icon: CreditCard, label: 'Học phí',    disabled: true, soon: true },
    ],
  },
];

export default function Sidebar({ session, open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    clearAuth();
    router.replace('/login');
  }

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden backdrop-blur-sm"
          onClick={onClose}
        />
      )}

      {/* Sidebar panel */}
      <aside
        className={cn(
          'fixed top-0 left-0 bottom-0 z-50 w-[240px]',
          'bg-[#0a0f1e] flex flex-col',
          'sidebar-transition',
          'lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Brand */}
        <div className="flex items-center justify-between px-5 py-5
                        border-b border-white/[0.06]">
          <Link href="/dashboard" className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center
                            shadow-lg shadow-blue-600/30 group-hover:shadow-blue-600/50
                            transition-shadow">
              <GraduationCap size={16} className="text-white" />
            </div>
            <div>
              <div className="text-white font-bold text-[0.9rem] leading-none">IUOSS Hub</div>
              <div className="text-slate-500 text-[0.65rem] mt-0.5">Cổng thông tin SV</div>
            </div>
          </Link>
          <button
            onClick={onClose}
            className="lg:hidden text-slate-500 hover:text-slate-300 transition-colors p-1"
          >
            <X size={18} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 overflow-y-auto sidebar-scroll space-y-5">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label}>
              <p className="px-3 mb-1.5 text-[0.62rem] font-semibold tracking-widest
                            uppercase text-slate-600">
                {section.label}
              </p>
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const isActive = item.href ? pathname === item.href : false;
                  const Icon = item.icon;

                  if (item.disabled) {
                    return (
                      <div
                        key={item.label}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg
                                   text-slate-600 text-sm cursor-not-allowed select-none"
                      >
                        <Icon size={16} className="flex-shrink-0" />
                        <span className="flex-1">{item.label}</span>
                        {item.soon && (
                          <span className="text-[0.6rem] font-medium bg-slate-800
                                           text-slate-500 px-1.5 py-0.5 rounded-full">
                            Sắp có
                          </span>
                        )}
                      </div>
                    );
                  }

                  return (
                    <Link
                      key={item.href}
                      href={item.href!}
                      onClick={onClose}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2 rounded-lg text-sm',
                        'transition-all duration-150 group',
                        isActive
                          ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/30'
                          : 'text-slate-400 hover:text-slate-100 hover:bg-white/[0.05]',
                      )}
                    >
                      <Icon size={16} className="flex-shrink-0" />
                      <span className="flex-1">{item.label}</span>
                      {isActive && (
                        <ChevronRight size={14} className="opacity-70" />
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* User info + Logout */}
        <div className="p-3 border-t border-white/[0.06] space-y-1">
          {session && (
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg">
              <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center
                              text-white text-sm font-bold flex-shrink-0 shadow shadow-blue-600/30">
                {getInitials(session.full_name)}
              </div>
              <div className="min-w-0">
                <div className="text-slate-200 text-sm font-medium truncate leading-tight">
                  {session.full_name}
                </div>
                <div className="text-slate-500 text-xs truncate mt-0.5">
                  {session.ldap_uid}
                </div>
              </div>
            </div>
          )}
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm
                       text-red-400 hover:text-red-300 hover:bg-red-500/[0.08]
                       transition-all duration-150"
          >
            <LogOut size={16} />
            Đăng xuất
          </button>
        </div>
      </aside>
    </>
  );
}
