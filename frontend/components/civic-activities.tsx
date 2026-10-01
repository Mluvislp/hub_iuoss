'use client';

import { badge } from '@/lib/ui';
import { cn, formatDate } from '@/lib/utils';
import type { CivicActivity } from '@/lib/types';

/** Kết quả sinh hoạt công dân — dùng chung trang chủ và trang chi tiết. */
export function CivicResult({ value }: { value: string }) {
  if (value === 'YES') return <span className={cn(badge.base, badge.success)}>Đạt</span>;
  if (value === 'NO') return <span className={cn(badge.base, badge.danger)}>Không đạt</span>;
  return <span className={cn(badge.base, badge.neutral)}>Chưa có kết quả</span>;
}

/** Bảng sinh hoạt công dân. Rỗng → dòng trạng thái, không phải bảng trống. */
export function CivicActivitiesTable({ items }: { items: CivicActivity[] }) {
  if (!items.length) {
    return (
      <p className="py-6 text-center text-sm text-muted">Chưa có thông tin sinh hoạt công dân.</p>
    );
  }

  return (
    <>
    {/* Điện thoại: mỗi hoạt động một dòng, kết quả nằm bên phải. */}
    <ul className="divide-y divide-line2 md:hidden">
      {items.map((act) => (
        <li
          key={`${act.activity_code}-${act.attempt_no}`}
          className="flex items-center justify-between gap-3 px-4 py-3"
        >
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink">{act.activity_code}</p>
            <p className="mt-0.5 text-[0.78rem] text-muted">
              Lần {act.attempt_no}
              {act.completed_at && <> · Hoàn thành {formatDate(act.completed_at)}</>}
            </p>
          </div>
          <CivicResult value={act.result_value} />
        </li>
      ))}
    </ul>
    <div className="hidden overflow-x-auto md:block">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-surface-subtle text-[0.78rem] text-muted border-b border-line">
            <th className="text-left font-medium px-5 py-2.5">Hoạt động</th>
            <th className="text-center font-medium px-3 py-2.5">Lần</th>
            <th className="text-left font-medium px-3 py-2.5">Kết quả</th>
            <th className="text-left font-medium px-5 py-2.5">Ngày hoàn thành</th>
          </tr>
        </thead>
        <tbody>
          {items.map((act) => (
            <tr
              key={`${act.activity_code}-${act.attempt_no}`}
              className="border-b border-line2 last:border-0 hover:bg-surface-subtle transition-colors"
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
    </>
  );
}
