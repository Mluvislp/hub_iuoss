'use client';

/**
 * Chọn file đính kèm cho ticket (tối đa 2, PDF hoặc ảnh, mỗi file ≤ 5 MB) và hiện
 * file đã gửi. Kiểm ở đây chỉ để báo sớm — backend kiểm lại bằng nội dung thật.
 */

import { useRef, useState } from 'react';
import { FileText, ImageIcon, Loader2, Paperclip, X } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
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

/** File đã gửi: bấm để mở (tải bằng token qua fetch rồi mở blob). */
export function AttachmentChip({ ticketId, att }: { ticketId: number; att: TicketAttachment }) {
  const [busy, setBusy] = useState(false);

  async function open() {
    if (busy) return;
    setBusy(true);
    // Mở tab trước khi await: trình duyệt chặn window.open gọi sau một lời hứa.
    const tab = window.open('', '_blank');
    try {
      const blob = await api.tickets.attachment(ticketId, att.id);
      const url = URL.createObjectURL(blob);
      if (tab) tab.location.href = url;
      else window.location.href = url;
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      tab?.close();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={open}
      className="inline-flex max-w-[260px] items-center gap-2 rounded-lg border border-line bg-white px-2.5 py-1.5
                 text-left text-[0.8rem] text-ink transition-colors hover:border-primary-line"
    >
      {busy ? (
        <Loader2 size={14} className="shrink-0 animate-spin text-muted" />
      ) : att.is_pdf ? (
        <FileText size={14} className="shrink-0 text-danger-text" />
      ) : (
        <ImageIcon size={14} className="shrink-0 text-primary" />
      )}
      <span className="truncate">{att.name}</span>
      <span className="shrink-0 text-[0.72rem] text-muted">{formatSize(att.size)}</span>
    </button>
  );
}
