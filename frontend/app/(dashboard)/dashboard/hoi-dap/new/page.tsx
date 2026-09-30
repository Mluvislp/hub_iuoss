'use client';

/**
 * Đặt câu hỏi mới: chọn mảng → tiêu đề → nội dung → tối đa 2 file.
 * Mảng quyết định người phụ trách nhận email báo, nên đặt lên đầu và bắt buộc chọn.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowLeft, Check, Loader2, Send } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { ui } from '@/lib/ui';
import { cn } from '@/lib/utils';
import { FilePicker } from '@/components/ticket-files';
import type { TicketTopic } from '@/lib/types';

const MAX_SUBJECT = 200;
const MAX_BODY = 5000;

export default function NewTicketPage() {
  const router = useRouter();
  const [topics, setTopics] = useState<TicketTopic[] | null>(null);
  const [topicId, setTopicId] = useState<number | null>(null);
  const [subtopicId, setSubtopicId] = useState<number | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    api.tickets
      .topics()
      .then(setTopics)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Không tải được danh sách mảng.'));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    const topic = (topics ?? []).find((t) => t.id === topicId);
    if (!topic) errs.topic_id = 'Chọn mảng cần trao đổi.';
    else if (topic.children.length && !subtopicId) errs.topic_id = 'Chọn nội dung cụ thể trong mảng đã chọn.';
    if (subject.trim().length < 5) errs.subject = 'Tiêu đề tối thiểu 5 ký tự.';
    if (!body.trim()) errs.body = 'Nhập nội dung.';
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;

    const form = new FormData();
    // Mảng có mục con thì gửi id mục con — ticket gắn thẳng với mục cụ thể.
    form.set('topic_id', String(subtopicId ?? topicId));
    form.set('subject', subject.trim());
    form.set('body', body.trim());
    files.forEach((f) => form.append('files', f));

    setSending(true);
    setError(null);
    try {
      const res = await api.tickets.create(form);
      router.replace(`/dashboard/hoi-dap/${res.id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        const fe = (err.data?.errors ?? {}) as Record<string, string>;
        setFieldErrors(fe);
      } else {
        setError('Không gửi được. Vui lòng thử lại.');
      }
      setSending(false);
    }
  }

  return (
    <div className="space-y-5">
      <Link href="/dashboard/hoi-dap" className={ui.btnSecondary}>
        <ArrowLeft size={15} />
        Danh sách câu hỏi
      </Link>

      <div>
        <h1 className="text-xl font-semibold text-ink">Đặt câu hỏi</h1>
        <p className="mt-1 text-sm text-muted">
          Câu hỏi được chuyển tới chuyên viên phụ trách mảng đã chọn. Phản hồi hiển thị tại
          mục Hỏi đáp và được báo qua email trường.
        </p>
      </div>

      <form onSubmit={submit} className="space-y-5">
        <section className={ui.card}>
          <div className={ui.cardHeader}>
            <h2 className={ui.sectionTitle}>1. Mảng cần trao đổi</h2>
          </div>
          <div className="px-5 py-4">
            {topics === null && !error ? (
              <div className="flex items-center gap-2 py-4 text-sm text-muted">
                <Loader2 size={15} className="animate-spin" />
                Đang tải…
              </div>
            ) : (
              <div className="grid gap-2.5 sm:grid-cols-2" role="radiogroup" aria-label="Mảng cần trao đổi">
                {(topics ?? []).map((t) => {
                  const active = topicId === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      disabled={sending}
                      onClick={() => {
                        if (topicId !== t.id) setSubtopicId(null);
                        setTopicId(t.id);
                        setFieldErrors((p) => ({ ...p, topic_id: '' }));
                      }}
                      className={cn(
                        'flex items-start gap-3 rounded-lg border px-4 py-3 text-left transition-colors',
                        active
                          ? 'border-primary bg-primary-soft'
                          : 'border-line bg-white hover:border-primary-line hover:bg-slate-50',
                      )}
                    >
                      <span
                        className={cn(
                          'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                          active ? 'border-primary bg-primary text-white' : 'border-slate-300 bg-white',
                        )}
                      >
                        {active && <Check size={11} strokeWidth={3} />}
                      </span>
                      <span className="min-w-0">
                        <span className={cn('block text-sm font-medium', active ? 'text-primary-text' : 'text-ink')}>
                          {t.name}
                        </span>
                        {t.description && (
                          <span className="mt-0.5 block text-[0.78rem] leading-snug text-muted">{t.description}</span>
                        )}
                        {t.children.length > 0 && (
                          <span className="mt-1 block text-[0.72rem] text-muted">{t.children.length} nội dung cụ thể</span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {(() => {
              const picked = (topics ?? []).find((t) => t.id === topicId);
              if (!picked || picked.children.length === 0) return null;
              return (
                <div className="mt-4 rounded-lg border border-primary-line bg-[#f8fbff] px-4 py-3">
                  <p className="mb-2 text-[0.82rem] font-medium text-ink">
                    Nội dung cụ thể — {picked.name}
                  </p>
                  <div className="space-y-1.5" role="radiogroup" aria-label={`Nội dung cụ thể — ${picked.name}`}>
                    {picked.children.map((c) => {
                      const on = subtopicId === c.id;
                      return (
                        <label
                          key={c.id}
                          className={cn(
                            'flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 transition-colors',
                            on ? 'border-primary bg-white' : 'border-transparent hover:bg-white',
                          )}
                        >
                          <input
                            type="radio"
                            name="subtopic"
                            className="mt-0.5 accent-[#2563eb]"
                            checked={on}
                            disabled={sending}
                            onChange={() => {
                              setSubtopicId(c.id);
                              setFieldErrors((p) => ({ ...p, topic_id: '' }));
                            }}
                          />
                          <span className="min-w-0">
                            <span className={cn('block text-sm', on ? 'font-medium text-primary-text' : 'text-ink')}>
                              {c.name}
                            </span>
                            {c.description && (
                              <span className="block text-[0.76rem] text-muted">{c.description}</span>
                            )}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
            {fieldErrors.topic_id && <p className="mt-2 text-[0.82rem] text-danger-text">{fieldErrors.topic_id}</p>}

            <p className="mt-4 border-t border-line pt-3 text-[0.8rem] leading-relaxed text-muted">
              Các trường hợp cần giải đáp thông tin khác ngoài các mục ở trên, sinh viên liên hệ Phòng
              Công tác Sinh viên (phòng O1.105, số điện thoại (+84) 028 3724 4270, số máy lẻ 3334, email{' '}
              <a href="mailto:oss@hcmiu.edu.vn" className="underline underline-offset-2 hover:text-ink">
                oss@hcmiu.edu.vn
              </a>
              ).
            </p>
          </div>
        </section>

        <section className={ui.card}>
          <div className={ui.cardHeader}>
            <h2 className={ui.sectionTitle}>2. Nội dung</h2>
          </div>
          <div className="space-y-4 px-5 py-4">
            <div>
              <label htmlFor="tk-subject" className={ui.fieldLabel}>Tiêu đề</label>
              <input
                id="tk-subject"
                value={subject}
                maxLength={MAX_SUBJECT}
                disabled={sending}
                onChange={(e) => setSubject(e.target.value)}
                className={cn(ui.input, fieldErrors.subject && 'border-danger-line')}
                placeholder="Tóm tắt vấn đề trong một câu"
              />
              {fieldErrors.subject && <p className="mt-1 text-[0.82rem] text-danger-text">{fieldErrors.subject}</p>}
            </div>
            <div>
              <label htmlFor="tk-body" className={ui.fieldLabel}>Nội dung chi tiết</label>
              <textarea
                id="tk-body"
                rows={7}
                value={body}
                maxLength={MAX_BODY}
                disabled={sending}
                onChange={(e) => setBody(e.target.value)}
                className={cn(ui.textarea, 'resize-y', fieldErrors.body && 'border-danger-line')}
                placeholder="Mô tả vấn đề, thời điểm phát sinh và thông tin liên quan"
              />
              <div className="mt-1 flex justify-between text-[0.75rem] text-muted">
                <span className="text-danger-text">{fieldErrors.body}</span>
                <span>{body.length}/{MAX_BODY}</span>
              </div>
            </div>
            <div>
              <span className={ui.fieldLabel}>File đính kèm (không bắt buộc)</span>
              <FilePicker files={files} onChange={setFiles} disabled={sending} />
              {fieldErrors.files && <p className="mt-1 text-[0.82rem] text-danger-text">{fieldErrors.files}</p>}
            </div>
          </div>
        </section>

        {error && (
          <div className="flex items-start gap-2.5 rounded-lg border border-danger-line bg-danger-soft px-4 py-3">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-danger-text" />
            <p className="text-sm text-danger-text">{error}</p>
          </div>
        )}

        <div className="flex justify-end">
          <button type="submit" disabled={sending || topics === null} className={ui.btnPrimary}>
            {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            Gửi câu hỏi
          </button>
        </div>
      </form>
    </div>
  );
}
