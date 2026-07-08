'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, ArrowLeft, Check, AlertCircle, Loader2, Info, PencilLine, FileText } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ui } from '@/lib/ui';
import type { DefermentFormData, Province, Ward } from '@/lib/types';

function validateDob(v: string): string | null {
  const s = v.trim();
  if (!s) return 'Vui lòng nhập ngày sinh.';
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (!m) return 'Ngày sinh phải theo định dạng dd/mm/yyyy.';
  const day = +m[1], mon = +m[2], year = +m[3];
  const dt = new Date(year, mon - 1, day);
  if (dt.getFullYear() !== year || dt.getMonth() !== mon - 1 || dt.getDate() !== day) return 'Ngày sinh không hợp lệ.';
  if (dt.getTime() > Date.now()) return 'Ngày sinh không được ở tương lai.';
  if (year < 1940) return 'Năm sinh không hợp lệ.';
  return null;
}

function ReadonlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className={ui.label}>{label}</div>
      <div className="mt-1 rounded-lg border border-line bg-slate-50 px-3 h-10 flex items-center text-sm text-ink">
        {value || '—'}
      </div>
    </div>
  );
}

type FErr = { dob?: string; province?: string; ward?: string; street?: string };

export default function DefermentRequestPage() {
  const [form, setForm] = useState<DefermentFormData | null>(null);
  const [loadError, setLoadError] = useState('');

  const [dob, setDob] = useState('');
  const [provinces, setProvinces] = useState<Province[]>([]);
  const [wards, setWards] = useState<Ward[]>([]);
  const [wardsLoading, setWardsLoading] = useState(false);
  const [provinceCode, setProvinceCode] = useState('');
  const [wardCode, setWardCode] = useState('');
  const [street, setStreet] = useState('');
  const [note, setNote] = useState('');
  const pendingWardRef = useRef('');   // ward_code prefill, set sau khi nạp xong danh sách xã

  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FErr>({});

  useEffect(() => {
    api.requests.defermentForm()
      .then((data) => {
        setForm(data);
        setDob(data.prefill.dob);
        setStreet(data.prefill.street);
        pendingWardRef.current = data.prefill.ward_code || '';
        setProvinceCode(data.prefill.province_code || '');   // trigger nạp xã + pre-select
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Không tải được thông tin sinh viên.'));
    api.locations.provinces().then(setProvinces).catch(() => {});
  }, []);

  // Nạp phường/xã khi đổi tỉnh; pre-select nếu có prefill khớp
  useEffect(() => {
    if (!provinceCode) { setWards([]); setWardCode(''); return; }
    setWardsLoading(true);
    api.locations.wards(provinceCode)
      .then((ws) => {
        setWards(ws);
        const pending = pendingWardRef.current;
        pendingWardRef.current = '';
        setWardCode((prev) => {
          if (pending && ws.some((w) => w.code === pending)) return pending;
          return prev && ws.some((w) => w.code === prev) ? prev : '';
        });
      })
      .catch(() => { setWards([]); setWardCode(''); })
      .finally(() => setWardsLoading(false));
  }, [provinceCode]);

  const dobChanged = form ? dob.trim() !== form.prefill.dob.trim() : false;
  const addressLocked = !!form?.prefill.address_locked;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs: FErr = {};
    const de = validateDob(dob); if (de) errs.dob = de;
    if (!addressLocked) {
      if (!provinceCode) errs.province = 'Vui lòng chọn tỉnh/thành.';
      if (!wardCode) errs.ward = 'Vui lòng chọn phường/xã.';
      if (!street.trim()) errs.street = 'Vui lòng nhập số nhà, tên đường.';
    }
    setFieldErrors(errs);
    if (Object.keys(errs).length) { setError('Vui lòng kiểm tra lại các trường được đánh dấu.'); return; }
    setError('');
    setLoading(true);
    try {
      await api.requests.createDeferment({
        dob: dob.trim(),
        province_code: provinceCode,
        ward_code: wardCode,
        street: street.trim(),
        note: note.trim() || undefined,
      });
      setSuccess(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gửi yêu cầu thất bại. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  }

  if (loadError) {
    return (
      <div className="max-w-[760px]">
        <div className="flex items-start gap-2.5 px-4 py-3 rounded-lg bg-danger-soft border border-danger-line text-danger-text text-sm">
          <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />{loadError}
        </div>
      </div>
    );
  }
  if (!form) {
    return <div className="flex items-center justify-center py-20 text-muted"><Loader2 size={22} className="animate-spin mr-2" /> Đang tải…</div>;
  }

  if (success) {
    return (
      <div className="max-w-[760px]">
        <div className={cn(ui.card, 'p-8 text-center')}>
          <div className="w-11 h-11 rounded-full bg-success-soft border border-success-line flex items-center justify-center mx-auto mb-4">
            <Check size={22} className="text-success-text" />
          </div>
          <h2 className="text-lg font-semibold text-ink">Đã gửi yêu cầu</h2>
          <p className="text-sm text-muted mt-2">Phòng CTSV sẽ phản hồi trong thời gian sớm nhất.</p>
          <div className="mt-6"><Link href="/dashboard" className={ui.btnPrimary}>Về Bảng thông tin</Link></div>
        </div>
      </div>
    );
  }

  const p = form.prefill;

  return (
    <div className="max-w-[760px] space-y-4">
      <nav className="flex items-center gap-1.5 text-[0.82rem] text-muted">
        <Link href="/dashboard" className="hover:text-ink">Bảng thông tin</Link>
        <ChevronRight size={14} className="text-slate-400" />
        <Link href="/dashboard/requests/new" className="hover:text-ink">Yêu cầu giấy tờ</Link>
        <ChevronRight size={14} className="text-slate-400" />
        <span className="text-ink font-medium">Hoãn nghĩa vụ quân sự</span>
      </nav>

      <div className={cn(ui.card, 'border-t-2 border-t-primary')}>
        <div className="px-6 py-5 border-b border-line">
          <h1 className="flex items-center gap-2 text-[1.05rem] font-semibold text-ink">
            <FileText size={17} className="text-primary" />
            Giấy xác nhận sinh viên — Hoãn nghĩa vụ quân sự
          </h1>
          <p className="text-sm text-muted mt-1">Kiểm tra thông tin, chuẩn hóa lại địa chỉ thường trú theo đơn vị hành chính hiện hành rồi gửi yêu cầu.</p>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-6">
          {error && (
            <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-lg bg-danger-soft border border-danger-line text-danger-text text-sm">
              <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />{error}
            </div>
          )}

          {/* Thông tin chỉ xem */}
          <div>
            <h2 className="text-[0.82rem] font-semibold text-muted mb-2.5">Thông tin sinh viên</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              <ReadonlyField label="Họ và tên" value={p.student_name} />
              <ReadonlyField label="Mã số sinh viên" value={p.student_id} />
              <ReadonlyField label="Khoa" value={p.department} />
              <ReadonlyField label="Trạng thái" value={p.cur_status_vi} />
              <ReadonlyField label="Thời gian nhập học" value={p.start_label} />
              <ReadonlyField label="Ra trường đúng tiến độ" value={p.graduation_label} />
              <ReadonlyField label="Thời gian đào tạo tối đa" value={p.max_label} />
            </div>
          </div>

          {/* Ngày sinh */}
          <div className="sm:max-w-[260px]">
            <label className={ui.fieldLabel}>
              Ngày sinh (dd/mm/yyyy)
              {dobChanged && (
                <span className="ml-1.5 inline-flex items-center gap-0.5 text-[0.75rem] font-normal text-warning-text">
                  <PencilLine size={11} /> sẽ gửi duyệt
                </span>
              )}
            </label>
            <input
              type="text" value={dob} maxLength={10} inputMode="numeric"
              onChange={(e) => { setDob(e.target.value); setFieldErrors((f) => ({ ...f, dob: undefined })); }}
              placeholder="dd/mm/yyyy"
              className={cn(ui.input, fieldErrors.dob ? 'border-danger-line focus:border-danger-line focus:ring-red-100' : dobChanged && 'border-warning-line')}
            />
            {fieldErrors.dob && <p className="mt-1 text-[0.75rem] text-danger-text">{fieldErrors.dob}</p>}
          </div>

          {/* Địa chỉ thường trú — chuẩn hóa */}
          <div>
            <h2 className="text-[0.82rem] font-semibold text-muted mb-2.5">Địa chỉ thường trú</h2>

            {addressLocked ? (
              <div>
                <div className={ui.label}>Địa chỉ thường trú</div>
                <div className="mt-1 rounded-lg border border-line bg-slate-50 px-3 py-2.5 text-sm text-ink">
                  {p.address_display || '—'}
                </div>
              </div>
            ) : (
              <>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className={ui.fieldLabel}>Tỉnh / Thành phố <span className="text-red-500">*</span></label>
                    <select
                      value={provinceCode}
                      onChange={(e) => { setProvinceCode(e.target.value); setFieldErrors((f) => ({ ...f, province: undefined, ward: undefined })); }}
                      className={cn(ui.input, 'bg-white', fieldErrors.province && 'border-danger-line')}
                    >
                      <option value="">— Chọn tỉnh/thành —</option>
                      {provinces.map((pv) => <option key={pv.code} value={pv.code}>{pv.name}</option>)}
                    </select>
                    {fieldErrors.province && <p className="mt-1 text-[0.75rem] text-danger-text">{fieldErrors.province}</p>}
                  </div>
                  <div>
                    <label className={ui.fieldLabel}>Phường / Xã <span className="text-red-500">*</span></label>
                    <select
                      value={wardCode}
                      disabled={!provinceCode || wardsLoading}
                      onChange={(e) => { setWardCode(e.target.value); setFieldErrors((f) => ({ ...f, ward: undefined })); }}
                      className={cn(ui.input, 'bg-white disabled:bg-slate-50 disabled:text-slate-400', fieldErrors.ward && 'border-danger-line')}
                    >
                      <option value="">{!provinceCode ? '— Chọn tỉnh trước —' : wardsLoading ? 'Đang tải…' : '— Chọn phường/xã —'}</option>
                      {wards.map((w) => <option key={w.code} value={w.code}>{w.name}</option>)}
                    </select>
                    {fieldErrors.ward && <p className="mt-1 text-[0.75rem] text-danger-text">{fieldErrors.ward}</p>}
                  </div>
                </div>
                <div className="mt-3">
                  <label className={ui.fieldLabel}>Số nhà, tên đường <span className="text-red-500">*</span></label>
                  <input
                    type="text" value={street} maxLength={255}
                    onChange={(e) => { setStreet(e.target.value); setFieldErrors((f) => ({ ...f, street: undefined })); }}
                    placeholder="Ví dụ: 123 Lê Lợi, Khu phố 4…"
                    className={cn(ui.input, fieldErrors.street && 'border-danger-line')}
                  />
                  {fieldErrors.street && <p className="mt-1 text-[0.75rem] text-danger-text">{fieldErrors.street}</p>}
                </div>
                <p className="mt-2 text-[0.78rem] text-muted">
                  Địa chỉ chuẩn hóa sẽ được gửi cho Phòng CTSV duyệt và cập nhật vào hồ sơ của bạn.
                </p>
              </>
            )}
          </div>

          {/* Ghi chú */}
          <div>
            <label className={ui.fieldLabel}>Ghi chú thêm <span className="text-muted font-normal">(không bắt buộc)</span></label>
            <textarea
              value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000}
              placeholder="Số bản in, yêu cầu đặc biệt…" className={ui.textarea}
            />
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-line -mx-6 px-6 -mb-5 pb-5">
            <Link href="/dashboard/requests/new" className={ui.btnGhost}>
              <ArrowLeft size={15} /> Quay lại
            </Link>
            <button type="submit" disabled={loading} className={ui.btnPrimary}>
              {loading && <Loader2 size={15} className="animate-spin" />}
              {loading ? 'Đang gửi…' : 'Gửi yêu cầu'}
            </button>
          </div>
        </form>
      </div>

      <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-slate-50 border-l-2 border-primary">
        <Info size={16} className="text-primary flex-shrink-0 mt-0.5" />
        <p className="text-[0.85rem] text-slate-600 leading-relaxed">
          Giấy sẽ dùng địa chỉ bạn vừa chuẩn hóa. Thời gian xử lý thông thường:{' '}
          <strong className="text-ink font-medium">1–3 ngày làm việc</strong>.
        </p>
      </div>
    </div>
  );
}
