"use client";

import React, { useEffect, useState, useRef, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useForm, Controller, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  ChevronRight, Home, Loader2, User, ShieldPlus, FileText,
  Lock, Unlock, Plus, CreditCard, CheckSquare
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { ui } from "@/lib/ui";
import { cn } from "@/lib/utils";
import type { Province } from "@/lib/types";
import AddressFields from "../../khai-bao-ngoai-tru/AddressFields";
import { getInsurancePeriods } from "@/lib/insurance-periods";

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"];

const fileSchema = z
  .any()
  .refine((files) => files?.length > 0, "Vui lòng chọn file.")
  .refine((files) => files?.[0]?.size <= MAX_FILE_SIZE, "Kích thước file tối đa là 5MB.")
  .refine(
    (files) => ACCEPTED_IMAGE_TYPES.includes(files?.[0]?.type),
    "Chỉ chấp nhận file ảnh (JPEG, PNG, WEBP, HEIC)."
  );

const schema = z.object({
  full_name: z.string().min(1, "Vui lòng nhập họ tên"),
  student_code: z.string().min(1, "Vui lòng nhập MSSV"),
  gender: z.enum(["Nam", "Nữ"]),
  dob: z.string().min(1, "Vui lòng nhập ngày sinh"),
  ethnicity: z.string().min(1, "Vui lòng chọn dân tộc"),
  phone_number: z.string().regex(/^(0|\+84)\d{9,10}$/, "Số điện thoại không hợp lệ"),
  social_insurance_number: z.string().optional(),
  citizen_id: z.string().regex(/^\d{9,12}$/, "Số CCCD phải từ 9-12 số"),
  permanent: z.object({
    provinceCode: z.string().min(1, "Vui lòng chọn tỉnh/thành"),
    wardCode: z.string().min(1, "Vui lòng chọn phường/xã"),
    street: z.string().min(1, "Vui lòng nhập số nhà, đường"),
  }),
  hospital_code: z.string().min(1, "Vui lòng chọn KCB ban đầu"),
  note: z.string().optional(),
  cccd_image: fileSchema,
  bhyt_image: z.any().optional(),
  payment_receipt_image: fileSchema,
  confirm_declaration: z.boolean().refine((val) => val === true, {
    message: "Bạn phải đồng ý với các điều khoản."
  }),
});

type FormData = z.infer<typeof schema>;

export default function InsuranceRegistrationPage() {
  return (
    <React.Suspense fallback={<div className="p-10 flex justify-center text-muted"><Loader2 className="animate-spin" /></div>}>
      <InsuranceRegistrationForm />
    </React.Suspense>
  );
}

function InsuranceRegistrationForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const periodId = searchParams.get("period") || "";
  const currentYear = new Date().getFullYear();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [isLocked, setIsLocked] = useState(true);

  const [provinces, setProvinces] = useState<Province[]>([]);
  const [ethnicities, setEthnicities] = useState<{ code: string; name: string }[]>([]);
  const [hospitals, setHospitals] = useState<{ code: string; name: string }[]>([]);
  const [hospitalSearch, setHospitalSearch] = useState("");
  const [hospitalProvince, setHospitalProvince] = useState("");

  // Sử dụng useMemo để giữ nguyên reference của periodObj giữa các lần render.
  // Điều này giúp ngăn chặn useEffect bên dưới bị kích hoạt lại liên tục khi state thay đổi,
  // khắc phục lỗi vòng lặp vô hạn (infinite loop) khi gọi API.
  const periodObj = useMemo(() => getInsurancePeriods().find((p) => p.id === periodId), [periodId]);
  const [config, setConfig] = useState<any>(null);

  const {
    watch,
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors }
  } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  useEffect(() => {
    let alive = true;
    if (!periodObj) {
      router.push("/dashboard/bao-hiem-y-te");
      return;
    }
    if (periodObj.status !== "open") {
      setIsLocked(true);
    }

    Promise.all([
      api.insuranceRegistration.prefill(),
      api.locations.provinces(),
      api.locations.ethnicities(),
    ])
      .then(([pref, provs, eths]) => {
        if (!alive) return;
        const p = pref.prefill;
        setValue("full_name", p.full_name);
        setValue("student_code", p.student_code);
        setValue("gender", p.gender as "Nam"|"Nữ");
        setValue("dob", p.dob);
        setValue("phone_number", p.phone_number);
        setValue("citizen_id", p.citizen_id);
        setValue("social_insurance_number", p.social_insurance_number);
        setValue("permanent", {
          provinceCode: p.permanent_province,
          wardCode: p.permanent_ward,
          street: p.permanent_street
        });

        setProvinces(provs);
        setEthnicities(eths);
        if (pref.config) {
          setConfig(pref.config);
        }
        if (p.existing_registration_id) {
          setIsLocked(true);
        }
        // Tắt trạng thái loading khi tải thành công
        setLoading(false);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err instanceof ApiError ? err.message : "Lỗi tải dữ liệu");
        // Tắt trạng thái loading khi có lỗi
        setLoading(false);
      });

    return () => { alive = false; };
  }, [periodObj, router, setValue]);

  useEffect(() => {
    if (!hospitalProvince) {
      setHospitals([]);
      return;
    }
    const timer = setTimeout(() => {
      api.hospitals.search(hospitalProvince, hospitalSearch).then(setHospitals).catch(console.error);
    }, 300);
    return () => clearTimeout(timer);
  }, [hospitalSearch, hospitalProvince]);

  const onSubmit = async (data: FormData) => {
    setSaving(true);
    setError("");

    try {
      const fd = new FormData();
      fd.append("registration_year", currentYear.toString());
      fd.append("registration_period", periodObj?.id.toUpperCase() || "MAIN");
      fd.append("full_name", data.full_name);
      fd.append("student_code", data.student_code);
      fd.append("gender", data.gender);
      fd.append("dob", data.dob);
      fd.append("ethnicity", data.ethnicity);
      fd.append("phone_number", data.phone_number);
      if (data.social_insurance_number) fd.append("social_insurance_number", data.social_insurance_number);
      fd.append("citizen_id", data.citizen_id);
      
      fd.append("permanent_province", data.permanent.provinceCode);
      fd.append("permanent_ward", data.permanent.wardCode);
      fd.append("permanent_street", data.permanent.street);
      
      fd.append("hospital_code", data.hospital_code);
      if (data.note) fd.append("note", data.note);

      fd.append("cccd_image", data.cccd_image[0]);
      if (data.bhyt_image && data.bhyt_image.length > 0) fd.append("bhyt_image", data.bhyt_image[0]);
      fd.append("payment_receipt_image", data.payment_receipt_image[0]);

      await api.insuranceRegistration.submit(fd);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Đã có lỗi xảy ra");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex justify-center h-64 text-muted"><Loader2 size={26} className="animate-spin mt-10" /></div>;

  if (success) {
    return (
      <div className="max-w-xl mx-auto mt-10 p-8 bg-white border border-line rounded-xl shadow-sm text-center">
        <div className="w-16 h-16 bg-success-soft text-success-text rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckSquare size={32} />
        </div>
        <h2 className="text-xl font-semibold text-ink mb-2">Đăng ký thành công</h2>
        <p className="text-slate-600 mb-6">Yêu cầu đăng ký BHYT của bạn đã được ghi nhận. Phòng CTSV sẽ kiểm tra và cập nhật trạng thái trong thời gian sớm nhất.</p>
        <Link href="/dashboard/bao-hiem-y-te" className={ui.btnPrimary}>Quay lại trang BHYT</Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted">
        <Link href="/dashboard" className="hover:text-primary flex items-center gap-1.5"><Home size={14} /> Trang chủ</Link>
        <ChevronRight size={14} />
        <Link href="/dashboard/bao-hiem-y-te" className="hover:text-primary">Bảo hiểm Y tế</Link>
        <ChevronRight size={14} />
        <span className="font-medium text-ink">Đăng ký BHYT</span>
      </div>

      <div className="bg-primary-soft border border-primary-line rounded-lg p-5 text-primary-text">
        <h1 className="text-lg font-bold mb-2 flex items-center gap-2">
          <ShieldPlus size={20} /> Khai thông tin Đăng ký BHYT {periodObj?.name} năm {currentYear}
        </h1>
        {config?.description ? (
          <div className="text-sm mt-3" dangerouslySetInnerHTML={{ __html: config.description.replace(/\n/g, '<br />') }} />
        ) : (
          <ul className="text-sm space-y-1 mt-3">
            <li><strong>Đối tượng:</strong> Sinh viên bắt buộc tham gia BHYT theo quy định.</li>
            <li><strong>Thời hạn:</strong> 01/01 - 31/12 (Tùy đợt đăng ký).</li>
            <li><strong>Lệ phí:</strong> 631.800 đồng/sinh viên.</li>
          </ul>
        )}
      </div>

      {error && <div className="p-4 bg-danger-soft border border-danger-line text-danger-text rounded-lg text-sm">{error}</div>}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <fieldset disabled={isLocked} className="space-y-6">
          
        <div className={ui.card}>
          <div className={ui.cardHeader}>
            <h2 className={ui.sectionTitle}><User size={16} className="text-primary" /> Thông tin cá nhân</h2>
            {isLocked ? (
              <span className="text-xs font-medium text-slate-500 flex items-center gap-1.5 px-3 py-1.5"><Lock size={12} /> Đã khóa</span>
            ) : (
              <span className="text-xs font-medium text-primary flex items-center gap-1.5 px-3 py-1.5"><Unlock size={12} /> Đang chỉnh sửa</span>
            )}
          </div>
          
          <div className="p-5 space-y-6">
            <div className="grid sm:grid-cols-2 gap-5">
              <div>
                <label className={ui.fieldLabel}>Họ và tên</label>
                <input {...register("full_name")} disabled={isLocked} className={cn(ui.input, isLocked && "bg-slate-50 text-slate-500")} />
                {errors.full_name && <p className="text-xs text-danger-text mt-1">{errors.full_name.message}</p>}
              </div>
              <div>
                <label className={ui.fieldLabel}>Mã số sinh viên</label>
                <input {...register("student_code")} disabled={isLocked} className={cn(ui.input, isLocked && "bg-slate-50 text-slate-500")} />
              </div>
              <div>
                <label className={ui.fieldLabel}>Giới tính</label>
                <select {...register("gender")} disabled={isLocked} className={cn(ui.input, isLocked && "bg-slate-50 text-slate-500")}>
                  <option value="Nam">Nam</option>
                  <option value="Nữ">Nữ</option>
                </select>
              </div>
              <div>
                <label className={ui.fieldLabel}>Ngày sinh</label>
                <input type="date" {...register("dob")} disabled={isLocked} className={cn(ui.input, isLocked && "bg-slate-50 text-slate-500")} />
              </div>
              <div>
                <label className={ui.fieldLabel}>Dân tộc</label>
                <select {...register("ethnicity")} disabled={isLocked} className={cn(ui.input, isLocked && "bg-slate-50 text-slate-500")}>
                  <option value="">-- Chọn dân tộc --</option>
                  {ethnicities.map((e) => <option key={e.code} value={e.name}>{e.name}</option>)}
                </select>
              </div>
              <div>
                <label className={ui.fieldLabel}>Số điện thoại</label>
                <input {...register("phone_number")} disabled={isLocked} className={cn(ui.input, isLocked && "bg-slate-50 text-slate-500")} />
                {errors.phone_number && <p className="text-xs text-danger-text mt-1">{errors.phone_number.message}</p>}
              </div>
              <div>
                <label className={ui.fieldLabel}>Số CCCD</label>
                <input {...register("citizen_id")} disabled={isLocked} className={cn(ui.input, isLocked && "bg-slate-50 text-slate-500")} />
                {errors.citizen_id && <p className="text-xs text-danger-text mt-1">{errors.citizen_id.message}</p>}
              </div>
              <div>
                <label className={ui.fieldLabel}>Số sổ BHXH (Nếu có)</label>
                <input {...register("social_insurance_number")} disabled={isLocked} className={cn(ui.input, isLocked && "bg-slate-50 text-slate-500")} />
              </div>
            </div>

            <div className="pt-4 border-t border-line2">
              <h3 className="text-sm font-semibold mb-3">Thường trú</h3>
              <Controller control={control} name="permanent" render={({ field }) => (
                <div className={cn("transition-opacity", isLocked && "opacity-70 pointer-events-none")}>
                  <AddressFields idPrefix="perm" value={field.value || { provinceCode: "", wardCode: "", street: "" }} onChange={field.onChange} provinces={provinces} errors={{ province: errors.permanent?.provinceCode?.message, ward: errors.permanent?.wardCode?.message, street: errors.permanent?.street?.message }} />
                </div>
              )} />
            </div>


          </div>
        </div>
        </fieldset>
        {/* Các phần dưới đây luôn mở */}

        <div className={ui.card}>
          <div className={ui.cardHeader}>
            <h2 className={ui.sectionTitle}><ShieldPlus size={16} className="text-primary" /> Nơi KCB</h2>
          </div>
          <div className="p-5 space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className={ui.fieldLabel}>Tỉnh thành bệnh viện</label>
                <select value={hospitalProvince} onChange={(e) => { setHospitalProvince(e.target.value); setValue("hospital_code", ""); }} className={ui.input}>
                  <option value="">-- Chọn --</option>
                  {provinces.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className={ui.fieldLabel}>Tìm kiếm</label>
                <input type="text" value={hospitalSearch} onChange={(e) => setHospitalSearch(e.target.value)} disabled={!hospitalProvince} className={ui.input} placeholder="Gõ tên..." />
              </div>
            </div>
            <div>
              <label className={ui.fieldLabel}>Bệnh viện</label>
              <select {...register("hospital_code")} className={cn(ui.input, "h-auto py-2")}>
                <option value="">-- Chọn bệnh viện KCB --</option>
                {hospitals.map((h) => <option key={h.code} value={h.code}>{h.code} - {h.name}</option>)}
              </select>
              {errors.hospital_code && <p className="text-xs text-danger-text mt-1">{errors.hospital_code.message}</p>}
            </div>
          </div>
        </div>

        {/* Thanh toán & Hồ sơ - Chỉ hiển thị khi không khoá */}
          <div className={ui.card}>
            <div className={ui.cardHeader}>
              <h2 className={ui.sectionTitle}><CreditCard size={16} className="text-primary" /> Thanh toán & Hồ sơ</h2>
            </div>
          <div className="p-5 space-y-6">
            <div className="bg-slate-50 p-4 rounded-lg border border-line flex flex-col md:flex-row items-center gap-6">
              <div className="w-32 h-32 bg-white border border-line rounded-lg flex items-center justify-center p-2 flex-shrink-0">
                <div className="w-full h-full border-4 border-slate-800 flex items-center justify-center bg-white">
                  <div className="text-primary font-bold text-xs">VietQR</div>
                </div>
              </div>
              <div>
                <h3 className="font-bold mb-2">Thông tin chuyển khoản</h3>
                <ul className="text-sm text-slate-600 space-y-1">
                  <li>Ngân hàng: <strong>{config?.bank_name || "Vietcombank"}</strong></li>
                  <li>Số tài khoản: <strong>{config?.bank_account_number || "0123456789"}</strong></li>
                  <li>Chủ tài khoản: <strong>{config?.bank_account_name || "ĐẠI HỌC QUỐC TẾ"}</strong></li>
                  <li>Số tiền: <strong className="text-primary text-base">
                    {config?.insurance_fee 
                      ? new Intl.NumberFormat('vi-VN').format(config.insurance_fee) 
                      : "631.800"} VNĐ
                  </strong></li>
                  <li>Nội dung: <strong>BHYT - MSSV - Họ Tên</strong></li>
                </ul>
              </div>
            </div>

            <div className="grid sm:grid-cols-3 gap-5">
              <div>
                <label className={ui.fieldLabel}>Ảnh CCCD (Bắt buộc)</label>
                <div className="relative border-2 border-dashed border-slate-300 rounded-lg p-4 text-center hover:bg-slate-50 transition-colors cursor-pointer group">
                  <input type="file" accept="image/*" {...register("cccd_image")} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-10 h-10 bg-blue-50 text-blue-500 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                      {watch('cccd_image') && watch('cccd_image').length > 0 ? <CheckSquare size={20} className="text-success-text" /> : <Plus size={20} />}
                    </div>
                    <span className="text-sm font-medium text-slate-700">{watch('cccd_image') && watch('cccd_image').length > 0 ? watch('cccd_image')[0].name : 'Tải lên ảnh CCCD'}</span>
                    <span className="text-xs text-slate-500">Kích thước tối đa 5MB</span>
                  </div>
                </div>
                {errors.cccd_image && <p className="text-xs text-danger-text mt-1">{errors.cccd_image.message as string}</p>}
              </div>
              
              <div>
                <label className={ui.fieldLabel}>Bill chuyển khoản (Bắt buộc)</label>
                <div className="relative border-2 border-dashed border-slate-300 rounded-lg p-4 text-center hover:bg-slate-50 transition-colors cursor-pointer group">
                  <input type="file" accept="image/*" {...register("payment_receipt_image")} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-10 h-10 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                      {watch('payment_receipt_image') && watch('payment_receipt_image').length > 0 ? <CheckSquare size={20} className="text-success-text" /> : <CreditCard size={20} />}
                    </div>
                    <span className="text-sm font-medium text-slate-700">{watch('payment_receipt_image') && watch('payment_receipt_image').length > 0 ? watch('payment_receipt_image')[0].name : 'Tải lên biên lai'}</span>
                    <span className="text-xs text-slate-500">Kích thước tối đa 5MB</span>
                  </div>
                </div>
                {errors.payment_receipt_image && <p className="text-xs text-danger-text mt-1">{errors.payment_receipt_image.message as string}</p>}
              </div>
              
              <div>
                <label className={ui.fieldLabel}>Thẻ BHYT cũ (Tuỳ chọn)</label>
                <div className="relative border-2 border-dashed border-slate-300 rounded-lg p-4 text-center hover:bg-slate-50 transition-colors cursor-pointer group">
                  <input type="file" accept="image/*" {...register("bhyt_image")} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-10 h-10 bg-indigo-50 text-indigo-500 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                      {watch('bhyt_image') && watch('bhyt_image').length > 0 ? <CheckSquare size={20} className="text-success-text" /> : <FileText size={20} />}
                    </div>
                    <span className="text-sm font-medium text-slate-700">{watch('bhyt_image') && watch('bhyt_image').length > 0 ? watch('bhyt_image')[0].name : 'Tải lên thẻ BHYT cũ'}</span>
                    <span className="text-xs text-slate-500">Không bắt buộc</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

          <div className={ui.card}>
            <div className="p-5">
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" {...register("confirm_declaration")} className="mt-1 w-5 h-5 rounded border-gray-300 text-primary focus:ring-primary" />
              <div>
                <span className="text-sm font-medium text-ink">Xác nhận đã khai đúng thông tin, đã chuyển khoản và đồng ý cung cấp thông tin cho nhà trường.</span>
                {errors.confirm_declaration && <p className="text-xs text-danger-text mt-1">{errors.confirm_declaration.message}</p>}
              </div>
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <Link href="/dashboard/bao-hiem-y-te" className={ui.btnGhost}>Hủy</Link>
          <button type="submit" disabled={saving || isLocked} className={ui.btnPrimary}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : null} Gửi đăng ký
          </button>
        </div>
      </form>
    </div>
  );
}
