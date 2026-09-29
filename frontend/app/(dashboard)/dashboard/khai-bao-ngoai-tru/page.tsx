'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle, Check, ChevronRight, Home, Loader2, PencilLine, ShieldCheck,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { ui, badge } from '@/lib/ui';
import { cn } from '@/lib/utils';
import type { OffCampusForm, Province } from '@/lib/types';
import { DeclarationFields, DeclarationSummary, useDeclarationDraft } from './DeclarationForm';
import { FormBusy } from '@/components/form-busy';

/* Thân form (3 khối cá nhân / thường trú / tạm trú) và trạng thái đang nhập nằm ở
   DeclarationForm.tsx — dùng chung với phần 1 của trang Khám sức khỏe. */

export default function OffCampusDeclarationPage() {
  const [form, setForm] = useState<OffCampusForm | null>(null);
  const [provinces, setProvinces] = useState<Province[]>([]);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [asking, setAsking] = useState(false);
  const [askReason, setAskReason] = useState('');
  const draft = useDeclarationDraft(form);

  useEffect(() => {
    api.offcampus
      .form()
      .then(setForm)
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : 'Không tải được dữ liệu.'));
    api.locations.provinces().then(setProvinces).catch(() => {});
  }, []);

  if (loadError) {
    return (
      <div className="max-w-[820px]">
        <div className="flex items-start gap-2.5 px-4 py-3 rounded-lg bg-danger-soft border border-danger-line text-danger-text text-sm">
          <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />{loadError}
        </div>
      </div>
    );
  }
  if (!form) {
    return (
      <div className="flex items-center justify-center py-20 text-muted">
        <Loader2 size={22} className="animate-spin mr-2" /> Đang tải…
      </div>
    );
  }

  if (success) {
    return (
      <div className="max-w-[820px]">
        <div className={cn(ui.card, 'p-8 text-center')}>
          <div className="w-11 h-11 rounded-full bg-success-soft border border-success-line flex items-center justify-center mx-auto mb-4">
            <Check size={22} className="text-success-text" />
          </div>
          <h2 className="text-lg font-semibold text-ink">Đã ghi nhận khai báo</h2>
          <p className="text-sm text-muted mt-2">
            Thông tin đã được cập nhật vào hồ sơ. Cần sửa lại thì gửi yêu cầu
            chỉnh sửa ở màn hình xem lại.
          </p>
          <div className="mt-6 flex items-center justify-center gap-2">
            <Link href="/dashboard" className={ui.btnPrimary}>Về Bảng thông tin</Link>
            <button type="button" className={ui.btnOutline}
                    onClick={() => { setSuccess(false); window.location.reload(); }}>
              Xem lại khai báo
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Đã khai và chưa được mở lại → chỉ xem, không hiện form.
  if (form.locked) {
    return (
      <div className="max-w-[820px] space-y-4">
        <nav className="flex items-center gap-1.5 text-[0.82rem] text-muted">
          <Link href="/dashboard" className="hover:text-ink">Bảng thông tin</Link>
          <ChevronRight size={14} className="text-slate-400" />
          <span className="text-ink font-medium">Khai báo ngoại trú</span>
        </nav>

        <div className={cn(ui.card, 'border-t-2 border-t-primary')}>
          <div className="px-6 py-5 border-b border-line">
            <h1 className="flex items-center gap-2 text-[1.05rem] font-semibold text-ink">
              <ShieldCheck size={17} className="text-success-text" />
              Bạn đã hoàn tất khai báo
            </h1>
            <p className="text-sm text-muted mt-1">
              {form.declared_on
                ? `Bạn đã gửi khai báo ngày ${new Date(form.declared_on).toLocaleDateString('vi-VN')}. `
                : ''}
              Thông tin bên dưới đang được dùng làm hồ sơ chính thức. Nếu có thay đổi,
              vui lòng gửi yêu cầu chỉnh sửa để Phòng Công tác Sinh viên mở lại biểu mẫu.
            </p>
          </div>

          <div className="px-6 py-5 space-y-6">
            <DeclarationSummary form={form} />

            {!form.reopen_requested && (
              <div>
                <label className="block text-[0.78rem] text-muted mb-1">
                  Lý do cần chỉnh sửa <span className="text-slate-400">(không bắt buộc)</span>
                </label>
                <input
                  type="text" value={askReason} maxLength={255}
                  placeholder="Ví dụ: đã chuyển chỗ trọ, sai số nhà…"
                  onChange={(e) => setAskReason(e.target.value)}
                  className={cn(ui.input, 'h-9 text-[0.85rem]')}
                />
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              {form.reopen_requested ? (
                <span className={cn(badge.base, badge.warning)}>
                  Đã gửi yêu cầu chỉnh sửa
                  {form.reopen_requested_at ? ` ngày ${form.reopen_requested_at}` : ''} — chờ phòng CTSV xử lý
                </span>
              ) : (
                <button
                  type="button"
                  className={ui.btnOutline}
                  disabled={asking}
                  onClick={async () => {
                    setAsking(true);
                    setError('');
                    try {
                      await api.offcampus.requestReopen(askReason.trim());
                      const fresh = await api.offcampus.form();
                      setForm(fresh);
                    } catch (e) {
                      setError(e instanceof ApiError ? e.message : 'Không gửi được yêu cầu.');
                    } finally {
                      setAsking(false);
                    }
                  }}
                >
                  {asking ? <><Loader2 size={15} className="animate-spin" /> Đang gửi…</>
                          : <><PencilLine size={15} /> Yêu cầu chỉnh sửa lại</>}
                </button>
              )}
              <Link href="/dashboard" className={ui.btnPrimary}>Về Bảng thông tin</Link>
            </div>
            {error && (
              <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-danger-soft border border-danger-line text-danger-text text-sm">
                <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />{error}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setError('');
    draft.setFieldErrors({});

    // Chặn sớm ở client cho các ô bắt buộc — lỗi còn lại để server quyết.
    const local = draft.validate();
    if (Object.keys(local).length) {
      draft.setFieldErrors(local);
      setError('Vui lòng kiểm tra lại các ô được đánh dấu.');
      return;
    }

    setSaving(true);
    try {
      await api.offcampus.submit(draft.payload());
      setSuccess(true);
    } catch (e) {
      if (e instanceof ApiError && e.data?.errors) {
        draft.setFieldErrors(e.data.errors as Record<string, string>);
        setError('Vui lòng kiểm tra lại các ô được đánh dấu.');
      } else {
        setError(e instanceof ApiError ? e.message : 'Không gửi được khai báo.');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-[820px] space-y-4">
      <nav className="flex items-center gap-1.5 text-[0.82rem] text-muted">
        <Link href="/dashboard" className="hover:text-ink">Bảng thông tin</Link>
        <ChevronRight size={14} className="text-slate-400" />
        <span className="text-ink font-medium">Khai báo ngoại trú</span>
      </nav>

      <div className={cn(ui.card, 'border-t-2 border-t-primary')}>
        <div className="px-6 py-5 border-b border-line">
          <h1 className="flex items-center gap-2 text-[1.05rem] font-semibold text-ink">
            <Home size={17} className="text-primary" />
            Khai báo thông tin ngoại trú
          </h1>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5">
          <FormBusy busy={saving} label="Đang gửi khai báo…" className="space-y-7">
          {error && (
            <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-lg bg-danger-soft border border-danger-line text-danger-text text-sm">
              <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />{error}
            </div>
          )}

          <DeclarationFields form={form} draft={draft} provinces={provinces} />

          <div className="flex items-center justify-end gap-2 pt-1 border-t border-line2">
            <Link href="/dashboard" className={ui.btnGhost}>Hủy</Link>
            <button type="submit" disabled={saving} className={ui.btnPrimary}>
              {saving ? <><Loader2 size={15} className="animate-spin" /> Đang gửi…</> : 'Gửi khai báo'}
            </button>
          </div>
          </FormBusy>
        </form>
      </div>
    </div>
  );
}
