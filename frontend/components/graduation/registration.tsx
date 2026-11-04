'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle, CheckCircle2, Clock, ImagePlus, Info, Loader2, RefreshCw, Trash2, Upload, XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { notice, noticeIcon, ui } from '@/lib/ui';
import { GradError, checkPhoto, formatMB, gradApi, type GradMember } from '@/lib/graduation';

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

export function PhotoGuidelines({ code }: { code: string }) {
  return (
    <div className="space-y-4 text-sm text-slate-700">
      <div className={cn(notice.base, notice.info)}>
        <Info size={16} className={noticeIcon.info} />
        <p>
          Các sinh viên đã chụp ảnh tại các buổi chụp do nhà trường tổ chức <b>không cần phải tải lại hình ảnh</b>,
          trường hợp nếu như sinh viên tải lên hình ảnh khác thì nhà trường sẽ ghi nhận hình ảnh sinh viên tải lên
          tại đây để sử dụng làm hình ảnh trình chiếu.
        </p>
      </div>
      <div>
        <div className="font-semibold text-ink mb-1">Về chất lượng ảnh</div>
        <ul className="list-disc pl-5 space-y-1">
          <li>Dung lượng ảnh nên từ <b>1MB đến dưới 5MB</b> (lưu ý tránh gửi ảnh dưới 1MB để không bị vỡ nét hay mờ khi trình chiếu trên màn hình LED).</li>
          <li>Ảnh cần đảm bảo độ rõ nét, không bị rung mờ.</li>
          <li>
            Đổi tên file ảnh thành Mã số sinh viên, mã số học viên trước khi gửi — ví dụ <code className="font-mono font-semibold text-primary-text">{code}.jpg</code>.
            Lưu ý vui lòng ghi đúng mã số do IU quản lý, ví dụ hệ UWE là BABAWExxxx, ITITWExxxx. SV/HV lưu ý không được để khoảng trắng sau tên hình.
          </li>
          <li>Hình ảnh chỉ chấp nhận kiểu <b>JPG / JPEG / PNG</b>.</li>
        </ul>
      </div>
      <div>
        <div className="font-semibold text-ink mb-1">Về bố cục ảnh</div>
        <ul className="list-disc pl-5 space-y-1">
          <li>Nhà trường khuyến khích các bạn gửi ảnh chân dung lấy 1/2 người (chụp từ thắt lưng trở lên).</li>
          <li>Ảnh cần thấy rõ khuôn mặt, mang tinh thần tươi tắn nhưng vẫn giữ được nét trang trọng.</li>
          <li>Để đảm bảo sự đồng bộ cho buổi lễ, Nhà trường không nhận ảnh selfie, ảnh thẻ, ảnh chụp toàn thân (góc quá xa), hoặc ảnh đã qua các filter (như tai mèo, sticker…), ảnh không trang trọng, hoặc SV/HV mặc áo thun không cổ.</li>
        </ul>
      </div>
      <div>
        <div className="font-semibold text-ink mb-1">Về trang phục</div>
        <p>Vui lòng chọn trang phục lịch sự, trang trọng (Gợi ý: Các bạn nam có thể mặc áo sơ mi, áo có cổ, blazer hoặc suit. Các bạn nữ có thể chọn áo dài, áo sơ mi, áo có cổ, blazer hoặc suit).</p>
      </div>
    </div>
  );
}

/** Ô chọn ảnh: kiểm ngay phía trình duyệt (máy chủ kiểm lại), xem trước, báo lỗi cụ thể. */
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
    const problem = await checkPhoto(f, code);
    setChecking(false);
    if (problem) { setError(problem); onFile(null); return; }
    onFile(f);
  }

  return (
    <div>
      <input ref={input} type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png" className="hidden" onChange={pick} />
      {file && preview ? (
        <div className="flex gap-4 items-start rounded-lg border border-line p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Ảnh xem trước" className="w-28 h-36 object-cover rounded-md border border-line" />
          <div className="min-w-0 text-sm">
            <div className="font-medium text-ink break-all">{file.name}</div>
            <div className="text-muted">{formatMB(file.size)}</div>
            <div className="flex items-center gap-1 text-success-text mt-1"><CheckCircle2 size={14} /> Ảnh hợp lệ</div>
            <div className="flex gap-2 mt-3">
              <button type="button" className={ui.btnSecondary} onClick={() => input.current?.click()} disabled={disabled}>
                <RefreshCw size={14} /> Chọn ảnh khác
              </button>
              <button type="button" className={ui.btnGhost} onClick={() => onFile(null)} disabled={disabled}>Bỏ chọn</button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={disabled || checking}
          className="w-full rounded-lg border-2 border-dashed border-slate-300 hover:border-primary bg-slate-50/60 hover:bg-primary-soft/40
                     px-4 py-7 text-center transition-colors disabled:opacity-60"
        >
          {checking ? <Loader2 size={22} className="mx-auto animate-spin text-slate-400" /> : <ImagePlus size={22} className="mx-auto text-slate-400" />}
          <div className="mt-2 text-sm font-medium text-ink">{checking ? 'Đang kiểm tra ảnh…' : 'Chọn ảnh trình chiếu'}</div>
          <div className="text-xs text-muted mt-0.5">JPG / JPEG / PNG · 1 MB đến dưới 5 MB · tên file {code}.jpg</div>
        </button>
      )}
      <div className="mt-2"><Alert message={error} /></div>
    </div>
  );
}

function CurrentPhoto({ member, onChange }: { member: GradMember; onChange: (m: GradMember) => void }) {
  const reg = member.registration;
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);

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

  return (
    <div className={ui.card}>
      <div className={ui.cardHeader}><span className={ui.sectionTitle}><ImagePlus size={16} className="text-slate-500" /> Ảnh trình chiếu</span></div>
      <div className="p-5 space-y-4">
        {reg.has_photo ? (
          <div className="flex gap-4 items-start">
            {url
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={url} alt="Ảnh trình chiếu đã tải lên" className="w-32 h-40 object-cover rounded-md border border-line" />
              : <div className="w-32 h-40 rounded-md border border-line bg-slate-50 flex items-center justify-center"><Loader2 size={18} className="animate-spin text-slate-400" /></div>}
            <div className="text-sm min-w-0">
              <div className="font-medium text-ink break-all">{reg.photo_name}</div>
              {reg.photo_size ? <div className="text-muted">{formatMB(reg.photo_size)}</div> : null}
              <div className="text-muted">Tải lên lúc {dt(reg.photo_uploaded_at)}</div>
              {reg.can_edit && !replacing && (
                <div className="flex flex-wrap gap-2 mt-3">
                  <button type="button" className={ui.btnSecondary} onClick={() => setReplacing(true)} disabled={busy}>
                    <RefreshCw size={14} /> Thay ảnh khác
                  </button>
                  {confirmRemove ? (
                    <span className="inline-flex items-center gap-2 text-sm">
                      Gỡ ảnh này?
                      <button type="button" className={cn(ui.btnOutline, 'h-9 text-danger-text')} onClick={remove} disabled={busy}>
                        {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Gỡ
                      </button>
                      <button type="button" className={cn(ui.btnGhost, 'h-9')} onClick={() => setConfirmRemove(false)} disabled={busy}>Thôi</button>
                    </span>
                  ) : (
                    <button type="button" className={cn(ui.btnGhost, 'h-9 text-danger-text hover:text-danger-text')} onClick={() => setConfirmRemove(true)} disabled={busy}>
                      <Trash2 size={14} /> Gỡ ảnh
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">Chưa tải ảnh — nhà trường dùng ảnh từ buổi chụp do trường tổ chức (nếu có).</p>
        )}

        {reg.can_edit && (replacing || !reg.has_photo) && (
          <div className="space-y-3">
            <PhotoPicker code={member.student.student_code} file={file} onFile={setFile} disabled={busy} />
            <div className="flex gap-2 justify-end">
              {replacing && <button type="button" className={ui.btnGhost} onClick={() => { setReplacing(false); setFile(null); }}>Thôi</button>}
              <button type="button" className={ui.btnPrimary} onClick={upload} disabled={!file || busy}>
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                {reg.has_photo ? 'Tải ảnh mới lên' : 'Tải ảnh lên'}
              </button>
            </div>
            {reg.has_photo && <p className="text-xs text-muted">Ảnh mới tải lên thành công sẽ thay thế, ảnh cũ bị xóa khỏi hệ thống.</p>}
          </div>
        )}
        <Alert message={error} />
        {reg.can_edit && (
          <details className="rounded-lg border border-line px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium text-ink">Yêu cầu về ảnh trình chiếu</summary>
            <div className="mt-3"><PhotoGuidelines code={member.student.student_code} /></div>
          </details>
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
      <div className={cn(notice.base, notice.warning)}>
        <Clock size={16} className={noticeIcon.warning} />
        <div className="text-sm">
          <b>Đã gửi yêu cầu hủy đăng ký</b> lúc {dt(reg.cancel_requested_at)} — đang chờ Phòng Công tác Sinh viên duyệt.
          Mã QR vẫn dùng được cho tới khi yêu cầu được duyệt. Kết quả được báo qua email.
          {reg.cancel_reason && <div className="mt-1 text-muted">Lý do: {reg.cancel_reason}</div>}
        </div>
      </div>
    );
  }
  if (!reg.can_edit || reg.checked_in) return null;

  async function submit() {
    setBusy(true); setError('');
    try { onChange(await gradApi.cancel(reason)); setOpen(false); } catch (err) {
      setError(err instanceof GradError ? err.message : 'Không gửi được yêu cầu.');
    } finally { setBusy(false); }
  }

  return (
    <div className={ui.card}>
      <div className="p-5">
        {!open ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">Không thể tham dự? Gửi yêu cầu hủy đăng ký để Phòng Công tác Sinh viên duyệt.</p>
            <button type="button" className={cn(ui.btnOutline, 'text-danger-text')} onClick={() => setOpen(true)}>
              <XCircle size={16} /> Yêu cầu hủy đăng ký
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <label htmlFor="cancel-reason" className={ui.fieldLabel}>Lý do hủy đăng ký</label>
            <textarea id="cancel-reason" rows={3} maxLength={500} className={ui.textarea} value={reason}
                      onChange={(e) => setReason(e.target.value)} placeholder="Nêu ngắn gọn lý do" />
            <div className="text-xs text-muted text-right">{reason.length}/500</div>
            <Alert message={error} />
            <div className="flex justify-end gap-2">
              <button type="button" className={ui.btnGhost} onClick={() => setOpen(false)} disabled={busy}>Thôi</button>
              <button type="button" className={cn(ui.btnPrimary, 'bg-danger-text hover:bg-[#991b1b] disabled:hover:bg-danger-text')} onClick={submit}
                      disabled={busy || reason.trim().length < 5}>
                {busy && <Loader2 size={16} className="animate-spin" />} Gửi yêu cầu hủy
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Đăng ký mới — ảnh không bắt buộc. */
export function RegisterForm({ member, onRegistered }: { member: GradMember; onRegistered: (m: GradMember) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const reg = member.registration;

  async function submit() {
    setBusy(true); setError('');
    try { onRegistered(await gradApi.register(file)); } catch (err) {
      setError(err instanceof GradError ? err.message : 'Không đăng ký được. Vui lòng thử lại.');
    } finally { setBusy(false); }
  }

  return (
    <div className={ui.card}>
      <div className={ui.cardHeader}><span className={ui.sectionTitle}>Đăng ký tham dự</span></div>
      <div className="p-5 space-y-5">
        {reg.status === 'cancelled' && (
          <div className={cn(notice.base, notice.neutral)}>
            <Info size={16} className={noticeIcon.neutral} />
            <p className="text-sm">Đăng ký trước đó đã được hủy{reg.cancel_reviewed_at ? ` lúc ${dt(reg.cancel_reviewed_at)}` : ''}. Có thể đăng ký lại bên dưới.</p>
          </div>
        )}
        <div>
          <div className="font-semibold text-ink mb-1">Ảnh trình chiếu trên màn hình LED <span className="font-normal text-muted">(không bắt buộc)</span></div>
          <PhotoGuidelines code={member.student.student_code} />
        </div>
        <PhotoPicker code={member.student.student_code} file={file} onFile={setFile} disabled={busy} />
        <Alert message={error} />
        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-4 border-t border-line">
          <p className="text-xs text-muted">{file ? 'Ảnh sẽ được gửi cùng đăng ký.' : 'Chưa chọn ảnh — vẫn đăng ký được, tải ảnh sau khi còn hạn.'}</p>
          <button type="button" onClick={submit} disabled={busy} className={cn(ui.btnPrimary, 'h-11 px-6')}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
            Xác nhận đăng ký tham dự
          </button>
        </div>
      </div>
    </div>
  );
}

export function Registered({ member, onChange }: { member: GradMember; onChange: (m: GradMember) => void }) {
  const reg = member.registration;
  const rejected = reg.status === 'registered' && reg.cancel_reviewed_at && reg.cancel_review_note;
  return (
    <div className="space-y-4">
      <div className={cn(notice.base, notice.success)}>
        <CheckCircle2 size={16} className={noticeIcon.success} />
        <p className="text-sm"><b>Đã đăng ký tham dự</b> lúc {dt(reg.registered_at)}{reg.checked_in ? ' · đã check-in tại lễ' : ''}.</p>
      </div>
      {rejected && (
        <div className={cn(notice.base, notice.neutral)}>
          <Info size={16} className={noticeIcon.neutral} />
          <p className="text-sm">Yêu cầu hủy không được chấp thuận{reg.cancel_review_note ? `: ${reg.cancel_review_note}` : '.'}</p>
        </div>
      )}
      {!reg.can_edit && reg.status === 'registered' && !member.round.registration_open && (
        <div className={cn(notice.base, notice.neutral)}>
          <Info size={16} className={noticeIcon.neutral} />
          <p className="text-sm">Đã hết thời gian đăng ký — không đổi ảnh hay gửi yêu cầu hủy được nữa. Mã QR vẫn dùng bình thường.</p>
        </div>
      )}
      <CurrentPhoto member={member} onChange={onChange} />
      <CancelBlock member={member} onChange={onChange} />
    </div>
  );
}
