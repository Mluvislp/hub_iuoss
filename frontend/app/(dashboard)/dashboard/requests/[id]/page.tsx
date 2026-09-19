'use client';

/**
 * Chi tiết một yêu cầu giấy tờ + trao đổi với Phòng CTSV.
 *
 * Trao đổi hiển thị dạng dòng thời gian hai bên: thư của sinh viên nằm bên phải,
 * của chuyên viên bên trái. Lượt nào đi kèm một lần đổi trạng thái thì có nhãn
 * riêng — đó là quyết định hành chính, không phải câu chuyện trò.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  AlertCircle, ArrowLeft, Lock, Loader2, MessageSquare, Send, Ticket,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { ui, badge, accentIcon } from '@/lib/ui';
import { cn, formatDate, formatDateTime } from '@/lib/utils';
import {
  REQUEST_TYPE_LABELS,
  REQUEST_STATUS_LABELS,
  REQUEST_STATUS_STYLES,
  type ConfirmationRequestDetail,
  type RequestComment,
} from '@/lib/types';

/** Nhãn cho các ô sinh viên đã khai / xin sửa (khớp EDITABLE_FIELD_LABELS bên Dashboard). */
const FIELD_LABELS: Record<string, string> = {
  dob: 'Ngày sinh',
  citizen_id: 'Số CCCD',
  citizen_id_issue_date: 'Ngày cấp CCCD',
  permanent_address: 'Địa chỉ thường trú',
  class_code: 'Mã lớp',
};

/** Nhãn cho lượt trao đổi sinh ra từ một lần đổi trạng thái. */
const EVENT_LABELS: Record<string, string> = {
  awaiting_info: 'Yêu cầu bổ sung thông tin',
  rejected: 'Từ chối yêu cầu',
  done: 'Hoàn thành',
  processing: 'Chuyển sang đang xử lý',
};

function fieldValue(info: unknown): string {
  if (info === null || info === undefined) return '';
  if (typeof info === 'string') return info;
  if (typeof info === 'object') {
    const rec = info as Record<string, unknown>;
    // Field đã được duyệt thì lấy giá trị sinh viên đề nghị, chưa thì giá trị gốc.
    const picked = rec.review === 'approved' ? rec.proposed : (rec.proposed ?? rec.original);
    if (picked && typeof picked === 'object') {
      return String((picked as Record<string, unknown>).full ?? '');
    }
    return picked == null ? '' : String(picked);
  }
  return String(info);
}

function Bubble({ c }: { c: RequestComment }) {
  const mine = c.author_role === 'student';
  return (
    <div className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-lg border px-3.5 py-2.5',
          mine ? 'border-primary-line bg-primary-soft' : 'border-line bg-white',
        )}
      >
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="text-[0.78rem] font-semibold text-ink">
            {mine ? 'Em' : c.author_name}
          </span>
          <span className={cn(badge.base, mine ? badge.info : badge.neutral, 'py-0')}>
            {mine ? 'Sinh viên' : 'Phòng CTSV'}
          </span>
          {c.event && EVENT_LABELS[c.event] && (
            <span className={cn(badge.base, badge.warning, 'py-0')}>{EVENT_LABELS[c.event]}</span>
          )}
          <span className="ml-auto text-[0.72rem] text-muted">{formatDateTime(c.created_at)}</span>
        </div>
        <p className="whitespace-pre-wrap break-words text-[0.87rem] leading-relaxed text-ink">
          {c.body}
        </p>
      </div>
    </div>
  );
}

export default function RequestDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params?.id);

  const [data, setData] = useState<ConfirmationRequestDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const listEnd = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!Number.isFinite(id)) {
      setError('Mã yêu cầu không hợp lệ.');
      return;
    }
    api.requests
      .detail(id)
      .then(setData)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Không tải được yêu cầu này.'),
      );
  }, [id]);

  useEffect(() => {
    listEnd.current?.scrollIntoView({ block: 'nearest' });
  }, [data?.comments.length]);

  async function submit() {
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await api.requests.addComment(id, text);
      setBody('');
      setData((prev) =>
        prev
          ? {
              ...prev,
              comments: [...prev.comments, res.comment],
              comment_count: prev.comment_count + 1,
              status: res.status,
              student_can_comment: res.student_can_comment,
            }
          : prev,
      );
    } catch (err) {
      setSendError(err instanceof ApiError ? err.message : 'Không gửi được, em thử lại.');
    } finally {
      setSending(false);
    }
  }

  if (error) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/requests" className={ui.btnSecondary}>
          <ArrowLeft size={15} />
          Danh sách yêu cầu
        </Link>
        <div className="flex items-start gap-2.5 rounded-lg border border-danger-line bg-danger-soft px-4 py-3">
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-danger-text" />
          <p className="text-sm text-danger-text">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
        <Loader2 size={16} className="animate-spin" />
        Đang tải…
      </div>
    );
  }

  const payload = (data.payload ?? {}) as Record<string, unknown>;
  const snapshot = (payload.snapshot ?? {}) as Record<string, unknown>;
  const editable = (payload.editable ?? {}) as Record<string, unknown>;

  return (
    <div className="space-y-5">
      <Link href="/dashboard/requests" className={ui.btnSecondary}>
        <ArrowLeft size={15} />
        Danh sách yêu cầu
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">
            {REQUEST_TYPE_LABELS[data.request_type]}
          </h1>
          <p className="mt-1 text-sm text-muted">
            Mã #{data.id} · Gửi {formatDateTime(data.created_at)}
          </p>
        </div>
        <span className={cn(badge.base, REQUEST_STATUS_STYLES[data.status], 'text-[0.82rem]')}>
          {REQUEST_STATUS_LABELS[data.status]}
        </span>
      </div>

      {data.portal_code && (
        <section className="rounded-lg border border-primary-line bg-primary-soft px-5 py-4">
          <p className="flex items-center gap-1.5 text-[0.8rem] font-medium text-primary-text">
            <Ticket size={14} />
            MÃ HỒ SƠ PORTAL
          </p>
          <p className="mt-1.5 font-mono text-2xl font-bold tracking-wide text-primary-text">
            {data.portal_code}
          </p>
          <p className="mt-1.5 text-[0.82rem] text-primary-text/80">
            Em trình mã này khi đến Phòng Công tác Sinh viên (O1.105) nhận giấy.
          </p>
        </section>
      )}

      <section className={ui.card}>
        <div className={ui.cardHeader}>
          <h2 className={ui.sectionTitle}>Thông tin em đã gửi</h2>
        </div>
        <div className="px-5 py-2">
          <div className={ui.dtRow}>
            <span className={ui.dtLabel}>Mục đích</span>
            <span className={ui.dtValue}>{data.purpose}</span>
          </div>
          {snapshot.student_name ? (
            <div className={ui.dtRow}>
              <span className={ui.dtLabel}>Họ tên</span>
              <span className={ui.dtValue}>{String(snapshot.student_name)}</span>
            </div>
          ) : null}
          {snapshot.student_id ? (
            <div className={ui.dtRow}>
              <span className={ui.dtLabel}>MSSV</span>
              <span className={ui.dtValue}>{String(snapshot.student_id)}</span>
            </div>
          ) : null}
          {snapshot.department ? (
            <div className={ui.dtRow}>
              <span className={ui.dtLabel}>Khoa</span>
              <span className={ui.dtValue}>{String(snapshot.department)}</span>
            </div>
          ) : null}
          {Object.entries(FIELD_LABELS).map(([key, label]) => {
            const value = fieldValue(editable[key]);
            if (!value) return null;
            return (
              <div key={key} className={ui.dtRow}>
                <span className={ui.dtLabel}>{label}</span>
                <span className={ui.dtValue}>{value}</span>
              </div>
            );
          })}
          {data.note ? (
            <div className={ui.dtRow}>
              <span className={ui.dtLabel}>Ghi chú của em</span>
              <span className={ui.dtValue}>{data.note}</span>
            </div>
          ) : null}
        </div>
      </section>

      <section className={ui.card}>
        <div className={ui.cardHeader}>
          <h2 className={ui.sectionTitle}>
            <MessageSquare size={16} className={accentIcon.primary} />
            Trao đổi với Phòng CTSV
          </h2>
          {data.comments.length > 0 && (
            <span className={cn(badge.base, badge.neutral)}>{data.comments.length}</span>
          )}
        </div>

        <div className="max-h-[520px] space-y-2.5 overflow-y-auto px-5 py-4">
          {data.comments.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">
              Chưa có trao đổi nào. Em có thể nhắn cho Phòng CTSV nếu cần lưu ý điều gì về yêu cầu này.
            </p>
          ) : (
            data.comments.map((c) => <Bubble key={c.id} c={c} />)
          )}
          <div ref={listEnd} />
        </div>

        <div className="border-t border-line px-5 py-4">
          {data.student_can_comment ? (
            <>
              <label htmlFor="cmt" className={ui.fieldLabel}>
                Nội dung trao đổi
              </label>
              <textarea
                id="cmt"
                rows={3}
                maxLength={2000}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                disabled={sending}
                className={ui.textarea}
                placeholder={
                  data.status === 'awaiting_info'
                    ? 'Trả lời nội dung Phòng CTSV yêu cầu bổ sung…'
                    : 'Ví dụ: em cần giấy trước ngày 30/09 để kịp nộp cho địa phương.'
                }
              />
              {sendError && (
                <p className="mt-1.5 text-[0.82rem] text-danger-text">{sendError}</p>
              )}
              <div className="mt-2.5 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={submit}
                  disabled={sending || !body.trim()}
                  className={ui.btnPrimary}
                >
                  {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                  Gửi trao đổi
                </button>
                <span className="text-[0.78rem] text-muted">{body.length}/2000 ký tự</span>
              </div>
            </>
          ) : (
            <p className="flex items-start gap-2 text-[0.85rem] text-muted">
              <Lock size={14} className="mt-0.5 shrink-0" />
              Yêu cầu đang ở trạng thái “{REQUEST_STATUS_LABELS[data.status]}” nên em không gửi
              thêm trao đổi được. Cần hỗ trợ, em liên hệ Phòng Công tác Sinh viên (O1.105).
            </p>
          )}
        </div>
      </section>

      <p className="text-[0.78rem] text-muted">
        Cập nhật lần cuối: {formatDate(data.updated_at)}
      </p>
    </div>
  );
}
