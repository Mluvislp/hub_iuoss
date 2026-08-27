"use client";

import React, { useEffect, useState, useRef, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useForm, Controller, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  ChevronRight, Home, Loader2, User, ShieldPlus, FileText,
  Pencil, Plus, CreditCard, CheckSquare, Copy, Check
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { ui } from "@/lib/ui";
import { cn } from "@/lib/utils";
import type { Province, InsuranceRegistrationPrefill } from "@/lib/types";
import AddressFields from "../../khai-bao-ngoai-tru/AddressFields";
import SearchableSelect from "@/components/searchable-select";
import QRCode from "react-qr-code";
import { buildVietQrPayload, findBank, toAscii } from "@/lib/vietqr";
import { readCccdQr, looksLikeCccdQr } from "@/lib/cccd-qr";
import { getInsurancePeriods } from "@/lib/insurance-periods";

const MAX_FILE_SIZE = 5 * 1024 * 1024;

/**
 * Mã đợt → cách gọi đợt trong NỘI DUNG CHUYỂN KHOẢN.
 *
 * ⚠️ Không trùng với mã đợt: ba đợt phụ được Phòng CTSV đánh số 1/2/3 theo quý,
 * riêng đợt tháng 9 gọi là "đợt chính quý 1 năm sau". Ghi sai số đợt thì nhân viên đối soát
 * nhầm kỳ thu, nên sửa ở đây phải hỏi lại Phòng CTSV.
 */
const PERIOD_IN_NOTE: Record<string, string> = {
  Q2: "dot 2",
  Q3: "dot 3",
  Q4: "dot 4",
  MAIN: "dot chinh",
};
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
  social_insurance_number: z.string().regex(/^\d{10}$/, "Mã BHXH phải bao gồm đúng 10 chữ số cuối của mã BHYT"),
  citizen_id: z.string().regex(/^\d{12}$/, "Số CCCD là 12 số"),
  permanent: z.object({
    provinceCode: z.string().min(1, "Vui lòng chọn tỉnh/thành"),
    wardCode: z.string().min(1, "Vui lòng chọn phường/xã"),
    street: z.string().min(1, "Vui lòng nhập số nhà, đường"),
  }),
  hospital_code: z.string().min(1, "Vui lòng chọn nơi ĐK KCB ban đầu"),
  note: z.string().optional(),
  cccd_image: fileSchema,
  cccd_image_back: fileSchema,
  bhyt_image: z.any().optional(),
  payment_receipt_image: fileSchema,
  confirm_declaration: z.boolean().refine((val) => val === true, {
    message: "Bạn phải đồng ý với các điều khoản."
  }),
});

type FormData = z.infer<typeof schema>;

/** Nút chép nhanh cho số tài khoản và nội dung chuyển khoản. */
function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          // Trình duyệt chặn clipboard (http, quyền bị tắt) — người dùng bôi đen chép tay.
        }
      }}
      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
    >
      {done ? <><Check size={12} /> Đã chép</> : <><Copy size={12} /> Chép</>}
    </button>
  );
}

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

  // Hồ sơ gốc do API trả về. Quy tắc: trường nào ĐÃ ghi nhận thì khóa, trường
  // nào còn trống thì mở sẵn ô nhập. Riêng Số sổ BHXH và Thường trú có nút
  // "Chỉnh sửa" để mở lại.
  const [prefill, setPrefill] = useState<InsuranceRegistrationPrefill | null>(null);
  const [bhxhEditable, setBhxhEditable] = useState(false);

  // Chuỗi QR đọc từ ảnh CCCD. Chỉ để gửi kèm và lưu lại — KHÔNG điền ngược vào
  // form, và KHÔNG hiện thông báo nào ra màn hình sinh viên.
  const [cccdQrRaw, setCccdQrRaw] = useState<string | null>(null);
  const [addressEditable, setAddressEditable] = useState(false);

  const [provinces, setProvinces] = useState<Province[]>([]);
  const [ethnicities, setEthnicities] = useState<{ code: string; name: string }[]>([]);
  const [hospitals, setHospitals] = useState<{ code: string; name: string }[]>([]);
  const [hospitalsLoading, setHospitalsLoading] = useState(false);
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
    Promise.all([
      api.insuranceRegistration.prefill(),
      api.locations.provinces(),
      api.locations.ethnicities(),
    ])
      .then(([pref, provs, eths]) => {
        if (!alive) return;
        const p = pref.prefill;
        setPrefill(p);
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

  // Danh mục dân tộc nạp bất đồng bộ. Phải gán value SAU khi <option> đã render,
  // nếu không thẻ <select> lặng lẽ bỏ qua vì chưa có option nào khớp.
  useEffect(() => {
    if (ethnicities.length > 0 && prefill?.ethnicity) {
      setValue("ethnicity", prefill.ethnicity);
    }
  }, [ethnicities, prefill, setValue]);

  // Nạp toàn bộ cơ sở KCB của tỉnh đã chọn. Không cắt bớt: thiếu ô tìm kiếm
  // riêng thì danh sách phải đủ, nếu không sẽ có cơ sở không cách nào chọn.
  useEffect(() => {
    if (!hospitalProvince) {
      setHospitals([]);
      return;
    }
    let alive = true;
    setHospitalsLoading(true);
    api.hospitals.byProvince(hospitalProvince)
      .then((rows) => { if (alive) setHospitals(rows); })
      .catch(console.error)
      .finally(() => { if (alive) setHospitalsLoading(false); });
    return () => { alive = false; };
  }, [hospitalProvince]);

  // ── Mã QR chuyển khoản ────────────────────────────────────────────────
  // Nội dung bám theo MSSV + họ tên đang hiển thị trên form, nên sinh viên sửa
  // họ tên thì nội dung chuyển khoản đổi theo.
  const studentCode = watch("student_code");
  const fullName = watch("full_name");

  // BIN lấy từ cấu hình trước. Chỉ khi cột bỏ trống mới dò theo tên ngân hàng —
  // dò theo tên là phương án chữa cháy, không phải đường chính.
  const bankBin = useMemo(() => {
    const explicit = String(config?.bank_bin ?? "").trim();
    if (/^\d{6}$/.test(explicit)) return explicit;
    return findBank(config?.bank_name)?.bin ?? null;
  }, [config]);
  // Mẫu Phòng CTSV quy định: "HO VA TEN- MSSV- Thanh toan phi BHYT nam <năm> <đợt>".
  // Bỏ dấu vì nhiều app ngân hàng cắt hỏng nội dung có dấu; họ tên viết hoa cho
  // khớp mẫu.
  const transferNote = useMemo(() => {
    const dot = PERIOD_IN_NOTE[(periodObj?.id ?? "").toUpperCase()] ?? "dot chinh";
    const name = toAscii(fullName ?? "").toUpperCase();
    return toAscii(`${name}- ${studentCode ?? ""}- Thanh toan phi BHYT nam ${currentYear} ${dot}`);
  }, [fullName, studentCode, periodObj, currentYear]);
  const qrPayload = useMemo(() => {
    if (!bankBin || !config?.bank_account_number) return null;
    return buildVietQrPayload({
      bin: bankBin,
      accountNumber: config.bank_account_number,
      amount: config.insurance_fee,
      addInfo: transferNote,
    });
  }, [bankBin, config, transferNote]);

  /** Hồ sơ gốc đã có giá trị cho trường này chưa. */
  const recorded = (v?: string | null) => !!(v && String(v).trim());
  const fieldCls = (locked: boolean) => cn(ui.input, locked && "bg-slate-50 text-slate-500");

  const bhxhLocked = recorded(prefill?.social_insurance_number) && !bhxhEditable;
  const hasAddress = recorded(prefill?.permanent_province)
    && recorded(prefill?.permanent_ward)
    && recorded(prefill?.permanent_street);
  const addressLocked = hasAddress && !addressEditable;

  // Tải ảnh CCCD lên là đọc QR ngay tại máy người dùng, IM LẶNG — không hiện
  // thông báo nào cho sinh viên. Đọc được hay không đều không ảnh hưởng tới
  // việc nộp đơn.
  //
  // Thử CẢ HAI mặt: CCCD gắn chip in QR ở mặt trước, còn thẻ Căn cước mẫu mới
  // (từ 01/07/2024) dời QR sang mặt sau. Không đoán theo mẫu thẻ — ảnh nào ra
  // chuỗi đúng khuôn thì lấy ảnh đó.
  const cccdFrontFile = watch("cccd_image");
  const cccdBackFile = watch("cccd_image_back");
  useEffect(() => {
    const files = [cccdFrontFile?.[0], cccdBackFile?.[0]].filter(Boolean) as File[];
    if (files.length === 0) {
      setCccdQrRaw(null);
      return;
    }

    let alive = true;
    (async () => {
      for (const file of files) {
        let raw: string | null = null;
        try {
          raw = await readCccdQr(file);
        } catch {
          raw = null;
        }
        if (!alive) return;
        if (looksLikeCccdQr(raw)) {
          setCccdQrRaw(raw);
          return;
        }
      }
      if (alive) setCccdQrRaw(null);
    })();

    return () => { alive = false; };
  }, [cccdFrontFile, cccdBackFile]);

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
      fd.append("cccd_image_back", data.cccd_image_back[0]);
      if (data.bhyt_image && data.bhyt_image.length > 0) fd.append("bhyt_image", data.bhyt_image[0]);
      if (cccdQrRaw) fd.append("cccd_qr_raw", cccdQrRaw);
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
        <p className="text-slate-600 mb-6">Yêu cầu đăng ký BHYT của sinh viên đã được ghi nhận. Phòng CTSV sẽ tiến hành gửi hồ sơ lên BHXH để gia hạn/đăng ký mới. BHYT sẽ có hiệu lực từ ngày đầu quý tiếp theo.</p>
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
            <li><strong>Thời hạn:</strong> 01/10/2026 - 31/12/2026.</li>
            <li><strong>Lệ phí:</strong> 170.775 đồng/sinh viên.</li>
          </ul>
        )}
      </div>

      {error && <div className="p-4 bg-danger-soft border border-danger-line text-danger-text rounded-lg text-sm">{error}</div>}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <fieldset className="space-y-6">
          
        <div className={ui.card}>
          <div className={ui.cardHeader}>
            <h2 className={ui.sectionTitle}><User size={16} className="text-primary" /> Thông tin cá nhân</h2>
            <span className="text-xs text-muted">Ô để trống là phần hồ sơ chưa có, mời bạn bổ sung</span>
          </div>
          
          <div className="p-5 space-y-6">
            <div className="grid sm:grid-cols-2 gap-5">
              <div>
                <label className={ui.fieldLabel}>Họ và tên</label>
                <input {...register("full_name")} disabled={recorded(prefill?.full_name)} className={fieldCls(recorded(prefill?.full_name))} />
                {errors.full_name && <p className="text-xs text-danger-text mt-1">{errors.full_name.message}</p>}
              </div>
              <div>
                <label className={ui.fieldLabel}>Mã số sinh viên</label>
                <input {...register("student_code")} disabled={recorded(prefill?.student_code)} className={fieldCls(recorded(prefill?.student_code))} />
              </div>
              <div>
                <label className={ui.fieldLabel}>Giới tính</label>
                <select {...register("gender")} disabled={recorded(prefill?.gender)} className={fieldCls(recorded(prefill?.gender))}>
                  <option value="Nam">Nam</option>
                  <option value="Nữ">Nữ</option>
                </select>
              </div>
              <div>
                <label className={ui.fieldLabel}>Ngày sinh</label>
                <input type="date" {...register("dob")} disabled={recorded(prefill?.dob)} className={fieldCls(recorded(prefill?.dob))} />
              </div>
              <div>
                <label className={ui.fieldLabel}>Dân tộc</label>
                <select {...register("ethnicity")} disabled={recorded(prefill?.ethnicity)} className={fieldCls(recorded(prefill?.ethnicity))}>
                  <option value="">-- Chọn dân tộc --</option>
                  {ethnicities.map((e) => <option key={e.code} value={e.name}>{e.name}</option>)}
                </select>
              </div>
              <div>
                <label className={ui.fieldLabel}>Số điện thoại</label>
                <input {...register("phone_number")} disabled={recorded(prefill?.phone_number)} className={fieldCls(recorded(prefill?.phone_number))} />
                {errors.phone_number && <p className="text-xs text-danger-text mt-1">{errors.phone_number.message}</p>}
              </div>
              <div>
                <label className={ui.fieldLabel}>Số CCCD</label>
                <input {...register("citizen_id")} disabled={recorded(prefill?.citizen_id)} className={fieldCls(recorded(prefill?.citizen_id))} />
                {errors.citizen_id && <p className="text-xs text-danger-text mt-1">{errors.citizen_id.message}</p>}
              </div>
              <div>
                <label className={ui.fieldLabel}>Số sổ BHXH (10 số cuối của BHYT)</label>
                <input {...register("social_insurance_number")} disabled={bhxhLocked} className={fieldCls(bhxhLocked)} />
                {/* Dòng hiển thị lỗi Zod */}
                {errors.social_insurance_number && (
                <p className="text-xs text-danger-text mt-1">
                 {errors.social_insurance_number.message as string}
                 </p>
                 )}
                {recorded(prefill?.social_insurance_number) && (
                  <button
                    type="button"
                    onClick={() => {
                      // Hủy sửa thì trả về đúng giá trị trong hồ sơ gốc.
                      if (bhxhEditable) setValue("social_insurance_number", prefill?.social_insurance_number ?? "");
                      setBhxhEditable((v) => !v);
                    }}
                    className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    <Pencil size={12} /> {bhxhEditable ? "Hủy sửa" : "Chỉnh sửa"}
                  </button>
                )}
              </div>
            </div>

            <div className="pt-4 border-t border-line2">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold">Thường trú</h3>
                {hasAddress && (
                  <button
                    type="button"
                    onClick={() => {
                      // Hủy sửa thì trả về đúng địa chỉ trong hồ sơ gốc.
                      if (addressEditable) setValue("permanent", {
                        provinceCode: prefill?.permanent_province ?? "",
                        wardCode: prefill?.permanent_ward ?? "",
                        street: prefill?.permanent_street ?? "",
                      });
                      setAddressEditable((v) => !v);
                    }}
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    <Pencil size={12} /> {addressEditable ? "Hủy sửa" : "Chỉnh sửa"}
                  </button>
                )}
              </div>
              <Controller control={control} name="permanent" render={({ field }) => (
                <div className={cn("transition-opacity", addressLocked && "opacity-70 pointer-events-none")}>
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
            <h2 className={ui.sectionTitle}><ShieldPlus size={16} className="text-primary" /> Nơi Đăng ký Khám chữ bệnh ban đầu</h2>
          </div>
          <div className="p-5 space-y-4">
            <div>
              <label className={ui.fieldLabel} htmlFor="kcb-province">Tỉnh thành bệnh viện</label>
              <SearchableSelect
                id="kcb-province"
                value={hospitalProvince}
                onChange={(v) => { setHospitalProvince(v); setValue("hospital_code", ""); }}
                options={provinces.map((p) => ({ value: p.code, label: p.name }))}
                placeholder="-- Chọn tỉnh thành --"
                searchPlaceholder="Gõ tên tỉnh thành..."
                emptyText="Không có tỉnh thành nào khớp"
              />
            </div>
            <div>
              <label className={ui.fieldLabel} htmlFor="kcb-hospital">Bệnh viện</label>
              <p className="mt-1.5 text-xs text-muted">
                  Sinh viên chỉ chọn các Bệnh viện tại TP.HCM hoặc Đồng Nai.
                </p>
              <Controller control={control} name="hospital_code" render={({ field }) => (
                <SearchableSelect
                  id="kcb-hospital"
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  options={hospitals.map((h) => ({ value: h.code, label: h.name, hint: h.code }))}
                  disabled={!hospitalProvince || hospitalsLoading}
                  placeholder={
                    !hospitalProvince ? "-- Chọn tỉnh thành trước --"
                      : hospitalsLoading ? "Đang tải danh sách..."
                      : "-- Chọn bệnh viện KCB --"
                  }
                  searchPlaceholder="Gõ tên hoặc mã cơ sở..."
                  emptyText="Không có cơ sở nào khớp"
                />
              )} />
              {hospitalProvince && !hospitalsLoading && (
                <p className="mt-1.5 text-xs text-muted">
                  {hospitals.length} cơ sở trong tỉnh này. Gõ tên hoặc mã để tìm, không dấu cũng được.
                </p>
              )}
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
            <div className="flex flex-col items-start gap-6 rounded-lg border border-line bg-slate-50 p-4 md:flex-row">
              <div className="mx-auto shrink-0 text-center md:mx-0">
                {qrPayload ? (
                  <>
                    <div className="rounded-lg border border-line bg-white p-3">
                      <QRCode value={qrPayload} size={148} level="M" style={{ height: 148, width: 148 }} />
                    </div>
                    <p className="mt-2 text-xs text-muted">Quét bằng app ngân hàng bất kỳ</p>
                  </>
                ) : (
                  <div className="flex h-[176px] w-[176px] items-center justify-center rounded-lg border border-dashed border-line bg-white px-4 text-center text-xs text-muted">
                    Chưa tạo được mã QR. Vui lòng chuyển khoản thủ công theo thông tin bên cạnh.
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <h3 className="mb-2 font-semibold text-ink">Thông tin chuyển khoản</h3>
                <ul className="space-y-1.5 text-sm text-slate-600">
                  <li>
                    Ngân hàng: <strong className="text-ink">{config?.bank_name || "—"}</strong>
                    {bankBin && <span className="ml-1.5 text-xs text-muted">(BIN {bankBin})</span>}
                  </li>
                  <li className="flex flex-wrap items-center gap-x-2">
                    <span>Số tài khoản: <strong className="font-mono text-ink">{config?.bank_account_number || "—"}</strong></span>
                    {config?.bank_account_number && <CopyButton text={config.bank_account_number} />}
                  </li>
                  <li>Chủ tài khoản: <strong className="text-ink">{config?.bank_account_name || "—"}</strong></li>
                  <li>
                    Số tiền: <strong className="text-base text-primary">
                      {config?.insurance_fee ? new Intl.NumberFormat("vi-VN").format(config.insurance_fee) : "—"} VNĐ
                    </strong>
                  </li>
                  <li className="flex flex-wrap items-center gap-x-2">
                    <span>Nội dung: <strong className="break-all text-ink">{transferNote}</strong></span>
                    <CopyButton text={transferNote} />
                  </li>
                </ul>
                <p className="mt-3 text-xs text-muted">
                  Mã QR đã gồm sẵn số tài khoản, số tiền và nội dung. Giữ nguyên nội dung chuyển
                  khoản để Phòng KHTC đối chiếu được hóa đơn.
                </p>
              </div>
            </div>

            <div className="grid items-start gap-5 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex flex-col">
                <label className={cn(ui.fieldLabel, "mb-1.5 flex min-h-[1.25rem] items-baseline gap-1")}>
                  <span>Ảnh CCCD mặt trước</span><span className="text-danger-text" title="Bắt buộc">*</span>
                </label>
                <div className="group relative flex min-h-[9rem] cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-slate-300 p-4 text-center transition-colors hover:bg-slate-50">
                  <input type="file" accept="image/*" {...register("cccd_image")} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
                  <div className="flex flex-col items-center gap-2">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-500 transition-transform group-hover:scale-110">
                      {watch("cccd_image")?.length > 0 ? <CheckSquare size={20} className="text-success-text" /> : <Plus size={20} />}
                    </div>
                    <span className="text-sm font-medium text-slate-700 break-all">
                      {watch("cccd_image")?.length > 0 ? watch("cccd_image")[0].name : "Tải lên mặt trước"}
                    </span>
                    <span className="text-xs text-slate-500">Tối đa 5MB</span>
                  </div>
                </div>
                {errors.cccd_image && <p className="mt-1 text-xs text-danger-text">{errors.cccd_image.message as string}</p>}
              </div>
              <div className="flex flex-col">
                <label className={cn(ui.fieldLabel, "mb-1.5 flex min-h-[1.25rem] items-baseline gap-1")}>
                  <span>Ảnh CCCD mặt sau</span><span className="text-danger-text" title="Bắt buộc">*</span>
                </label>
                <div className="group relative flex min-h-[9rem] cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-slate-300 p-4 text-center transition-colors hover:bg-slate-50">
                  <input type="file" accept="image/*" {...register("cccd_image_back")} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
                  <div className="flex flex-col items-center gap-2">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-50 text-sky-500 transition-transform group-hover:scale-110">
                      {watch("cccd_image_back")?.length > 0 ? <CheckSquare size={20} className="text-success-text" /> : <Plus size={20} />}
                    </div>
                    <span className="text-sm font-medium text-slate-700 break-all">
                      {watch("cccd_image_back")?.length > 0 ? watch("cccd_image_back")[0].name : "Tải lên mặt sau"}
                    </span>
                    <span className="text-xs text-slate-500">Tối đa 5MB</span>
                  </div>
                </div>
                {errors.cccd_image_back && <p className="mt-1 text-xs text-danger-text">{errors.cccd_image_back.message as string}</p>}
              </div>
              <div className="flex flex-col">
                <label className={cn(ui.fieldLabel, "mb-1.5 flex min-h-[1.25rem] items-baseline gap-1")}>
                  <span>Bill chuyển khoản</span><span className="text-danger-text" title="Bắt buộc">*</span>
                </label>
                <div className="group relative flex min-h-[9rem] cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-slate-300 p-4 text-center transition-colors hover:bg-slate-50">
                  <input type="file" accept="image/*" {...register("payment_receipt_image")} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
                  <div className="flex flex-col items-center gap-2">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-500 transition-transform group-hover:scale-110">
                      {watch("payment_receipt_image")?.length > 0 ? <CheckSquare size={20} className="text-success-text" /> : <CreditCard size={20} />}
                    </div>
                    <span className="text-sm font-medium text-slate-700 break-all">
                      {watch("payment_receipt_image")?.length > 0 ? watch("payment_receipt_image")[0].name : "Tải lên biên lai"}
                    </span>
                    <span className="text-xs text-slate-500">Tối đa 5MB</span>
                  </div>
                </div>
                {errors.payment_receipt_image && <p className="mt-1 text-xs text-danger-text">{errors.payment_receipt_image.message as string}</p>}
              </div>
              <div className="flex flex-col">
                <label className={cn(ui.fieldLabel, "mb-1.5 flex min-h-[1.25rem] items-baseline gap-1")}>
                  <span>Thẻ BHYT cũ</span><span className="text-xs font-normal text-muted">(tuỳ chọn)</span>
                </label>
                <div className="group relative flex min-h-[9rem] cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-slate-300 p-4 text-center transition-colors hover:bg-slate-50">
                  <input type="file" accept="image/*" {...register("bhyt_image")} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
                  <div className="flex flex-col items-center gap-2">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-50 text-indigo-500 transition-transform group-hover:scale-110">
                      {watch("bhyt_image")?.length > 0 ? <CheckSquare size={20} className="text-success-text" /> : <FileText size={20} />}
                    </div>
                    <span className="text-sm font-medium text-slate-700 break-all">
                      {watch("bhyt_image")?.length > 0 ? watch("bhyt_image")[0].name : "Tải lên thẻ BHYT cũ"}
                    </span>
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
          <button type="submit" disabled={saving} className={ui.btnPrimary}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : null} Gửi đăng ký
          </button>
        </div>
      </form>
    </div>
  );
}
