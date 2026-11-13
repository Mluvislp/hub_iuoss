'use client';

/**
 * Chi tiết một yêu cầu "Nạp giấy tờ trực tiếp": thông tin đã khai, file đã nạp, tiến trình xử lý,
 * mã trả hồ sơ và trao đổi với Phòng CTSV (cùng khuôn trang chi tiết yêu cầu giấy tờ).
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  AlertCircle, ArrowLeft, Check, Images, Lock, Loader2, MessageSquare, PencilLine, Send, Ticket,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { ui, badge, accentIcon, notice, noticeIcon } from '@/lib/ui';
import { cn, formatDate, formatDateTime } from '@/lib/utils';
import { REQUEST_STATUS_LABELS, REQUEST_STATUS_STYLES, type RequestComment, type SubmissionDetail } from '@/lib/types';
import { RequestCode } from '@/components/request-code';
import { SubmissionFileGrid } from '@/components/submission-files';

const FIELD_LABELS: Record<string, string> = { dob: 'Ngày sinh', citizen_id: 'Số CCCD', citizen_id_issue_date: 'Ngày cấp CCCD' };
const REVIEW_LABEL: Record<string, string> = { pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Không được duyệt' };
const REVIEW_STYLE: Record<string, string> = { pending: badge.warning, approved: badge.success, rejected: badge.danger };

const EVENT_LABELS: Record<string, string> = {
  processing: 'Đã tiếp nhận',
  awaiting_info: 'Yêu cầu bổ sung thông tin',
  rejected: 'Từ chối yêu cầu',
  done: 'Hoàn thành',
  returned: 'Đã trả giấy',
  student_edit: 'Đã cập nhật yêu cầu',
  request_note: 'Ghi chú khi gửi yêu cầu',
};
const EVENT_STYLES: Record<string, string> = {
  processing: badge.info, awaiting_info: badge.warning, rejected: badge.danger, done: badge.success,
  returned: badge.success, student_edit: badge.neutral, request_note: badge.neutral,
};

/** Bốn bước quy trình — Từ chối / Chờ bổ sung hiện dưới dạng ghi chú trên bước đang đứng. */
const STEPS = [
  { key: 'pending', label: 'Đã gửi' },
  { key: 'processing', label: 'Đang xử lý' },
  { key: 'done', label: 'Hoàn thành' },
  { key: 'returned', label: 'Đã trả giấy' },
];
function stepIndex(status: string): number {
  if (status === 'returned') return 3;
  if (status === 'done') return 2;
  if (status === 'processing') return 1;
  return 0;
}

function Bubble({ c }: { c: RequestComment }) {
  const mine = c.author_role === 'student';
  return (
    <div className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
      <div className={cn('max-w-[85%] rounded-lg border px-3.5 py-2.5', mine ? 'border-line bg-[#f8fafc]' : 'border-line bg-white')}>
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="text-[0.78rem] font-semibold text-ink">{c.author_name}</span>
          <span className={cn(badge.base, badge.neutral, 'py-0')}>{mine ? 'Sinh viên' : 'Phòng CTSV'}</span>
          {c.event && EVENT_LABELS[c.event] && (
            <span className={cn(badge.base, EVENT_STYLES[c.event] ?? badge.neutral, 'py-0')}>{EVENT_LABELS[c.event]}</span>
          )}
          <span className="ml-auto text-[0.72rem] text-muted">{formatDateTime(c.created_at)}</span>
        </div>
        <p className="whitespace-pre-wrap break-words text-[0.87rem] leading-relaxed text-ink">{c.body}</p>
      </div>
    </div>
  );
}

export default function SubmissionDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params?.id);
  const [data, setData] = useState<SubmissionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const listEnd = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!Number.isFinite(id)) { setError('Mã yêu cầu không hợp lệ.'); return; }
    api.submissions.detail(id).then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Không tải được yêu cầu này.'));
  }, [id]);

  useEffect(() => { listEnd.current?.scrollIntoView({ block: 'nearest' }); }, [data?.comments.length]);

  async function submit() {
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await api.submissions.addComment(id, text);
      setBody('');
      setData((prev) => prev ? {
        ...prev, comments: [...prev.comments, res.comment], status: res.status, status_label: res.status_label,
        student_can_comment: res.student_can_comment, student_can_edit: res.student_can_edit,
      } : prev);
    } catch (err) {
      setSendError(err instanceof ApiError ? err.message : 'Không gửi được. Vui lòng thử lại.');
    } finally {
      setSending(false);
    }
  }

  if (error) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/nap-giay-to" className={ui.btnSecondary}><ArrowLeft size={15} /> Nạp giấy tờ trực tiếp</Link>
        <div className={cn(notice.base, notice.error)}><AlertCircle className={noticeIcon.error} /><p>{error}</p></div>
      </div>
    );
  }
  if (!data) {
    return <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted"><Loader2 size={16} className="animate-spin" /> Đang tải…</div>;
  }

  const snap = data.payload.snapshot ?? {};
  const editable = data.payload.editable ?? {};
  const current = stepIndex(data.status);
  const halted = data.status === 'rejected' || data.status === 'awaiting_info';
  const noteText = (data.note ?? '').trim();
  const noteComment: RequestComment | null = noteText ? {
    id: -1, author_role: 'student', author_name: snap.student_name || 'Sinh viên', body: noteText,
    event: 'request_note', created_at: data.created_at,
  } : null;

  return (
    <div className="space-y-5">
      <div>
        <Link href="/dashboard/nap-giay-to" className="inline-flex items-center gap-1.5 text-[0.82rem] font-medium text-muted hover:text-ink">
          <ArrowLeft size={14} /> Nạp giấy tờ trực tiếp
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h1 className="text-xl font-semibold text-ink break-words">{data.document_name}</h1>
          <span className={cn(badge.base, REQUEST_STATUS_STYLES[data.status])}>{REQUEST_STATUS_LABELS[data.status]}</span>
        </div>
        <p className="mt-1 text-sm text-muted">Gửi lúc {formatDateTime(data.created_at)}</p>
      </div>

      {data.student_can_edit && (
        <section className={cn(notice.base, notice.warning, 'flex-wrap items-center justify-between gap-3 px-5 py-4')}>
          <div className="min-w-0">
            <p className="text-[0.88rem] font-semibold text-ink">Phòng CTSV yêu cầu bổ sung thông tin</p>
            <p className="mt-0.5 text-[0.82rem] text-ink">Sửa lại thông tin / tải lại file theo nội dung trao đổi bên dưới, hoặc trả lời bằng tin nhắn.</p>
          </div>
          <Link href={`/dashboard/nap-giay-to/new?edit=${data.id}`} className={cn(ui.btnPrimary, 'shrink-0')}>
            <PencilLine size={15} /> Sửa yêu cầu
          </Link>
        </section>
      )}

      {/* Tiến trình 4 bước */}
      <section className={cn(ui.card, 'px-5 py-4')}>
        <ol className="grid grid-cols-4 gap-2">
          {STEPS.map((s, i) => {
            const reached = data.status !== 'rejected' && i <= current;
            const active = i === current && !halted;
            return (
              <li key={s.key} className="flex flex-col items-center text-center">
                <div className="flex w-full items-center">
                  <span className={cn('h-0.5 flex-1', i === 0 ? 'opacity-0' : reached ? 'bg-primary' : 'bg-line')} />
                  <span className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[0.75rem] font-semibold',
                    reached ? 'border-primary bg-primary text-white' : 'border-line bg-white text-muted',
                    active && 'ring-4 ring-primary/15',
                  )}>
                    {reached && i < current ? <Check size={14} /> : i + 1}
                  </span>
                  <span className={cn('h-0.5 flex-1', i === STEPS.length - 1 ? 'opacity-0' : i < current && data.status !== 'rejected' ? 'bg-primary' : 'bg-line')} />
                </div>
                <span className={cn('mt-1.5 text-[0.76rem] font-medium', reached ? 'text-ink' : 'text-muted')}>{s.label}</span>
              </li>
            );
          })}
        </ol>
        {halted && (
          <p className={cn('mt-3 rounded-md border px-3 py-2 text-[0.8rem]',
            data.status === 'rejected' ? 'border-danger-line bg-danger-soft text-danger-text' : 'border-warning-line bg-warning-soft text-warning-text')}>
            {data.status === 'rejected'
              ? 'Yêu cầu không được tiếp nhận — xem lý do trong phần trao đổi.'
              : 'Đang chờ sinh viên bổ sung thông tin.'}
          </p>
        )}
      </section>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          <section className={ui.card}>
            <div className={ui.cardHeader}>
              <h2 className={ui.sectionTitle}><Images size={16} className={accentIcon.primary} /> Ảnh chụp / bản scan</h2>
              <span className={cn(badge.base, badge.neutral)}>{data.files.length}</span>
            </div>
            <div className="px-5 py-4">
              <SubmissionFileGrid submissionId={data.id} files={data.files} />
            </div>
          </section>

          <section className={ui.card}>
            <div className={ui.cardHeader}><h2 className={ui.sectionTitle}>Thông tin đã gửi</h2></div>
            <div className="px-5 py-2">
              <div className={ui.dtRow}><span className={ui.dtLabel}>Giấy tờ cần xét</span><span className={ui.dtValue}>{data.document_name}</span></div>
              <div className={ui.dtRow}><span className={ui.dtLabel}>Số bản</span><span className={ui.dtValue}>{data.copies}</span></div>
              {snap.student_name && <div className={ui.dtRow}><span className={ui.dtLabel}>Họ tên</span><span className={ui.dtValue}>{snap.student_name}</span></div>}
              {snap.student_id && <div className={ui.dtRow}><span className={ui.dtLabel}>MSSV</span><span className={ui.dtValue}>{snap.student_id}</span></div>}
              {snap.department && <div className={ui.dtRow}><span className={ui.dtLabel}>Khoa</span><span className={ui.dtValue}>{snap.department}</span></div>}
              {Object.entries(FIELD_LABELS).map(([key, label]) => {
                const info = editable[key];
                if (!info) return null;
                const value = info.review === 'rejected' ? info.original : info.proposed || info.original;
                if (!value) return null;
                return (
                  <div key={key} className={ui.dtRow}>
                    <span className={ui.dtLabel}>{label}</span>
                    <span className={cn(ui.dtValue, 'flex flex-wrap items-center gap-2')}>
                      {value}
                      {info.changed && info.review && (
                        <span className={cn(badge.base, REVIEW_STYLE[info.review] ?? badge.neutral, 'py-0')}>{REVIEW_LABEL[info.review] ?? info.review}</span>
                      )}
                    </span>
                  </div>
                );
              })}
              {data.contact_phone && <div className={ui.dtRow}><span className={ui.dtLabel}>Số điện thoại liên hệ</span><span className={ui.dtValue}>{data.contact_phone}</span></div>}
              <div className={ui.dtRow}><span className={ui.dtLabel}>Cam đoan</span><span className={ui.dtValue}>Đã cam đoan lúc {formatDateTime(data.consented_at)}</span></div>
            </div>
          </section>

          <section className={ui.card}>
            <div className={ui.cardHeader}>
              <h2 className={ui.sectionTitle}><MessageSquare size={16} className={accentIcon.primary} /> Trao đổi với Phòng CTSV</h2>
              {data.comments.length > 0 && <span className={cn(badge.base, badge.neutral)}>{data.comments.length}</span>}
            </div>
            <div className="max-h-[520px] space-y-2.5 overflow-y-auto px-5 py-4">
              {noteComment && <Bubble c={noteComment} />}
              {data.comments.length === 0 && !noteComment
                ? <p className="py-6 text-center text-sm text-muted">Chưa có trao đổi.</p>
                : data.comments.map((c) => <Bubble key={c.id} c={c} />)}
              <div ref={listEnd} />
            </div>
            <div className="border-t border-line px-5 py-4">
              {data.student_can_comment ? (
                <>
                  <label htmlFor="cmt" className={ui.fieldLabel}>Nội dung trao đổi</label>
                  <textarea
                    id="cmt" rows={3} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} disabled={sending}
                    className={ui.textarea}
                    placeholder={data.status === 'awaiting_info' ? 'Nội dung bổ sung theo yêu cầu…' : 'Nội dung cần lưu ý với Phòng Công tác Sinh viên…'}
                  />
                  {sendError && <p className="mt-1.5 text-[0.82rem] text-danger-text">{sendError}</p>}
                  <div className="mt-2.5 flex flex-wrap items-center gap-3">
                    <button type="button" onClick={submit} disabled={sending || !body.trim()} className={ui.btnPrimary}>
                      {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Gửi trao đổi
                    </button>
                    <span className="text-[0.78rem] text-muted">{body.length}/2000 ký tự</span>
                  </div>
                </>
              ) : (
                <p className="flex items-start gap-2 text-[0.85rem] text-muted">
                  <Lock size={14} className="mt-0.5 shrink-0" />
                  Không gửi được trao đổi khi yêu cầu ở trạng thái “{REQUEST_STATUS_LABELS[data.status]}”.
                  Liên hệ Phòng Công tác Sinh viên (O1.105) nếu cần hỗ trợ.
                </p>
              )}
            </div>
          </section>
        </div>

        <aside className="order-first space-y-5 lg:order-none">
          <section className={ui.card}>
            <div className={ui.cardHeader}><h2 className={ui.sectionTitle}>Tóm tắt</h2></div>
            <dl className="px-5 py-1">
              <div className={ui.dtRow}><dt className={ui.dtLabel}>Mã yêu cầu</dt><dd className={ui.dtValue}><RequestCode code={data.code} /></dd></div>
              <div className={ui.dtRow}><dt className={ui.dtLabel}>Trạng thái</dt><dd className={ui.dtValue}>{REQUEST_STATUS_LABELS[data.status]}</dd></div>
              <div className={ui.dtRow}><dt className={ui.dtLabel}>Ngày gửi</dt><dd className={ui.dtValue}>{formatDateTime(data.created_at)}</dd></div>
              <div className={ui.dtRow}><dt className={ui.dtLabel}>Cập nhật</dt><dd className={ui.dtValue}>{formatDate(data.updated_at)}</dd></div>
              {data.returned_at && <div className={ui.dtRow}><dt className={ui.dtLabel}>Đã trả giấy</dt><dd className={ui.dtValue}>{data.returned_at}</dd></div>}
            </dl>
          </section>

          {data.return_code && (
            <section className={cn(ui.card, 'px-5 py-4')}>
              <p className="flex items-center gap-1.5 text-[0.8rem] font-medium text-muted"><Ticket size={14} className="text-slate-500" /> Mã trả hồ sơ</p>
              <p className="mt-1.5 font-mono text-2xl font-bold tracking-wide text-ink">{data.return_code}</p>
              <p className="mt-1.5 text-[0.8rem] leading-relaxed text-muted">
                {data.status === 'returned'
                  ? 'Đã nhận lại giấy. Biên nhận trả giấy được gửi qua email.'
                  : 'Xuất trình mã này khi đến nhận lại giấy tại Phòng Công tác Sinh viên (O1.105).'}
              </p>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
