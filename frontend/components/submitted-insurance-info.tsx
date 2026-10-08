'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Clock3, FileImage, History, Pencil } from 'lucide-react';
import { api } from '@/lib/api';
import { accentIcon, badge, ui } from '@/lib/ui';
import { cn } from '@/lib/utils';
import type { SubmittedInsurance } from '@/lib/types';

export const INSURANCE_FIELD_LABELS: Record<string,string> = {
  full_name:'Họ tên', student_code:'MSSV', gender:'Giới tính', dob:'Ngày sinh',
  ethnicity:'Dân tộc', phone_number:'Số điện thoại', citizen_id:'CCCD',
  social_insurance_number:'Mã số BHXH', permanent_address:'Thường trú', permanent_province:'Tỉnh/thành thường trú',
  permanent_ward:'Phường/xã thường trú', permanent_street:'Địa chỉ thường trú',
  hospital_code:'Nơi khám chữa bệnh', note:'Ghi chú thông tin BHYT bị sai',
  medical_insurance_code:'Mã thẻ BHYT',
  valid_from:'Thẻ có hiệu lực từ', valid_until:'Thẻ có hiệu lực đến',
  cccd_image:'CCCD mặt trước', cccd_image_back:'CCCD mặt sau', bhyt_image:'Thẻ BHYT cũ',
  payment_receipt_image:'Biên lai chuyển khoản',
};
const labels = INSURANCE_FIELD_LABELS;

/** Giá trị trước/sau trong lịch sử. Server đã đổi mã tỉnh/phường/bệnh viện sang tên. */
export function changeText(value: unknown) {
  if (value === null || value === undefined || value === '') return '—';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** Các trường sinh viên sửa và danh sách ảnh đã thay (server tách ảnh khỏi `changes`). */
export function ChangeList({changes, images, submitted = false, className}:{
  changes?: Record<string,{before:unknown; after:unknown}>; images?: string[]; submitted?: boolean; className?: string;
}) {
  const entries = Object.entries(changes || {});
  if (!entries.length && !images?.length) return null;
  return <dl className={className}>
    {entries.map(([field,change]) => <div key={field} className="flex flex-wrap gap-x-1.5">
      <dt className="text-muted">{labels[field] || field}:</dt>
      <dd className="min-w-0"><span className="text-slate-400 line-through">{changeText(change.before)}</span> → <span className="font-medium text-ink">{changeText(change.after)}</span></dd>
    </div>)}
    {!!images?.length && <div className="flex flex-wrap gap-x-1.5">
      <dt className="text-muted">{submitted ? 'Ảnh đã tải lên' : 'Ảnh đã thay mới'}:</dt>
      <dd className="min-w-0 font-medium text-ink">{images.map(field => labels[field] || field).join(', ')}</dd>
    </div>}
  </dl>;
}

const eventLabels: Record<string,string> = {
  SUBMITTED:'Đã gửi bản khai', STUDENT_UPDATED:'Sinh viên chỉnh sửa',
  RESUBMITTED:'Sinh viên gửi bổ sung', CONFIRMED:'Đã xác nhận', REJECTED:'Từ chối',
  SUPPLEMENT_REVIEWED:'Đã kiểm tra bổ sung',
};

export function formatDateTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const parts = new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    day: '2-digit', month: '2-digit', year: 'numeric', hour12: false,
  }).formatToParts(date).reduce<Record<string,string>>((result, part) => {
    result[part.type] = part.value;
    return result;
  }, {});
  return `${parts.hour}:${parts.minute}:${parts.second} ${parts.day}/${parts.month}/${parts.year}`;
}

export function PrivateImage({url, label, caption = true}:{url:string; label:string; caption?:boolean}) {
  const [src, setSrc] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let objectUrl = '';
    api.insuranceRegistration.evidence(url).then(blob => {
      if (active) {
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      }
    }).catch(e => { if (active) setError(e.message); });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);
  return <figure className="min-w-0">
    {caption && <figcaption className="mb-1.5 text-xs font-medium text-muted">{label}</figcaption>}
    {src ? <a href={src} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-line bg-slate-50">
      <img src={src} alt={label} className="h-32 w-full object-contain" />
    </a> : <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-line bg-slate-50 px-3 text-center text-xs text-muted">
      <FileImage size={16} className="mr-2 shrink-0" />{error || 'Đang tải ảnh đã nộp…'}
    </div>}
  </figure>;
}

export function SubmittedInsuranceInfo({data, external=false, showEdit=true}:{data:SubmittedInsurance; external?:boolean; showEdit?:boolean}) {
  const canEdit = data.can_edit ?? data.window?.can_edit;
  const canResubmit = data.can_resubmit ?? data.status === 'rejected';
  const displayValue = (key: string) => data.display?.[key] || data.prefill[key] || '—';
  return <section className={cn(ui.card, 'overflow-hidden')}>
    <div className={ui.cardHeader}>
      <div>
        <h3 className={ui.sectionTitle}><History size={16} className={accentIcon.primary} />Thông tin hiện tại đã nộp</h3>
        <p className="mt-1 text-xs text-muted">Gửi lúc {formatDateTime(data.created_at)} · Cập nhật lúc {formatDateTime(data.updated_at)}</p>
      </div>
      <span className={cn(badge.base, data.window?.can_edit ? badge.success : badge.neutral)}>
        {data.window?.can_edit ? 'Đợt đang mở' : 'Đợt đã đóng'}
      </span>
    </div>

    <div className="space-y-5 p-5">
      {data.edited_at && <div className="flex items-start gap-2.5 rounded-lg border border-warning-line bg-warning-soft px-4 py-3 text-sm text-warning-text">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        <span>Sinh viên đã chỉnh sửa vào lúc {formatDateTime(data.edited_at)}, không thể chỉnh sửa thêm</span>
      </div>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm text-muted"><Clock3 size={15} />Hạn kết thúc: {formatDateTime(data.window?.end_date)}</p>
        {showEdit && <div className="flex flex-wrap gap-2">
          {canEdit && <Link className={ui.btnSecondary} href={'/dashboard/bao-hiem-y-te/' + (external ? 'khai-noi-khac' : 'dang-ky') + '?edit=' + data.id}>
            <Pencil size={14} />Chỉnh sửa {external ? 'bản khai' : 'đơn'}
          </Link>}
          {external && canResubmit && <Link className={ui.btnSecondary} href={'/dashboard/bao-hiem-y-te/khai-noi-khac?edit=' + data.id + '&resubmit=1'}>
            Gửi lại sau từ chối
          </Link>}
        </div>}
      </div>

      <dl className="grid gap-x-8 sm:grid-cols-2">
        {Object.entries(labels).filter(([key]) => key in data.prefill).map(([key,label]) => <div key={key} className={ui.dtRow}>
          <dt className={ui.dtLabel}>{label}</dt><dd className={cn(ui.dtValue, 'break-words')}>{displayValue(key)}</dd>
        </div>)}
      </dl>

      {!!Object.keys(data.legacy_changes || {}).length && <details className="rounded-lg border border-line p-3 text-sm">
        <summary className="cursor-pointer font-medium text-ink">So sánh với hồ sơ tại lần lưu gần nhất</summary>
        <div className="mt-2 space-y-1 text-slate-600">{Object.entries(data.legacy_changes || {}).map(([key,value]) => <p key={key}><span className="text-muted">{labels[key] || key}:</span> {changeText(value.from)} → <span className="font-medium text-ink">{changeText(value.to)}</span></p>)}</div>
      </details>}
      {data.history?.map((event, index) => <details key={index} className="rounded-lg border border-line p-3 text-sm">
        <summary className="cursor-pointer font-medium text-ink">{eventLabels[event.event_type] || event.event_type} · {formatDateTime(event.created_at)}</summary>
        <div className="mt-2 space-y-1 text-slate-600">
          {event.payload?.previous_rejection && <p>Phản hồi từ chối trước: {event.payload.previous_rejection}</p>}
          <ChangeList changes={event.payload?.changes} images={event.payload?.images} submitted={event.event_type === 'SUBMITTED'} className="space-y-1" />
        </div>
      </details>)}
      {!!data.images?.length && <div>
        <h4 className="mb-3 text-sm font-semibold text-ink">Ảnh đã nộp</h4>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{data.images.map(i => <PrivateImage key={i.field} url={i.url} label={labels[i.field] || i.field}/>)}</div>
        <p className="mt-2 text-xs text-muted">Các ảnh này được giữ nguyên. Chỉ chọn ảnh mới trong biểu mẫu khi muốn thay thế.</p>
      </div>}
    </div>
  </section>;
}
