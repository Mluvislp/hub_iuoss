'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, ClipboardList, Loader2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { ui, accentIcon } from '@/lib/ui';
import { CivicActivitiesTable } from '@/components/civic-activities';
import type { CivicActivity } from '@/lib/types';

// Tính năng chưa mở thì (dashboard)/layout.tsx đã thay trang này bằng
// <ComingSoon />, nên ở đây chỉ cần lo trường hợp đã mở.
export default function CivicActivitiesPage() {
  const [items, setItems] = useState<CivicActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.dashboard.get()
      .then((d) => setItems(d.civic_activities ?? []))
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

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-center gap-2.5 px-4 py-3 rounded-lg bg-warning-soft border border-warning-line text-warning-text text-sm">
          <AlertCircle size={16} className="flex-shrink-0" />
          {error}
        </div>
      )}

      <section className={ui.card}>
        <div className={ui.cardHeader}>
          <h2 className={ui.sectionTitle}>
            <ClipboardList size={16} className={accentIcon.warning} />
            Sinh hoạt công dân
          </h2>
          {items.length > 0 && <span className="text-xs text-muted">{items.length} mục</span>}
        </div>
        <div className={items.length ? 'p-0' : 'px-5 py-4'}>
          <CivicActivitiesTable items={items} />
        </div>
      </section>
    </div>
  );
}
