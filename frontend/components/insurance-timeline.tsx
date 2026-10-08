'use client';

import type { ReactNode } from 'react';
import { ArrowRight, Clock3 } from 'lucide-react';
import { InsuranceStatus } from '@/components/insurance-status';
import { ChangeList } from '@/components/submitted-insurance-info';
import type { InsuranceTimelineItem, SubmittedInsurance } from '@/lib/types';

const actorName = (source: string) => source === 'Hub' ? 'Sinh viên' : source === 'Dashboard' ? 'Chuyên viên' : 'Hệ thống';

/** Phần chung của một bước; đơn đăng ký tại trường có thêm phí/minh chứng/bệnh viện. */
export type TimelineEntry = Pick<InsuranceTimelineItem,
  'label' | 'created_at' | 'source_app' | 'from_status' | 'to_status' | 'reason_label' | 'reason_text' | 'event_type' | 'payload'>
  & { key: string | number };

/** "Lịch sử xử lý và bổ sung" — cùng một giao diện cho đơn đăng ký, bản khai nơi khác và đổi nơi KCB. */
export function InsuranceTimeline<T extends TimelineEntry>({ items, empty, renderExtra }: {
  items: T[]; empty: string; renderExtra?: (item: T) => ReactNode;
}) {
  return <section className="rounded-lg border border-line bg-white p-4 sm:p-6">
    <div className="mb-5 flex items-start gap-2"><Clock3 className="mt-0.5 h-4 w-4 text-primary" /><div><h3 className="font-semibold text-ink">Lịch sử xử lý và bổ sung</h3><p className="text-sm text-muted">Các hoạt động được sắp xếp theo thời gian</p></div></div>
    {!items.length && <p className="rounded-lg bg-slate-50 p-4 text-sm text-muted">{empty}</p>}
    <div className="relative ml-2 border-l-2 border-primary-line pl-6 sm:ml-3 sm:pl-8">
    {items.map((e, index) => <article className="relative pb-6 last:pb-0" key={e.key}>
      <span className="absolute -left-[31px] top-1 flex h-4 w-4 items-center justify-center rounded-full border-4 border-white bg-primary shadow-sm sm:-left-[39px]" />
      <div className="rounded-lg border border-line bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="font-semibold text-ink">{e.label}</p><p className="mt-1 text-xs text-slate-500">Bước {index + 1} · {actorName(e.source_app)}</p></div><time className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">{new Date(e.created_at).toLocaleString('vi-VN')}</time></div>
        {e.from_status && e.to_status && e.from_status !== e.to_status && <div className="mt-3 flex flex-wrap items-center gap-2 text-sm"><InsuranceStatus status={e.from_status} /><ArrowRight className="h-4 w-4 text-slate-400" /><InsuranceStatus status={e.to_status} /></div>}
        {(e.reason_label || e.reason_text) && <div className="mt-3 rounded-lg border border-warning-line bg-warning-soft px-3 py-2 text-sm text-warning-text">{e.reason_label && <p className="font-semibold">{e.reason_label}</p>}{e.reason_text && <p className={e.reason_label ? 'mt-1' : ''}>{e.reason_text}</p>}</div>}
        {e.payload.previous_rejection && <p className="mt-3 text-sm text-danger-text">Phản hồi từ chối trước: {e.payload.previous_rejection}</p>}
        <ChangeList changes={e.payload.changes} images={e.payload.images} submitted={e.event_type === 'SUBMITTED'} className="mt-3 space-y-1 rounded-lg bg-slate-50 p-3 text-sm" />
        {renderExtra?.(e)}
      </div>
    </article>)}
    </div>
  </section>;
}

type HistoryKind = 'external' | 'hospital-change';
type HistoryEvent = NonNullable<SubmittedInsurance['history']>[number] & {
  payload: { review_note?: string; from_status?: string; to_status?: string };
};

const EVENT_LABELS: Record<HistoryKind, Record<string, string>> = {
  external: {
    SUBMITTED: 'Sinh viên gửi bản khai', STUDENT_UPDATED: 'Sinh viên chỉnh sửa bản khai',
    RESUBMITTED: 'Sinh viên gửi lại sau từ chối', CONFIRMED: 'Đã xác nhận bản khai',
    REJECTED: 'Từ chối bản khai', SUPPLEMENT_REVIEWED: 'Chuyên viên đã kiểm tra phần bổ sung',
  },
  'hospital-change': {
    SUBMITTED: 'Sinh viên gửi yêu cầu', STUDENT_UPDATED: 'Sinh viên chỉnh sửa yêu cầu',
    RESUBMITTED: 'Sinh viên gửi lại sau từ chối', SENT_TO_BHXH: 'Chuyển BHXH xử lý',
    ISSUED: 'Phát hành, đã đổi nơi KCB trên thẻ', REJECTED: 'Từ chối yêu cầu',
    SUPPLEMENT_REVIEWED: 'Chuyên viên đã kiểm tra phần bổ sung',
  },
};
// Bản khai nơi khác không lưu trạng thái trong sự kiện; suy ra theo loại sự kiện.
const TRANSITIONS: Record<HistoryKind, Record<string, [string, string]>> = {
  external: { CONFIRMED: ['pending', 'confirmed'], REJECTED: ['pending', 'rejected'], RESUBMITTED: ['rejected', 'pending'] },
  'hospital-change': { RESUBMITTED: ['rejected', 'iu_processing'] },
};

/** Lịch sử của bản khai/yêu cầu (`history`) → các bước hiển thị như đơn đăng ký. */
export function historyTimeline(history: SubmittedInsurance['history'], kind: HistoryKind): TimelineEntry[] {
  return ((history ?? []) as HistoryEvent[]).map((event, index) => {
    const payload = event.payload || {};
    const [from, to] = payload.from_status && payload.to_status
      ? [payload.from_status, payload.to_status] : TRANSITIONS[kind][event.event_type] ?? [null, null];
    const note = (payload.review_note || '').trim();
    // Bản khai nơi khác: bước gửi chỉ cần ghi nhận đã gửi — SV có thể khai nhiều bản,
    // so với hồ sơ cũ (gạch giá trị cũ) không có ý nghĩa. Các lần sửa sau vẫn hiện chi tiết.
    const hideChanges = kind === 'external' && event.event_type === 'SUBMITTED';
    return {
      key: index, event_type: event.event_type, created_at: event.created_at, source_app: event.source_app,
      label: EVENT_LABELS[kind][event.event_type] || event.event_type,
      from_status: from, to_status: to,
      reason_label: note ? (event.event_type === 'REJECTED' ? 'Lý do từ chối' : 'Ghi chú của chuyên viên') : '',
      reason_text: note || null,
      payload: hideChanges ? {} : { changes: payload.changes, images: payload.images, previous_rejection: payload.previous_rejection },
    };
  });
}
