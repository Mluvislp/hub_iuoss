'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle, Camera, Check, CheckCircle2, Clock, ImagePlus, Info, Loader2, RefreshCw, Shirt, Sparkles,
  Trash2, Upload, X, XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  GradError, checkBank, checkPhoto, formatMB, gradApi, storedPhotoName, type BankInput, type GradBank, type GradMember,
} from '@/lib/graduation';
import { BANK_NOTE, BankCard, BankFields, emptyBank } from './bank';
import { g } from './styles';

const dt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' }) : '';

function Alert({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div role="alert" className="flex items-start gap-2.5 p-3 rounded-lg bg-danger-soft border border-danger-line text-danger-text text-sm">
      <AlertCircle size={16} className="shrink-0 mt-0.5" /><span>{message}</span>
    </div>
  );
}

function Callout({ tone = 'gold', icon: Icon = Info, children }: {
  tone?: 'gold' | 'green' | 'slate' | 'amber'; icon?: typeof Info; children: React.ReactNode;
}) {
  const tones = {
    gold: 'border-[#ecd9a0] bg-[#fdf9ec] text-[#5c4510] [&_svg]:text-[#a07d1c]',
    green: 'border-emerald-200 bg-emerald-50/70 text-emerald-900 [&_svg]:text-emerald-600',
    slate: 'border-slate-200 bg-slate-50 text-slate-700 [&_svg]:text-slate-400',
    amber: 'border-amber-200 bg-amber-50/70 text-amber-900 [&_svg]:text-amber-600',
  };
  return (
    <div className={cn('flex items-start gap-3 rounded-lg border px-4 py-3 text-sm leading-relaxed', tones[tone])}>
      <Icon size={17} className="shrink-0 mt-0.5" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

// ── Yêu cầu về ảnh: 3 nhóm ngắn, đọc lướt được ─────────────────────────────────

function Group({ icon: Icon, title, children }: { icon: typeof Info; title: string; children: React.ReactNode }) {
  return (
    <section className="py-4 first:pt-0 last:pb-0">
      <h4 className="flex items-center gap-2 text-sm font-semibold text-ink">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#fdf6e3] text-[#a07d1c]"><Icon size={14} /></span>
        {title}
      </h4>
      <div className="mt-2.5 pl-9 text-[0.86rem] leading-relaxed text-slate-600">{children}</div>
    </section>
  );
}

const Yes = ({ children }: { children: React.ReactNode }) => (
  <li className="flex gap-2"><Check size={15} className="mt-0.5 shrink-0 text-emerald-600" /><span>{children}</span></li>
);

// Quy cách bắt buộc — câu chữ của Phòng CTSV (06/11/2026), giữ nguyên.
const GOWN_RULE = (
  <Callout tone="amber" icon={AlertCircle}>
    <b>Quy cách bắt buộc:</b> Nhà trường chỉ sử dụng ảnh mặc <b>đúng Lễ phục của trường Đại học Quốc tế</b>, đúng loại
    lễ phục của ngành SV/HV tốt nghiệp để trình chiếu trên slide, SV/HV vui lòng up ảnh đúng quy cách.
  </Callout>
);

export function PhotoGuidelines() {
  return (
    <div className="divide-y divide-line2">
      <div className="pb-4">{GOWN_RULE}</div>
      <Group icon={Sparkles} title="Chất lượng ảnh">
        <ul className="space-y-1.5">
          <li>Dung lượng <b className="text-ink">từ 1 MB đến dưới 5 MB</b> — ảnh dưới 1 MB dễ vỡ nét, mờ trên màn hình LED.</li>
          <li>Ảnh rõ nét, không rung mờ.</li>
          <li>Chỉ nhận <b className="text-ink">JPG / JPEG / PNG</b>.</li>
        </ul>
      </Group>
      <Group icon={Camera} title="Bố cục ảnh">
        <ul className="space-y-1.5">
          <Yes>Chân dung <b className="text-ink">1/2 người</b> (từ thắt lưng trở lên).</Yes>
          <Yes>Thấy rõ khuôn mặt, tươi tắn nhưng vẫn trang trọng.</Yes>
        </ul>
        <p className="mt-3 mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">Nhà trường không nhận</p>
        <ul className="flex flex-wrap gap-1.5">
          {['Ảnh selfie', 'Ảnh thẻ', 'Toàn thân (góc quá xa)', 'Filter, tai mèo, sticker…', 'Ảnh không trang trọng',
            'Áo thun không cổ'].map((t) => (
            <li key={t} className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50/60 px-2.5 py-0.5 text-[0.8rem] text-rose-800">
              <X size={12} className="text-rose-500" /> {t}
            </li>
          ))}
        </ul>
      </Group>
      <Group icon={Shirt} title="Trang phục">
        <p>Lịch sự, trang trọng.</p>
        <dl className="mt-2 grid gap-1.5">
          <div className="flex gap-2"><dt className="w-10 shrink-0 font-semibold text-ink">Nam</dt><dd>sơ mi, áo có cổ, blazer hoặc suit.</dd></div>
          <div className="flex gap-2"><dt className="w-10 shrink-0 font-semibold text-ink">Nữ</dt><dd>áo dài, sơ mi, áo có cổ, blazer hoặc suit.</dd></div>
        </dl>
      </Group>
    </div>
  );
}

const SCHOOL_PHOTO_NOTE = (
  <>Đã chụp ảnh tại các buổi chụp do nhà trường tổ chức thì <b>không cần tải lại</b>. Nếu tải lên ảnh khác, nhà
    trường sẽ dùng ảnh tải lên tại đây làm ảnh trình chiếu.</>
);

/** Ô chọn ảnh lớn: kiểm ngay ở trình duyệt (máy chủ kiểm lại), xem trước theo khung chân dung. */
function PhotoPicker({ code, file, onFile, disabled }: {
  code: string; file: File | null; onFile: (f: File | null) => void; disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [preview, setPreview] = useState('');

  useEffect(() => {
    if (!file) { setPreview(''); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    e.target.value = '';
    setError('');
    if (!f) return;
    setChecking(true);
    const problem = await checkPhoto(f);
    setChecking(false);
    if (problem) { setError(problem); onFile(null); return; }
    onFile(f);
  }

  return (
    <div className="space-y-3">
      <input ref={input} type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png" className="hidden" onChange={pick} />
      {file && preview ? (
        <div className="flex flex-col sm:flex-row gap-4 rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Ảnh xem trước" className="mx-auto sm:mx-0 aspect-[4/5] w-40 object-cover rounded-lg border border-white shadow-sm" />
          <div className="min-w-0 flex-1 text-sm">
            <div className="flex items-center gap-1.5 font-semibold text-emerald-700"><CheckCircle2 size={16} /> Ảnh hợp lệ</div>
            <dl className="mt-2 space-y-1 text-slate-600">
              <div className="flex gap-2"><dt className="w-20 shrink-0 text-muted">Dung lượng</dt><dd className="text-ink">{formatMB(file.size)}</dd></div>
              <div className="flex gap-2"><dt className="w-20 shrink-0 text-muted">Lưu thành</dt><dd className="font-mono text-ink">{storedPhotoName(code, file)}</dd></div>
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className={g.btnOutline} onClick={() => input.current?.click()} disabled={disabled}>
                <RefreshCw size={15} /> Chọn ảnh khác
              </button>
              <button type="button" className={g.btnGhost} onClick={() => onFile(null)} disabled={disabled}>Bỏ chọn</button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={disabled || checking}
          className="group w-full rounded-xl border-2 border-dashed border-slate-300 bg-[#fbfcfe] px-6 py-10 text-center transition-colors
                     hover:border-[#d4a72c] hover:bg-[#fffbf0] disabled:opacity-60
                     focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#d4a72c]/25"
        >
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-[#ecd9a0] bg-[#fdf6e3] text-[#a07d1c] transition-transform group-hover:scale-105">
            {checking ? <Loader2 size={24} className="animate-spin" /> : <ImagePlus size={24} />}
          </span>
          <div className="mt-4 font-semibold text-ink">{checking ? 'Đang kiểm tra ảnh…' : 'Bấm để chọn ảnh trình chiếu'}</div>
          <div className="mt-1 text-sm text-muted">JPG / JPEG / PNG · từ 1 MB đến dưới 5 MB</div>
        </button>
      )}
      <Alert message={error} />
    </div>
  );
}

// ── Đăng ký mới ─────────────────────────────────────────────────────────────

export function RegisterForm({ member, banks, onRegistered }: {
  member: GradMember; banks: GradBank[]; onRegistered: (m: GradMember) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [bank, setBank] = useState<BankInput>(() => emptyBank(member));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const reg = member.registration;
  const code = member.student.student_code;

  async function submit() {
    const problem = checkBank(bank);
    if (problem) {
      setError(problem);
      document.getElementById('hoan-coc')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setBusy(true); setError('');
    try { onRegistered(await gradApi.register(file, bank)); } catch (err) {
      setError(err instanceof GradError ? err.message : 'Không đăng ký được. Vui lòng thử lại.');
    } finally { setBusy(false); }
  }

  return (
    <div className={cn(g.card, 'overflow-hidden')}>
      <div className="border-b border-line px-6 py-5 sm:px-8">
        <p className={g.eyebrow}>Bước 3</p>
        <h3 className="mt-1 font-display text-[1.9rem] font-semibold leading-tight text-[#0f2a5c]">Đăng ký tham dự</h3>
        <p className="mt-1 text-sm text-muted">Tải ảnh trình chiếu nếu có, khai tài khoản nhận hoàn tiền cọc, rồi bấm xác nhận để nhận mã QR check-in.</p>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="space-y-5 px-6 py-6 sm:px-8">
          {reg.status === 'cancelled' && (
            <Callout tone="slate">
              Đăng ký trước đó đã được hủy{reg.cancel_reviewed_at ? ` lúc ${dt(reg.cancel_reviewed_at)}` : ''}. Có thể đăng ký lại.
            </Callout>
          )}
          <div>
            <div className="flex items-baseline justify-between gap-3">
              <h4 className="font-semibold text-ink">Ảnh trình chiếu trên màn hình LED</h4>
              <span className="rounded-full border border-slate-200 px-2.5 py-0.5 text-xs font-medium text-muted whitespace-nowrap">Không bắt buộc</span>
            </div>
            <div className="mt-3"><Callout>{SCHOOL_PHOTO_NOTE}</Callout></div>
          </div>
          <PhotoPicker code={code} file={file} onFile={setFile} disabled={busy} />

          <div id="hoan-coc" className="scroll-mt-24 border-t border-line pt-5">
            <div className="flex items-baseline justify-between gap-3">
              <h4 className="font-semibold text-ink">Tài khoản nhận hoàn tiền cọc lễ phục</h4>
              <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-xs font-semibold text-rose-700 whitespace-nowrap">Bắt buộc</span>
            </div>
            <p className="mt-1 mb-4 text-sm text-muted">{BANK_NOTE}</p>
            <BankFields banks={banks} value={bank} onChange={setBank} disabled={busy} />
          </div>

          <Alert message={error} />
          <div className="rounded-xl bg-[#0f2a5c] p-4 sm:p-5 text-white flex flex-col gap-3.5">
            {file && <div className="text-sm text-white/80">Ảnh sẽ được gửi cùng đăng ký.</div>}
            <button type="button" onClick={submit} disabled={busy}
                    className="inline-flex w-full items-center justify-center gap-2 h-12 px-6 rounded-lg bg-[#f5d27a] hover:bg-[#f0c75c]
                               text-[#0f2a5c] font-semibold transition-colors disabled:opacity-60 whitespace-nowrap
                               focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/40">
              {busy ? <Loader2 size={17} className="animate-spin" /> : <CheckCircle2 size={17} />}
              Xác nhận đăng ký tham dự
            </button>
          </div>
        </div>

        <aside className="border-t lg:border-t-0 lg:border-l border-line bg-[#fbfcfe] px-6 py-6 sm:px-8">
          <p className={g.eyebrow}>Yêu cầu về ảnh</p>
          <div className="mt-4"><PhotoGuidelines /></div>
        </aside>
      </div>
    </div>
  );
}

// ── Đã đăng ký: ảnh + hủy ───────────────────────────────────────────────────

function CurrentPhoto({ member, onChange }: { member: GradMember; onChange: (m: GradMember) => void }) {
  const reg = member.registration;
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [showRules, setShowRules] = useState(false);

  useEffect(() => {
    let revoke = '';
    setUrl('');
    if (!reg.has_photo) return;
    gradApi.photoBlob().then((b) => { revoke = URL.createObjectURL(b); setUrl(revoke); }).catch(() => {});
    return () => { if (revoke) URL.revokeObjectURL(revoke); };
  }, [reg.has_photo, reg.photo_uploaded_at]);

  async function upload() {
    if (!file) return;
    setBusy(true); setError('');
    try {
      onChange(await gradApi.replacePhoto(file));
      setFile(null); setReplacing(false);
    } catch (err) {
      setError(err instanceof GradError ? err.message : 'Không tải ảnh lên được.');
    } finally { setBusy(false); }
  }

  async function remove() {
    setBusy(true); setError('');
    try { onChange(await gradApi.removePhoto()); setConfirmRemove(false); } catch (err) {
      setError(err instanceof GradError ? err.message : 'Không gỡ được ảnh.');
    } finally { setBusy(false); }
  }

  const editing = reg.can_edit && (replacing || !reg.has_photo);

  return (
    <div className={cn(g.card, 'p-6')}>
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className={g.eyebrow}>Ảnh trình chiếu</p>
          <h4 className="mt-1 font-semibold text-ink">Màn hình LED tại lễ</h4>
        </div>
        {reg.can_edit && (
          <button type="button" onClick={() => setShowRules((v) => !v)} className="text-sm font-medium text-[#a07d1c] hover:underline">
            {showRules ? 'Ẩn yêu cầu' : 'Xem yêu cầu về ảnh'}
          </button>
        )}
      </div>

      <div className="mt-4 space-y-4">
        {reg.has_photo ? (
          <div className="flex flex-col sm:flex-row gap-5">
            {url
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={url} alt="Ảnh trình chiếu đã tải lên" className="mx-auto sm:mx-0 aspect-[4/5] w-36 object-cover rounded-lg border border-line" />
              : <div className="mx-auto sm:mx-0 aspect-[4/5] w-36 rounded-lg border border-line bg-slate-50 flex items-center justify-center"><Loader2 size={18} className="animate-spin text-slate-400" /></div>}
            <div className="min-w-0 flex-1 text-sm">
              <dl className="space-y-1.5">
                <div className="flex gap-2"><dt className="w-20 shrink-0 text-muted">Tên file</dt><dd className="font-mono text-ink break-all">{reg.photo_name}</dd></div>
                {reg.photo_size ? <div className="flex gap-2"><dt className="w-20 shrink-0 text-muted">Dung lượng</dt><dd className="text-ink">{formatMB(reg.photo_size)}</dd></div> : null}
                <div className="flex gap-2"><dt className="w-20 shrink-0 text-muted">Tải lên</dt><dd className="text-ink">{dt(reg.photo_uploaded_at)}</dd></div>
              </dl>
              {reg.can_edit && !replacing && (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button type="button" className={g.btnOutline} onClick={() => setReplacing(true)} disabled={busy}>
                    <RefreshCw size={15} /> Thay ảnh khác
                  </button>
                  {confirmRemove ? (
                    <span className="inline-flex items-center gap-2 text-sm">
                      Gỡ ảnh này?
                      <button type="button" className={cn(g.btnOutline, 'text-danger-text')} onClick={remove} disabled={busy}>
                        {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Gỡ
                      </button>
                      <button type="button" className={g.btnGhost} onClick={() => setConfirmRemove(false)} disabled={busy}>Thôi</button>
                    </span>
                  ) : (
                    <button type="button" className={cn(g.btnGhost, 'text-danger-text hover:text-danger-text')} onClick={() => setConfirmRemove(true)} disabled={busy}>
                      <Trash2 size={15} /> Gỡ ảnh
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          <Callout tone="slate">Chưa tải ảnh — nhà trường dùng ảnh từ buổi chụp do trường tổ chức (nếu có).</Callout>
        )}

        {editing && (
          <div className="space-y-3">
            <PhotoPicker code={member.student.student_code} file={file} onFile={setFile} disabled={busy} />
            <div className="flex items-center justify-end gap-2">
              {replacing && <button type="button" className={g.btnGhost} onClick={() => { setReplacing(false); setFile(null); }}>Thôi</button>}
              <button type="button" className={cn(g.btnPrimary, 'h-11')} onClick={upload} disabled={!file || busy}>
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                {reg.has_photo ? 'Tải ảnh mới lên' : 'Tải ảnh lên'}
              </button>
            </div>
            {reg.has_photo && <p className="text-xs text-muted text-right">Ảnh mới tải lên thành công sẽ thay ảnh cũ, ảnh cũ bị xóa khỏi hệ thống.</p>}
          </div>
        )}
        <Alert message={error} />
        {showRules && (
          <div className="rounded-xl border border-line bg-[#fbfcfe] p-5">
            <div className="mb-4"><Callout>{SCHOOL_PHOTO_NOTE}</Callout></div>
            <PhotoGuidelines />
          </div>
        )}
      </div>
    </div>
  );
}

function CancelBlock({ member, onChange }: { member: GradMember; onChange: (m: GradMember) => void }) {
  const reg = member.registration;
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (reg.status === 'cancel_requested') {
    return (
      <Callout tone="amber" icon={Clock}>
        <b>Đã gửi yêu cầu hủy đăng ký</b> lúc {dt(reg.cancel_requested_at)} — đang chờ Phòng Công tác Sinh viên duyệt.
        Mã QR vẫn dùng được cho tới khi yêu cầu được duyệt; kết quả được báo qua email.
        {reg.cancel_reason && <div className="mt-1 opacity-80">Lý do: {reg.cancel_reason}</div>}
      </Callout>
    );
  }
  if (!reg.can_edit || reg.checked_in) return null;

  async function submit() {
    setBusy(true); setError('');
    try { onChange(await gradApi.cancel(reason)); setOpen(false); } catch (err) {
      setError(err instanceof GradError ? err.message : 'Không gửi được yêu cầu.');
    } finally { setBusy(false); }
  }

  if (!open) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-slate-300 px-5 py-4">
        <p className="text-sm text-muted">Không thể tham dự? Gửi yêu cầu hủy để Phòng Công tác Sinh viên duyệt.</p>
        <button type="button" className={cn(g.btnOutline, 'text-danger-text')} onClick={() => setOpen(true)}>
          <XCircle size={16} /> Yêu cầu hủy đăng ký
        </button>
      </div>
    );
  }
  return (
    <div className={cn(g.card, 'p-6 space-y-3')}>
      <label htmlFor="cancel-reason" className="block text-sm font-semibold text-ink">Lý do hủy đăng ký</label>
      <textarea id="cancel-reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="Nêu ngắn gọn lý do"
                className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-ink resize-none
                           focus:outline-none focus:border-[#0f2a5c] focus:ring-4 focus:ring-[#0f2a5c]/10" />
      <div className="text-xs text-muted text-right">{reason.length}/500</div>
      <Alert message={error} />
      <div className="flex justify-end gap-2">
        <button type="button" className={g.btnGhost} onClick={() => setOpen(false)} disabled={busy}>Thôi</button>
        <button type="button" onClick={submit} disabled={busy || reason.trim().length < 5}
                className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-lg bg-danger-text hover:bg-[#991b1b] text-white text-sm font-semibold disabled:opacity-60">
          {busy && <Loader2 size={16} className="animate-spin" />} Gửi yêu cầu hủy
        </button>
      </div>
    </div>
  );
}

export function Registered({ member, banks, onChange }: {
  member: GradMember; banks: GradBank[]; onChange: (m: GradMember) => void;
}) {
  const reg = member.registration;
  const rejected = reg.status === 'registered' && reg.cancel_reviewed_at && reg.cancel_review_note;
  return (
    <div className="space-y-4">
      <Callout tone="green" icon={CheckCircle2}>
        <b>Đã đăng ký tham dự</b> lúc {dt(reg.registered_at)}{reg.checked_in ? ' · đã check-in tại lễ' : ''}.
      </Callout>
      {rejected && <Callout tone="slate">Yêu cầu hủy không được chấp thuận: {reg.cancel_review_note}</Callout>}
      {!reg.can_edit && reg.status === 'registered' && !member.round.registration_open && (
        <Callout tone="slate">Đã hết thời gian đăng ký — không đổi ảnh hay gửi yêu cầu hủy được nữa. Mã QR vẫn dùng bình thường.</Callout>
      )}
      <CurrentPhoto member={member} onChange={onChange} />
      <BankCard key={member.bank ? `${member.bank.bank_id}-${member.bank.account_number}` : 'none'}
                member={member} banks={banks} onChange={onChange} />
      <CancelBlock member={member} onChange={onChange} />
    </div>
  );
}
