'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { InsuranceDetail, InsuranceEvidence, Province } from '@/lib/types';

const money = (value: number) => value.toLocaleString('vi-VN') + ' VNĐ';
const statusNames: Record<string, string> = {iu_processing:'ĐHQT xử lý', waiting_bhxh:'Chờ BHXH xử lý', issued:'Phát hành', rejected:'Từ chối'};

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
  if (error) return <span>Không tải được minh chứng.</span>;
  if (!url) return <span>Đang tải ảnh…</span>;
  return <a href={url} target="_blank" rel="noreferrer" className="block w-36 rounded border p-1">
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={url} alt="Minh chứng thanh toán" className="h-28 w-full object-contain" />
    <span className="block truncate text-xs">{evidence.filename}</span>
  </a>;
}

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
      api.locations.provinces().then(setProvinces).catch(e => setError(e.message));
  }, [editing, data?.reason_code]);
  useEffect(() => {
    setHospital(''); setHospitals([]);
    if (!province) return;
    let active = true;
    api.hospitals.byProvince(province).then(h => { if (active) setHospitals(h); }).catch(e => setError(e.message));
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
    <button className="text-primary-text underline" onClick={() => { setOpen(true); setError(''); }}>Chi tiết / bổ sung</button>
    {open && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Chi tiết đơn BHYT">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-6 text-left shadow-xl">
        <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Đơn BHYT #{id}</h2>
          <button disabled={busy} onClick={() => { setOpen(false); setEditing(false); }}>Đóng</button></div>
        {error && <p role="alert" className="my-3 text-red-700">{error} <button className="underline" onClick={async () => {
          pending.current = null; setData(await api.insuranceRegistration.detail(id)); setError('');
        }}>Tải lại đơn</button></p>}
        {!data ? <p>Đang tải…</p> : <>
          <p className="my-3 font-medium">{statusNames[data.status] || data.status}</p>
          {rejected && <section className="rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="font-semibold">{data.reason_label}</p><p className="whitespace-pre-wrap">{data.reason_text}</p>
            {data.reason_code === 'HOSPITAL_NOT_ACCEPTED' || paymentReason ?
              <button className="mt-3 rounded border bg-white px-3 py-2" onClick={() => setEditing(true)}>
                {paymentReason ? 'Đóng tiền / gửi minh chứng' : 'Điều chỉnh bệnh viện'}</button>
              : <p className="mt-2">Liên hệ Phòng Công tác Sinh viên theo nội dung trên. Cán bộ sẽ tiếp nhận lại đơn sau khi vấn đề được xử lý.</p>}
          </section>}
          {rejected && editing && <section className="my-4 space-y-3 rounded-lg border p-4">
            {data.reason_code === 'HOSPITAL_NOT_ACCEPTED' ? <>
              <label className="block">Tỉnh/Thành phố<select className="mt-1 block w-full rounded border p-2" value={province}
                onChange={e => { setProvince(e.target.value); pending.current = null; }}><option value="">Chọn tỉnh/thành</option>
                {provinces.map(p => <option key={p.code} value={p.code}>{p.name}</option>)}</select></label>
              <label className="block">Bệnh viện<select className="mt-1 block w-full rounded border p-2" value={hospital}
                onChange={e => { setHospital(e.target.value); pending.current = null; }}><option value="">Chọn bệnh viện</option>
                {hospitals.map(h => <option key={h.code} value={h.code}>{h.name} — {h.code}</option>)}</select></label>
            </> : <>
              {data.payment ? <>
                <p>Phí gốc: {money(data.payment.required_amount_vnd)}</p>
                <p>Tổng tiền đã được cán bộ xác nhận: {money(data.payment.confirmed_paid_total_vnd)}</p>
                <p className="font-semibold">Cần đóng bổ sung: {money(data.payment.missing_amount_vnd)}</p>
                {data.payment.missing_amount_vnd === 0 ? <p>Không cần chuyển thêm tiền.</p> : data.payment.qr_url ? <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={data.payment.qr_url} alt="QR chuyển khoản số tiền còn thiếu" className="w-64" />
                  <p>{data.payment.bank_name} · {data.payment.bank_account_number} · {data.payment.bank_account_name}</p>
                  <p>Nội dung: {data.payment.reference}</p>
                </> : <p>Thiếu thông tin tài khoản tại thời điểm đăng ký. Liên hệ Phòng CTSV để xác minh trước khi chuyển tiền.</p>}
              </> : <p>Chưa có đối soát tiền. Liên hệ Phòng CTSV để xác minh số tiền cần đóng.</p>}
              <label className="block">Ảnh minh chứng bổ sung (tối đa 8 ảnh, 5 MB/ảnh)
                <input className="mt-2 block" type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={e => {
                  setFiles(Array.from(e.target.files || [])); pending.current = null;
                }} /></label><p>{files.map(f => f.name).join(', ')}</p>
              <p className="text-sm text-slate-600">Ảnh gửi lên chưa đồng nghĩa tiền đã được xác nhận. Các ảnh cũ được giữ nguyên.</p>
            </>}
            <button disabled={busy || (data.reason_code === 'HOSPITAL_NOT_ACCEPTED' ? !hospital : !files.length)}
              className="rounded bg-blue-700 px-4 py-2 text-white disabled:opacity-50" onClick={submit}>
              {busy ? 'Đang gửi…' : data.reason_code === 'HOSPITAL_NOT_ACCEPTED' ? 'Lưu và gửi lại' : 'Gửi minh chứng bổ sung và gửi lại'}</button>
          </section>}
          <h3 className="mt-5 font-semibold">Lịch sử xử lý và bổ sung</h3>
          {!data.timeline.length && <p className="mt-2">Đơn cũ chưa có lịch sử chi tiết.</p>}
          {data.timeline.map(e => <article className="my-4 border-l-2 pl-3" key={e.id}>
            <p className="text-xs text-slate-500">{new Date(e.created_at).toLocaleString('vi-VN')} · {e.source_app}</p>
            <p className="font-medium">{e.label}</p>
            {e.from_status && <p>{statusNames[e.from_status] || e.from_status} → {statusNames[e.to_status || ''] || e.to_status}</p>}
            {(e.reason_label || e.reason_text) && <p>{e.reason_label}: {e.reason_text}</p>}
            {e.assessment && <p>Phí: {money(e.assessment.required_amount_vnd)} · Đã xác nhận: {money(e.assessment.confirmed_paid_total_vnd)} · Còn thiếu: {money(e.assessment.missing_amount_vnd)}</p>}
            {e.payload.before && e.payload.after && <p>Từ: {e.payload.before.hospital_name} ({e.payload.before.hospital_code}) — {e.payload.before.province_name}<br />
              Sang: {e.payload.after.hospital_name} ({e.payload.after.hospital_code}) — {e.payload.after.province_name}</p>}
            <div className="mt-2 flex flex-wrap gap-2">{e.evidences.map(p => <EvidenceImage key={p.id} evidence={p} />)}</div>
          </article>)}
        </>}
      </div>
    </div>}
  </>;
}
