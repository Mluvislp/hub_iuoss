'use client';

/**
 * Chi tiết ticket hỏi đáp — trình bày kiểu HỒ SƠ TICKET / THƯ, không phải khung chat.
 *
 * Tham khảo: Zendesk "My requests" (thông tin ticket ở cột riêng, trao đổi cũ → mới),
 * Jira Service Management (hoạt động dạng thẻ trải ngang, ô phản hồi chỉ mở khi bấm),
 * Gmail (lượt cũ thu gọn thành "n lượt trao đổi trước", lượt mới nhất mở sẵn).
 * Mục tiêu: mỗi lượt gửi là một văn bản có chủ đích, không khuyến khích nhắn liên tục —
 * ô soạn đóng sau khi gửi, không có Ctrl+Enter gửi nhanh, và khi ticket đang chờ
 * Phòng CTSV thì nêu rõ để sinh viên không nhắn dồn.
 *
 * Tin mới vẫn tự đến bằng polling: tab mở → `?after=<id lượt cuối>` mỗi 5 giây; tab ẩn →
 * 30 giây, không đánh dấu đã đọc (seen=0), chỉ báo trên tiêu đề tab.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  AlertCircle, ArrowLeft, ChevronsUpDown, CircleDot, Info, Loader2, Lock, Paperclip, Reply,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { ui, badge } from '@/lib/ui';
import { cn, formatDateTime } from '@/lib/utils';
import { refreshTicketUnread } from '@/lib/ticket-unread';
import { AttachmentChip, FilePicker } from '@/components/ticket-files';
import { TICKET_STATUS_STYLES, type TicketDetail, type TicketMessage } from '@/lib/types';

const POLL_VISIBLE_MS = 5_000;
const POLL_HIDDEN_MS = 30_000;
const MAX_BODY = 5000;
/** Số lượt mới nhất luôn mở sẵn; lượt ở giữa gộp thành "n lượt trao đổi trước". */
const KEEP_LATEST = 2;
const OFFICE = 'Phòng Công tác Sinh viên';

/** Kiểu chữ cho tin chuyên viên soạn bằng editor (HTML đã được backend lọc). */
const RICH =
  'break-words text-[0.9rem] leading-relaxed text-ink ' +
  '[&_p]:mb-2 [&>*:last-child]:mb-0 [&_strong]:font-semibold [&_b]:font-semibold [&_em]:italic ' +
  '[&_ul]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mb-2 [&_ol]:list-decimal [&_ol]:pl-5 ' +
  '[&_blockquote]:mb-2 [&_blockquote]:border-l-[3px] [&_blockquote]:border-primary-line ' +
  '[&_blockquote]:bg-slate-50 [&_blockquote]:px-3 [&_blockquote]:py-1 ' +
  '[&_a]:text-primary-text [&_a]:underline';

/** Lượt đang gửi (gửi lạc quan): hiện ngay, chờ server xác nhận. */
interface PendingMessage {
  tempId: number;
  body: string;
  files: File[];
  state: 'sending' | 'failed';
  error?: string;
}

function Avatar({ staff, name }: { staff: boolean; name: string }) {
  return (
    <span
      className={cn(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-[0.8rem] font-semibold',
        staff ? 'border-primary-line bg-primary-soft text-primary-text' : 'border-line bg-slate-100 text-slate-600',
      )}
      aria-hidden
    >
      {staff ? 'CT' : (name.trim().split(/\s+/).pop() ?? '?').charAt(0).toUpperCase()}
    </span>
  );
}

function plainSnippet(m: TicketMessage): string {
  const raw = m.body_html
    ? m.body_html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    : m.body;
  return raw.replace(/\s+/g, ' ').trim();
}

/** Một lượt trao đổi — thẻ trải ngang như một bức thư. */
function MessageCard({
  m, ticketId, first, fresh, collapsed, onToggle,
}: {
  m: TicketMessage;
  ticketId: number;
  first: boolean;
  fresh: boolean;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const staff = m.author_role === 'staff';
  return (
    <article
      id={`msg-${m.id}`}
      className={cn(
        'rounded-lg border bg-white transition-shadow',
        staff ? 'border-line border-l-[3px] border-l-primary' : 'border-line',
        fresh && 'ring-2 ring-primary/25',
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start gap-3 px-5 py-3.5 text-left"
        aria-expanded={!collapsed}
      >
        <Avatar staff={staff} name={m.author_name} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[0.88rem] font-semibold text-ink">{staff ? OFFICE : m.author_name}</span>
            <span className="text-[0.75rem] text-muted">
              {staff ? `Chuyên viên: ${m.author_name}` : 'Sinh viên'}
              {first && ' · Yêu cầu ban đầu'}
            </span>
          </span>
          {collapsed && (
            <span className="mt-0.5 block truncate text-[0.82rem] text-slate-500">{plainSnippet(m)}</span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1.5 text-[0.75rem] text-muted">
          {m.attachments.length > 0 && <Paperclip size={13} aria-label="Có tệp đính kèm" />}
          {formatDateTime(m.created_at)}
        </span>
      </button>

      {!collapsed && (
        <div className="border-t border-line2 px-5 pb-4 pt-3.5 sm:pl-[68px]">
          {staff && m.body_html ? (
            // HTML đã được backend lọc theo danh sách thẻ cho phép (core/richtext.py).
            <div className={RICH} dangerouslySetInnerHTML={{ __html: m.body_html }} />
          ) : (
            <p className="whitespace-pre-wrap break-words text-[0.9rem] leading-relaxed text-ink">{m.body}</p>
          )}
          {m.attachments.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-[0.75rem] font-medium text-muted">Tệp đính kèm ({m.attachments.length})</p>
              <div className="flex flex-wrap gap-2">
                {m.attachments.map((a) => <AttachmentChip key={a.id} ticketId={ticketId} att={a} />)}
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

/** Sự kiện hệ thống (đóng / mở lại ticket): một dòng mốc thời gian, không phải thư. */
function EventRow({ m }: { m: TicketMessage }) {
  return (
    <div className="flex items-center gap-2 px-1 text-[0.8rem] text-muted">
      <CircleDot size={13} className="shrink-0 text-slate-400" />
      <span>{m.body}</span>
      <span className="text-slate-400">· {formatDateTime(m.created_at)}</span>
    </div>
  );
}

function PendingCard({ p, name, onRetry }: { p: PendingMessage; name: string; onRetry: () => void }) {
  const failed = p.state === 'failed';
  return (
    <article className={cn('rounded-lg border bg-white', failed ? 'border-danger-line' : 'border-line opacity-70')}>
      <div className="flex items-start gap-3 px-5 py-3.5">
        <Avatar staff={false} name={name} />
        <span className="min-w-0 flex-1">
          <span className="text-[0.88rem] font-semibold text-ink">{name}</span>
          <span className="ml-2 text-[0.75rem] text-muted">Sinh viên</span>
        </span>
        <span className={cn('flex items-center gap-1.5 text-[0.75rem]', failed ? 'text-danger-text' : 'text-muted')}>
          {failed ? (
            <>
              {p.error ?? 'Không gửi được.'}
              <button type="button" onClick={onRetry} className="font-semibold text-primary-text underline">
                Gửi lại
              </button>
            </>
          ) : (
            <>
              <Loader2 size={13} className="animate-spin" />
              Đang gửi…
            </>
          )}
        </span>
      </div>
      <div className="border-t border-line2 px-5 pb-4 pt-3.5 sm:pl-[68px]">
        <p className="whitespace-pre-wrap break-words text-[0.9rem] leading-relaxed text-ink">{p.body}</p>
        {p.files.length > 0 && (
          <p className="mt-3 text-[0.78rem] text-muted">Tệp đính kèm: {p.files.map((f) => f.name).join(', ')}</p>
        )}
      </div>
    </article>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2.5 text-[0.84rem]">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="text-right font-medium text-ink">{children}</dd>
    </div>
  );
}

export default function TicketDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params?.id);

  const [data, setData] = useState<TicketDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [freshIds, setFreshIds] = useState<number[]>([]);
  const [notice, setNotice] = useState<number | null>(null);   // id lượt mới của Phòng CTSV
  const [showOlder, setShowOlder] = useState(false);
  const [toggled, setToggled] = useState<Record<number, boolean>>({});

  const tempSeq = useRef(-1);
  const lastId = useRef(0);
  const baseTitle = useRef<string>('');
  const hiddenNew = useRef(0);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  /** Gộp lượt mới (poll và gửi có thể trả trùng một lượt). */
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
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Không tải được ticket này.'));
  }, [id]);

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
        merge(messages, rest);
        if (fromStaff.length) {
          setFreshIds(fromStaff.map((m) => m.id));
          window.setTimeout(() => alive && setFreshIds([]), 6000);
          if (hidden) {
            hiddenNew.current += fromStaff.length;
            document.title = `(${hiddenNew.current}) Phản hồi mới · ${baseTitle.current}`;
          } else {
            setNotice(fromStaff[fromStaff.length - 1].id);
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

  const myName = useMemo(
    () => data?.messages.find((m) => m.author_role === 'student')?.author_name ?? 'Sinh viên',
    [data],
  );

  /** Gửi một lượt đã hiện sẵn; thành công thì thay bằng bản chính thức. */
  async function deliver(item: PendingMessage) {
    const form = new FormData();
    form.set('body', item.body);
    item.files.forEach((f) => form.append('files', f));
    try {
      const res = await api.tickets.reply(id, form);
      const { message, ...rest } = res;
      setPending((list) => list.filter((p) => p.tempId !== item.tempId));
      merge([message], rest);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Không gửi được.';
      setPending((list) => list.map((p) => (p.tempId === item.tempId ? { ...p, state: 'failed', error: msg } : p)));
    }
  }

  function send() {
    const text = body.trim();
    if (!text) return;
    // Gửi lạc quan: đóng ô soạn + hiện thẻ "Đang gửi…" ngay, không chờ server.
    const item: PendingMessage = { tempId: tempSeq.current--, body: text, files, state: 'sending' };
    setPending((list) => [...list, item]);
    setBody('');
    setFiles([]);
    setComposing(false);
    deliver(item);
  }

  function retry(item: PendingMessage) {
    const again: PendingMessage = { ...item, state: 'sending', error: undefined };
    setPending((list) => list.map((p) => (p.tempId === item.tempId ? again : p)));
    deliver(again);
  }

  function openComposer() {
    setComposing(true);
    window.setTimeout(() => {
      composerRef.current?.focus();
      composerRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 0);
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

  // ── Dựng dòng trao đổi: lượt đầu + (gộp lượt giữa) + các lượt mới nhất ──
  const letters = data.messages.filter((m) => m.author_role !== 'system');
  const firstId = letters[0]?.id;
  const latestIds = new Set(letters.slice(-KEEP_LATEST).map((m) => m.id));
  const hiddenIds = new Set(
    showOlder ? [] : letters.slice(1, Math.max(1, letters.length - KEEP_LATEST)).map((m) => m.id),
  );
  const olderCount = hiddenIds.size;
  const isCollapsed = (m: TicketMessage) => {
    const byDefault = !(m.id === firstId || latestIds.has(m.id));
    return toggled[m.id] === undefined ? byDefault : !toggled[m.id];
  };

  const sep = data.topic.name.indexOf(' - ');
  const topicName = sep >= 0 ? data.topic.name.slice(0, sep) : data.topic.name;
  const subtopicName = sep >= 0 ? data.topic.name.slice(sep + 3) : '';
  const waitingOffice = data.status === 'open';
  const lastStaff = [...letters].reverse().find((m) => m.author_role === 'staff');

  let olderBarShown = false;

  return (
    <div className="space-y-5">
      <Link href="/dashboard/hoi-dap" className={ui.btnSecondary}>
        <ArrowLeft size={15} />
        Danh sách câu hỏi
      </Link>

      {/* ── Đầu hồ sơ ── */}
      <header className={cn(ui.card, 'px-5 py-4')}>
        <p className="font-mono text-[0.78rem] tracking-wide text-muted">TICKET #{data.id}</p>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <h1 className="min-w-0 break-words text-xl font-semibold leading-snug text-ink">{data.subject}</h1>
          <span className={cn(badge.base, TICKET_STATUS_STYLES[data.status], 'text-[0.82rem]')}>
            {data.status_label}
          </span>
        </div>
        <p className="mt-1.5 text-[0.84rem] text-muted">
          {data.topic.name} · Gửi {formatDateTime(data.created_at)}
        </p>
      </header>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        {/* ── Dòng trao đổi ── */}
        <div className="min-w-0 space-y-3">
          {notice !== null && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary-line bg-primary-soft px-4 py-2.5">
              <p className="text-[0.85rem] font-medium text-primary-text">{OFFICE} đã gửi phản hồi mới.</p>
              <button
                type="button"
                className="text-[0.82rem] font-semibold text-primary-text underline"
                onClick={() => {
                  document.getElementById(`msg-${notice}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
                  setNotice(null);
                }}
              >
                Xem phản hồi
              </button>
            </div>
          )}

          {data.messages.map((m) => {
            if (m.author_role === 'system') return <EventRow key={m.id} m={m} />;
            if (hiddenIds.has(m.id)) {
              if (olderBarShown) return null;
              olderBarShown = true;
              return (
                <button
                  key={`older-${m.id}`}
                  type="button"
                  onClick={() => setShowOlder(true)}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 py-2.5 text-[0.82rem] font-medium text-slate-600 hover:border-primary-line hover:text-primary-text"
                >
                  <ChevronsUpDown size={14} />
                  {olderCount} lượt trao đổi trước
                </button>
              );
            }
            return (
              <MessageCard
                key={m.id}
                m={m}
                ticketId={data.id}
                first={m.id === firstId}
                fresh={freshIds.includes(m.id)}
                collapsed={isCollapsed(m)}
                onToggle={() => setToggled((t) => ({ ...t, [m.id]: isCollapsed(m) }))}
              />
            );
          })}

          {pending.map((p) => (
            <PendingCard key={p.tempId} p={p} name={myName} onRetry={() => retry(p)} />
          ))}

          {/* ── Phản hồi: đóng mặc định, mở khi bấm ── */}
          {!data.can_reply ? (
            <div className="flex items-start gap-2.5 rounded-lg border border-line bg-slate-50 px-5 py-4 text-[0.86rem] text-slate-600">
              <Lock size={15} className="mt-0.5 shrink-0" />
              <span>
                Ticket đã được đóng. Trường hợp cần trao đổi thêm, đề nghị sinh viên{' '}
                <Link href="/dashboard/hoi-dap/new" className="font-medium text-primary-text hover:underline">
                  đặt câu hỏi mới
                </Link>
                .
              </span>
            </div>
          ) : composing ? (
            <section className={ui.card}>
              <div className={ui.cardHeader}>
                <h2 className={ui.sectionTitle}>
                  <Reply size={16} className="text-primary" />
                  {waitingOffice ? 'Bổ sung thông tin' : 'Phản hồi'} — Ticket #{data.id}
                </h2>
              </div>
              <div className="space-y-3 px-5 py-4">
                <textarea
                  ref={composerRef}
                  id="tk-reply"
                  rows={7}
                  maxLength={MAX_BODY}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  className={cn(ui.textarea, 'resize-y')}
                  placeholder="Nội dung trình bày đầy đủ trong một lượt phản hồi"
                  aria-label="Nội dung phản hồi"
                />
                <FilePicker files={files} onChange={setFiles} max={data.max_files} />
                <p className="text-[0.76rem] text-muted">
                  Nội dung đã gửi được lưu vào hồ sơ ticket và không chỉnh sửa hoặc thu hồi được.
                </p>
                <div className="flex flex-wrap items-center gap-2 border-t border-line2 pt-3">
                  <button type="button" onClick={send} disabled={!body.trim()} className={ui.btnPrimary}>
                    Gửi phản hồi
                  </button>
                  <button type="button" onClick={() => setComposing(false)} className={ui.btnGhost}>
                    Huỷ
                  </button>
                  <span className="ml-auto text-[0.75rem] text-muted">{body.length}/{MAX_BODY}</span>
                </div>
              </div>
            </section>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-white px-5 py-3.5">
              <p className="text-[0.85rem] text-slate-600">
                {waitingOffice
                  ? `Ticket đang chờ ${OFFICE} phản hồi.`
                  : `${OFFICE} đã phản hồi. Nội dung chưa rõ có thể phản hồi lại trong ticket này.`}
              </p>
              <button
                type="button"
                onClick={openComposer}
                className={waitingOffice ? ui.btnSecondary : ui.btnPrimary}
              >
                <Reply size={15} />
                {waitingOffice ? 'Bổ sung thông tin' : 'Phản hồi'}
              </button>
            </div>
          )}
        </div>

        {/* ── Cột thông tin ticket ── */}
        <aside className="space-y-4 lg:sticky lg:top-4">
          <section className={ui.card}>
            <div className={ui.cardHeader}>
              <h2 className={ui.sectionTitle}>Thông tin ticket</h2>
            </div>
            <dl className="divide-y divide-line2 px-5 py-1">
              <InfoRow label="Mã ticket"><span className="font-mono">#{data.id}</span></InfoRow>
              <InfoRow label="Trạng thái">
                <span className={cn(badge.base, TICKET_STATUS_STYLES[data.status])}>{data.status_label}</span>
              </InfoRow>
              <InfoRow label="Mảng">{topicName}</InfoRow>
              {subtopicName && <InfoRow label="Nội dung">{subtopicName}</InfoRow>}
              <InfoRow label="Ngày gửi">{formatDateTime(data.created_at)}</InfoRow>
              <InfoRow label="Cập nhật">{formatDateTime(data.updated_at)}</InfoRow>
              <InfoRow label="Phản hồi gần nhất">
                {lastStaff ? formatDateTime(lastStaff.created_at) : <span className="font-normal italic text-muted">Chưa có</span>}
              </InfoRow>
              <InfoRow label="Số lượt trao đổi">{letters.length}</InfoRow>
            </dl>
          </section>

          <section className="rounded-lg border border-line bg-slate-50 px-5 py-4">
            <p className="flex items-center gap-1.5 text-[0.82rem] font-semibold text-ink">
              <Info size={14} className="text-slate-500" />
              Lưu ý
            </p>
            <ul className="mt-2 list-disc space-y-1.5 pl-4 text-[0.8rem] leading-relaxed text-slate-600">
              <li>Mỗi ticket dành cho một vấn đề. Vấn đề khác đề nghị đặt câu hỏi mới.</li>
              <li>Thông tin bổ sung trình bày đầy đủ trong một lượt phản hồi, kèm tệp minh chứng nếu có.</li>
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
