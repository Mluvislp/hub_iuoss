'use client';

import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  LayoutDashboard,
  FilePlus2,
  Home,
  LogOut,
  ShieldCheck,
  X,
} from 'lucide-react';
import { cn, getInitials } from '@/lib/utils';
import { BHYT_HOME, clearAuth } from '@/lib/auth';
import { clearFeatureCache, FEATURE_META, type FeatureKey } from '@/lib/features';
import { useTicketUnread } from '@/lib/ticket-unread';
import type { FeatureFlags, StudentSession } from '@/lib/types';

interface SidebarProps {
  session: StudentSession | null;
  features: FeatureFlags;
  open: boolean;
  onClose: () => void;
}

interface NavItem {
  href: string;
  icon: React.ElementType;
  label: string;
  /**
   * Tính năng chi phối mục này. Cờ tắt thì mục VẪN hiện (kèm dấu "Sắp ra mắt"),
   * bấm vào ra trang chờ — xem lib/features.ts.
   */
  feature?: FeatureKey;
}

function featureItem(key: FeatureKey): NavItem {
  const meta = FEATURE_META[key];
  return { href: meta.href, icon: meta.icon, label: meta.label, feature: key };
}

const NAV_SECTIONS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Tổng quan',
    items: [{ href: '/dashboard', icon: LayoutDashboard, label: 'Bảng thông tin' }],
  },
  {
    // Trang chỉ để XEM thông tin cá nhân — tách khỏi nhóm dịch vụ (nơi SV phải nộp gì đó).
    label: 'Hồ sơ của tôi',
    items: [
      { href: '/dashboard/bao-hiem-y-te', icon: ShieldCheck, label: 'Bảo hiểm y tế' },
      featureItem('civic_activities'),
    ],
  },
  {
    label: 'Dịch vụ sinh viên',
    items: [
      // Danh sách đứng TRƯỚC form tạo: vào đây phần lớn là để xem yêu cầu cũ
      // chạy tới đâu, tạo mới là việc thỉnh thoảng.
      featureItem('document_requests'),
      {
        href: '/dashboard/requests/new',
        icon: FilePlus2,
        label: 'Tạo yêu cầu mới',
        feature: 'document_requests',
      },
      { href: '/dashboard/khai-bao-ngoai-tru', icon: Home, label: 'Khai báo ngoại trú' },
      featureItem('health_check'),
      featureItem('support_tickets'),
    ],
  },
];

export default function Sidebar({ session, features, open, onClose }: SidebarProps) {
  const pathname = usePathname();
  // Học viên cao học (phiên `bhyt_only`): chỉ một mục Bảo hiểm y tế, không gì khác.
  const bhytOnly = session?.bhyt_only === true;
  const ticketUnread = useTicketUnread(features.support_tickets && !bhytOnly);

  // Mục sáng = href khớp DÀI NHẤT với URL hiện tại. So khớp tuyệt đối thì vào
  // trang con là menu tắt hết; so khớp tiền tố đơn thuần thì ở /requests/new sẽ
  // sáng cả "Yêu cầu giấy tờ" lẫn "Tạo yêu cầu mới".
  // Tính năng chưa mở (cờ FEATURE_* tắt) thì ẨN HẲN khỏi menu — trước 01/10/2026 vẫn
  // hiện kèm chấm "Đang phát triển", sinh viên bấm vào chỉ gặp trang chưa mở.
  const sections: { label: string; items: NavItem[] }[] = bhytOnly
    ? [{ label: 'Hồ sơ của tôi', items: [{ href: BHYT_HOME, icon: ShieldCheck, label: 'Bảo hiểm y tế' }] }]
    : NAV_SECTIONS
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !item.feature || features[item.feature]),
    }))
    .filter((section) => section.items.length > 0);

  const activeHref = NAV_SECTIONS
    .flatMap((section) => section.items.map((item) => item.href))
    .filter((href) => pathname === href || pathname.startsWith(href + '/'))
    .sort((a, b) => b.length - a.length)[0] ?? '';
  const router = useRouter();

  function handleLogout() {
    clearAuth();
    clearFeatureCache();
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
          <Link href={bhytOnly ? BHYT_HOME : '/dashboard'} className="flex items-center gap-2.5">
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
          {sections.map((section, i) => (
            <div key={section.label} className={cn('px-3', i > 0 && 'mt-5 pt-5 border-t border-line2')}>
              <p className="px-2.5 mb-2 text-[0.68rem] font-semibold text-slate-400">
                {section.label}
              </p>
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = item.href === activeHref;

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
                      {item.feature === 'support_tickets' && ticketUnread > 0 && (
                        <span
                          className="min-w-[20px] h-5 px-1.5 rounded-full border border-danger-line bg-danger-soft
                                     text-danger-text text-[0.7rem] font-semibold leading-[18px] text-center"
                          aria-label={`${ticketUnread} ticket có phản hồi mới`}
                        >
                          {ticketUnread > 9 ? '9+' : ticketUnread}
                        </span>
                      )}
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
