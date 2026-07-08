'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronRight, ArrowRight, Check, AlertCircle, Loader2, Info, FileText } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ui } from '@/lib/ui';
import { REQUEST_TYPE_LABELS, type RequestType } from '@/lib/types';

const REQUEST_TYPES = Object.entries(REQUEST_TYPE_LABELS) as [RequestType, string][];

const TYPE_HINTS: Record<RequestType, string> = {
  enrollment: 'Xác nhận sinh viên đang theo học tại trường.',
  graduation: 'Xác nhận đã hoàn thành chương trình / tốt nghiệp.',
  deferment: 'Xác nhận để làm thủ tục tạm hoãn nghĩa vụ quân sự.',
  other: 'Các mục đích khác (du học, vay vốn, xin việc, visa…).',
};

export default function NewRequestPage() {
  const router = useRouter();

  const [requestType, setRequestType] = useState<RequestType | ''>('');
  const [purpose, setPurpose] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  // Loại giấy có biểu mẫu chi tiết riêng (prefill từ hồ sơ) → điều hướng sang trang riêng.
  const DEDICATED_FORMS: Partial<Record<RequestType, string>> = {
    other: '/dashboard/requests/other',
    deferment: '/dashboard/requests/deferment',
  };
  const dedicatedHref = requestType ? DEDICATED_FORMS[requestType] : undefined;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!requestType) { setError('Vui lòng chọn loại giấy tờ.'); return; }
    if (!purpose.trim()) { setError('Vui lòng nhập mục đích yêu cầu.'); return; }
    setError('');
    setLoading(true);
    try {
      await api.requests.create({
        request_type: requestType,
        purpose: purpose.trim(),
        note: note.trim() || undefined,
      });
      setSuccess(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gửi yêu cầu thất bại. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  }

  // ── Success ───────────────────────────────────────────────
  if (success) {
    return (
      <div className="max-w-[720px]">
        <div className={cn(ui.card, 'p-8 text-center')}>
          <div className="w-11 h-11 rounded-full bg-green-50 border border-green-200
                          flex items-center justify-center mx-auto mb-4">
            <Check size={22} className="text-green-700" />
          </div>
          <h2 className="text-lg font-semibold text-ink">Đã gửi yêu cầu</h2>
          <p className="text-sm text-muted mt-2 leading-relaxed">
            Phòng CTSV sẽ phản hồi trong thời gian sớm nhất. Bạn có thể theo dõi trạng thái
            xử lý tại Bảng thông tin.
          </p>
          <div className="flex gap-3 justify-center mt-6">
            <Link href="/dashboard" className={ui.btnOutline}>Về Bảng thông tin</Link>
            <button
              onClick={() => { setSuccess(false); setRequestType(''); setPurpose(''); setNote(''); }}
              className={ui.btnPrimary}
            >
              Tạo yêu cầu khác
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Form ──────────────────────────────────────────────────
  return (
    <div className="max-w-[720px] space-y-4">

      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-[0.82rem] text-muted">
        <Link href="/dashboard" className="hover:text-ink">Bảng thông tin</Link>
        <ChevronRight size={14} className="text-slate-400" />
        <span className="text-ink font-medium">Yêu cầu giấy tờ</span>
      </nav>

      <div className={cn(ui.card, 'border-t-2 border-t-primary')}>
        {/* Header */}
        <div className="px-6 py-5 border-b border-line">
          <h1 className="flex items-center gap-2 text-[1.05rem] font-semibold text-ink">
            <FileText size={17} className="text-primary" />
            Tạo yêu cầu giấy tờ
          </h1>
          <p className="text-sm text-muted mt-1">
            Chọn loại giấy tờ và nêu rõ mục đích. Phòng CTSV sẽ xử lý và phản hồi trên hệ thống.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-6">
          {error && (
            <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-lg
                            bg-red-50 border border-red-200 text-red-800 text-sm">
              <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          {/* Loại giấy tờ — tiles */}
          <div>
            <label className={ui.fieldLabel}>
              Loại giấy tờ <span className="text-red-500">*</span>
            </label>
            <div className="grid sm:grid-cols-2 gap-2.5">
              {REQUEST_TYPES.map(([value, label]) => {
                const selected = requestType === value;
                return (
                  <label
                    key={value}
                    className={cn(
                      'flex items-start gap-3 p-3.5 rounded-lg border cursor-pointer transition-colors',
                      selected
                        ? 'border-primary bg-primary-soft ring-1 ring-primary-line'
                        : 'border-line hover:border-slate-300 hover:bg-slate-50',
                    )}
                  >
                    <input
                      type="radio"
                      name="request_type"
                      value={value}
                      checked={selected}
                      onChange={() => { setRequestType(value); setPurpose(''); setError(''); }}
                      className="mt-0.5 accent-primary"
                    />
                    <span>
                      <span className={cn('block text-sm font-medium', selected ? 'text-primary' : 'text-ink')}>
                        {label}
                      </span>
                      <span className="block text-[0.8rem] text-muted mt-0.5">{TYPE_HINTS[value]}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {dedicatedHref ? (
            /* Loại giấy có biểu mẫu chi tiết → điều hướng sang trang riêng */
            <div className="flex items-start gap-3 px-4 py-3.5 rounded-lg bg-primary-soft border border-primary-line">
              <Info size={16} className="text-primary flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-ink">
                  Loại giấy này cần thêm thông tin từ hồ sơ của bạn để lập giấy chính xác.
                </p>
                <Link
                  href={dedicatedHref}
                  className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:text-primary-hover"
                >
                  Tiếp tục điền biểu mẫu
                  <ArrowRight size={15} />
                </Link>
              </div>
            </div>
          ) : (
            <>
              {/* Mục đích */}
              <div>
                <label className={ui.fieldLabel}>
                  Mục đích <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  placeholder="Ví dụ: Bổ sung hồ sơ du học, xác nhận đang học…"
                  maxLength={255}
                  className={ui.input}
                />
                <p className="mt-1 text-[0.75rem] text-muted text-right">{purpose.length}/255</p>
              </div>

              {/* Ghi chú */}
              <div>
                <label className={ui.fieldLabel}>
                  Ghi chú thêm <span className="text-muted font-normal">(không bắt buộc)</span>
                </label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  maxLength={1000}
                  placeholder="Số bản in, ngôn ngữ, yêu cầu đặc biệt…"
                  className={ui.textarea}
                />
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-line -mx-6 px-6 -mb-5 pb-5">
                <Link href="/dashboard" className={ui.btnGhost}>Hủy</Link>
                <button type="submit" disabled={loading} className={ui.btnPrimary}>
                  {loading && <Loader2 size={15} className="animate-spin" />}
                  {loading ? 'Đang gửi…' : 'Gửi yêu cầu'}
                </button>
              </div>
            </>
          )}
        </form>
      </div>

      {/* Alert note */}
      <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-slate-50 border-l-2 border-primary">
        <Info size={16} className="text-primary flex-shrink-0 mt-0.5" />
        <p className="text-[0.85rem] text-slate-600 leading-relaxed">
          Sau khi gửi, bạn có thể theo dõi trạng thái xử lý tại{' '}
          <Link href="/dashboard" className="font-medium text-primary hover:underline">Bảng thông tin</Link>.
          Thời gian xử lý thông thường: <strong className="text-ink font-medium">1–3 ngày làm việc</strong>.
        </p>
      </div>
    </div>
  );
}
