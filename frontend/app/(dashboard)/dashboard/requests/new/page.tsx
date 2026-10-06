'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronRight, ArrowRight, Info, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ui } from '@/lib/ui';
import { REQUEST_TYPE_LABELS, type RequestType } from '@/lib/types';
import { useRequestQuota } from '@/components/request-quota';

// Các loại giấy chưa hỗ trợ tạo online (ẩn khỏi danh sách chọn)
const HIDDEN_TYPES: RequestType[] = ['enrollment', 'graduation'];

// Mỗi loại giấy có một biểu mẫu chi tiết riêng (prefill từ hồ sơ).
const DEDICATED_FORMS: Record<string, string> = {
  deferment: '/dashboard/requests/deferment',
  thuong_binh: '/dashboard/requests/thuong-binh',
  bank_loan: '/dashboard/requests/bank-loan',
  english_form: '/dashboard/requests/english',
  conduct_score: '/dashboard/requests/conduct-score',
  other: '/dashboard/requests/other',
};

// Chỉ hiển thị loại đã có biểu mẫu (và không nằm trong danh sách ẩn).
const REQUEST_TYPES = (Object.entries(REQUEST_TYPE_LABELS) as [RequestType, string][])
  .filter(([value]) => !HIDDEN_TYPES.includes(value) && DEDICATED_FORMS[value]);

const TYPE_HINTS: Record<RequestType, string> = {
  enrollment: 'Xác nhận sinh viên đang theo học tại trường.',
  graduation: 'Xác nhận đã hoàn thành chương trình / tốt nghiệp.',
  deferment: 'Xác nhận để làm thủ tục tạm hoãn nghĩa vụ quân sự.',
  thuong_binh: 'Xác nhận để hưởng ưu đãi giáo dục (con thương binh, liệt sĩ…).',
  bank_loan: 'Xác nhận để vay vốn ngân hàng chính sách cho sinh viên.',
  english_form: 'Giấy xác nhận bằng tiếng Anh (du học, xin việc, visa…).',
  conduct_score: 'Bảng điểm rèn luyện theo học kỳ hoặc cả năm học, bản mềm hoặc bản cứng.',
  // Liệt kê theo OTHER_PURPOSE_CHOICES (backend/core/documents.py) — thêm/bớt mục đích thì xem lại câu này.
  other: 'Xác nhận cho vé Metro ưu đãi, xin visa, xin việc, thực tập, du học, thi Tiếng Anh đầu ra, giảm trừ gia cảnh, vay vốn theo nhu cầu, kết nạp Đảng…',
};

export default function NewRequestPage() {
  const [requestType, setRequestType] = useState<RequestType | ''>('');
  // Loại hết lượt trong học kỳ: KHÔNG ẩn — làm mờ, không chọn được, nêu lý do ngay trên ô.
  const quota = useRequestQuota();
  const dedicatedHref = requestType ? DEDICATED_FORMS[requestType] : undefined;
  const selectedLabel = requestType ? REQUEST_TYPE_LABELS[requestType] : '';

  return (
    <div className="max-w-[720px] space-y-4">

      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-meta text-muted">
        <Link href="/dashboard" className="hover:text-ink">Bảng thông tin</Link>
        <ChevronRight size={14} className="text-faint" />
        <span className="text-ink font-medium">Yêu cầu giấy tờ</span>
      </nav>

      <div className={cn(ui.card, 'border-t-2 border-t-primary')}>
        {/* Header */}
        <div className="px-6 py-5 border-b border-line">
          <h1 className="flex items-center gap-2 text-title font-semibold text-ink">
            <FileText size={17} className="text-primary" />
            Tạo yêu cầu giấy tờ
          </h1>
          <p className="text-sm text-muted mt-1">
            Chọn loại giấy tờ cần cấp. Mỗi loại có biểu mẫu riêng để điền thông tin chính xác;
            Phòng CTSV sẽ xử lý và phản hồi trên hệ thống.
          </p>
        </div>

        <div className="px-6 py-5 space-y-6">
          {/* Loại giấy tờ — tiles */}
          <div>
            {/* Tiêu đề của một nhóm radio, không phải label của một ô → p + radiogroup. */}
            <p id="request-type-label" className={ui.fieldLabel}>
              Loại giấy tờ <span className="text-danger-text">*</span>
            </p>
            <div role="radiogroup" aria-labelledby="request-type-label" className="grid sm:grid-cols-2 gap-2.5">
              {REQUEST_TYPES.map(([value, label]) => {
                const selected = requestType === value;
                const lock = quota?.types[value];
                const blocked = !!lock?.blocked;
                return (
                  <label
                    key={value}
                    aria-disabled={blocked}
                    className={cn(
                      'flex items-start gap-3 p-3.5 rounded-lg border transition-colors',
                      blocked
                        ? 'cursor-not-allowed border-line bg-surface-subtle'
                        : selected
                          ? 'cursor-pointer border-primary bg-primary-soft ring-1 ring-primary-line'
                          : 'cursor-pointer border-line hover:border-line-strong hover:bg-surface-subtle',
                    )}
                  >
                    <input
                      type="radio"
                      name="request_type"
                      value={value}
                      checked={selected}
                      disabled={blocked}
                      onChange={() => setRequestType(value)}
                      className="mt-0.5 accent-primary"
                    />
                    <span>
                      <span className={cn('block text-sm font-medium', blocked ? 'text-slate-400' : selected ? 'text-primary' : 'text-ink')}>
                        {label}
                      </span>
                      <span className={cn('block text-meta mt-0.5', blocked ? 'text-faint' : 'text-muted')}>
                        {TYPE_HINTS[value]}
                      </span>
                      {blocked && (
                        <span className="mt-2 block rounded-md border border-warning-line bg-warning-soft px-2.5 py-2 text-xs leading-relaxed text-warning-text">
                          {lock!.reason}
                        </span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* CTA mở biểu mẫu chi tiết của loại đã chọn */}
          {dedicatedHref ? (
            <div className="px-4 py-4 rounded-lg bg-primary-soft border border-primary-line">
              <div className="flex items-start gap-3">
                <Info size={16} className="text-primary flex-shrink-0 mt-0.5" />
                <p className="text-sm text-ink flex-1">
                  Giấy <strong className="font-semibold">“{selectedLabel}”</strong> cần thêm một số thông tin
                  từ hồ sơ (ngày sinh, CCCD, địa chỉ…) để lập giấy chính xác.
                  Nhấn nút bên dưới để mở biểu mẫu và điền thông tin.
                </p>
              </div>
              <Link href={dedicatedHref} className={cn(ui.btnPrimary, 'mt-3.5 w-full justify-center')}>
                Mở biểu mẫu “{selectedLabel}”
                <ArrowRight size={15} />
              </Link>
            </div>
          ) : (
            <p className="text-sm text-muted px-1">
              Chọn một loại giấy tờ ở trên để tiếp tục.
            </p>
          )}
        </div>
      </div>

      {/* Alert note */}
      <div className="flex items-start gap-3 px-4 py-3 rounded-lg border border-line bg-surface-subtle">
        <Info size={16} className="text-primary flex-shrink-0 mt-0.5" />
        <p className="text-sm text-ink-3 leading-relaxed">
          Sau khi gửi biểu mẫu, theo dõi trạng thái xử lý tại{' '}
          <Link href="/dashboard" className="font-medium text-primary hover:underline">Bảng thông tin</Link>.
          Thời gian xử lý: <strong className="text-ink font-medium">2–3 ngày làm việc</strong>.
        </p>
      </div>
    </div>
  );
}
