'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  BadgeCheck, Building2, GraduationCap, Activity,
  Heart, Users, FileCheck, Plus, AlertCircle, Loader2,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { getSession } from '@/lib/auth';
import { formatDate, formatDateTime, cn } from '@/lib/utils';
import type {
  DashboardData, StudentSession,
  REQUEST_TYPE_LABELS, REQUEST_STATUS_LABELS, REQUEST_STATUS_STYLES,
} from '@/lib/types';
import {
  REQUEST_TYPE_LABELS as TYPE_LABELS,
  REQUEST_STATUS_LABELS as STATUS_LABELS,
  REQUEST_STATUS_STYLES as STATUS_STYLES,
} from '@/lib/types';

// ── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({
  icon: Icon,
  label,
  value,
  iconBg,
  iconColor,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  iconBg: string;
  iconColor: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200/80 p-4
                    hover:shadow-md hover:shadow-slate-200/50 transition-shadow">
      <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center mb-3', iconBg)}>
        <Icon size={17} className={iconColor} />
      </div>
      <div className="text-[0.67rem] font-semibold uppercase tracking-widest text-slate-400 mb-1">
        {label}
      </div>
      <div className="text-sm font-bold text-slate-900 truncate">{value}</div>
    </div>
  );
}

// ── Hub Card ─────────────────────────────────────────────────────────────────
function HubCard({
  title, icon: Icon, iconColor, badge, children, noPadding,
}: {
  title: string;
  icon: React.ElementType;
  iconColor?: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
  noPadding?: boolean;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200/80
                    hover:shadow-md hover:shadow-slate-200/50 transition-shadow overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5
                      border-b border-slate-100">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <Icon size={15} className={iconColor ?? 'text-slate-500'} />
          {title}
        </h3>
        {badge}
      </div>
      <div className={noPadding ? '' : 'p-5'}>{children}</div>
    </div>
  );
}

// ── Info Row ─────────────────────────────────────────────────────────────────
function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2.5
                    border-b border-slate-50 last:border-0">
      <span className="text-sm text-slate-500">{label}</span>
      <span className="text-sm font-semibold text-slate-800 text-right ml-4">{value}</span>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const [session, setSession] = useState<StudentSession | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setSession(getSession() as StudentSession | null);
    api.dashboard.get()
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Không thể tải dữ liệu.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        <Loader2 size={28} className="animate-spin" />
      </div>
    );
  }

  const { student, health_insurance, civic_activities, confirmation_requests } = data ?? {};

  return (
    <div className="max-w-5xl mx-auto space-y-5">

      {/* ── Welcome banner ─────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            Xin chào, {session?.full_name ?? '—'} 👋
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Cổng thông tin sinh viên — Trường Đại học Quốc tế HCMIU
          </p>
        </div>
        <Link
          href="/dashboard/requests/new"
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg
                     bg-blue-600 hover:bg-blue-700 active:bg-blue-800
                     text-white text-sm font-semibold
                     shadow-sm shadow-blue-600/20 transition-colors"
        >
          <Plus size={15} />
          Tạo yêu cầu giấy tờ
        </Link>
      </div>

      {/* API error */}
      {error && (
        <div className="flex items-center gap-2.5 p-3.5 rounded-lg
                        bg-amber-50 border border-amber-200 text-amber-700 text-sm">
          <AlertCircle size={16} className="flex-shrink-0" />
          {error}
        </div>
      )}

      {/* ── Unlinked account warning ────────────────────────── */}
      {!student && !error && (
        <div className="flex items-start gap-2.5 p-4 rounded-xl
                        bg-amber-50 border border-amber-200 text-amber-700 text-sm">
          <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
          <span>
            Tài khoản <strong>{session?.ldap_uid}</strong> chưa được liên kết với hồ sơ sinh viên.
            Vui lòng liên hệ Phòng CTSV để được hỗ trợ.
          </span>
        </div>
      )}

      {/* ── Stat cards ─────────────────────────────────────── */}
      {student && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            icon={BadgeCheck}
            label="MSSV"
            value={student.current_student_code}
            iconBg="bg-blue-50"
            iconColor="text-blue-600"
          />
          <StatCard
            icon={Building2}
            label="Khoa"
            value={student.current_department?.code ?? '—'}
            iconBg="bg-emerald-50"
            iconColor="text-emerald-600"
          />
          <StatCard
            icon={GraduationCap}
            label="Bậc đào tạo"
            value={student.current_degree_level?.name ?? '—'}
            iconBg="bg-amber-50"
            iconColor="text-amber-600"
          />
          <StatCard
            icon={Activity}
            label="Trạng thái"
            value={student.current_status?.name_vi ?? '—'}
            iconBg="bg-violet-50"
            iconColor="text-violet-600"
          />
        </div>
      )}

      {/* ── BHYT + Sinh hoạt công dân ─────────────────────── */}
      <div className="grid md:grid-cols-5 gap-3">

        {/* BHYT */}
        <div className="md:col-span-2">
          <HubCard
            title="Bảo hiểm y tế"
            icon={Heart}
            iconColor="text-red-500"
            badge={
              health_insurance ? (
                <span className="text-[0.7rem] font-medium px-2 py-0.5 rounded-full
                                  bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                  Còn hiệu lực
                </span>
              ) : undefined
            }
          >
            {health_insurance ? (
              <div className="-mx-0 space-y-0">
                <InfoRow label="Mã BHYT" value={
                  <span className="font-mono text-xs">{health_insurance.medical_insurance_code}</span>
                } />
                <InfoRow label="Nơi đăng ký KCB" value={health_insurance.hospital_code} />
                <InfoRow label="Hạn thẻ" value={formatDate(health_insurance.valid_until)} />
              </div>
            ) : (
              <div className="py-6 text-center text-sm text-slate-400">
                <Heart size={28} className="mx-auto mb-2 text-slate-200" />
                Không có thông tin bảo hiểm y tế
              </div>
            )}
          </HubCard>
        </div>

        {/* Sinh hoạt công dân */}
        <div className="md:col-span-3">
          <HubCard
            title="Sinh hoạt công dân"
            icon={Users}
            iconColor="text-blue-500"
            noPadding={!!civic_activities?.length}
            badge={
              civic_activities?.length ? (
                <span className="text-[0.7rem] font-medium px-2 py-0.5 rounded-full
                                  bg-slate-100 text-slate-500 ring-1 ring-slate-200">
                  {civic_activities.length} mục
                </span>
              ) : undefined
            }
          >
            {civic_activities?.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                      <th className="text-left px-5 py-3 font-semibold">Hoạt động</th>
                      <th className="text-center px-3 py-3 font-semibold">Lần</th>
                      <th className="text-center px-3 py-3 font-semibold">Kết quả</th>
                      <th className="text-left px-5 py-3 font-semibold">Ngày</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {civic_activities.map((act) => (
                      <tr key={`${act.activity_code}-${act.attempt_no}`}
                          className="hover:bg-slate-50/80 transition-colors">
                        <td className="px-5 py-3 font-semibold text-slate-800">
                          {act.activity_code}
                        </td>
                        <td className="px-3 py-3 text-center text-slate-500">
                          {act.attempt_no}
                        </td>
                        <td className="px-3 py-3 text-center">
                          {act.result_value === 'YES' ? (
                            <span className="inline-flex text-xs font-medium px-2 py-0.5
                                             rounded-full bg-emerald-50 text-emerald-700
                                             ring-1 ring-emerald-200">Đạt</span>
                          ) : act.result_value === 'NO' ? (
                            <span className="inline-flex text-xs font-medium px-2 py-0.5
                                             rounded-full bg-red-50 text-red-700
                                             ring-1 ring-red-200">Không đạt</span>
                          ) : (
                            <span className="inline-flex text-xs font-medium px-2 py-0.5
                                             rounded-full bg-slate-100 text-slate-500
                                             ring-1 ring-slate-200">Chưa có</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-slate-500 text-xs">
                          {formatDate(act.completed_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-6 text-center text-sm text-slate-400">
                <Users size={28} className="mx-auto mb-2 text-slate-200" />
                Không có thông tin sinh hoạt công dân
              </div>
            )}
          </HubCard>
        </div>
      </div>

      {/* ── Yêu cầu giấy xác nhận ─────────────────────────── */}
      <HubCard
        title="Yêu cầu giấy xác nhận gần đây"
        icon={FileCheck}
        iconColor="text-emerald-600"
        noPadding={!!confirmation_requests?.length}
        badge={
          <Link
            href="/dashboard/requests/new"
            className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5
                       rounded-lg bg-emerald-600 hover:bg-emerald-700
                       text-white transition-colors"
          >
            <Plus size={12} />
            Tạo mới
          </Link>
        }
      >
        {confirmation_requests?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                  <th className="text-left px-5 py-3 font-semibold">Loại giấy</th>
                  <th className="text-left px-5 py-3 font-semibold hidden sm:table-cell">Mục đích</th>
                  <th className="text-left px-5 py-3 font-semibold hidden md:table-cell">Ngày tạo</th>
                  <th className="text-center px-5 py-3 font-semibold">Trạng thái</th>
                  <th className="text-left px-5 py-3 font-semibold hidden lg:table-cell">Phản hồi CTSV</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {confirmation_requests.map((req) => (
                  <tr key={req.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-5 py-3.5 font-semibold text-slate-800 whitespace-nowrap">
                      {TYPE_LABELS[req.request_type]}
                    </td>
                    <td className="px-5 py-3.5 text-slate-600 hidden sm:table-cell max-w-[180px] truncate">
                      {req.purpose}
                    </td>
                    <td className="px-5 py-3.5 text-slate-500 text-xs hidden md:table-cell whitespace-nowrap">
                      {formatDateTime(req.created_at)}
                    </td>
                    <td className="px-5 py-3.5 text-center">
                      <span className={cn(
                        'inline-flex text-xs font-medium px-2.5 py-1 rounded-full ring-1',
                        STATUS_STYLES[req.status],
                      )}>
                        {STATUS_LABELS[req.status]}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-slate-500 hidden lg:table-cell">
                      {req.staff_note ?? <span className="text-slate-300">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-10 text-center text-sm text-slate-400">
            <FileCheck size={32} className="mx-auto mb-2 text-slate-200" />
            <p>Chưa có yêu cầu nào.</p>
            <Link
              href="/dashboard/requests/new"
              className="mt-3 inline-flex items-center gap-1.5 text-blue-600
                         hover:text-blue-700 font-medium text-sm"
            >
              <Plus size={14} />
              Tạo yêu cầu đầu tiên
            </Link>
          </div>
        )}
      </HubCard>
    </div>
  );
}
