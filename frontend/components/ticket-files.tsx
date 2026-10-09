'use client';

/**
 * Chọn file đính kèm cho ticket (tối đa 2, PDF hoặc ảnh, mỗi file ≤ 5 MB) và hiện
 * file đã gửi. Kiểm ở đây chỉ để báo sớm — backend kiểm lại bằng nội dung thật.
 */

import { useEffect, useRef, useState } from 'react';
import { Download, File, FileSpreadsheet, FileText, ImageIcon, Loader2, Paperclip, X } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ui } from '@/lib/ui';
import type { TicketAttachment } from '@/lib/types';

export const TICKET_MAX_FILES = 2;
const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif';

export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function looksAllowed(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    file.type === 'application/pdf' || file.type.startsWith('image/') ||
    /\.(pdf|jpe?g|png|webp|heic|heif)$/.test(name)
  );
}

export function FilePicker({
  files,
  onChange,
  disabled,
  max = TICKET_MAX_FILES,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
  max?: number;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  function add(list: FileList | null) {
    if (!list) return;
    const next = [...files];
    for (const file of Array.from(list)) {
      if (next.length >= max) {
        setError(`Chỉ đính kèm tối đa ${max} file.`);
        break;
      }
      if (!looksAllowed(file)) {
        setError(`“${file.name}” không phải PDF hoặc ảnh.`);
        continue;
      }
      if (file.size > MAX_BYTES) {
        setError(`“${file.name}” vượt 5 MB.`);
        continue;
      }
      setError(null);
      next.push(file);
    }
    onChange(next);
    if (input.current) input.current.value = '';
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {files.map((f, i) => (
          <span
            key={`${f.name}-${i}`}
            className="inline-flex max-w-[260px] items-center gap-2 rounded-lg border border-line bg-white px-2.5 py-1.5 text-[0.8rem] text-ink"
          >
            {f.type === 'application/pdf' ? (
              <FileText size={14} className="shrink-0 text-danger-text" />
            ) : (
              <ImageIcon size={14} className="shrink-0 text-primary" />
            )}
            <span className="truncate">{f.name}</span>
            <span className="shrink-0 text-[0.72rem] text-muted">{formatSize(f.size)}</span>
            {!disabled && (
              <button
                type="button"
                onClick={() => onChange(files.filter((_, j) => j !== i))}
                className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-ink"
                aria-label={`Bỏ ${f.name}`}
              >
                <X size={13} />
              </button>
            )}
          </span>
        ))}
        {files.length < max && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => input.current?.click()}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-1.5',
              'text-[0.8rem] font-medium text-slate-600 hover:border-primary-line hover:text-primary-text',
              'disabled:cursor-not-allowed disabled:opacity-60',
            )}
          >
            <Paperclip size={14} />
            Đính kèm file
          </button>
        )}
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(e) => add(e.target.files)}
        />
      </div>
      <p className="mt-1.5 text-[0.75rem] text-muted">
        Tối đa {max} file PDF hoặc ảnh, mỗi file không quá 5 MB.
      </p>
      {error && <p className="mt-1 text-[0.8rem] text-danger-text">{error}</p>}
    </div>
  );
}

/** PDF và ảnh xem được ngay trên trang; Word/Excel (chuyên viên gửi mẫu đơn) chỉ tải xuống. */
function previewable(att: TicketAttachment): boolean {
  return att.is_pdf || att.mime_type.startsWith('image/');
}

function isSpreadsheet(att: TicketAttachment): boolean {
  return /spreadsheet|excel/.test(att.mime_type);
}

/**
 * File đã gửi: bấm để XEM NGAY TRÊN TRANG (ảnh hiện thẳng, PDF trong khung) —
 * không mở tab mới. File cần token nên tải qua fetch rồi dựng blob URL.
 * File không xem được trong trình duyệt (Word/Excel) thì tải thẳng về máy.
 */
export function AttachmentChip({ ticketId, att }: { ticketId: number; att: TicketAttachment }) {
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await api.tickets.attachment(ticketId, att.id);
      // Gán đúng kiểu để trình duyệt hiển thị PDF trong khung thay vì tải xuống.
      const objectUrl = URL.createObjectURL(new Blob([blob], { type: att.mime_type }));
      if (!previewable(att)) {
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = att.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
        return;
      }
      setUrl(objectUrl);
    } catch {
      setError('Không tải được file.');
    } finally {
      setBusy(false);
    }
  }

  function close() {
    if (url) URL.revokeObjectURL(url);
    setUrl(null);
  }

  useEffect(() => {
    if (!url) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
    // close() đọc `url` hiện tại — gắn lại mỗi khi url đổi là đủ.
  }, [url]);

  return (
    <>
      <button
        type="button"
        onClick={open}
        title={error ?? (previewable(att) ? 'Xem file' : 'Tải xuống')}
        className={cn(
          'inline-flex max-w-[260px] items-center gap-2 rounded-lg border bg-white px-2.5 py-1.5',
          previewable(att) ? 'cursor-zoom-in' : 'cursor-pointer',
          'text-left text-[0.8rem] text-ink transition-colors hover:border-primary-line',
          error ? 'border-danger-line' : 'border-line',
        )}
      >
        {busy ? (
          <Loader2 size={14} className="shrink-0 animate-spin text-muted" />
        ) : att.is_pdf ? (
          <FileText size={14} className="shrink-0 text-danger-text" />
        ) : att.mime_type.startsWith('image/') ? (
          <ImageIcon size={14} className="shrink-0 text-primary" />
        ) : isSpreadsheet(att) ? (
          <FileSpreadsheet size={14} className="shrink-0 text-success-text" />
        ) : (
          <File size={14} className="shrink-0 text-primary" />
        )}
        <span className="truncate">{att.name}</span>
        <span className="shrink-0 text-[0.72rem] text-muted">{formatSize(att.size)}</span>
        {!previewable(att) && !busy && <Download size={13} className="shrink-0 text-muted" />}
      </button>

      {url && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 p-3 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label={att.name}
          onClick={close}
        >
          <div
            className="flex h-full max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-line bg-white shadow-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{att.name}</span>
              <a href={url} download={att.name} className={ui.btnSecondary}>
                <Download size={14} />
                Tải xuống
              </a>
              <button
                type="button"
                onClick={close}
                className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-ink"
                aria-label="Đóng"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-100">
              {att.is_pdf ? (
                <iframe src={url} title={att.name} className="h-full w-full border-0 bg-white" />
              ) : (
                <img src={url} alt={att.name} className="max-h-full max-w-full object-contain" />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
