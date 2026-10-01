'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { RejectionNotice } from '@/components/rejection-notice';
import { AlertTriangle, ArrowRight, Building2, Check, CheckSquare, Clock3, Copy, CreditCard, FileClock, ImageIcon, Info, Loader2, Plus } from 'lucide-react';
import QRCode from 'react-qr-code';
import SearchableSelect from '@/components/searchable-select';
import { InsuranceStatus } from '@/components/insurance-status';
import { ui } from '@/lib/ui';
import { ChangeList, SubmittedInsuranceInfo } from '@/components/submitted-insurance-info';
import { InsuranceModal } from '@/components/insurance-modal';
import { api, newRequestKey } from '@/lib/api';
import { buildVietQrPayload, findBank } from '@/lib/vietqr';
import type { InsuranceDetail, InsuranceEvidence, Province } from '@/lib/types';

const money = (value: number) => value.toLocaleString('vi-VN') + ' VNĐ';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return <button type="button" className="touch-target inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
    onClick={async () => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch { /* Người dùng vẫn có thể chọn và sao chép thủ công. */ }
    }}>
    {copied ? <><Check className="h-3 w-3" />Đã chép</> : <><Copy className="h-3 w-3" />Chép</>}
  </button>;
}

function EvidenceImage({ evidence }: { evidence: InsuranceEvidence }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    let objectUrl = '';
    api.insuranceRegistration.evidence(evidence.url).then(blob => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [evidence.url]);
  if (error) return <span className="rounded-lg border border-danger-line bg-danger-soft px-3 py-2 text-xs text-danger-text">Không tải được minh chứng.</span>;
  if (!url) return <span className="animate-pulse rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-500">Đang tải ảnh…</span>;
  return <a href={url} target="_blank" rel="noreferrer" className="group block w-36 overflow-hidden rounded-lg border border-line bg-white transition-colors hover:border-primary-line">
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={url} alt="Minh chứng thanh toán bổ sung" className="h-24 w-full bg-slate-50 object-contain" />
    <span className="flex items-center gap-1.5 truncate border-t border-slate-100 px-2.5 py-2 text-xs text-slate-600"><ImageIcon className="h-3.5 w-3.5 shrink-0" />{evidence.filename}</span>
  </a>;
}

const actorName = (source: string) => source === 'Hub' ? 'Sinh viên' : source === 'Dashboard' ? 'Chuyên viên' : 'Hệ thống';

export function InsuranceSupplement({ id, onUpdated }: { id: number; onUpdated: () => void }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<InsuranceDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [provinces, setProvinces] = useState<Province[]>([]);
  const [province, setProvince] = useState('');
  const [hospital, setHospital] = useState('');
  const [hospitals, setHospitals] = useState<{code:string; name:string}[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [hospitalsLoading, setHospitalsLoading] = useState(false);
  const pending = useRef<FormData | null>(null);
  useEffect(() => {
    if (!open) return;
    let active = true;
    api.insuranceRegistration.detail(id).then(d => { if (active) setData(d); })
      .catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [open, id]);
  useEffect(() => {
    if (editing && data?.reason_code === 'HOSPITAL_NOT_ACCEPTED')
      api.locations.provinces().then(items => setProvinces(items.filter(p => ['79', '75'].includes(p.code)))).catch(e => setError(e.message));
  }, [editing, data?.reason_code]);
  useEffect(() => {
    setHospital(''); setHospitals([]);
    if (!province) { setHospitalsLoading(false); return; }
    setHospitalsLoading(true);
    let active = true;
    api.hospitals.byProvince(province).then(h => { if (active) setHospitals(h); })
      .catch(e => { if (active) setError(e.message); })
      .finally(() => { if (active) setHospitalsLoading(false); });
    return () => { active = false; };
  }, [province]);

  async function submit() {
    if (!data) return;
    setBusy(true); setError('');
    if (!pending.current) {
      const body = new FormData();
      body.set('request_key', newRequestKey()); body.set('row_version', String(data.row_version));
      if (data.reason_code === 'HOSPITAL_NOT_ACCEPTED') {
        body.set('hospital_code', hospital); body.set('province_code', province);
      } else files.forEach(file => body.append('evidences', file));
      pending.current = body;
    }
    try {
      await api.insuranceRegistration.supplement(id, pending.current);
      pending.current = null; setEditing(false); setFiles([]);
      setData(await api.insuranceRegistration.detail(id)); onUpdated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không gửi được bổ sung.');
      // Preserve the exact body on transport failure; validation conflicts require refreshing.
    } finally { setBusy(false); }
  }

  const rejected = data?.status === 'rejected';
  const paymentReason = data?.reason_code === 'UNPAID' || data?.reason_code === 'UNDERPAID';
  const paymentQr = useMemo(() => {
    const payment = data?.payment;
    const bankBin = findBank(payment?.bank_name)?.bin;
    if (!payment || !bankBin || payment.missing_amount_vnd <= 0) return null;
    return buildVietQrPayload({
      bin: bankBin,
      accountNumber: payment.bank_account_number,
      amount: payment.missing_amount_vnd,
      addInfo: payment.reference,
    });
  }, [data?.payment]);
  const paymentBankBin = findBank(data?.payment?.bank_name)?.bin;
  return <>
    <button className={ui.btnSecondary}
      onClick={() => { setOpen(true); setError(''); }}><FileClock className="h-4 w-4" />Chi tiết</button>
    {open && <InsuranceModal eyebrow="Hồ sơ bảo hiểm y tế" title={'Đơn BHYT #' + id} closeDisabled={busy} onClose={() => { setOpen(false); setEditing(false); }}>
        {error && <div role="alert" className="mb-4 flex flex-wrap items-start gap-2 rounded-lg border border-danger-line bg-danger-soft px-4 py-3 text-sm text-danger-text">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span className="min-w-0 flex-1">{error}</span>
          <button type="button" className="font-medium underline" onClick={async () => {
            pending.current = null; setData(await api.insuranceRegistration.detail(id)); setError('');
          }}>Tải lại đơn</button></div>}
        {!data ? !error && <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" />Đang tải…</p> : <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2"><span className="text-sm text-muted">Trạng thái hiện tại</span><InsuranceStatus status={data.status} /></div>
          {rejected && <RejectionNotice eyebrow="Đơn bị từ chối" title={data.reason_label || 'Đơn bị từ chối'} note={data.reason_text}>
              {data.reason_code === 'HOSPITAL_NOT_ACCEPTED' || paymentReason ?
                !editing && <div className="flex flex-col gap-2 rounded-lg bg-primary-soft p-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-primary-text">{paymentReason ? 'Bổ sung minh chứng chuyển khoản để cán bộ xem xét lại đơn.' : 'Chọn lại bệnh viện khám chữa bệnh để gửi lại đơn.'}</p>
                  <button type="button" className={ui.btnPrimary + " w-full shrink-0 sm:w-auto"} onClick={() => setEditing(true)}>
                    {paymentReason ? 'Đóng tiền / gửi minh chứng' : 'Điều chỉnh bệnh viện'}</button>
                </div>
              : <p className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-700"><Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />Liên hệ Phòng Công tác Sinh viên theo nội dung trên. Cán bộ sẽ tiếp nhận lại đơn sau khi vấn đề được xử lý.</p>}
          </RejectionNotice>}
          {rejected && editing && <section className="space-y-4 rounded-lg border border-line bg-white p-4 sm:p-5">
            {data.reason_code === 'HOSPITAL_NOT_ACCEPTED' ? <>
              <div className="space-y-2">
                <label className={ui.fieldLabel} htmlFor={'supplement-province-' + id}>Tỉnh/Thành phố</label>
                <SearchableSelect id={'supplement-province-' + id} value={province}
                  onChange={value => { setProvince(value); setHospital(''); setHospitals([]); pending.current = null; }}
                  options={provinces.map(p => ({value: p.code, label: p.code === '79' ? 'Thành phố Hồ Chí Minh' : 'Đồng Nai'}))}
                  placeholder="-- Chọn tỉnh thành --" searchPlaceholder="Gõ tên tỉnh thành..." />
              </div>
              <div className="space-y-2">
                <label className={ui.fieldLabel} htmlFor={'supplement-hospital-' + id}>Bệnh viện</label>
                <SearchableSelect id={'supplement-hospital-' + id} value={hospital}
                  onChange={value => { setHospital(value); pending.current = null; }}
                  options={hospitals.filter(h => h.code !== data.hospital_code).map(h => ({value: h.code, label: h.name, hint: h.code}))}
                  disabled={!province || hospitalsLoading}
                  placeholder={!province ? '-- Chọn tỉnh thành trước --' : hospitalsLoading ? 'Đang tải danh sách...' : '-- Chọn bệnh viện KCB --'}
                  searchPlaceholder="Gõ tên hoặc mã cơ sở..." emptyText="Không có cơ sở nào khớp" />
              </div>
            </> : <>
              {data.payment ? <>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-line bg-slate-50 p-3.5">
                    <span className="text-xs font-medium text-muted">Số tiền phải đóng</span>
                    <p className="mt-1 text-lg font-bold text-ink">{money(data.payment.required_amount_vnd)}</p>
                  </div>
                  <div className="rounded-lg border border-success-line bg-success-soft p-3.5">
                    <span className="text-xs font-medium text-success-text">Số tiền đã xác nhận</span>
                    <p className="mt-1 text-lg font-bold text-success-text">{money(data.payment.confirmed_paid_total_vnd)}</p>
                  </div>
                  <div className="rounded-lg border border-warning-line bg-warning-soft p-3.5">
                    <span className="text-xs font-medium text-warning-text">Số tiền còn thiếu</span>
                    <p className="mt-1 text-lg font-bold text-warning-text">{money(data.payment.missing_amount_vnd)}</p>
                  </div>
                </div>

                {data.payment.missing_amount_vnd === 0 ? <p className="rounded-lg border border-success-line bg-success-soft p-3 text-sm font-medium text-success-text">Bạn không cần chuyển thêm tiền.</p> :
                  data.payment.bank_account_number ? <div className="flex flex-col items-start gap-6 rounded-lg border border-line bg-slate-50 p-4 md:flex-row">
                    <div className="mx-auto shrink-0 text-center md:mx-0">
                      {paymentQr ? <>
                        <div className="rounded-lg border border-line bg-white p-3">
                          <QRCode value={paymentQr} size={148} level="M" style={{ height: 148, width: 148 }} />
                        </div>
                        <p className="mt-2 text-xs text-muted">Quét bằng app ngân hàng bất kỳ</p>
                      </> : <div className="flex h-[174px] w-[174px] items-center justify-center rounded-lg border border-dashed border-line bg-white px-4 text-center text-xs text-muted">Chưa tạo được mã QR. Vui lòng chuyển khoản thủ công.</div>}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="mb-2 font-semibold text-ink">Thông tin chuyển khoản</h3>
                      <ul className="space-y-1.5 text-sm text-slate-600">
                        <li>Ngân hàng: <strong className="text-ink">{data.payment.bank_name || '—'}</strong>{paymentBankBin && <span className="ml-1.5 text-xs text-muted">(BIN {paymentBankBin})</span>}</li>
                        <li className="flex flex-wrap items-center gap-x-2"><span>Số tài khoản: <strong className="font-mono text-ink">{data.payment.bank_account_number}</strong></span><CopyButton text={data.payment.bank_account_number} /></li>
                        <li>Chủ tài khoản: <strong className="text-ink">{data.payment.bank_account_name || '—'}</strong></li>
                        <li>Số tiền: <strong className="text-base text-primary">{money(data.payment.missing_amount_vnd)}</strong></li>
                        <li className="flex flex-wrap items-center gap-x-2"><span>Nội dung: <strong className="break-all text-ink">{data.payment.reference}</strong></span><CopyButton text={data.payment.reference} /></li>
                      </ul>
                      <p className="mt-3 text-xs text-muted">Mã QR đã gồm sẵn số tài khoản, số tiền còn thiếu và nội dung. Giữ nguyên nội dung chuyển khoản để Phòng KHTC đối chiếu được hóa đơn.</p>
                    </div>
                  </div> : <p className="rounded-lg border border-warning-line bg-warning-soft p-3 text-sm text-warning-text">Thiếu thông tin tài khoản tại thời điểm đăng ký. Liên hệ Phòng CTSV để xác minh trước khi chuyển tiền.</p>}
              </> : <p className="rounded-lg border border-warning-line bg-warning-soft p-3 text-sm text-warning-text">Chưa có đối soát tiền. Liên hệ Phòng CTSV để xác minh số tiền cần đóng.</p>}

              <div>
                <label htmlFor={'supplement-file-' + id} className={ui.fieldLabel}>Ảnh minh chứng bổ sung <span className="font-normal text-muted">(tối đa 1 ảnh, 5 MB)</span></label>
                <div className="group relative flex min-h-[9rem] cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-slate-300 p-4 text-center transition-colors hover:bg-slate-50 focus-within:ring-2 focus-within:ring-primary/40">
                  <input id={'supplement-file-' + id} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" type="file" accept="image/jpeg,image/png,image/webp" onChange={e => {
                    setFiles(e.target.files?.[0] ? [e.target.files[0]] : []); pending.current = null;
                  }} />
                  <div className="flex min-w-0 flex-col items-center gap-2">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-500 transition-transform group-hover:scale-110">
                      {files.length ? <CheckSquare size={20} /> : <Plus size={20} />}
                    </div>
                    <span className="max-w-full break-all text-sm font-medium text-slate-700">{files.length ? 'Đã chọn 1 ảnh' : 'Tải lên minh chứng chuyển khoản'}</span>
                    <span className="text-xs text-slate-500">JPEG, PNG hoặc WEBP · Tối đa 5MB</span>
                  </div>
                </div>
                {!!files.length && <div className="mt-2 flex flex-wrap gap-1.5">{files.map(file => <span key={file.name + file.lastModified} className="max-w-full truncate rounded-md border border-line bg-white px-2 py-1 text-xs text-muted">{file.name}</span>)}</div>}
              </div>
              <p className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-600"><CreditCard className="mt-0.5 h-4 w-4 shrink-0" />Ảnh gửi lên chưa đồng nghĩa tiền đã được xác nhận. Các ảnh cũ được giữ nguyên.</p>
            </>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" className={ui.btnGhost} disabled={busy} onClick={() => { setEditing(false); pending.current = null; }}>Hủy</button>
              <button type="button" disabled={busy || hospitalsLoading || (data.reason_code === 'HOSPITAL_NOT_ACCEPTED' ? !hospital : !files.length)}
                className={ui.btnPrimary + " h-auto min-h-10 whitespace-normal py-2"} onClick={submit}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {busy ? 'Đang gửi…' : data.reason_code === 'HOSPITAL_NOT_ACCEPTED' ? 'Lưu và gửi lại' : 'Gửi minh chứng bổ sung và gửi lại'}</button>
            </div>
          </section>}
          <SubmittedInsuranceInfo data={data} />
          <section className="rounded-lg border border-line bg-white p-4 sm:p-6">
            <div className="mb-5 flex items-start gap-2"><Clock3 className="mt-0.5 h-4 w-4 text-primary" /><div><h3 className="font-semibold text-ink">Lịch sử xử lý và bổ sung</h3><p className="text-sm text-muted">Các hoạt động được sắp xếp theo thời gian</p></div></div>
            {!data.timeline.length && <p className="rounded-lg bg-slate-50 p-4 text-sm text-muted">Đơn cũ chưa có lịch sử chi tiết.</p>}
            <div className="relative ml-2 border-l-2 border-primary-line pl-6 sm:ml-3 sm:pl-8">
            {data.timeline.map((e, index) => <article className="relative pb-6 last:pb-0" key={e.id}>
              <span className="absolute -left-[31px] top-1 flex h-4 w-4 items-center justify-center rounded-full border-4 border-white bg-primary shadow-sm sm:-left-[39px]" />
              <div className="rounded-lg border border-line bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="font-semibold text-ink">{e.label}</p><p className="mt-1 text-xs text-slate-500">Bước {index + 1} · {actorName(e.source_app)}</p></div><time className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">{new Date(e.created_at).toLocaleString('vi-VN')}</time></div>
                {e.from_status && e.to_status && e.from_status !== e.to_status && <div className="mt-3 flex flex-wrap items-center gap-2 text-sm"><InsuranceStatus status={e.from_status} /><ArrowRight className="h-4 w-4 text-slate-400" /><InsuranceStatus status={e.to_status} /></div>}
                {(e.reason_label || e.reason_text) && <div className="mt-3 rounded-lg border border-warning-line bg-warning-soft px-3 py-2 text-sm text-warning-text">{e.reason_label && <p className="font-semibold">{e.reason_label}</p>}{e.reason_text && <p className={e.reason_label ? 'mt-1' : ''}>{e.reason_text}</p>}</div>}
                {e.assessment && <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3"><div className="rounded-lg bg-slate-50 p-2.5"><span className="block text-xs text-slate-500">Phí phải đóng</span><b>{money(e.assessment.required_amount_vnd)}</b></div><div className="rounded-lg bg-success-soft p-2.5"><span className="block text-xs text-success-text">Đã xác nhận</span><b>{money(e.assessment.confirmed_paid_total_vnd)}</b></div><div className="rounded-lg bg-warning-soft p-2.5"><span className="block text-xs text-warning-text">Còn thiếu</span><b>{money(e.assessment.missing_amount_vnd)}</b></div></div>}
                {e.payload.previous_rejection && <p className="mt-3 text-sm text-danger-text">Phản hồi từ chối trước: {e.payload.previous_rejection}</p>}
                <ChangeList changes={e.payload.changes} images={e.payload.images} submitted={e.event_type === 'SUBMITTED'} className="mt-3 space-y-1 rounded-lg bg-slate-50 p-3 text-sm" />
                {e.payload.before && e.payload.after && <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm"><div className="mb-2 flex items-center gap-2 font-semibold text-slate-700"><Building2 className="h-4 w-4" />Thay đổi nơi khám chữa bệnh</div><div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr]"><div><span className="text-xs text-slate-500">Từ</span><p>{e.payload.before.hospital_name || '—'}</p><p className="text-xs text-slate-500">{e.payload.before.province_name}</p></div><ArrowRight className="hidden h-4 w-4 self-center text-slate-400 sm:block" /><div><span className="text-xs text-slate-500">Sang</span><p className="font-medium text-primary-text">{e.payload.after.hospital_name || '—'}</p><p className="text-xs text-slate-500">{e.payload.after.province_name}</p></div></div></div>}
                {!!e.evidences.length && <div className="mt-3"><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Minh chứng thanh toán bổ sung</p><div className="flex flex-wrap gap-2">{e.evidences.map(p => <EvidenceImage key={p.id} evidence={p} />)}</div></div>}
              </div>
            </article>)}
            </div>
          </section>
        </div>}
    </InsuranceModal>}
  </>;
}
