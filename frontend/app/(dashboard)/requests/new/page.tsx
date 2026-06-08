'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  FileText, ChevronLeft, Loader2, CheckCircle2, AlertCircle,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { REQUEST_TYPE_LABELS, type RequestType } from '@/lib/types';

const REQUEST_TYPES = Object.entries(REQUEST_TYPE_LABELS) as [RequestType, string][];

const PURPOSE_SUGGESTIONS: Record<RequestType, string[]> = {
  enrollment: [
    'Vay vốn ngân hàng chính sách',
    'Xin miễn nghĩa vụ quân sự',
    'Làm thủ tục hành chính',
    'Đăng ký học bổng',
  ],
  graduation: [
    'Xin việc làm',
    'Đăng ký học tiếp',
    'Làm thủ tục hành chính',
  ],
  deferment: [
    'Hoãn nghĩa vụ quân sự do đang học đại học',
  ],
  other: [
    'Làm thủ tục hành chính',
    'Mục đích cá nhân',
  ],
};

export default function NewRequestPage() {
  const router = useRouter();

  const [requestType, setRequestType] = useState<RequestType | ''>('');
  const [purpose, setPurpose] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const suggestions =
    requestType ? (PURPOSE_SUGGESTIONS[requestType] ?? []) : [];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!requestType) { setError('Vui lòng chọn loại giấy xác nhận.'); return; }
    if (!purpose.trim()) { setError('Vui lòng nhập mục đích yêu cầu.'); return; }

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

  // ── Success state ────────────────────────────────────────
  if (success) {
    return (
      <div className="max-w-lg mx-auto mt-10">
        <div className="bg-white rounded-2xl border border-slate-200/80 p-8 text-center
                        shadow-sm">
          <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center
                          mx-auto mb-4 ring-4 ring-emerald-100">
            <CheckCircle2 size={28} className="text-emerald-600" />
          </div>
          <h2 className="text-lg font-bold text-slate-900 mb-2">Gửi yêu cầu thành công!</h2>
          <p className="text-sm text-slate-500 leading-relaxed">
            Phòng CTSV đã nhận được yêu cầu của bạn và sẽ xử lý trong thời gian sớm nhất.
            Bạn có thể theo dõi trạng thái trên trang Dashboard.
          </p>
          <div className="flex gap-3 justify-center mt-6">
            <Link
              href="/dashboard"
              className="px-4 py-2 rounded-lg text-sm font-semibold
                         bg-blue-600 hover:bg-blue-700 text-white transition-colors"
            >
              Về Dashboard
            </Link>
            <button
              onClick={() => {
                setSuccess(false);
                setRequestType('');
                setPurpose('');
                setNote('');
              }}
              className="px-4 py-2 rounded-lg text-sm font-semibold
                         bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
            >
              Tạo yêu cầu mới
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Form ─────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto space-y-4">

      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <Link
          href="/dashboard"
          className="flex items-center gap-1 text-slate-500 hover:text-slate-700 transition-colors"
        >
          <ChevronLeft size={15} />
          Dashboard
        </Link>
        <span className="text-slate-300">/</span>
        <span className="text-slate-700 font-medium">Tạo yêu cầu giấy tờ</span>
      </div>

      {/* Card */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100
                        bg-gradient-to-r from-slate-50 to-white">
          <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center">
            <FileText size={17} className="text-blue-600" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Yêu cầu giấy xác nhận</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Điền đầy đủ thông tin bên dưới. Phòng CTSV sẽ phản hồi sớm nhất.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2.5 p-3.5 rounded-lg
                            bg-red-50 border border-red-200 text-red-700 text-sm">
              <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          {/* Request type */}
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-slate-700">
              Loại giấy xác nhận <span className="text-red-500">*</span>
            </label>
            <div className="grid sm:grid-cols-2 gap-2">
              {REQUEST_TYPES.map(([value, label]) => (
                <label
                  key={value}
                  className={cn(
                    'flex items-center gap-3 p-3.5 rounded-xl border cursor-pointer',
                    'transition-all duration-150',
                    requestType === value
                      ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500/30'
                      : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50',
                  )}
                >
                  <input
                    type="radio"
                    name="request_type"
                    value={value}
                    checked={requestType === value}
                    onChange={() => {
                      setRequestType(value);
                      setPurpose('');
                    }}
                    className="accent-blue-600"
                  />
                  <span className={cn(
                    'text-sm font-medium',
                    requestType === value ? 'text-blue-700' : 'text-slate-700',
                  )}>
                    {label}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Purpose */}
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-slate-700">
              Mục đích <span className="text-red-500">*</span>
            </label>

            {/* Suggestions */}
            {suggestions.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setPurpose(s)}
                    className={cn(
                      'text-xs px-2.5 py-1 rounded-full border transition-colors',
                      purpose === s
                        ? 'border-blue-400 bg-blue-50 text-blue-700'
                        : 'border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700',
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            <input
              type="text"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="Nhập mục đích yêu cầu..."
              maxLength={255}
              className={cn(
                'w-full px-3.5 py-2.5 rounded-lg border text-sm bg-white',
                'text-slate-900 placeholder:text-slate-400',
                'focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500',
                'transition-colors duration-150',
                error && !purpose ? 'border-red-300' : 'border-slate-300 hover:border-slate-400',
              )}
            />
            <p className="text-xs text-slate-400 text-right">{purpose.length}/255</p>
          </div>

          {/* Note */}
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-slate-700">
              Ghi chú thêm{' '}
              <span className="text-slate-400 font-normal">(không bắt buộc)</span>
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Thông tin thêm nếu có (số bản in, yêu cầu đặc biệt...)"
              rows={3}
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300
                         hover:border-slate-400 text-sm bg-white text-slate-900
                         placeholder:text-slate-400 resize-none
                         focus:outline-none focus:ring-2 focus:ring-blue-500/30
                         focus:border-blue-500 transition-colors duration-150"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between gap-3 pt-1">
            <Link
              href="/dashboard"
              className="px-4 py-2.5 rounded-lg text-sm font-semibold
                         text-slate-600 hover:text-slate-800 hover:bg-slate-100
                         transition-colors"
            >
              Huỷ
            </Link>
            <button
              type="submit"
              disabled={loading}
              className={cn(
                'flex items-center gap-2 px-5 py-2.5 rounded-lg',
                'text-sm font-semibold text-white',
                'bg-blue-600 hover:bg-blue-700 active:bg-blue-800',
                'shadow-sm shadow-blue-600/20 transition-all duration-150',
                'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2',
                'disabled:opacity-70 disabled:cursor-not-allowed',
              )}
            >
              {loading ? <Loader2 size={15} className="animate-spin" /> : null}
              {loading ? 'Đang gửi...' : 'Gửi yêu cầu'}
            </button>
          </div>
        </form>
      </div>

      {/* Info note */}
      <div className="flex items-start gap-2.5 p-4 rounded-xl
                      bg-blue-50/70 border border-blue-100 text-blue-700 text-sm">
        <AlertCircle size={15} className="flex-shrink-0 mt-0.5 text-blue-500" />
        <p className="leading-relaxed">
          Sau khi gửi, bạn có thể theo dõi trạng thái yêu cầu trên trang{' '}
          <Link href="/dashboard" className="font-semibold underline underline-offset-2">
            Dashboard
          </Link>
          . Thời gian xử lý thông thường là <strong>1–3 ngày làm việc</strong>.
        </p>
      </div>
    </div>
  );
}
