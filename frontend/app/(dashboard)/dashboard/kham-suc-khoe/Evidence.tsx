'use client';

/* Ảnh minh chứng khám sức khỏe: hướng dẫn tra cứu · chọn ảnh · xem ảnh đã nộp. */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, FileImage, ImagePlus, X } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { HealthCheckResponse } from '@/lib/types';

const GUIDE_APP_URL =
  'https://medinet.hochiminhcity.gov.vn/kham-suc-khoe/so-y-te-tphcm-hay-cai-dat-va-theo-doi-suc-khoe-tron-doi-tren-ung-dung-cong-dan-cmobile16680-75572.aspx';
const GUIDE_VIDEO_URL = 'https://drive.google.com/file/d/15CmO2LdHQ47uKVma65nE_0z0mBJ-3hSb/view';
const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif';
const MAX_BYTES = 5 * 1024 * 1024;

/** Hướng dẫn tra cứu kết quả khám trên ứng dụng Công dân số. */
export function EvidenceGuide() {
  const link = 'inline-flex items-center gap-1 font-medium text-primary-text hover:underline';
  return (
    <div className="rounded-lg border border-line border-l-2 border-l-primary bg-slate-50 px-4 py-3 text-[0.84rem] text-ink space-y-2">
      <p>
        Sinh viên kiểm tra thông tin kết quả khám sức khỏe theo Chương trình khám sức khỏe
        toàn dân của Thành phố trên ứng dụng Công dân số Thành phố theo hướng dẫn của Sở Y tế
        Thành phố Hồ Chí Minh:{' '}
        <a href={GUIDE_APP_URL} target="_blank" rel="noopener noreferrer" className={link}>
          Xem hướng dẫn tại đây <ExternalLink size={12} />
        </a>
      </p>
      <p>
        Đối với sinh viên đã khám nhưng kết quả chưa hiển thị trên ứng dụng Công dân số, sinh
        viên thực hiện cập nhật kết quả đã khám theo video hướng dẫn:{' '}
        <a href={GUIDE_VIDEO_URL} target="_blank" rel="noopener noreferrer" className={link}>
          Xem video hướng dẫn <ExternalLink size={12} />
        </a>
      </p>
    </div>
  );
}

/** Ô chọn ảnh + xem trước. Kiểm dung lượng ở client cho nhanh; định dạng thật do server quyết. */
export function EvidencePicker({
  files, onChange, max, error,
}: { files: File[]; onChange: (f: File[]) => void; max: number; error?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState('');
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  function add(list: FileList | null) {
    if (!list) return;
    setLocalError('');
    const next = [...files];
    for (const f of Array.from(list)) {
      if (f.size > MAX_BYTES) { setLocalError(`“${f.name}” vượt quá 5 MB.`); continue; }
      if (next.length >= max) { setLocalError(`Tối đa ${max} ảnh.`); break; }
      next.push(f);
    }
    onChange(next);
    if (input.current) input.current.value = '';
  }

  return (
    <div>
      <div className="grid grid-cols-3 gap-3">
        {files.map((f, i) => (
          <div key={previews[i]} className="relative rounded-lg border border-line overflow-hidden bg-slate-50 aspect-[3/4]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previews[i]} alt={f.name} className="w-full h-full object-cover" />
            <button type="button" aria-label="Bỏ ảnh"
                    onClick={() => onChange(files.filter((_, j) => j !== i))}
                    className="absolute top-1.5 right-1.5 w-7 h-7 rounded-md bg-white/95 border border-line flex items-center justify-center text-muted hover:text-danger-text">
              <X size={14} />
            </button>
            <div className="absolute bottom-0 inset-x-0 bg-white/95 border-t border-line px-2 py-1 text-[0.7rem] text-muted truncate">
              {f.name}
            </div>
          </div>
        ))}
        {files.length < max && (
          <button type="button" onClick={() => input.current?.click()}
                  className={cn(
                    'flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed aspect-[3/4] text-muted hover:bg-slate-50 hover:text-ink transition-colors',
                    error || localError ? 'border-danger-line' : 'border-slate-300',
                  )}>
            <ImagePlus size={22} />
            <span className="text-[0.8rem] font-medium">Thêm ảnh</span>
            <span className="text-[0.7rem]">{files.length}/{max}</span>
          </button>
        )}
      </div>
      <input ref={input} type="file" accept={ACCEPT} multiple className="hidden"
             onChange={(e) => add(e.target.files)} />
      <p className="mt-2 text-[0.75rem] text-muted">
        Ảnh chụp phiếu kết quả hoặc màn hình kết quả trên ứng dụng Công dân số. JPG, PNG, WebP
        hoặc HEIC; tối đa {max} ảnh, mỗi ảnh không quá 5 MB.
      </p>
      {(error || localError) && (
        <p className="mt-1 text-[0.75rem] text-danger-text">{error || localError}</p>
      )}
    </div>
  );
}

/** Ảnh minh chứng đã nộp — tải qua fetch vì cần token. */
export function EvidenceThumbs({ response }: { response: HealthCheckResponse }) {
  const [urls, setUrls] = useState<(string | null)[]>([]);
  useEffect(() => {
    let alive = true;
    const made: string[] = [];
    Promise.all(response.evidence.map((e) =>
      api.healthCheck.evidence(e.index).then((b) => {
        const u = URL.createObjectURL(b); made.push(u); return u;
      }).catch(() => null),
    )).then((list) => { if (alive) setUrls(list); });
    return () => { alive = false; made.forEach((u) => URL.revokeObjectURL(u)); };
  }, [response.id, response.submit_count, response.evidence]);

  if (!response.evidence.length) return null;
  return (
    <div className="grid grid-cols-3 gap-3">
      {response.evidence.map((e, i) => (
        <a key={e.index} href={urls[i] || undefined} target="_blank" rel="noopener noreferrer"
           className="block rounded-lg border border-line overflow-hidden bg-slate-50 aspect-[3/4]">
          {urls[i] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={urls[i]!} alt={e.name} className="w-full h-full object-cover" />
          ) : (
            <span className="flex h-full items-center justify-center text-slate-400">
              <FileImage size={20} />
            </span>
          )}
        </a>
      ))}
    </div>
  );
}
