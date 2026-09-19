'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Building2, Check, CheckSquare, Clock3, Copy, CreditCard, FileClock, ImageIcon, Plus, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import QRCode from 'react-qr-code';
import SearchableSelect from '@/components/searchable-select';
import { InsuranceStatus } from '@/components/insurance-status';
import { ui } from '@/lib/ui';
import { api } from '@/lib/api';
import { buildVietQrPayload, findBank } from '@/lib/vietqr';
import type { InsuranceDetail, InsuranceEvidence, Province } from '@/lib/types';

const money = (value: number) => value.toLocaleString('vi-VN') + ' VNĐ';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
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
  if (error) return <span className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">Không tải được minh chứng.</span>;
  if (!url) return <span className="animate-pulse rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-500">Đang tải ảnh…</span>;
  return <a href={url} target="_blank" rel="noreferrer" className="group block w-36 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md">
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={url} alt="Minh chứng thanh toán bổ sung" className="h-24 w-full bg-slate-50 object-contain" />
    <span className="flex items-center gap-1.5 truncate border-t border-slate-100 px-2.5 py-2 text-xs text-slate-600"><ImageIcon className="h-3.5 w-3.5 shrink-0" />{evidence.filename}</span>
  </a>;
}

const actorName = (source: string) => source === 'Hub' ? 'Sinh viên' : source === 'Dashboard' ? 'Nhân viên' : 'Hệ thống';

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
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = overflow; };
  }, [open]);
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
      body.set('request_key', crypto.randomUUID()); body.set('row_version', String(data.row_version));
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
  return <>
    <button className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3.5 py-2 text-sm font-semibold text-blue-700 shadow-sm transition hover:border-blue-300 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
      onClick={() => { setOpen(true); setError(''); }}><FileClock className="h-4 w-4" />Chi tiết</button>
    {open && createPortal(<div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-3 backdrop-blur-sm sm:p-6" role="dialog" aria-modal="true" aria-label="Chi tiết đơn BHYT">
      <div className="max-h-[calc(100dvh-1.5rem)] min-w-0 w-full max-w-4xl overflow-x-hidden overflow-y-auto overscroll-contain whitespace-normal break-words sm:max-h-[calc(100dvh-3rem)] rounded-2xl bg-slate-50 text-left shadow-2xl ring-1 ring-black/5">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur sm:px-7">
          <div><p className="text-xs font-semibold uppercase tracking-wider text-blue-600">Hồ sơ bảo hiểm y tế</p><h2 className="mt-0.5 text-lg font-bold text-slate-900">Đơn BHYT #{id}</h2></div>
          <button aria-label="Đóng" className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900" disabled={busy} onClick={() => { setOpen(false); setEditing(false); }}><X className="h-5 w-5" /></button></div>
        <div className="px-3 py-4 sm:px-7 sm:py-5">
        {error && <p role="alert" className="my-3 text-red-700">{error} <button className="underline" onClick={async () => {
          pending.current = null; setData(await api.insuranceRegistration.detail(id)); setError('');
        }}>Tải lại đơn</button></p>}
        {!data ? <p>Đang tải…</p> : <>
          <div className="mb-5 flex flex-wrap items-center gap-2"><span className="text-sm text-slate-500">Trạng thái hiện tại</span><InsuranceStatus status={data.status} /></div>
          {rejected && <section className="rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="font-semibold">{data.reason_label}</p><p className="whitespace-pre-wrap">{data.reason_text}</p>
            {data.reason_code === 'HOSPITAL_NOT_ACCEPTED' || paymentReason ?
              <button className={ui.btnOutline + " mt-3"} onClick={() => setEditing(true)}>
                {paymentReason ? 'Đóng tiền / gửi minh chứng' : 'Điều chỉnh bệnh viện'}</button>
              : <p className="mt-2">Liên hệ Phòng Công tác Sinh viên theo nội dung trên. Cán bộ sẽ tiếp nhận lại đơn sau khi vấn đề được xử lý.</p>}
          </section>}
          {rejected && editing && <section className="my-4 space-y-3 rounded-lg border p-4">
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
                        <li>Ngân hàng: <strong className="text-ink">{data.payment.bank_name || '—'}</strong></li>
                        <li className="flex flex-wrap items-center gap-x-2"><span>Số tài khoản: <strong className="font-mono text-ink">{data.payment.bank_account_number}</strong></span><CopyButton text={data.payment.bank_account_number} /></li>
                        <li>Chủ tài khoản: <strong className="text-ink">{data.payment.bank_account_name || '—'}</strong></li>
                        <li>Số tiền: <strong className="text-base text-primary">{money(data.payment.missing_amount_vnd)}</strong></li>
                        <li className="flex flex-wrap items-center gap-x-2"><span>Nội dung: <strong className="break-all text-ink">{data.payment.reference}</strong></span><CopyButton text={data.payment.reference} /></li>
                      </ul>
                      <p className="mt-3 text-xs text-muted">Mã QR đã gồm sẵn số tài khoản, số tiền còn thiếu và nội dung chuyển khoản.</p>
                    </div>
                  </div> : <p className="rounded-lg border border-warning-line bg-warning-soft p-3 text-sm text-warning-text">Thiếu thông tin tài khoản tại thời điểm đăng ký. Liên hệ Phòng CTSV để xác minh trước khi chuyển tiền.</p>}
              </> : <p>Chưa có đối soát tiền. Liên hệ Phòng CTSV để xác minh số tiền cần đóng.</p>}

              <div>
                <label className={ui.fieldLabel}>Ảnh minh chứng bổ sung <span className="font-normal text-muted">(tối đa 8 ảnh, 5 MB/ảnh)</span></label>
                <div className="group relative flex min-h-[9rem] cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-slate-300 p-4 text-center transition-colors hover:bg-slate-50">
                  <input className="absolute inset-0 h-full w-full cursor-pointer opacity-0" type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={e => {
                    setFiles(Array.from(e.target.files || [])); pending.current = null;
                  }} />
                  <div className="flex min-w-0 flex-col items-center gap-2">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-500 transition-transform group-hover:scale-110">
                      {files.length ? <CheckSquare size={20} /> : <Plus size={20} />}
                    </div>
                    <span className="max-w-full break-all text-sm font-medium text-slate-700">{files.length ? `${files.length} ảnh đã chọn` : 'Tải lên minh chứng chuyển khoản'}</span>
                    <span className="text-xs text-slate-500">JPEG, PNG hoặc WEBP · Tối đa 5MB/ảnh</span>
                  </div>
                </div>
                {!!files.length && <div className="mt-2 flex flex-wrap gap-1.5">{files.map(file => <span key={file.name + file.lastModified} className="max-w-full truncate rounded-md border border-line bg-white px-2 py-1 text-xs text-muted">{file.name}</span>)}</div>}
              </div>
              <p className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-600"><CreditCard className="mt-0.5 h-4 w-4 shrink-0" />Ảnh gửi lên chưa đồng nghĩa tiền đã được xác nhận. Các ảnh cũ được giữ nguyên.</p>
            </>}
            <button disabled={busy || hospitalsLoading || (data.reason_code === 'HOSPITAL_NOT_ACCEPTED' ? !hospital : !files.length)}
              className={ui.btnPrimary + " w-full whitespace-normal sm:w-auto disabled:opacity-50"} onClick={submit}>
              {busy ? 'Đang gửi…' : data.reason_code === 'HOSPITAL_NOT_ACCEPTED' ? 'Lưu và gửi lại' : 'Gửi minh chứng bổ sung và gửi lại'}</button>
          </section>}
          <section className="mt-7 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
            <div className="mb-5 flex items-center gap-3"><span className="rounded-xl bg-blue-50 p-2 text-blue-700"><Clock3 className="h-5 w-5" /></span><div><h3 className="font-bold text-slate-900">Lịch sử xử lý và bổ sung</h3><p className="text-sm text-slate-500">Các hoạt động được sắp xếp theo thời gian</p></div></div>
            {!data.timeline.length && <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Đơn cũ chưa có lịch sử chi tiết.</p>}
            <div className="relative ml-2 border-l-2 border-blue-100 pl-6 sm:ml-3 sm:pl-8">
            {data.timeline.map((e, index) => <article className="relative pb-6 last:pb-0" key={e.id}>
              <span className="absolute -left-[31px] top-1 flex h-4 w-4 items-center justify-center rounded-full border-4 border-white bg-blue-500 shadow-sm sm:-left-[39px]" />
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-bold text-slate-900">{e.label}</p><p className="mt-1 text-xs text-slate-500">Bước {index + 1} · {actorName(e.source_app)}</p></div><time className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">{new Date(e.created_at).toLocaleString('vi-VN')}</time></div>
                {e.from_status && e.to_status && e.from_status !== e.to_status && <div className="mt-3 flex flex-wrap items-center gap-2 text-sm"><InsuranceStatus status={e.from_status} /><ArrowRight className="h-4 w-4 text-slate-400" /><InsuranceStatus status={e.to_status} /></div>}
                {(e.reason_label || e.reason_text) && <div className="mt-3 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-900"><span className="font-semibold">{e.reason_label}</span>{e.reason_text && <span>: {e.reason_text}</span>}</div>}
                {e.assessment && <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3"><div className="rounded-lg bg-slate-50 p-2.5"><span className="block text-xs text-slate-500">Phí phải đóng</span><b>{money(e.assessment.required_amount_vnd)}</b></div><div className="rounded-lg bg-emerald-50 p-2.5"><span className="block text-xs text-emerald-700">Đã xác nhận</span><b>{money(e.assessment.confirmed_paid_total_vnd)}</b></div><div className="rounded-lg bg-amber-50 p-2.5"><span className="block text-xs text-amber-700">Còn thiếu</span><b>{money(e.assessment.missing_amount_vnd)}</b></div></div>}
                {e.payload.before && e.payload.after && <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm"><div className="mb-2 flex items-center gap-2 font-semibold text-slate-700"><Building2 className="h-4 w-4" />Thay đổi nơi khám chữa bệnh</div><div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr]"><div><span className="text-xs text-slate-500">Từ</span><p>{e.payload.before.hospital_name} · {e.payload.before.hospital_code}</p><p className="text-xs text-slate-500">{e.payload.before.province_name}</p></div><ArrowRight className="hidden h-4 w-4 self-center text-slate-400 sm:block" /><div><span className="text-xs text-slate-500">Sang</span><p className="font-medium text-blue-700">{e.payload.after.hospital_name} · {e.payload.after.hospital_code}</p><p className="text-xs text-slate-500">{e.payload.after.province_name}</p></div></div></div>}
                {!!e.evidences.length && <div className="mt-3"><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Minh chứng thanh toán bổ sung</p><div className="flex flex-wrap gap-2">{e.evidences.map(p => <EvidenceImage key={p.id} evidence={p} />)}</div></div>}
              </div>
            </article>)}
            </div>
          </section>
        </>}
        </div>
      </div>
    </div>, document.body)}
  </>;
}
