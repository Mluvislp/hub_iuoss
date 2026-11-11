'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'react-qr-code';
import { AlertCircle, Check, CheckCircle2, Copy, Eye, FileText, Loader2, ReceiptText, RefreshCw, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { buildVietQrPayload } from '@/lib/vietqr';
import { GradError, checkReceipt, formatMB, gradApi, type GradDeposit, type GradMember } from '@/lib/graduation';
import { g } from './styles';

// Tiền thế chân lễ phục: chuyển khoản vào tài khoản Phòng KHTC (số tiền theo nhóm, nội dung theo cú pháp KHTC —
// máy chủ tính, core/graduation.py::deposit_payload) rồi tải minh chứng. Bắt buộc khi đăng ký mới; người đã đăng
// ký trước khi có mục này nộp bổ sung ở DepositCard.

const vnd = (n: number) => new Intl.NumberFormat('vi-VN').format(n);
const dmy = (iso: string) => iso.split('-').reverse().join('/');
const dt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' }) : '';

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch { /* trình duyệt chặn clipboard — bôi đen chép tay */ }
      }}
      className="inline-flex items-center gap-1 text-xs font-medium text-[#a07d1c] hover:underline"
    >
      {done ? <><Check size={12} /> Đã chép</> : <><Copy size={12} /> Chép</>}
    </button>
  );
}

/** QR VietQR + thông tin chuyển khoản. */
export function DepositInfo({ deposit }: { deposit: GradDeposit }) {
  const qr = useMemo(() => deposit.amount
    ? buildVietQrPayload({ bin: deposit.bank_bin, accountNumber: deposit.account_number, amount: deposit.amount,
                           addInfo: deposit.reference })
    : null, [deposit]);

  if (!deposit.amount) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-900">
        Chưa có mức tiền thế chân cho nhóm này — vui lòng liên hệ Phòng Công tác Sinh viên.
      </div>
    );
  }
  const rows: Array<[string, React.ReactNode, string?]> = [
    ['Ngân hàng', deposit.bank_name],
    ['Số tài khoản', <span key="a" className="font-mono tracking-wide">{deposit.account_number}</span>, deposit.account_number],
    ['Chủ tài khoản', deposit.account_name],
    ['Nội dung', <span key="r" className="break-words">{deposit.reference}</span>, deposit.reference],
  ];
  return (
    <div className="flex flex-col items-center gap-5 rounded-xl border border-line bg-[#fbfcfe] p-4 sm:p-5 md:flex-row md:items-start">
      <div className="shrink-0 text-center">
        {qr ? (
          <div className="rounded-lg border border-line bg-white p-3">
            <QRCode value={qr} size={148} level="M" style={{ height: 148, width: 148 }} />
          </div>
        ) : null}
        <p className="mt-2 text-xs text-muted">Quét bằng app ngân hàng bất kỳ</p>
      </div>
      <div className="w-full min-w-0 flex-1">
        <div className="text-xs font-medium uppercase tracking-wider text-slate-400">Số tiền</div>
        <div className="font-display text-[1.9rem] font-semibold leading-tight text-[#0f2a5c]">{vnd(deposit.amount)} đ</div>
        <dl className="mt-3 space-y-1.5 text-sm">
          {rows.map(([k, v, copy]) => (
            <div key={k} className="flex flex-wrap gap-x-2">
              <dt className="w-28 shrink-0 text-muted">{k}</dt>
              <dd className="min-w-0 flex-1 font-semibold text-ink">
                {v} {copy && <span className="ml-1 whitespace-nowrap"><CopyButton text={copy} /></span>}
              </dd>
            </div>
          ))}
        </dl>
        <p className={cn('mt-3 text-xs', deposit.overdue ? 'font-semibold text-rose-700' : 'text-muted')}>
          {deposit.overdue
            ? `Đã quá hạn đóng tiền thế chân (${dmy(deposit.deadline)}). Chưa chuyển khoản thì liên hệ Phòng Công tác Sinh viên.`
            : `Hạn cuối: hết ngày ${dmy(deposit.deadline)}. Mã QR đã gồm sẵn số tài khoản, số tiền và nội dung — giữ nguyên nội dung để Phòng KHTC đối chiếu.`}
        </p>
      </div>
    </div>
  );
}

/** Ô chọn file minh chứng (ảnh / PDF) — kiểm sớm ở trình duyệt, máy chủ kiểm lại. */
export function ReceiptPicker({ file, onFile, disabled, compact }: {
  file: File | null; onFile: (f: File | null) => void; disabled?: boolean; compact?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [preview, setPreview] = useState('');
  const isPdf = !!file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name));

  useEffect(() => {
    if (!file || isPdf) { setPreview(''); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file, isPdf]);

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    e.target.value = '';
    setError('');
    if (!f) return;
    setChecking(true);
    const problem = await checkReceipt(f);
    setChecking(false);
    if (problem) { setError(problem); onFile(null); return; }
    onFile(f);
  }

  return (
    <div className="space-y-2">
      <input ref={input} type="file" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" className="hidden" onChange={pick} />
      {file ? (
        <div className="flex items-center gap-3.5 rounded-xl border border-emerald-200 bg-emerald-50/40 p-3">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Minh chứng xem trước" className="h-16 w-12 shrink-0 rounded border border-white object-cover shadow-sm" />
          ) : (
            <span className="flex h-16 w-12 shrink-0 items-center justify-center rounded border border-emerald-200 bg-white text-emerald-600"><FileText size={20} /></span>
          )}
          <div className="min-w-0 flex-1 text-sm">
            <div className="flex items-center gap-1.5 font-semibold text-emerald-700"><CheckCircle2 size={15} /> Đã chọn minh chứng</div>
            <div className="truncate text-muted">{file.name} · {formatMB(file.size)}</div>
          </div>
          <button type="button" className={g.btnGhost} onClick={() => input.current?.click()} disabled={disabled}>
            <RefreshCw size={14} /> Đổi
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={disabled || checking}
          className={cn(
            'group w-full rounded-xl border-2 border-dashed border-slate-300 bg-[#fbfcfe] px-5 text-center transition-colors',
            'hover:border-[#d4a72c] hover:bg-[#fffbf0] disabled:opacity-60',
            'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#d4a72c]/25',
            compact ? 'py-5' : 'py-7',
          )}
        >
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full border border-[#ecd9a0] bg-[#fdf6e3] text-[#a07d1c]">
            {checking ? <Loader2 size={20} className="animate-spin" /> : <Upload size={20} />}
          </span>
          <div className="mt-3 font-semibold text-ink">{checking ? 'Đang kiểm tra…' : 'Bấm để chọn minh chứng chuyển khoản'}</div>
          <div className="mt-0.5 text-sm text-muted">Ảnh chụp màn hình / biên lai · JPG, PNG hoặc PDF · tối đa 10 MB</div>
        </button>
      )}
      {error && (
        <p role="alert" className="flex items-start gap-1.5 text-sm text-danger-text"><AlertCircle size={15} className="mt-0.5 shrink-0" />{error}</p>
      )}
    </div>
  );
}

async function openReceipt() {
  const tab = window.open('', '_blank');
  try {
    const url = URL.createObjectURL(await gradApi.receiptBlob());
    if (tab) tab.location.href = url; else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch {
    tab?.close();
  }
}

/** Sau khi đăng ký: thông tin chuyển khoản + trạng thái minh chứng, nộp / thay minh chứng. */
export function DepositCard({ member, onChange }: { member: GradMember; onChange: (m: GradMember) => void }) {
  const d = member.deposit;
  const [file, setFile] = useState<File | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [showInfo, setShowInfo] = useState(!d.has_receipt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function upload() {
    if (!file) { setError('Vui lòng chọn file minh chứng.'); return; }
    setBusy(true); setError('');
    try {
      onChange(await gradApi.replaceReceipt(file));
      setFile(null); setReplacing(false); setShowInfo(false);
    } catch (err) {
      setError(err instanceof GradError ? err.message : 'Không gửi được minh chứng. Vui lòng thử lại.');
    } finally { setBusy(false); }
  }

  const picking = d.can_upload && (!d.has_receipt || replacing);
  return (
    <div className={cn(g.card, 'p-6', !d.has_receipt && 'border-amber-300')}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className={g.eyebrow}>Tiền thế chân lễ phục</p>
          <h4 className="mt-1 font-semibold text-ink">Chuyển khoản &amp; minh chứng</h4>
        </div>
        {d.has_receipt ? (
          <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">Đã nộp minh chứng</span>
        ) : (
          <span className="rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700">Chưa nộp minh chứng</span>
        )}
      </div>

      {!d.has_receipt && (
        <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-900">
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-amber-600" />
          <span>Minh chứng đã chuyển khoản tiền thế chân là <b>bắt buộc</b>. {d.can_upload
            ? 'Chuyển khoản theo thông tin dưới đây rồi tải minh chứng lên.'
            : 'Liên hệ Phòng Công tác Sinh viên.'}</span>
        </div>
      )}

      {d.has_receipt && (
        <div className="mt-4 flex flex-wrap items-center gap-3.5 rounded-xl border border-line bg-[#fbfcfe] p-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#fdf6e3] text-[#a07d1c]"><ReceiptText size={18} /></span>
          <div className="min-w-0 flex-1 text-sm">
            <div className="font-semibold text-ink">{d.amount ? `${vnd(d.amount)} đ · ` : ''}minh chứng {d.receipt_is_pdf ? 'PDF' : 'ảnh'}</div>
            <div className="text-muted">Nộp lúc {dt(d.receipt_uploaded_at)}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={g.btnOutline} onClick={openReceipt}><Eye size={15} /> Xem</button>
            {d.can_upload && !replacing && (
              <button type="button" className={g.btnGhost} onClick={() => setReplacing(true)}><RefreshCw size={14} /> Thay minh chứng</button>
            )}
          </div>
        </div>
      )}

      {d.has_receipt && !showInfo && (
        <button type="button" onClick={() => setShowInfo(true)} className="mt-3 text-sm font-medium text-[#a07d1c] hover:underline">
          Xem lại thông tin chuyển khoản
        </button>
      )}
      {showInfo && <div className="mt-4"><DepositInfo deposit={d} /></div>}

      {picking && (
        <div className="mt-4 space-y-3">
          <ReceiptPicker file={file} onFile={setFile} disabled={busy} compact />
          {error && <p role="alert" className="text-sm text-danger-text">{error}</p>}
          <div className="flex justify-end gap-2">
            {replacing && (
              <button type="button" className={g.btnGhost} disabled={busy}
                      onClick={() => { setReplacing(false); setFile(null); setError(''); }}>Thôi</button>
            )}
            <button type="button" className={cn(g.btnPrimary, 'h-11')} onClick={upload} disabled={busy || !file}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} Gửi minh chứng
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
