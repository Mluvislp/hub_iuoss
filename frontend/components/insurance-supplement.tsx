'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Building2, Clock3, FileClock, ImageIcon, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import SearchableSelect from '@/components/searchable-select';
import { InsuranceStatus } from '@/components/insurance-status';
import { ui } from '@/lib/ui';
import { api } from '@/lib/api';
import type { InsuranceDetail, InsuranceEvidence, Province } from '@/lib/types';

const money = (value: number) => value.toLocaleString('vi-VN') + ' VNĐ';

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
                <p>Phí gốc: {money(data.payment.required_amount_vnd)}</p>
                <p>Tổng tiền đã được cán bộ xác nhận: {money(data.payment.confirmed_paid_total_vnd)}</p>
                <p className="font-semibold">Cần đóng bổ sung: {money(data.payment.missing_amount_vnd)}</p>
                {data.payment.missing_amount_vnd === 0 ? <p>Không cần chuyển thêm tiền.</p> : data.payment.qr_url ? <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={data.payment.qr_url} alt="QR chuyển khoản số tiền còn thiếu" className="w-64 max-w-full" />
                  <p>{data.payment.bank_name} · {data.payment.bank_account_number} · {data.payment.bank_account_name}</p>
                  <p>Nội dung: {data.payment.reference}</p>
                </> : <p>Thiếu thông tin tài khoản tại thời điểm đăng ký. Liên hệ Phòng CTSV để xác minh trước khi chuyển tiền.</p>}
              </> : <p>Chưa có đối soát tiền. Liên hệ Phòng CTSV để xác minh số tiền cần đóng.</p>}
              <label className="block">Ảnh minh chứng bổ sung (tối đa 8 ảnh, 5 MB/ảnh)
                <input className="mt-2 block w-full min-w-0 max-w-full text-sm" type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={e => {
                  setFiles(Array.from(e.target.files || [])); pending.current = null;
                }} /></label><p>{files.map(f => f.name).join(', ')}</p>
              <p className="text-sm text-slate-600">Ảnh gửi lên chưa đồng nghĩa tiền đã được xác nhận. Các ảnh cũ được giữ nguyên.</p>
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
