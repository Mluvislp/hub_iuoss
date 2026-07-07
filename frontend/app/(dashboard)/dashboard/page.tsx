'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Plus, AlertCircle, Loader2, UserRound, ShieldCheck, ClipboardList, FileText,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { getSession } from '@/lib/auth';
import { formatDate, formatDateTime, cn } from '@/lib/utils';
import { ui, badge, accentIcon } from '@/lib/ui';
import type { DashboardData, StudentSession } from '@/lib/types';
import {
  REQUEST_TYPE_LABELS as TYPE_LABELS,
  REQUEST_STATUS_LABELS as STATUS_LABELS,
  REQUEST_STATUS_STYLES as STATUS_STYLES,
} from '@/lib/types';

type Accent = keyof typeof accentIcon;

// ── Panel (border + icon accent theo section) ────────────────────────────────
function Panel({
  title, icon: Icon, accent = 'primary', action, children, bodyClassName,
}: {
  title: string;
  icon?: React.ElementType;
  accent?: Accent;
  action?: React.ReactNode;
  children: React.ReactNode;
  bodyClassName?: string;
}) {
  return (
    <section className={ui.card}>
      <div className={ui.cardHeader}>
        <h2 className={ui.sectionTitle}>
          {Icon && <Icon size={16} className={accentIcon[accent]} />}
          {title}
        </h2>
        {action}
      </div>
      <div className={bodyClassName ?? 'px-5 py-4'}>{children}</div>
    </section>
  );
}

// ── Definition row (empty = italic muted) ────────────────────────────────────
function DefRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className={ui.dtRow}>
      <span className={ui.dtLabel}>{label}</span>
      <span className={ui.dtValue}>
        {value ?? <span className="italic font-normal text-slate-400">Chưa cập nhật</span>}
      </span>
    </div>
  );
}

// ── Civic result badge ───────────────────────────────────────────────────────
function CivicResult({ value }: { value: string }) {
  if (value === 'YES') return <span className={cn(badge.base, badge.success)}>Đạt</span>;
  if (value === 'NO') return <span className={cn(badge.base, badge.danger)}>Không đạt</span>;
  return <span className={cn(badge.base, badge.neutral)}>Chưa có kết quả</span>;
}

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
      <div className="flex items-center justify-center h-64 text-muted">
        <Loader2 size={26} className="animate-spin" />
      </div>
    );
  }

  const { student, health_insurance, civic_activities, confirmation_requests } = data ?? {};
  const isActive = student?.current_status?.status_group === 'ACTIVE';

  return (
    <div className="space-y-6">

      {/* ── Hero / greeting ───────────────────────────────── */}
      <section className="rounded-lg border border-primary-line bg-[#f5f9ff] px-5 sm:px-6 py-5">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-[1.35rem] font-semibold text-ink">
              Xin chào, {session?.full_name ?? '—'}
            </h1>
            <p className="text-sm text-muted mt-1">
              Cổng dịch vụ sinh viên — Trường Đại học Quốc tế, ĐHQG-HCM
            </p>
          </div>
          <Link href="/dashboard/requests/new" className={ui.btnPrimary}>
            <Plus size={16} />
            Tạo yêu cầu giấy tờ
          </Link>
        </div>
      </section>

      {error && (
        <div className="flex items-center gap-2.5 px-4 py-3 rounded-lg bg-warning-soft border border-warning-line text-warning-text text-sm">
          <AlertCircle size={16} className="flex-shrink-0" />
          {error}
        </div>
      )}

      {!student && !error && (
        <div className="flex items-start gap-2.5 px-4 py-3 rounded-lg bg-warning-soft border border-warning-line text-warning-text text-sm">
          <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
          <span>
            Tài khoản <strong>{session?.ldap_uid}</strong> chưa được liên kết với hồ sơ sinh viên.
            Vui lòng liên hệ Phòng CTSV để được hỗ trợ.
          </span>
        </div>
      )}

      {/* ── Hồ sơ sinh viên ───────────────────────────────── */}
      {student && (
        <Panel title="Hồ sơ sinh viên" icon={UserRound} accent="primary">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-lg border border-line2 bg-[#f8fafc] px-3.5 py-3">
              <div className={ui.label}>Mã số sinh viên</div>
              <div className="mt-1 text-sm font-semibold text-ink font-mono">{student.current_student_code}</div>
            </div>
            <div className="rounded-lg border border-line2 bg-[#f8fafc] px-3.5 py-3">
              <div className={ui.label}>Khoa</div>
              <div className="mt-1 text-sm font-medium text-ink">
                {student.current_department?.name_vi ?? student.current_department?.code ?? '—'}
              </div>
            </div>
            <div className="rounded-lg border border-line2 bg-[#f8fafc] px-3.5 py-3">
              <div className={ui.label}>Bậc đào tạo</div>
              <div className="mt-1 text-sm font-medium text-ink">{student.current_degree_level?.name ?? '—'}</div>
            </div>
            <div className="rounded-lg border border-line2 bg-[#f8fafc] px-3.5 py-3">
              <div className={ui.label}>Trạng thái</div>
              <div className="mt-1.5">
                <span className={cn(badge.base, isActive ? badge.success : badge.neutral)}>
                  {student.current_status?.name_vi ?? '—'}
                </span>
              </div>
            </div>
          </div>
        </Panel>
      )}

      {/* ── BHYT + Sinh hoạt công dân ─────────────────────── */}
      <div className="grid lg:grid-cols-5 gap-5">
        <div className="lg:col-span-2">
          <Panel
            title="Bảo hiểm y tế"
            icon={ShieldCheck}
            accent="success"
            action={
              health_insurance && <span className={cn(badge.base, badge.success)}>Còn hiệu lực</span>
            }
          >
            {health_insurance ? (
              <dl>
                <DefRow
                  label="Mã thẻ BHYT"
                  value={<span className="font-mono text-[0.82rem]">{health_insurance.medical_insurance_code}</span>}
                />
                <DefRow label="Nơi đăng ký KCB" value={health_insurance.hospital_code || null} />
                <DefRow label="Giá trị đến" value={formatDate(health_insurance.valid_until)} />
              </dl>
            ) : (
              <p className="py-6 text-center text-sm text-muted">Chưa có thông tin bảo hiểm y tế.</p>
            )}
          </Panel>
        </div>

        <div className="lg:col-span-3">
          <Panel
            title="Sinh hoạt công dân"
            icon={ClipboardList}
            accent="warning"
            action={civic_activities?.length ? <span className="text-xs text-muted">{civic_activities.length} mục</span> : undefined}
            bodyClassName={civic_activities?.length ? 'p-0' : 'px-5 py-4'}
          >
            {civic_activities?.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#f8fafc] text-[0.78rem] text-muted border-b border-line">
                      <th className="text-left font-medium px-5 py-2.5">Hoạt động</th>
                      <th className="text-center font-medium px-3 py-2.5">Lần</th>
                      <th className="text-left font-medium px-3 py-2.5">Kết quả</th>
                      <th className="text-left font-medium px-5 py-2.5">Ngày hoàn thành</th>
                    </tr>
                  </thead>
                  <tbody>
                    {civic_activities.map((act) => (
                      <tr
                        key={`${act.activity_code}-${act.attempt_no}`}
                        className="border-b border-line2 last:border-0 hover:bg-[#f9fafb] transition-colors"
                      >
                        <td className="px-5 py-3 font-medium text-ink">{act.activity_code}</td>
                        <td className="px-3 py-3 text-center text-muted">{act.attempt_no}</td>
                        <td className="px-3 py-3"><CivicResult value={act.result_value} /></td>
                        <td className="px-5 py-3 text-muted text-[0.82rem]">{formatDate(act.completed_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="py-6 text-center text-sm text-muted">Chưa có thông tin sinh hoạt công dân.</p>
            )}
          </Panel>
        </div>
      </div>

      {/* ── Yêu cầu giấy tờ gần đây ────────────────────────── */}
      <Panel
        title="Yêu cầu giấy tờ gần đây"
        icon={FileText}
        accent="primary"
        bodyClassName={confirmation_requests?.length ? 'p-0' : 'px-5 py-4'}
        action={
          <Link href="/dashboard/requests/new" className={ui.btnSecondary}>
            <Plus size={15} />
            Tạo yêu cầu
          </Link>
        }
      >
        {confirmation_requests?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#f8fafc] text-[0.78rem] text-muted border-b border-line">
                  <th className="text-left font-medium px-5 py-2.5">Loại giấy</th>
                  <th className="text-left font-medium px-5 py-2.5 hidden sm:table-cell">Mục đích</th>
                  <th className="text-left font-medium px-5 py-2.5 hidden md:table-cell">Ngày tạo</th>
                  <th className="text-left font-medium px-5 py-2.5">Trạng thái</th>
                  <th className="text-left font-medium px-5 py-2.5 hidden lg:table-cell">Phản hồi CTSV</th>
                </tr>
              </thead>
              <tbody>
                {confirmation_requests.map((req) => (
                  <tr
                    key={req.id}
                    className="border-b border-line2 last:border-0 hover:bg-[#f9fafb] transition-colors"
                  >
                    <td className="px-5 py-3.5 font-medium text-ink whitespace-nowrap align-top">
                      {TYPE_LABELS[req.request_type]}
                    </td>
                    <td className="px-5 py-3.5 text-slate-600 hidden sm:table-cell max-w-[260px] align-top">
                      <span className="line-clamp-2" title={req.purpose}>{req.purpose}</span>
                    </td>
                    <td className="px-5 py-3.5 text-muted text-[0.82rem] hidden md:table-cell whitespace-nowrap align-top">
                      {formatDateTime(req.created_at)}
                    </td>
                    <td className="px-5 py-3.5 align-top">
                      <span className={cn(badge.base, STATUS_STYLES[req.status])}>
                        {STATUS_LABELS[req.status]}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-slate-600 hidden lg:table-cell align-top max-w-[240px]">
                      {req.staff_note
                        ? <span className="line-clamp-2">{req.staff_note}</span>
                        : <span className="italic text-slate-400">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-10 text-center">
            <p className="text-sm text-muted">Chưa có yêu cầu nào.</p>
            <Link href="/dashboard/requests/new" className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary-text hover:underline">
              <Plus size={15} />
              Tạo yêu cầu đầu tiên
            </Link>
          </div>
        )}
      </Panel>
    </div>
  );
}
