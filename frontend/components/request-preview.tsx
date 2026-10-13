'use client';

/**
 * Xem trước giấy tờ trước khi gửi (backend core/document_preview.py → Dashboard dựng ảnh).
 *
 * Chống dùng ra ngoài nằm ở ẢNH: Dashboard in cứng dấu chìm "BẢN XEM TRƯỚC — KHÔNG CÓ GIÁ TRỊ
 * SỬ DỤNG" + MSSV + giờ xem, độ phân giải thấp; không có file PDF/DOCX nào tới trình duyệt.
 * Lớp giao diện ở đây chỉ làm khó thêm: ảnh là nền CSS (không có <img> để "Lưu ảnh"), lớp phủ
 * trong suốt, chặn chuột phải / kéo thả / chọn chữ, chặn Ctrl+S / Ctrl+P, ẩn khi in.
 * Chụp màn hình thì không chặn được — ảnh chụp vẫn mang dấu chìm.
 *
 * Cách gắn vào form: nút "Xem trước giấy" là nút submit có `onClick={arm}` ⇒ đi chung đúng phần
 * kiểm tra của handleSubmit; trong handleSubmit gọi `consume()` để biết đang xem trước, dựng body
 * như lúc gửi rồi `show(body)` thay vì gửi.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Eye, Loader2, ShieldAlert, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { ui } from '@/lib/ui';
import { cn } from '@/lib/utils';

export function useDocumentPreview(requestType: string) {
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pages, setPages] = useState<string[]>([]);
  const [error, setError] = useState('');
  const armed = useRef(false);

  useEffect(() => {
    let alive = true;
    api.requests
      .previewStatus()
      .then((d) => alive && setEnabled(d.enabled && d.types.includes(requestType)))
      .catch(() => {
        /* không bật được thì không hiện nút */
      });
    return () => {
      alive = false;
    };
  }, [requestType]);

  const arm = useCallback(() => {
    armed.current = true;
  }, []);

  /** Gọi ĐẦU handleSubmit: true ⇒ lượt submit này là xem trước (đã tự hạ cờ). */
  const consume = useCallback(() => {
    const v = armed.current;
    armed.current = false;
    return v;
  }, []);

  const show = useCallback(
    async (data: Record<string, unknown>) => {
      setOpen(true);
      setLoading(true);
      setPages([]);
      setError('');
      try {
        const res = await api.requests.preview({ request_type: requestType, ...data });
        setPages(res.pages);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Chưa tạo được bản xem trước. Vui lòng thử lại.');
      } finally {
        setLoading(false);
      }
    },
    [requestType],
  );

  const close = useCallback(() => {
    setOpen(false);
    setPages([]);
  }, []);

  const button = enabled ? (
    <button type="submit" onClick={arm} disabled={loading} className={ui.btnGhost}>
      {loading ? <Loader2 size={15} className="animate-spin" /> : <Eye size={15} />}
      Xem trước giấy
    </button>
  ) : null;

  const modal = open ? <PreviewModal loading={loading} pages={pages} error={error} onClose={close} /> : null;

  return { enabled, consume, show, button, modal };
}

function PreviewModal({ loading, pages, error, onClose }: {
  loading: boolean;
  pages: string[];
  error: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      // Lưu trang / in khi đang mở bản xem trước.
      if ((e.ctrlKey || e.metaKey) && ['s', 'p'].includes(e.key.toLowerCase())) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const block = (e: React.SyntheticEvent) => e.preventDefault();

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 print:hidden sm:items-center sm:p-6"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onContextMenu={block}
    >
      <div className="flex max-h-[calc(100dvh-1rem)] w-full min-w-0 flex-col overflow-hidden rounded-t-xl border border-line bg-canvas shadow-card sm:max-h-[calc(100dvh-3rem)] sm:max-w-3xl sm:rounded-lg">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-white px-4 py-3 sm:px-6">
          <h2 className="truncate text-base font-semibold text-ink">Xem trước giấy</h2>
          <button type="button" aria-label="Đóng" className={cn(ui.btnGhost, 'h-9 w-9 shrink-0 px-0')} onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-warning-line bg-warning-soft px-3 py-2.5 text-[0.82rem] text-warning-text">
            <ShieldAlert size={16} className="mt-0.5 shrink-0" />
            <p>
              Bản xem trước chỉ để kiểm tra thông tin trước khi gửi, có dấu chìm và không có giá trị sử dụng.
              Giấy chính thức do Phòng Công tác Sinh viên cấp sau khi xử lý yêu cầu.
            </p>
          </div>
          {loading && (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
              <Loader2 size={16} className="animate-spin" /> Đang tạo bản xem trước…
            </div>
          )}
          {!loading && error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">{error}</p>
          )}
          <div className="select-none space-y-4" onDragStart={block} onCopy={block}>
            {pages.map((b64, i) => (
              <div
                key={i}
                role="img"
                aria-label={`Trang ${i + 1} của bản xem trước`}
                className="relative mx-auto w-full max-w-[640px] border border-line bg-white bg-contain bg-center bg-no-repeat shadow-card"
                style={{ aspectRatio: '210 / 297', backgroundImage: `url(data:image/jpeg;base64,${b64})` }}
              >
                {/* Lớp phủ trong suốt: không có phần tử ảnh nào để bấm "Lưu ảnh" / kéo ra ngoài. */}
                <div className="absolute inset-0" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
