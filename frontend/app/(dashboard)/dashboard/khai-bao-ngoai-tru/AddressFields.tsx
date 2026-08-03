'use client';

import { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { api } from '@/lib/api';
import { ui } from '@/lib/ui';
import { cn } from '@/lib/utils';
import type { Province, Ward } from '@/lib/types';

export interface AddressValue {
  provinceCode: string;
  wardCode: string;
  street: string;
}

interface Props {
  value: AddressValue;
  onChange: (next: AddressValue) => void;
  provinces: Province[];
  /** Khóa ô tỉnh (nhánh "tạm trú tại TP.HCM") */
  lockedProvinceCode?: string;
  errors?: { province?: string; ward?: string; street?: string };
  /** Nhắc khi tỉnh cũ đã bị sáp nhập, hoặc gợi ý khác */
  hint?: string;
  idPrefix: string;
}

const STREET_PLACEHOLDER = 'Ví dụ: 123 Nguyễn Văn Cừ, Khu phố 3';

export default function AddressFields({
  value, onChange, provinces, lockedProvinceCode, errors = {}, hint, idPrefix,
}: Props) {
  const [wards, setWards] = useState<Ward[]>([]);
  const [loading, setLoading] = useState(false);

  const provinceCode = lockedProvinceCode ?? value.provinceCode;

  useEffect(() => {
    if (!provinceCode) { setWards([]); return; }
    let alive = true;
    setLoading(true);
    api.locations
      .wards(provinceCode)
      .then((rows) => { if (alive) setWards(rows); })
      .catch(() => { if (alive) setWards([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [provinceCode]);

  const lockedProvince = lockedProvinceCode
    ? provinces.find((p) => p.code === lockedProvinceCode)
    : undefined;

  return (
    <div className="space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className={ui.fieldLabel} htmlFor={`${idPrefix}-province`}>
            Tỉnh / Thành phố <span className="text-red-500">*</span>
          </label>
          {lockedProvinceCode ? (
            <div className="flex items-center gap-2 h-10 px-3 rounded-lg border border-line bg-slate-50 text-sm text-ink">
              <Lock size={13} className="text-slate-400 flex-shrink-0" />
              {lockedProvince?.name ?? 'Thành phố Hồ Chí Minh'}
            </div>
          ) : (
            <select
              id={`${idPrefix}-province`}
              value={value.provinceCode}
              onChange={(e) => onChange({ ...value, provinceCode: e.target.value, wardCode: '' })}
              className={cn(ui.input, 'bg-white', errors.province && 'border-danger-line')}
            >
              <option value="">— Chọn tỉnh/thành —</option>
              {provinces.map((p) => (
                <option key={p.code} value={p.code}>{p.name}</option>
              ))}
            </select>
          )}
          {errors.province && (
            <p className="mt-1 text-[0.75rem] text-danger-text">{errors.province}</p>
          )}
        </div>

        <div>
          <label className={ui.fieldLabel} htmlFor={`${idPrefix}-ward`}>
            Phường / Xã <span className="text-red-500">*</span>
          </label>
          <select
            id={`${idPrefix}-ward`}
            value={value.wardCode}
            disabled={!provinceCode || loading}
            onChange={(e) => onChange({ ...value, wardCode: e.target.value })}
            className={cn(
              ui.input,
              'bg-white disabled:bg-slate-50 disabled:text-slate-400',
              errors.ward && 'border-danger-line',
            )}
          >
            <option value="">
              {!provinceCode ? '— Chọn tỉnh trước —' : loading ? 'Đang tải…' : '— Chọn phường/xã —'}
            </option>
            {wards.map((w) => (
              <option key={w.code} value={w.code}>{w.name}</option>
            ))}
          </select>
          {errors.ward && <p className="mt-1 text-[0.75rem] text-danger-text">{errors.ward}</p>}
        </div>
      </div>

      <div>
        <label className={ui.fieldLabel} htmlFor={`${idPrefix}-street`}>
          Địa chỉ chi tiết <span className="text-red-500">*</span>
        </label>
        <input
          id={`${idPrefix}-street`}
          type="text"
          value={value.street}
          maxLength={255}
          placeholder={STREET_PLACEHOLDER}
          onChange={(e) => onChange({ ...value, street: e.target.value })}
          className={cn(ui.input, errors.street && 'border-danger-line')}
        />
        {errors.street ? (
          <p className="mt-1 text-[0.75rem] text-danger-text">{errors.street}</p>
        ) : (
          <ul className="mt-1.5 space-y-0.5 text-[0.75rem] text-muted">
            <li>• Chỉ ghi <b>số nhà, tên đường, thôn/ấp/khu phố</b>.</li>
            <li>• <b>Không</b> nhập lại phường/xã, quận/huyện, tỉnh/thành đã chọn ở trên.</li>
            <li>• Viết hoa chữ cái đầu mỗi từ, <b>không viết tắt</b> (ghi “Khu phố 3”, không ghi “KP.3”).</li>
          </ul>
        )}
      </div>

      {hint && (
        <div className="flex gap-2 px-3 py-2 rounded-lg bg-warning-soft border border-warning-line text-[0.78rem] text-warning-text">
          {hint}
        </div>
      )}
    </div>
  );
}
