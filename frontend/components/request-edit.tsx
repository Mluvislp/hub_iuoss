'use client';

/**
 * Sửa lại yêu cầu khi Phòng CTSV chuyển sang "Chờ bổ sung thông tin".
 *
 * Mỗi form giấy tờ mở bằng `?edit=<id>` ⇒ nạp yêu cầu cũ, điền lại các ô từ payload,
 * bỏ chặn hạn mức (yêu cầu đã có lượt) và gửi bằng PUT thay vì tạo mới. Backend:
 * `core/request_edit.py`.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, MessageSquareWarning } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import type { ConfirmationRequestDetail, RequestType } from '@/lib/types';

/** Trang form của từng loại giấy sửa được. Loại cũ (chỉ mục đích tự do) không có. */
export const EDIT_PATHS: Partial<Record<RequestType, string>> = {
  other: '/dashboard/requests/other',
  deferment: '/dashboard/requests/deferment',
  thuong_binh: '/dashboard/requests/thuong-binh',
  bank_loan: '/dashboard/requests/bank-loan',
  english_form: '/dashboard/requests/english',
  conduct_score: '/dashboard/requests/conduct-score',
};

export function editHref(req: { id: number; request_type: RequestType }): string | null {
  const path = EDIT_PATHS[req.request_type];
  return path ? `${path}?edit=${req.id}` : null;
}

export interface EditState {
  /** id trên URL; null = đang tạo mới. */
  id: number | null;
  request: ConfirmationRequestDetail | null;
  /** Không nạp được, hoặc yêu cầu không còn ở trạng thái sửa được. */
  error: string;
}

/** Đọc `?edit=<id>` (window.location — tránh useSearchParams buộc bọc Suspense). */
export function useEditRequest(type: RequestType): EditState {
  const [state, setState] = useState<EditState>({ id: null, request: null, error: '' });

  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get('edit');
    const id = raw && /^\d+$/.test(raw) ? Number(raw) : null;
    if (id === null) return;
    setState({ id, request: null, error: '' });
    api.requests.detail(id)
      .then((req) => {
        if (req.request_type !== type) {
          setState({ id, request: null, error: 'Yêu cầu này không thuộc loại giấy của trang.' });
        } else if (!req.student_can_edit) {
          setState({ id, request: null, error: 'Yêu cầu này không còn ở trạng thái “Chờ bổ sung thông tin” nên không sửa được.' });
        } else {
          setState({ id, request: req, error: '' });
        }
      })
      .catch((err) => setState({
        id, request: null, error: err instanceof ApiError ? err.message : 'Không tải được yêu cầu cần sửa.',
      }));
  }, [type]);

  return state;
}

type Editable = Record<string, { changed?: boolean; review?: string | null; proposed?: unknown }>;

function editableOf(req: ConfirmationRequestDetail): Editable {
  return ((req.payload ?? {}) as { editable?: Editable }).editable ?? {};
}

/**
 * Giá trị SV đã xin sửa và CHƯA được quyết ⇒ điền lại. Ô đã duyệt thì hồ sơ đã mang giá
 * trị mới; ô bị từ chối thì quay về hồ sơ — cả hai trả null để form dùng prefill gốc.
 */
export function pendingValue(req: ConfirmationRequestDetail, key: string): string | null {
  const f = editableOf(req)[key];
  if (!f || !f.changed || f.review !== 'pending' || typeof f.proposed !== 'string') return null;
  return f.proposed;
}

export function pendingAddress(req: ConfirmationRequestDetail):
  { province_code: string; ward_code: string; street: string } | null {
  const f = editableOf(req).permanent_address;
  if (!f || !f.changed || f.review !== 'pending' || !f.proposed || typeof f.proposed !== 'object') return null;
  const p = f.proposed as Record<string, string>;
  return { province_code: p.province_code ?? '', ward_code: p.ward_code ?? '', street: p.street ?? '' };
}

export function purposeOf(req: ConfirmationRequestDetail): { code: string; program_name: string } {
  const p = ((req.payload ?? {}) as { purpose?: { code?: string; program_name?: string | null } }).purpose ?? {};
  return { code: p.code ?? '', program_name: p.program_name ?? '' };
}

/** Đầu form: nội dung Phòng CTSV yêu cầu bổ sung (lượt gần nhất của chuyên viên). */
export function EditRequestBanner({ edit }: { edit: EditState }) {
  if (edit.id === null) return null;
  if (edit.error) {
    return (
      <div className="flex items-start gap-2.5 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">
        <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
        <span>
          {edit.error}{' '}
          <Link href={`/dashboard/requests/${edit.id}`} className="font-medium underline">Xem yêu cầu</Link>
        </span>
      </div>
    );
  }
  if (!edit.request) return null;
  const ask = [...edit.request.comments].reverse().find((c) => c.author_role === 'staff');
  return (
    <div className="rounded-lg border border-warning-line bg-warning-soft px-4 py-3">
      <div className="flex items-center gap-2 text-[0.84rem] font-semibold text-warning-text">
        <MessageSquareWarning size={15} className="shrink-0" />
        Bổ sung thông tin theo yêu cầu của Phòng CTSV
      </div>
      {ask && (
        <div className="mt-1.5 text-[0.84rem] text-ink leading-relaxed">
          <span className="text-muted">Phòng CTSV ({formatDateTime(ask.created_at)}): </span>
          <span className="whitespace-pre-line">{ask.body}</span>
        </div>
      )}
      <p className="mt-1.5 text-[0.78rem] text-muted">
        Sửa các ô cần thiết rồi bấm <strong className="font-medium text-ink">Cập nhật yêu cầu</strong>.
        Thông tin đã được duyệt giữ nguyên.
      </p>
    </div>
  );
}

/** Gửi form: đang sửa ⇒ PUT lên yêu cầu cũ; không thì tạo mới như trước. */
export function submitOrUpdate<T extends object>(
  edit: EditState,
  requestType: RequestType,
  create: (data: T) => Promise<unknown>,
  data: T,
): Promise<unknown> {
  return edit.id !== null
    ? api.requests.update(edit.id, { request_type: requestType, ...data })
    : create(data);
}
