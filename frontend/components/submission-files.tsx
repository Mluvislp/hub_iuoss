'use client';

/**
 * File của "Nạp giấy tờ trực tiếp": khung kéo-thả chọn ảnh / PDF (tối đa 10) và lưới file đã nạp.
 * Kiểm ở đây chỉ để báo sớm — backend (core/direct_submissions.py) kiểm lại bằng nội dung thật.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft, ChevronRight, Download, FileText, ImageIcon, Loader2, RotateCw, Trash2, Undo2, UploadCloud, X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ui } from '@/lib/ui';
import type { SubmissionFile, SubmissionLimits } from '@/lib/types';

const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif';

export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

function isAllowed(file: File): boolean {
  return isPdf(file) || file.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name);
}

/** Ảnh trình duyệt tự vẽ được (HEIC thì không — chỉ hiện biểu tượng, server sẽ đổi sang JPEG). */
function canPreview(file: File): boolean {
  return /^image\/(jpeg|png|webp|gif)$/.test(file.type);
}

/** Thumbnail cho file vừa chọn — object URL, thu hồi khi bỏ khỏi danh sách. */
function LocalThumb({ file }: { file: File }) {
  const url = useMemo(() => (canPreview(file) ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  if (url) return <img src={url} alt="" className="h-full w-full object-cover" />;
  return isPdf(file)
    ? <FileText size={26} className="text-danger-text" />
    : <ImageIcon size={26} className="text-primary" />;
}

/**
 * Khung chọn file: bấm hoặc kéo-thả. `existing` = số file đang giữ (khi sửa yêu cầu) để tính
 * tổng số / dung lượng đúng như backend.
 */
export function SubmissionUploader({
  files, onChange, limits, existingCount = 0, existingBytes = 0, error, disabled,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  limits: SubmissionLimits;
  existingCount?: number;
  existingBytes?: number;
  error?: string;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  const [drag, setDrag] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const total = existingCount + files.length;
  const bytes = existingBytes + files.reduce((s, f) => s + f.size, 0);
  const full = total >= limits.max_files;

  function add(list: FileList | File[] | null) {
    if (!list) return;
    const next = [...files];
    let err: string | null = null;
    let size = bytes;
    for (const file of Array.from(list)) {
      if (existingCount + next.length >= limits.max_files) { err = `Chỉ tải lên tối đa ${limits.max_files} file.`; break; }
      if (!isAllowed(file)) { err = `“${file.name}” không phải ảnh hoặc PDF.`; continue; }
      const max = isPdf(file) ? limits.pdf_max_bytes : limits.image_max_bytes;
      if (file.size > max) { err = `“${file.name}” vượt ${formatSize(max)}.`; continue; }
      if (size + file.size > limits.total_max_bytes) { err = `Tổng dung lượng vượt ${formatSize(limits.total_max_bytes)}.`; break; }
      if (next.some((f) => f.name === file.name && f.size === file.size)) continue;   // chọn trùng
      size += file.size;
      next.push(file);
    }
    setLocalError(err);
    onChange(next);
    if (input.current) input.current.value = '';
  }

  const shownError = localError || error;

  return (
    <div>
      <button
        type="button"
        disabled={disabled || full}
        onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); if (!disabled && !full) setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); if (!disabled && !full) add(e.dataTransfer.files); }}
        className={cn(
          'flex w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-4 py-6 text-center transition-colors',
          drag ? 'border-primary bg-primary-soft' : shownError ? 'border-danger-line bg-white' : 'border-slate-300 bg-[#f8fafc] hover:border-primary-line hover:bg-white',
          'disabled:cursor-not-allowed disabled:opacity-60',
        )}
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-white">
          <UploadCloud size={19} className="text-primary" />
        </span>
        <span className="text-sm font-medium text-ink">
          {full ? `Đã đủ ${limits.max_files} file` : 'Bấm để chọn hoặc kéo thả ảnh / PDF vào đây'}
        </span>
        <span className="text-[0.78rem] text-muted">
          Ảnh JPG, PNG, HEIC (≤ {formatSize(limits.image_max_bytes)}) hoặc PDF (≤ {formatSize(limits.pdf_max_bytes)}) ·
          tối đa {limits.max_files} file, tổng ≤ {formatSize(limits.total_max_bytes)}
        </span>
      </button>
      <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={(e) => add(e.target.files)} />

      <div className="mt-2 flex items-center justify-between text-[0.78rem] text-muted">
        <span>{total}/{limits.max_files} file · {formatSize(bytes)}</span>
        {files.length > 0 && !disabled && (
          <button type="button" onClick={() => { onChange([]); setLocalError(null); }} className="font-medium hover:text-ink">
            Bỏ hết file mới chọn
          </button>
        )}
      </div>
      {shownError && <p className="mt-1 text-[0.8rem] text-danger-text">{shownError}</p>}

      {files.length > 0 && (
        <ul className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4">
          {files.map((f, i) => (
            <li key={`${f.name}-${f.size}-${i}`} className="group relative overflow-hidden rounded-lg border border-line bg-white">
              <div className="flex aspect-[4/3] items-center justify-center bg-slate-50">
                <LocalThumb file={f} />
              </div>
              <div className="border-t border-line2 px-2 py-1.5">
                <p className="truncate text-[0.76rem] font-medium text-ink" title={f.name}>{f.name}</p>
                <p className="text-[0.7rem] text-muted">{formatSize(f.size)}</p>
              </div>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => onChange(files.filter((_, j) => j !== i))}
                  className="absolute right-1.5 top-1.5 rounded-md border border-line bg-white/95 p-1 text-slate-500 shadow-sm hover:text-danger-text"
                  aria-label={`Bỏ ${f.name}`}
                >
                  <X size={14} />
                </button>
              )}
              <span className="absolute left-1.5 top-1.5 rounded bg-slate-900/70 px-1.5 text-[0.68rem] font-semibold text-white">
                Mới
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Blob URL của một file đã nạp (cần token). Cache theo id trong suốt vòng đời trang. */
function useFileUrl(submissionId: number, file: SubmissionFile, enabled: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let made: string | null = null;
    api.submissions.file(submissionId, file.id)
      .then((blob) => {
        if (!alive) return;
        made = URL.createObjectURL(new Blob([blob], { type: file.mime_type }));
        setUrl(made);
      })
      .catch(() => alive && setFailed(true));
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [submissionId, file.id, file.mime_type, enabled]);
  return { url, failed };
}

function RemoteThumb({ submissionId, file }: { submissionId: number; file: SubmissionFile }) {
  const { url, failed } = useFileUrl(submissionId, file, !file.is_pdf);
  if (file.is_pdf) return <FileText size={26} className="text-danger-text" />;
  if (failed) return <ImageIcon size={26} className="text-slate-400" />;
  if (!url) return <Loader2 size={18} className="animate-spin text-muted" />;
  return <img src={url} alt="" className="h-full w-full object-cover" />;
}

/**
 * Lưới file đã nạp. Bấm để xem ngay trên trang (ảnh / PDF), chuyển trước-sau.
 * `removable` (khi sửa yêu cầu): mỗi ô có nút gỡ / hoàn tác, `removed` là tập id đang đánh dấu gỡ.
 */
export function SubmissionFileGrid({
  submissionId, files, removable = false, removed, onToggleRemove,
}: {
  submissionId: number;
  files: SubmissionFile[];
  removable?: boolean;
  removed?: Set<number>;
  onToggleRemove?: (id: number) => void;
}) {
  const [open, setOpen] = useState<number | null>(null);
  if (!files.length) return <p className="text-sm text-muted">Không có file nào.</p>;
  return (
    <>
      <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4">
        {files.map((f, i) => {
          const gone = removed?.has(f.id);
          return (
            <li key={f.id} className={cn('relative overflow-hidden rounded-lg border bg-white', gone ? 'border-danger-line' : 'border-line')}>
              <button
                type="button"
                onClick={() => setOpen(i)}
                className={cn('block w-full text-left', gone && 'opacity-40')}
                title={f.name}
              >
                <div className="flex aspect-[4/3] items-center justify-center bg-slate-50">
                  <RemoteThumb submissionId={submissionId} file={f} />
                </div>
                <div className="border-t border-line2 px-2 py-1.5">
                  <p className={cn('truncate text-[0.76rem] font-medium text-ink', gone && 'line-through')}>{f.name}</p>
                  <p className="text-[0.7rem] text-muted">{formatSize(f.size)}</p>
                </div>
              </button>
              <span className="absolute left-1.5 top-1.5 rounded bg-slate-900/70 px-1.5 text-[0.68rem] font-semibold text-white">{i + 1}</span>
              {removable && onToggleRemove && (
                <button
                  type="button"
                  onClick={() => onToggleRemove(f.id)}
                  className={cn(
                    'absolute right-1.5 top-1.5 inline-flex items-center gap-1 rounded-md border bg-white/95 px-1.5 py-0.5 text-[0.7rem] font-medium shadow-sm',
                    gone ? 'border-line text-ink' : 'border-line text-slate-500 hover:text-danger-text',
                  )}
                >
                  {gone ? <><Undo2 size={12} /> Giữ lại</> : <><Trash2 size={12} /> Gỡ</>}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {open !== null && (
        <FileViewer submissionId={submissionId} files={files} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />
      )}
    </>
  );
}

function FileViewer({ submissionId, files, index, onIndex, onClose }: {
  submissionId: number; files: SubmissionFile[]; index: number;
  onIndex: (i: number) => void; onClose: () => void;
}) {
  const file = files[index];
  const { url, failed } = useFileUrl(submissionId, file, true);
  const [rot, setRot] = useState(0);
  const many = files.length > 1;
  const go = (d: number) => { setRot(0); onIndex((index + d + files.length) % files.length); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && many) go(-1);
      if (e.key === 'ArrowRight' && many) go(1);
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, many]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/70 p-3 sm:p-6" role="dialog" aria-modal="true"
         aria-label={file.name} onClick={onClose}>
      <div className="flex h-full max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-line bg-white shadow-card"
           onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{file.name}</span>
          {many && <span className="text-[0.78rem] text-muted">{index + 1}/{files.length}</span>}
          {!file.is_pdf && (
            <button type="button" onClick={() => setRot((r) => (r + 90) % 360)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-ink" aria-label="Xoay ảnh">
              <RotateCw size={16} />
            </button>
          )}
          {url && (
            <a href={url} download={file.name} className={ui.btnSecondary}><Download size={14} /> Tải xuống</a>
          )}
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-ink" aria-label="Đóng">
            <X size={18} />
          </button>
        </div>
        <div className="relative flex min-h-0 flex-1 items-center justify-center bg-slate-800">
          {failed ? (
            <p className="text-sm text-white/80">Không tải được file.</p>
          ) : !url ? (
            <Loader2 size={22} className="animate-spin text-white/80" />
          ) : file.is_pdf ? (
            <iframe src={url} title={file.name} className="h-full w-full border-0 bg-white" />
          ) : (
            <img src={url} alt={file.name} style={{ transform: `rotate(${rot}deg)` }}
                 className="max-h-full max-w-full object-contain transition-transform" />
          )}
          {many && (
            <>
              <button type="button" onClick={() => go(-1)} aria-label="File trước"
                      className="absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-ink shadow hover:bg-white">
                <ChevronLeft size={20} />
              </button>
              <button type="button" onClick={() => go(1)} aria-label="File sau"
                      className="absolute right-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-ink shadow hover:bg-white">
                <ChevronRight size={20} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
