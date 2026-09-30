'use client';

/**
 * Chi tiết ticket + trao đổi với Phòng CTSV, tự nhận tin mới.
 *
 * "Realtime" bằng polling: tab đang mở → hỏi `?after=<id lượt cuối>` mỗi 5 giây;
 * tab ẩn → 30 giây và KHÔNG đánh dấu đã đọc (seen=0), chỉ báo số tin mới trên
 * tiêu đề tab. Mỗi lần hỏi chỉ trả lượt mới nên gần như không tốn gì.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  AlertCircle, ArrowLeft, Loader2, Lock, MessageSquare, Send,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { ui, badge, accentIcon } from '@/lib/ui';
import { cn, formatDateTime } from '@/lib/utils';
import { refreshTicketUnread } from '@/lib/ticket-unread';
import { AttachmentChip, FilePicker } from '@/components/ticket-files';
import { TICKET_STATUS_STYLES, type TicketDetail, type TicketMessage } from '@/lib/types';

/** Lượt đang gửi (gửi lạc quan): hiện ngay, chờ server xác nhận. id âm để không đụng id thật. */
interface PendingMessage {
  tempId: number;
  body: string;
  files: File[];
  state: 'sending' | 'failed';
  error?: string;
}

function PendingBubble({ p, onRetry }: { p: PendingMessage; onRetry: () => void }) {
  const failed = p.state === 'failed';
  return (
    <div className="flex flex-col items-end">
      <div
        className={cn(
          'max-w-[85%] rounded-lg border px-3.5 py-2.5',
          failed ? 'border-danger-line bg-danger-soft' : 'border-primary-line bg-primary-soft opacity-70',
        )}
      >
        <p className="whitespace-pre-wrap break-words text-[0.87rem] leading-relaxed text-ink">{p.body}</p>
        {p.files.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {p.files.map((f, i) => (
              <span key={i} className="rounded-md border border-line bg-white px-2 py-1 text-[0.75rem] text-muted">
                {f.name}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className={cn('mt-1 flex items-center gap-1.5 text-[0.72rem]', failed ? 'text-danger-text' : 'text-muted')}>
        {failed ? (
          <>
            {p.error ?? 'Không gửi được.'}
            <button type="button" onClick={onRetry} className="font-semibold text-primary-text underline">
              Gửi lại
            </button>
          </>
        ) : (
          <>
            <span className="inline-flex gap-[3px]" aria-hidden>
              <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:0ms]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:150ms]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:300ms]" />
            </span>
            Đang gửi…
          </>
        )}
      </div>
    </div>
  );
}

/** Kiểu chữ cho tin chuyên viên soạn bằng editor (không dùng plugin typography). */
const RICH =
  'break-words text-[0.87rem] leading-relaxed text-ink ' +
  '[&_p]:mb-1.5 [&>*:last-child]:mb-0 [&_strong]:font-semibold [&_b]:font-semibold [&_em]:italic ' +
  '[&_ul]:mb-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mb-1.5 [&_ol]:list-decimal [&_ol]:pl-5 ' +
  '[&_blockquote]:mb-1.5 [&_blockquote]:border-l-[3px] [&_blockquote]:border-primary-line ' +
  '[&_blockquote]:bg-slate-50 [&_blockquote]:px-3 [&_blockquote]:py-1 ' +
  '[&_a]:text-primary-text [&_a]:underline';

const POLL_VISIBLE_MS = 5_000;
const POLL_HIDDEN_MS = 30_000;
const MAX_BODY = 5000;

function Bubble({ m, ticketId, fresh }: { m: TicketMessage; ticketId: number; fresh: boolean }) {
  if (m.author_role === 'system') {
    return (
      <div className="flex justify-center">
        <span className="rounded-full border border-line bg-slate-50 px-3 py-0.5 text-[0.75rem] text-muted">
          {m.body} · {formatDateTime(m.created_at)}
        </span>
      </div>
    );
  }
  const mine = m.author_role === 'student';
  return (
    <div className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-lg border px-3.5 py-2.5 transition-shadow duration-700',
          mine ? 'border-primary-line bg-primary-soft' : 'border-line bg-white',
          fresh && 'ring-2 ring-primary/30',
        )}
      >
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="text-[0.78rem] font-semibold text-ink">{m.author_name}</span>
          {!mine && <span className={cn(badge.base, badge.neutral, 'py-0')}>Phòng CTSV</span>}
          <span className="ml-auto text-[0.72rem] text-muted">{formatDateTime(m.created_at)}</span>
        </div>
        {!mine && m.body_html ? (
          // HTML đã được backend lọc theo danh sách thẻ cho phép (core/richtext.py).
          <div
            className={RICH}
            dangerouslySetInnerHTML={{ __html: m.body_html }}
          />
        ) : (
          <p className="whitespace-pre-wrap break-words text-[0.87rem] leading-relaxed text-ink">{m.body}</p>
        )}
        {m.attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {m.attachments.map((a) => <AttachmentChip key={a.id} ticketId={ticketId} att={a} />)}
          </div>
        )}
      </div>
    </div>
  );
}

export default function TicketDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params?.id);

  const [data, setData] = useState<TicketDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const tempSeq = useRef(-1);
  const [freshIds, setFreshIds] = useState<number[]>([]);
  const [notice, setNotice] = useState(false);

  const listRef = useRef<HTMLDivElement | null>(null);
  const lastId = useRef(0);
  const baseTitle = useRef<string>('');
  const hiddenNew = useRef(0);

  const scrollToEnd = useCallback(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  /** Gộp lượt mới vào danh sách (poll và gửi có thể trả trùng một lượt). */
  const merge = useCallback((incoming: TicketMessage[], next: Partial<TicketDetail>) => {
    setData((prev) => {
      if (!prev) return prev;
      const known = new Set(prev.messages.map((m) => m.id));
      const added = incoming.filter((m) => !known.has(m.id));
      added.forEach((m) => { lastId.current = Math.max(lastId.current, m.id); });
      return { ...prev, ...next, messages: [...prev.messages, ...added] };
    });
  }, []);

  // Tải lần đầu
  useEffect(() => {
    if (!Number.isFinite(id)) {
      setError('Mã ticket không hợp lệ.');
      return;
    }
    baseTitle.current = document.title;
    api.tickets
      .detail(id)
      .then((d) => {
        setData(d);
        lastId.current = d.messages.reduce((mx, m) => Math.max(mx, m.id), 0);
        refreshTicketUnread();
        window.setTimeout(scrollToEnd, 0);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Không tải được ticket này.'));
  }, [id, scrollToEnd]);

  // Polling tin mới
  useEffect(() => {
    if (!data) return;
    let alive = true;
    let timer: number | undefined;

    const poll = async () => {
      const hidden = document.hidden;
      try {
        const d = await api.tickets.detail(id, lastId.current, !hidden);
        if (!alive) return;
        const fromStaff = d.messages.filter((m) => m.author_role === 'staff');
        const { messages, ...rest } = d;
        const el = listRef.current;
        const atBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        merge(messages, rest);
        if (messages.length && atBottom) window.setTimeout(scrollToEnd, 0);
        if (fromStaff.length) {
          setFreshIds(fromStaff.map((m) => m.id));
          window.setTimeout(() => alive && setFreshIds([]), 4000);
          if (hidden) {
            hiddenNew.current += fromStaff.length;
            document.title = `(${hiddenNew.current}) Phản hồi mới · ${baseTitle.current}`;
          } else {
            setNotice(true);
            window.setTimeout(() => alive && setNotice(false), 5000);
            refreshTicketUnread();
          }
        }
      } catch {
        /* mạng chập chờn: bỏ lượt này, lượt sau hỏi lại */
      }
      if (alive) timer = window.setTimeout(poll, document.hidden ? POLL_HIDDEN_MS : POLL_VISIBLE_MS);
    };

    const onVisible = () => {
      if (document.hidden) return;
      hiddenNew.current = 0;
      document.title = baseTitle.current;
      window.clearTimeout(timer);
      poll();   // quay lại tab: hỏi ngay + đánh dấu đã đọc
    };

    timer = window.setTimeout(poll, POLL_VISIBLE_MS);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      document.title = baseTitle.current;
    };
    // Chỉ khởi động một lần khi đã có dữ liệu — `data` đổi liên tục do chính polling.
  }, [id, data !== null]);

  /** Gửi một lượt đã hiện sẵn trên khung chat; thành công thì thay bằng bản chính thức. */
  async function deliver(item: PendingMessage) {
    const form = new FormData();
    form.set('body', item.body);
    item.files.forEach((f) => form.append('files', f));
    try {
      const res = await api.tickets.reply(id, form);
      const { message, ...rest } = res;
      setPending((list) => list.filter((p) => p.tempId !== item.tempId));
      merge([message], rest);
      window.setTimeout(scrollToEnd, 0);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Không gửi được.';
      setPending((list) => list.map((p) => (p.tempId === item.tempId ? { ...p, state: 'failed', error: msg } : p)));
    }
  }

  function send() {
    const text = body.trim();
    if (!text) return;
    // Gửi lạc quan: xoá ô nhập + hiện bong bóng "Đang gửi…" NGAY, không chờ server.
    const item: PendingMessage = { tempId: tempSeq.current--, body: text, files, state: 'sending' };
    setPending((list) => [...list, item]);
    setBody('');
    setFiles([]);
    window.setTimeout(scrollToEnd, 0);
    deliver(item);
  }

  function retry(item: PendingMessage) {
    const again: PendingMessage = { ...item, state: 'sending', error: undefined };
    setPending((list) => list.map((p) => (p.tempId === item.tempId ? again : p)));
    deliver(again);
  }

  if (error) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/hoi-dap" className={ui.btnSecondary}>
          <ArrowLeft size={15} />
          Danh sách câu hỏi
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

  return (
    <div className="space-y-5">
      <Link href="/dashboard/hoi-dap" className={ui.btnSecondary}>
        <ArrowLeft size={15} />
        Danh sách câu hỏi
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="break-words text-xl font-semibold text-ink">{data.subject}</h1>
          <p className="mt-1 text-sm text-muted">
            #{data.id} · {data.topic.name} · Gửi {formatDateTime(data.created_at)}
          </p>
        </div>
        <span className={cn(badge.base, TICKET_STATUS_STYLES[data.status], 'text-[0.82rem]')}>
          {data.status_label}
        </span>
      </div>

      <section className={ui.card}>
        <div className={ui.cardHeader}>
          <h2 className={ui.sectionTitle}>
            <MessageSquare size={16} className={accentIcon.primary} />
            Trao đổi với Phòng CTSV
          </h2>
          {notice ? (
            <span className={cn(badge.base, badge.info)}>Phòng CTSV vừa phản hồi</span>
          ) : data.can_reply ? (
            <span className="inline-flex items-center gap-1.5 text-[0.75rem] text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-success-text" />
              Tự cập nhật
            </span>
          ) : null}
        </div>

        <div ref={listRef} className="max-h-[560px] space-y-2.5 overflow-y-auto px-5 py-4">
          {data.messages.map((m) => (
            <Bubble key={m.id} m={m} ticketId={data.id} fresh={freshIds.includes(m.id)} />
          ))}
          {pending.map((p) => (
            <PendingBubble key={p.tempId} p={p} onRetry={() => retry(p)} />
          ))}
        </div>

        <div className="border-t border-line px-5 py-4">
          {data.can_reply ? (
            <>
              <label htmlFor="tk-reply" className={ui.fieldLabel}>Nhắn thêm</label>
              <textarea
                id="tk-reply"
                rows={3}
                maxLength={MAX_BODY}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    send();
                  }
                }}
                className={cn(ui.textarea, 'resize-y')}
                placeholder="Nội dung trao đổi thêm…"
              />
              <div className="mt-2">
                <FilePicker files={files} onChange={setFiles} max={data.max_files} />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button type="button" onClick={send} disabled={!body.trim()} className={ui.btnPrimary}>
                  <Send size={15} />
                  Gửi
                </button>
                <span className="text-[0.78rem] text-muted">Ctrl + Enter để gửi</span>
              </div>
            </>
          ) : (
            <p className="flex items-start gap-2 text-[0.85rem] text-muted">
              <Lock size={14} className="mt-0.5 shrink-0" />
              <span>
                Ticket đã được đóng. Trường hợp cần trao đổi thêm, đề nghị sinh viên{' '}
                <Link href="/dashboard/hoi-dap/new" className="font-medium text-primary-text hover:underline">
                  đặt câu hỏi mới
                </Link>
                .
              </span>
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
