"use client";

import React, { useEffect, useState, useRef, useMemo, useCallback, useId } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useForm, Controller, type Resolver, type UseFormRegisterReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  ChevronRight,
  Home,
  Loader2,
  User,
  ShieldPlus,
  FileText,
  Pencil,
  Plus,
  CreditCard,
  CheckSquare,
  CheckCircle2,
  Copy,
  Check,
  AlertTriangle,
  CalendarClock,
  History,
  Info,
  Lock,
  Upload,
  Send,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { PrivateImage, formatDateTime } from "@/components/submitted-insurance-info";
import { InsuranceStatus } from "@/components/insurance-status";
import { RejectionNotice } from "@/components/rejection-notice";
import { FreshmanWarningModal } from "@/components/freshman-warning-modal";
import { api, ApiError, newRequestKey } from "@/lib/api";
import { badge, ui } from "@/lib/ui";
import { cn } from "@/lib/utils";
import type { Province, InsurancePeriodConfig, InsuranceRegistrationPrefill, SubmittedInsurance } from "@/lib/types";
import AddressFields from "@/app/(dashboard)/dashboard/khai-bao-ngoai-tru/AddressFields";
import SearchableSelect from "@/components/searchable-select";
import QRCode from "react-qr-code";
import { buildVietQrPayload, findBank, toAscii } from "@/lib/vietqr";
import { readCccdQr, looksLikeCccdQr } from "@/lib/cccd-qr";

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
  MAIN: "dot 1",
};
const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
];

/**
 * Mô tả đợt do Phòng CTSV soạn bằng CKEditor bên Dashboard (HTML). Preflight của
 * Tailwind xóa kiểu danh sách/liên kết nên phải khai lại ở đây.
 */
const DESCRIPTION_CLS =
  "text-sm leading-6 [&_a]:font-medium [&_a]:underline [&_h2]:font-semibold [&_h3]:font-semibold " +
  "[&_h4]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5";

const fileSchema = z
  .any()
  .refine((files) => files?.length > 0, "Vui lòng chọn file.")
  .refine(
    (files) => files?.[0]?.size <= MAX_FILE_SIZE,
    "Kích thước file tối đa là 5MB.",
  )
  .refine(
    (files) => ACCEPTED_IMAGE_TYPES.includes(files?.[0]?.type),
    "Chỉ chấp nhận file ảnh (JPEG, PNG, WEBP, HEIC).",
  );

const schema = z.object({
  full_name: z.string().min(1, "Vui lòng nhập họ tên"),
  student_code: z.string().min(1, "Vui lòng nhập MSSV"),
  gender: z.enum(["Nam", "Nữ"]),
  dob: z.string().min(1, "Vui lòng nhập ngày sinh"),
  ethnicity: z.string().min(1, "Vui lòng chọn dân tộc"),
  phone_number: z
    .string()
    .regex(/^(0|\+84)\d{9,10}$/, "Số điện thoại không hợp lệ"),
  social_insurance_number: z
    .string()
    .regex(/^\d{10}$/, "Mã BHXH phải bao gồm đúng 10 chữ số cuối của mã BHYT"),
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
  bhyt_image: fileSchema,
  payment_receipt_image: fileSchema,
  medical_insurance_code: z.string().optional(),
  valid_from: z.string().optional(),
  valid_until: z.string().optional(),
  confirm_declaration: z.boolean().refine((val) => val === true, {
    message: "Bạn phải đồng ý với các điều khoản.",
  }),
});

const externalBase = schema.extend({
  payment_receipt_image: z.any().optional(),
  medical_insurance_code: z.string().regex(/^(?:[A-Z]{2}[0-9]{13}|[0-9]{10})$/, "Mã thẻ gồm 10 số hoặc 2 chữ cái và 13 số"),
  valid_from: z.string().min(1, "Vui lòng nhập ngày bắt đầu"),
  valid_until: z.string().min(1, "Vui lòng nhập ngày hết hạn"),
});
type ExternalValues = Pick<z.infer<typeof externalBase>, "valid_from" | "valid_until" | "medical_insurance_code" | "social_insurance_number">;
/**
 * Kiểm tra chéo giống `ExternalInsuranceSerializer.validate` bên backend, báo ngay
 * trên đúng ô. `when` cho chạy cả khi ô khác đang lỗi để sinh viên thấy mọi lỗi một lượt.
 */
const withExternalRules = <T extends z.ZodType<ExternalValues>>(base: T) => base
  .refine((v) => !v.valid_from || !v.valid_until || v.valid_until >= v.valid_from, {
    message: "Ngày hết hạn phải từ ngày bắt đầu trở đi", path: ["valid_until"], when: () => true,
  })
  .refine((v) => !/^\d{10}$/.test(v.social_insurance_number ?? "") || !v.medical_insurance_code
    || v.medical_insurance_code.endsWith(v.social_insurance_number), {
    message: "Mã thẻ BHYT phải khớp mã số BHXH (10 số cuối)", path: ["medical_insurance_code"], when: () => true,
  });
const externalSchema = withExternalRules(externalBase);
// Sửa hồ sơ đã nộp: ảnh cũ được giữ, chỉ gửi ảnh khi sinh viên chọn ảnh thay thế.
const keptImages = {
  cccd_image: z.any().optional(), cccd_image_back: z.any().optional(),
  bhyt_image: z.any().optional(), payment_receipt_image: z.any().optional(),
};
const editSchema = schema.extend(keptImages);
const externalEditSchema = withExternalRules(externalBase.extend(keptImages));
type FormData = z.infer<typeof schema> | z.infer<typeof externalSchema>;

type ImageName = "cccd_image" | "cccd_image_back" | "bhyt_image" | "payment_receipt_image";
type ExtraPrefill = Partial<Record<"medical_insurance_code" | "valid_from" | "valid_until" | "hospital_code" | "hospital_province" | "note", string>>;
const IMAGE_NAMES: ImageName[] = ["cccd_image", "cccd_image_back", "bhyt_image", "payment_receipt_image"];
/** Tên trường backend khác tên trong form. */
const BACKEND_FIELD: Record<string, string> = {
  permanent_province: "permanent.provinceCode",
  permanent_ward: "permanent.wardCode",
  permanent_street: "permanent.street",
};
const FORM_FIELDS = new Set(Object.keys(schema.shape).filter((k) => k !== "permanent"));

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
      {done ? (
        <>
          <Check size={12} /> Đã chép
        </>
      ) : (
        <>
          <Copy size={12} /> Chép
        </>
      )}
    </button>
  );
}

/**
 * Link chữ nhỏ "Chỉnh sửa / Hủy sửa" ở góc phải tiêu đề thẻ.
 *
 * Cố ý KHÔNG dùng <button>: các thẻ nằm trong <fieldset disabled> của form, mà
 * fieldset khóa mọi <button>/<input> con — hồ sơ đã nộp mở ở chế độ chỉ xem
 * (fieldset đang khóa) thì nút mở khóa sẽ chết. Thẻ span role="button" không
 * bị fieldset ảnh hưởng; `disabled` chỉ dùng khi đang gửi.
 */
function EditLink({ active, label = "Chỉnh sửa", onClick, disabled = false }: { active: boolean; label?: string; onClick: () => void; disabled?: boolean }) {
  const run = () => { if (!disabled) onClick(); };
  return (
    <span
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onClick={run}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); run(); }
      }}
      className={cn(
        "touch-target inline-flex shrink-0 cursor-pointer select-none items-center gap-1 text-xs font-medium text-primary hover:underline",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      <Pencil size={12} /> {active ? "Hủy sửa" : label}
    </span>
  );
}

/** Mã BHYT dán vào có thể dài 15 số (hoặc kèm khoảng trắng/chữ) → chỉ giữ chữ số, lấy 10 số cuối. */
function lastTenDigits(raw: string): string {
  return raw.replace(/\D/g, "").slice(-10);
}

function FieldError({ message, id }: { message?: unknown; id?: string }) {
  if (!message) return null;
  return <p id={id} data-field-error className="mt-1 text-xs text-danger-text">{String(message)}</p>;
}

/** id + trạng thái lỗi cho một ô của form — label trỏ vào `id`, lỗi gắn vào ô qua
 *  aria-describedby để trình đọc màn hình đọc được ô nào sai, sai vì sao. Mỗi trang
 *  chỉ có một form BHYT nên id tĩnh là đủ. */
function fieldA11y(name: string, invalid: boolean) {
  const id = `bhyt-${name}`;
  return {
    id,
    "aria-invalid": invalid,
    "aria-describedby": invalid ? `${id}-error` : undefined,
  };
}
const errorId = (name: string) => `bhyt-${name}-error`;

/**
 * Một ô ảnh hồ sơ. Đã có ảnh nộp trước → hiện chính ảnh đó; ô chọn file chỉ còn
 * là nút "Thay ảnh khác". Chưa có ảnh → ô kéo thả.
 */
function ImageField({
  label, hint, emptyText, Icon, tone, existingUrl, disabled, file, error, input,
}: {
  label: string;
  hint?: string;
  emptyText: string;
  Icon: LucideIcon;
  tone: string;
  existingUrl?: string;
  disabled: boolean;
  file?: File;
  error?: unknown;
  input?: UseFormRegisterReturn;
}) {
  const inputId = useId();
  const errId = `${inputId}-error`;
  const invalid = !!error;
  return (
    <div className="flex min-w-0 flex-col">
      <label htmlFor={existingUrl ? undefined : inputId} className={cn(ui.fieldLabel, "mb-1.5 flex min-h-[1.25rem] flex-wrap items-baseline gap-1")}>
        <span>{label}</span>
        {!existingUrl && <span className="text-danger-text">*</span>}
        {hint && <span className="text-xs font-normal text-muted">{hint}</span>}
      </label>
      {existingUrl ? (
        <>
          <PrivateImage url={existingUrl} label={label} caption={false} />
          {!disabled && input ? (
            <label className={cn(ui.btnOutline, "relative mt-2 h-9 w-full cursor-pointer overflow-hidden px-3 text-xs focus-within:ring-2 focus-within:ring-primary/40",
              error ? "border-danger bg-danger-soft text-danger-text" : file && "border-success-line bg-success-soft text-success-text")}>
              <input type="file" accept="image/*" {...input} aria-invalid={invalid} aria-describedby={invalid ? errId : undefined}
                     className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
              {file ? <CheckSquare size={14} className="shrink-0" /> : <Upload size={14} className="shrink-0" />}
              <span className="truncate">{file ? file.name : "Thay ảnh khác"}</span>
            </label>
          ) : null}
        </>
      ) : (
        <div
          className={cn(
            // input file trong suốt phủ cả ô → viền focus của nó vô hình; vẽ focus lên khung.
            "group relative flex min-h-[8rem] items-center justify-center rounded-lg border-2 border-dashed p-4 text-center transition-colors focus-within:ring-2 focus-within:ring-primary/40",
            error ? "border-danger bg-danger-soft" : "border-line-strong",
            disabled ? "bg-surface-subtle opacity-70" : "cursor-pointer hover:bg-surface-subtle",
          )}
        >
          {input && (
            <input
              id={inputId}
              aria-invalid={invalid}
              aria-describedby={invalid ? errId : undefined}
              type="file"
              accept="image/*"
              {...input}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
            />
          )}
          <div className="flex min-w-0 flex-col items-center gap-2">
            <div className={cn("flex h-10 w-10 items-center justify-center rounded-full transition-transform group-hover:scale-110", tone)}>
              {file ? <CheckSquare size={20} className="text-success-text" /> : <Icon size={20} />}
            </div>
            <span className="max-w-full break-all text-sm font-medium text-ink-2">
              {file ? file.name : emptyText}
            </span>
            <span className="text-xs text-muted">Tối đa 5MB</span>
          </div>
        </div>
      )}
      <FieldError id={errId} message={(error as { message?: string } | undefined)?.message} />
    </div>
  );
}

export default function InsuranceRegistrationPage({ external = false }: { external?: boolean }) {
  return (
    <React.Suspense
      fallback={
        <div className="p-10 flex justify-center text-muted">
          <Loader2 className="animate-spin" />
        </div>
      }
    >
      <InsuranceRegistrationForm external={external} />
    </React.Suspense>
  );
}

function InsuranceRegistrationForm({ external }: { external: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const periodId = searchParams.get("period") || "";
  const editId = Number(searchParams.get("edit")) || 0;
  const resubmitting = external && searchParams.get('resubmit') === '1';
  const [submitted, setSubmitted] = useState<SubmittedInsurance | null>(null);
  const editingRecord = !!submitted?.id;

  // Hồ sơ đã nộp mở ra ở chế độ CHỈ XEM; sinh viên bấm "Chỉnh sửa" mới mở khóa.
  const [unlocked, setUnlocked] = useState(false);
  // Đơn mới: trường nào hồ sơ gốc đã có thì khóa, nút "Chỉnh sửa" của thẻ mở lại.
  const [infoEditable, setInfoEditable] = useState(false);
  const requestKey = useRef<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  // Tăng mỗi lần gửi thất bại; effect chạy sau khi lỗi đã render mới cuộn tới.
  const [scrollTick, setScrollTick] = useState(0);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [freshmanAck, setFreshmanAck] = useState(false);
  const [success, setSuccess] = useState(false);

  const [prefill, setPrefill] = useState<InsuranceRegistrationPrefill | null>(
    null,
  );

  // Chuỗi QR đọc từ ảnh CCCD. Chỉ để gửi kèm và lưu lại — KHÔNG điền ngược vào
  // form, và KHÔNG hiện thông báo nào ra màn hình sinh viên.
  const [cccdQrRaw, setCccdQrRaw] = useState<string | null>(null);

  const [provinces, setProvinces] = useState<Province[]>([]);
  const [ethnicities, setEthnicities] = useState<
    { code: string; name: string }[]
  >([]);
  const [hospitals, setHospitals] = useState<{ code: string; name: string }[]>(
    [],
  );
  const [hospitalsLoading, setHospitalsLoading] = useState(false);
  const [hospitalProvince, setHospitalProvince] = useState("");

  const [config, setConfig] = useState<InsurancePeriodConfig | null>(null);

  // Schema đổi theo việc đang tạo mới hay sửa hồ sơ; đọc qua ref để resolver
  // luôn dùng đúng schema của lần render gần nhất.
  const activeSchema = useRef<object>(external ? externalSchema : schema);
  activeSchema.current = editingRecord
    ? (external ? externalEditSchema : editSchema)
    : (external ? externalSchema : schema);

  const {
    watch,
    register,
    handleSubmit,
    control,
    setValue,
    clearErrors,
    setError: setFieldError,
    formState: { errors },
  } = useForm<FormData>({
    resolver: ((values, context, options) =>
      zodResolver(activeSchema.current as typeof schema)(values as never, context, options as never)) as Resolver<FormData>,
  });
  const sinField = register("social_insurance_number");

  useEffect(() => {
    const subscription = watch(() => { requestKey.current = null; });
    return () => subscription.unsubscribe();
  }, [watch]);

  /** Đổ dữ liệu (hồ sơ gốc hoặc đơn đã nộp) vào form; cũng dùng để hủy chỉnh sửa. */
  const applyValues = useCallback((p: InsuranceRegistrationPrefill & ExtraPrefill) => {
    setValue("full_name", p.full_name ?? "");
    setValue("student_code", p.student_code ?? "");
    setValue("gender", p.gender as "Nam" | "Nữ");
    setValue("dob", p.dob ?? "");
    setValue("ethnicity", p.ethnicity ?? "");
    setValue("phone_number", p.phone_number ?? "");
    setValue("citizen_id", p.citizen_id ?? "");
    setValue("social_insurance_number", p.social_insurance_number ?? "");
    setValue("permanent", {
      provinceCode: p.permanent_province ?? "",
      wardCode: p.permanent_ward ?? "",
      street: p.permanent_street ?? "",
    });
    setValue("hospital_code", p.hospital_code || "");
    setValue("note", p.note || "");
    for (const field of ["medical_insurance_code", "valid_from", "valid_until"] as const) {
      setValue(field, p[field] || "");
    }
    setHospitalProvince(p.hospital_province || "");
  }, [setValue]);

  useEffect(() => {
    let alive = true;
    if (!external && !periodId && !editId) {
      router.push("/dashboard/bao-hiem-y-te");
      return;
    }
    Promise.all([
      editId ? (external ? api.externalInsurance.detail(editId) : api.insuranceRegistration.detail(editId)) : external ? api.externalInsurance.prefill() : api.insuranceRegistration.prefill(periodId),
      api.locations.provinces(),
      api.locations.ethnicities(),
    ])
      .then(([pref, provs, eths]) => {
        if (!alive) return;
        const existing = pref as SubmittedInsurance;
        if (existing.id) {
          setSubmitted(existing);
          setUnlocked(resubmitting);
        }
        setPrefill(pref.prefill);
        applyValues(pref.prefill);
        setProvinces(provs);
        setEthnicities(eths);
        if (pref.config) setConfig(pref.config);
        setLoading(false);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err instanceof ApiError ? err.message : "Lỗi tải dữ liệu");
        setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [external, editId, periodId, resubmitting, router, applyValues]);

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
    api.hospitals
      .byProvince(hospitalProvince)
      .then((rows) => {
        if (alive) setHospitals(rows);
      })
      .catch(console.error)
      .finally(() => {
        if (alive) setHospitalsLoading(false);
      });
    return () => {
      alive = false;
    };
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
  // Mẫu Phòng CTSV quy định: "BHYT sinh vien dot <đợt> <năm>_<MSSV>_<họ tên>".
  // Bỏ dấu phần họ tên để nội dung QR tương thích với ứng dụng ngân hàng.
  const transferNote = useMemo(() => {
    const dot =
      PERIOD_IN_NOTE[(config?.registration_period ?? "").toUpperCase()] ?? "dot chinh";
    const name = toAscii(fullName ?? "").trim();
    return `BHYT sinh vien ${dot} ${config?.registration_year ?? ""}_${studentCode ?? ""}_${name}`;
  }, [fullName, studentCode, config]);
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
  const fieldCls = (locked: boolean, hasError?: boolean) =>
    cn(
      ui.input,
      locked && "bg-surface-subtle text-muted",
      hasError &&
        "border-danger focus:border-danger focus:ring-danger bg-danger-soft/30",
    );

  const canSubmit = submitted?.id
    ? !!(resubmitting ? submitted.can_resubmit : (submitted.can_edit ?? submitted.window?.can_edit))
    : config?.status === 'open';
  const editLocked = editingRecord && !unlocked;
  const formEnabled = canSubmit && !editLocked;
  /** Trường thông tin cá nhân có bị khóa không. */
  const personalLocked = (value?: string | null) =>
    editingRecord ? !unlocked : recorded(value) && !infoEditable;
  const hasAddress =
    recorded(prefill?.permanent_province) &&
    recorded(prefill?.permanent_ward) &&
    recorded(prefill?.permanent_street);
  const addressLocked = editingRecord ? !unlocked : hasAddress && !infoEditable;
  const submittedImages = useMemo(
    () => Object.fromEntries((submitted?.images ?? []).map((i) => [i.field, i.url])) as Partial<Record<ImageName, string>>,
    [submitted],
  );

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
    const files = [cccdFrontFile?.[0], cccdBackFile?.[0]].filter(
      Boolean,
    ) as File[];
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

    return () => {
      alive = false;
    };
  }, [cccdFrontFile, cccdBackFile]);

  // Cuộn tới lỗi đầu tiên trong form; không có lỗi theo ô thì tới thông báo lỗi chung.
  useEffect(() => {
    if (!scrollTick) return;
    const target = formRef.current?.querySelector<HTMLElement>("[data-field-error]") ?? alertRef.current;
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [scrollTick]);

  /** Bỏ mọi thay đổi chưa lưu, trả form về đúng đơn đã nộp và khóa lại. */
  const cancelEdit = () => {
    if (!submitted) return;
    applyValues(submitted.prefill);
    // Ô file chỉ nhận chuỗi rỗng khi xóa lựa chọn.
    for (const name of IMAGE_NAMES) setValue(name, "");
    setValue("confirm_declaration", false);
    clearErrors();
    setError("");
    setUnlocked(false);
  };

  const onSubmit = async (data: FormData) => {
    setSaving(true);
    setError("");
    setNotice("");

    try {
      const fd = new FormData();
      if (external) {
        for (const field of ['medical_insurance_code', 'valid_from', 'valid_until'] as const) {
          fd.append(field, data[field] || "");
        }
      } else {
        if (!config && !submitted) throw new Error("Không tìm thấy cấu hình đợt đăng ký.");
        fd.append("registration_year", String(submitted?.registration_year ?? config?.registration_year));
        fd.append("registration_period", submitted?.registration_period ?? config?.registration_period ?? "");
      }
      fd.append("full_name", data.full_name);
      fd.append("student_code", data.student_code);
      fd.append("gender", data.gender);
      fd.append("dob", data.dob);
      fd.append("ethnicity", data.ethnicity);
      fd.append("phone_number", data.phone_number);
      fd.append("social_insurance_number", data.social_insurance_number || "");
      fd.append("citizen_id", data.citizen_id);

      fd.append("permanent_province", data.permanent.provinceCode);
      fd.append("permanent_ward", data.permanent.wardCode);
      fd.append("permanent_street", data.permanent.street);

      fd.append("hospital_code", data.hospital_code);
      fd.append("note", data.note || "");

      if (data.cccd_image?.[0]) fd.append("cccd_image", data.cccd_image[0]);
      if (data.cccd_image_back?.[0]) fd.append("cccd_image_back", data.cccd_image_back[0]);
      if (cccdQrRaw) fd.append("cccd_qr_raw", cccdQrRaw);
      if (data.bhyt_image?.[0]) fd.append("bhyt_image", data.bhyt_image[0]);
      if (!external && data.payment_receipt_image?.[0]) fd.append("payment_receipt_image", data.payment_receipt_image[0]);

      requestKey.current ??= newRequestKey();
      fd.set('request_key', requestKey.current);
      if (submitted?.id) {
        fd.set('action', resubmitting ? 'resubmit' : 'edit');
        fd.set('row_version', String(submitted.row_version));
        if (external) await api.externalInsurance.update(submitted.id, fd);
        else await api.insuranceRegistration.supplement(submitted.id, fd);
        // Ở lại trang, hiện bản mới nhất ở chế độ chỉ xem.
        const fresh = await (external ? api.externalInsurance.detail(submitted.id) : api.insuranceRegistration.detail(submitted.id));
        requestKey.current = null;
        setSubmitted(fresh);
        setPrefill(fresh.prefill);
        if (fresh.config) setConfig(fresh.config);
        applyValues(fresh.prefill);
        for (const name of IMAGE_NAMES) setValue(name, "");
        setValue("confirm_declaration", false);
        setUnlocked(false);
        setNotice(resubmitting
          ? "Đã gửi lại bản khai. Cán bộ sẽ kiểm tra lại thông tin."
          : "Đã lưu thay đổi. Thông tin mới nhất được hiển thị bên dưới.");
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        if (external) await api.externalInsurance.submit(fd);
        else await api.insuranceRegistration.submit(fd);
        setSuccess(true);
      }
    } catch (err) {
      console.error("Nộp đơn BHYT thất bại", err);
      // Lỗi JS phía trình duyệt (vd. thiếu cấu hình đợt) vẫn mang thông điệp riêng — đừng nuốt mất.
      let message = err instanceof Error && err.message ? err.message : "Đã có lỗi xảy ra";
      if (err instanceof ApiError && err.status === 400) {
        // Lỗi theo từng trường của DRF: gắn vào đúng ô để sinh viên thấy ngay chỗ sai.
        // Khai nơi khác bọc lỗi trong `errors`, đăng ký tại trường trả thẳng ở gốc.
        const fieldErrors = (err.data.errors && typeof err.data.errors === "object" ? err.data.errors : err.data) as Record<string, unknown>;
        let mapped = 0;
        const unmapped: string[] = [];
        for (const [key, value] of Object.entries(fieldErrors)) {
          const field = BACKEND_FIELD[key] ?? (FORM_FIELDS.has(key) ? key : null);
          const text = Array.isArray(value) ? value[0] : value;
          if (typeof text !== "string") continue;
          if (!field) {
            if (key !== "detail" && key !== "non_field_errors") unmapped.push(text);
            continue;
          }
          setFieldError(field as never, { type: "server", message: text });
          mapped++;
        }
        // Trường backend không có ô tương ứng trên form thì vẫn phải nói ra, không để "HTTP 400".
        if (unmapped.length && message.startsWith("HTTP ")) message = unmapped.join(" ");
        else if (mapped) message = "Thông tin chưa hợp lệ, vui lòng kiểm tra các ô được đánh dấu đỏ.";
      }
      setError(message);
      setScrollTick((t) => t + 1);
    } finally {
      setSaving(false);
    }
  };

  const onInvalid = () => setScrollTick((t) => t + 1);

  if (loading)
    return (
      <div className="flex justify-center h-64 text-muted">
        <Loader2 size={26} className="animate-spin mt-10" />
      </div>
    );

  if (success) {
    return (
      <div className="max-w-xl mx-auto mt-6 sm:mt-10 p-6 sm:p-8 bg-white border border-line rounded-lg shadow-card text-center">
        <div className="w-16 h-16 bg-success-soft text-success-text rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckSquare size={32} />
        </div>
        <h2 className="text-title font-semibold text-ink mb-2">
          {external ? "Khai báo thành công" : "Đăng ký thành công"}
        </h2>
        <p className="text-ink-3 mb-6">
          {external ? "Thông tin tham gia BHYT tại nơi khác đã được ghi nhận và đang chờ cán bộ xác nhận." : <>Yêu cầu đăng ký BHYT của sinh viên đã được ghi nhận. Phòng CTSV sẽ
          tiến hành gửi hồ sơ lên BHXH để gia hạn/đăng ký mới. BHYT sẽ có hiệu
          lực từ ngày đầu quý tiếp theo.</>}
        </p>
        <Link href="/dashboard/bao-hiem-y-te" className={cn(ui.btnPrimary, "w-full sm:w-auto")}>
          Quay lại trang BHYT
        </Link>
      </div>
    );
  }

  const year = submitted?.registration_year ?? config?.registration_year;
  const title = external
    ? (editingRecord ? "Bản khai BHYT tại nơi khác" : "Khai thông tin tham gia BHYT tại nơi khác")
    : editingRecord
      ? `Đơn đăng ký BHYT năm ${year ?? ""}${config?.name ? ` - ${config.name}` : ""}`
      : `Khai thông tin - Mua BHYT năm ${year ?? ""}${config?.name ? ` - ${config.name}` : ""}`;
  const windowInfo = submitted?.window ?? (config ? { start_date: config.start_date, end_date: config.end_date, can_edit: config.status === 'open' } : null);
  const imageSlots = ([
    { name: "cccd_image", label: "Ảnh VNeID/CCCD mặt trước", emptyText: "Tải lên mặt trước", Icon: Plus, tone: "bg-primary-soft text-primary" },
    { name: "cccd_image_back", label: "Ảnh VNeID/CCCD mặt sau", emptyText: "Tải lên mặt sau", Icon: Plus, tone: "bg-sky-50 text-sky-500" },
    { name: "payment_receipt_image", label: "Bill chuyển khoản", emptyText: "Tải lên biên lai", Icon: CreditCard, tone: "bg-emerald-50 text-emerald-500" },
    { name: "bhyt_image", label: "Ảnh thẻ BHYT", hint: "(VssID/VNeID)", emptyText: "Tải lên ảnh thẻ BHYT", Icon: FileText, tone: "bg-indigo-50 text-indigo-500" },
  ] as const).filter((slot) => !external || slot.name !== "payment_receipt_image");

  return (
    <div className="max-w-4xl mx-auto space-y-5 sm:space-y-6">
      <nav className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted" aria-label="Breadcrumb">
        <Link
          href="/dashboard"
          className="hover:text-primary flex items-center gap-1.5"
        >
          <Home size={14} /> Trang chủ
        </Link>
        <ChevronRight size={14} />
        <Link href="/dashboard/bao-hiem-y-te" className="hover:text-primary">
          Bảo hiểm Y tế
        </Link>
        <ChevronRight size={14} />
        <span className="font-medium text-ink">
          {editingRecord ? (external ? "Bản khai tại nơi khác" : "Đơn đăng ký BHYT") : external ? "Khai BHYT tại nơi khác" : "Đăng ký BHYT"}
        </span>
      </nav>

      {/* Tiêu đề + mô tả của đợt. Đơn đã nộp dùng mô tả HIỆN HÀNH của chính đợt đó. */}
      <div className="rounded-lg border border-primary-line bg-primary-soft p-4 text-primary-text sm:p-5">
        <h1 className="flex items-start gap-2 text-base font-bold sm:text-lg">
          <ShieldPlus size={20} className="mt-0.5 shrink-0" /> <span>{title}</span>
        </h1>
        {external ? (
          <p className="mt-2 text-sm">Dành cho tất cả sinh viên đã tham gia BHYT tại nơi khác. Vui lòng khai đầy đủ thông tin và đính kèm 3 ảnh để nhà trường ghi nhận.</p>
        ) : config?.description ? (
          <div
            className={cn(DESCRIPTION_CLS, "mt-3")}
            dangerouslySetInnerHTML={{
              __html: config.description.replace(/\n/g, "<br />"),
            }}
          />
        ) : (
          <ul className="text-sm space-y-1 mt-3">
            <li>
              <strong>Đối tượng:</strong> Sinh viên bắt buộc tham gia BHYT theo
              quy định.
            </li>
            <li>
              <strong>Thời hạn:</strong> {config?.coverage_start || "Chưa có thông tin"} — {config?.coverage_end || "Chưa có thông tin"}
            </li>
            <li>
              <strong>Lệ phí:</strong> {config?.insurance_fee?.toLocaleString("vi-VN") ?? "Chưa có thông tin"} đồng/sinh viên.
            </li>
          </ul>
        )}
      </div>

      {!external && !editingRecord && config?.freshman_warning && !freshmanAck && (
        <FreshmanWarningModal message={config.freshman_warning} onConfirm={() => setFreshmanAck(true)} />
      )}

      {notice && (
        <div role="status" className="flex items-start gap-2.5 rounded-lg border border-success-line bg-success-soft px-4 py-3 text-sm text-success-text">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> {notice}
        </div>
      )}

      {error && (
        <div ref={alertRef} role="alert" className="flex items-start gap-2.5 rounded-lg border border-danger-line bg-danger-soft px-4 py-3 text-sm text-danger-text">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {/* Trạng thái hồ sơ đã nộp; nút mở khóa chỉnh sửa nằm ở thẻ Thông tin cá nhân */}
      {editingRecord && submitted ? (
        <section className={ui.card}>
          <div className={cn(ui.cardHeader, "px-4 sm:px-5")}>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h2 className={ui.sectionTitle}>
                <History size={16} className="text-primary" />
                {external ? "Bản khai đã gửi" : "Đơn đã gửi"}
              </h2>
              {submitted.status && <InsuranceStatus status={submitted.status} />}
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-3.5 text-sm sm:grid-cols-3 sm:px-5">
            <div className="min-w-0">
              <dt className="flex items-center gap-1.5 text-xs text-muted"><Send size={12} /> Đã gửi</dt>
              <dd className="mt-0.5 font-medium text-ink">{formatDateTime(submitted.created_at)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="flex items-center gap-1.5 text-xs text-muted"><RefreshCw size={12} /> Cập nhật</dt>
              <dd className="mt-0.5 font-medium text-ink">{formatDateTime(submitted.updated_at)}</dd>
            </div>
            <div className="col-span-2 min-w-0 sm:col-span-1">
              <dt className="flex items-center gap-1.5 text-xs text-muted"><CalendarClock size={12} /> Hạn chỉnh sửa</dt>
              <dd className="mt-0.5 flex flex-wrap items-center gap-x-2 font-medium text-ink">
                {formatDateTime(submitted.window?.end_date)}
                <span className={cn("inline-flex items-center gap-1 text-xs font-medium", submitted.window?.can_edit ? "text-success-text" : "text-muted")}>
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  {submitted.window?.can_edit ? "Đang mở" : "Đã đóng"}
                </span>
              </dd>
            </div>
          </dl>

          {submitted.review_note && (
            <div className="border-t border-line2 p-4 sm:p-5">
              <RejectionNotice rejected={submitted.status === "rejected"} eyebrow={external ? "Bản khai bị từ chối" : "Đơn bị từ chối"} note={submitted.review_note} />
            </div>
          )}
          {(() => {
            const hint = unlocked
              ? { Icon: Info, cls: "text-primary-text", text: resubmitting ? "Sửa theo phản hồi của cán bộ rồi bấm Gửi lại." : "Chỉ được chỉnh sửa một lần trong thời gian đợt mở." }
              : submitted.edited_at
                ? { Icon: CheckCircle2, cls: "text-muted", text: `Đã chỉnh sửa lúc ${formatDateTime(submitted.edited_at)} · không thể sửa thêm.` }
                : !canSubmit
                  ? { Icon: Lock, cls: "text-muted", text: "Hết thời gian chỉnh sửa · chỉ để xem." }
                  : null;
            return hint && (
              <p className={cn("flex items-center gap-2 border-t border-line2 px-4 py-2.5 text-xs sm:px-5", hint.cls)}>
                <hint.Icon size={14} className="shrink-0" /> {hint.text}
              </p>
            );
          })()}
        </section>
      ) : windowInfo ? (
        <div className="flex flex-col gap-2 rounded-lg border border-line bg-white px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 text-ink-3">
            <CalendarClock size={16} className="mt-0.5 shrink-0 text-primary" />
            <span>
              Bắt đầu: <strong className="font-medium text-ink">{formatDateTime(windowInfo.start_date)}</strong>
              <span className="hidden sm:inline"> · </span><br className="sm:hidden" />
              Hạn kết thúc: <strong className="font-medium text-ink">{formatDateTime(windowInfo.end_date)}</strong>
            </span>
          </p>
          <span className={cn(badge.base, "self-start sm:self-auto", windowInfo.can_edit ? badge.success : badge.neutral)}>
            {windowInfo.can_edit ? "Đang mở" : "Đã đóng / chưa mở"}
          </span>
        </div>
      ) : external ? (
        <p className="rounded-lg border border-line bg-white px-4 py-3 text-sm text-muted">Hiện chưa mở thời gian tiếp nhận khai báo. Các bản khai đã gửi vẫn xem được tại trang BHYT.</p>
      ) : null}

      <form ref={formRef} onChange={() => { requestKey.current = null; }} onSubmit={handleSubmit(onSubmit, onInvalid)} className="space-y-5 sm:space-y-6">
        {/* Hồ sơ đang khóa → mọi ô nhập bị vô hiệu; ảnh đã nộp vẫn xem được. */}
        <fieldset disabled={saving || !formEnabled} className={cn("min-w-0 space-y-5 sm:space-y-6", saving && "opacity-60")}>
          {external && (
            <section className={ui.card}>
              <div className={ui.cardHeader}><h2 className={ui.sectionTitle}><FileText size={16} className="text-primary" /> Thông tin thẻ tham gia ngoài nhà trường</h2></div>
              <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-3">
                {([
                  ['medical_insurance_code', 'Mã thẻ BHYT', 'text'],
                  ['valid_from', 'Giá trị sử dụng từ ngày', 'date'],
                  ['valid_until', 'Giá trị sử dụng đến ngày', 'date'],
                ] as const).map(([field, label, type]) => (
                  <div key={field} className="min-w-0">
                    <label htmlFor={`bhyt-${field}`} className={ui.fieldLabel}>{label} *</label>
                    <input {...fieldA11y(field, !!errors[field])} type={type} {...register(field)} className={fieldCls(editLocked, !!errors[field])} />
                    <FieldError id={errorId(field)} message={errors[field]?.message} />
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className={ui.card}>
            <div className={ui.cardHeader}>
              <h2 className={ui.sectionTitle}>
                <User size={16} className="text-primary" /> Thông tin cá nhân
              </h2>
              {prefill && !editingRecord && (
                <EditLink
                  disabled={saving}
                  active={infoEditable}
                  onClick={() => {
                    // Đang mở mà bấm Hủy → khôi phục dữ liệu gốc từ hồ sơ.
                    if (infoEditable) applyValues(prefill);
                    setInfoEditable(!infoEditable);
                  }}
                />
              )}
              {/* Mở khóa / hủy chỉnh sửa hồ sơ đã nộp: góc phải, cùng hàng tiêu đề */}
              {editingRecord && submitted && canSubmit && (
                <EditLink
                  disabled={saving}
                  active={unlocked}
                  label={resubmitting ? "Gửi lại bản khai" : "Chỉnh sửa"}
                  onClick={() => {
                    setNotice("");
                    if (unlocked) cancelEdit();
                    else setUnlocked(true);
                  }}
                />
              )}
            </div>

            <div className="space-y-6 p-4 sm:p-5">
              <div className="grid gap-4 sm:grid-cols-2 sm:gap-5">
                <div className="min-w-0">
                  <label htmlFor="bhyt-full_name" className={ui.fieldLabel}>Họ và tên</label>
                  <input
                    {...fieldA11y("full_name", !!errors.full_name)}
                    {...register("full_name")}
                    disabled={personalLocked(prefill?.full_name)}
                    className={fieldCls(personalLocked(prefill?.full_name), !!errors.full_name)}
                  />
                  <FieldError id={errorId("full_name")} message={errors.full_name?.message} />
                </div>
                <div className="min-w-0">
                  <label htmlFor="bhyt-student_code" className={ui.fieldLabel}>Mã số sinh viên</label>
                  <input
                    {...fieldA11y("student_code", !!errors.student_code)}
                    {...register("student_code")}
                    readOnly={editingRecord || (recorded(prefill?.student_code) && !infoEditable)}
                    className={fieldCls(editingRecord || personalLocked(prefill?.student_code), !!errors.student_code)}
                  />
                  <FieldError id={errorId("student_code")} message={errors.student_code?.message} />
                </div>
                <div className="min-w-0">
                  <label htmlFor="bhyt-gender" className={ui.fieldLabel}>Giới tính</label>
                  <select
                    {...fieldA11y("gender", !!errors.gender)}
                    {...register("gender")}
                    disabled={personalLocked(prefill?.gender)}
                    className={fieldCls(personalLocked(prefill?.gender), !!errors.gender)}
                  >
                    <option value="Nam">Nam</option>
                    <option value="Nữ">Nữ</option>
                  </select>
                  <FieldError id={errorId("gender")} message={errors.gender?.message} />
                </div>
                <div className="min-w-0">
                  <label htmlFor="bhyt-dob" className={ui.fieldLabel}>Ngày sinh</label>
                  <input
                    {...fieldA11y("dob", !!errors.dob)}
                    type="date"
                    {...register("dob")}
                    disabled={personalLocked(prefill?.dob)}
                    className={fieldCls(personalLocked(prefill?.dob), !!errors.dob)}
                  />
                  <FieldError id={errorId("dob")} message={errors.dob?.message} />
                </div>
                <div className="min-w-0">
                  <label htmlFor="bhyt-ethnicity" className={ui.fieldLabel}>Dân tộc</label>
                  <select
                    {...fieldA11y("ethnicity", !!errors.ethnicity)}
                    {...register("ethnicity")}
                    disabled={personalLocked(prefill?.ethnicity)}
                    className={fieldCls(personalLocked(prefill?.ethnicity), !!errors.ethnicity)}
                  >
                    <option value="">-- Chọn dân tộc --</option>
                    {ethnicities.map((e) => (
                      <option key={e.code} value={e.name}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                  <FieldError id={errorId("ethnicity")} message={errors.ethnicity?.message} />
                </div>
                <div className="min-w-0">
                  <label htmlFor="bhyt-phone_number" className={ui.fieldLabel}>Số điện thoại</label>
                  <input
                    {...fieldA11y("phone_number", !!errors.phone_number)}
                    {...register("phone_number")}
                    inputMode="tel"
                    disabled={personalLocked(prefill?.phone_number)}
                    className={fieldCls(personalLocked(prefill?.phone_number), !!errors.phone_number)}
                  />
                  <FieldError id={errorId("phone_number")} message={errors.phone_number?.message} />
                </div>
                <div className="min-w-0">
                  <label htmlFor="bhyt-citizen_id" className={ui.fieldLabel}>Số CCCD</label>
                  <input
                    {...fieldA11y("citizen_id", !!errors.citizen_id)}
                    {...register("citizen_id")}
                    inputMode="numeric"
                    disabled={personalLocked(prefill?.citizen_id)}
                    className={fieldCls(personalLocked(prefill?.citizen_id), !!errors.citizen_id)}
                  />
                  <FieldError id={errorId("citizen_id")} message={errors.citizen_id?.message} />
                </div>
                <div className="min-w-0">
                  <label htmlFor="bhyt-social_insurance_number" className={ui.fieldLabel}>
                    Số sổ BHXH (10 số cuối của BHYT)
                  </label>
                  <input
                    {...fieldA11y("social_insurance_number", !!errors.social_insurance_number)}
                    {...sinField}
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="Dán mã BHYT 15 số, hệ thống tự lấy 10 số cuối"
                    onChange={(e) => {
                      e.target.value = lastTenDigits(e.target.value);
                      void sinField.onChange(e);
                    }}
                    disabled={personalLocked(prefill?.social_insurance_number)}
                    className={fieldCls(personalLocked(prefill?.social_insurance_number), !!errors.social_insurance_number)}
                  />
                  <FieldError id={errorId("social_insurance_number")} message={errors.social_insurance_number?.message} />
                  {!editLocked && (
                    <div className="mt-2 rounded-lg border border-primary-line bg-primary-soft px-3 py-2.5 text-xs leading-5 text-primary-text">
                      <p className="flex items-center gap-1.5 font-semibold">
                        <Info size={14} className="shrink-0" /> Cách lấy số sổ BHXH
                      </p>
                      <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-ink-2">
                        <li>
                          Mở{" "}
                          <a
                            href="https://baohiemxahoi.gov.vn/tracuu/Pages/tra-cuu-thoi-han-su-dung-the-bhyt.aspx"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-primary hover:underline"
                          >
                            cổng tra cứu BHYT
                          </a>{" "}
                          và nhập <strong>số CCCD</strong> để tra cứu.
                        </li>
                        <li>
                          Sao chép <strong>mã thẻ BHYT (15 ký tự)</strong> rồi dán vào ô trên,
                          hệ thống tự lấy <strong>10 số cuối</strong>.
                        </li>
                        <li>
                          Chụp màn hình kết quả tra cứu và tải lên ở mục ảnh BHYT
                          (dùng được thay cho ảnh thẻ cũ).
                        </li>
                      </ol>
                    </div>
                  )}
                </div>
              </div>

              <div className="pt-4 border-t border-line2">
                <h3 className={cn("mb-3 text-sm font-semibold", errors.permanent && "text-danger-text")}>
                  Thường trú
                </h3>

                <Controller
                  control={control}
                  name="permanent"
                  render={({ field }) => (
                    <div
                      data-field-error={errors.permanent ? "" : undefined}
                      className={cn(
                        "transition-opacity",
                        addressLocked && "opacity-70 pointer-events-none",
                        errors.permanent && "p-3 -mx-3 rounded-lg border border-danger bg-danger-soft/40"
                      )}
                    >
                      <AddressFields
                        idPrefix="perm"
                        value={
                          field.value || {
                            provinceCode: "",
                            wardCode: "",
                            street: "",
                          }
                        }
                        onChange={field.onChange}
                        provinces={provinces}
                        errors={{
                          province: errors.permanent?.provinceCode?.message,
                          ward: errors.permanent?.wardCode?.message,
                          street: errors.permanent?.street?.message,
                        }}
                      />
                    </div>
                  )}
                />
              </div>
            </div>
          </section>

          <section className={ui.card}>
            <div className={ui.cardHeader}>
              <h2 className={ui.sectionTitle}>
                <ShieldPlus size={16} className="text-primary" /> Nơi đăng ký khám chữa bệnh ban đầu
              </h2>
            </div>
            <div className="grid gap-4 p-4 sm:p-5 md:grid-cols-2">
              <div className="min-w-0">
                <label className={cn(ui.fieldLabel, (!hospitalProvince && errors.hospital_code) && "text-danger-text")} htmlFor="kcb-province">
                  Tỉnh thành bệnh viện
                </label>
                <div className={cn((!hospitalProvince && errors.hospital_code) && "rounded-lg ring-1 ring-danger shadow-sm")}>
                  <SearchableSelect
                    id="kcb-province"
                    value={hospitalProvince}
                    disabled={!formEnabled}
                    onChange={(v) => {
                      setHospitalProvince(v);
                      setValue("hospital_code", "");
                    }}
                    options={provinces
                      .filter(
                        (p) =>
                          external || p.code === "79" ||
                          p.code === "75" ||
                          p.name.includes("Hồ Chí Minh") ||
                          p.name.includes("Đồng Nai"),
                      )
                      .map((p) => ({
                        value: p.code,
                        label: p.name,
                      }))}
                    placeholder="-- Chọn tỉnh thành --"
                    searchPlaceholder="Gõ tên tỉnh thành..."
                    emptyText="Không có tỉnh thành nào khớp"
                  />
                </div>
              </div>
              <div className="min-w-0">
                <label className={cn(ui.fieldLabel, errors.hospital_code && "text-danger-text")} htmlFor="kcb-hospital">
                  Bệnh viện
                </label>
                <div className={cn(errors.hospital_code && "rounded-lg ring-1 ring-danger shadow-sm")}>
                  <Controller
                    control={control}
                    name="hospital_code"
                    render={({ field }) => (
                      <SearchableSelect
                        id="kcb-hospital"
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        options={hospitals.map((h) => ({
                          value: h.code,
                          label: h.name,
                          hint: h.code,
                        }))}
                        disabled={!formEnabled || !hospitalProvince || hospitalsLoading}
                        placeholder={
                          !hospitalProvince
                            ? "-- Chọn tỉnh thành trước --"
                            : hospitalsLoading
                              ? "Đang tải danh sách..."
                              : "-- Chọn bệnh viện KCB --"
                        }
                        searchPlaceholder="Gõ tên hoặc mã cơ sở..."
                        emptyText="Không có cơ sở nào khớp"
                      />
                    )}
                  />
                </div>
                <FieldError message={errors.hospital_code?.message} />
                {formEnabled && hospitalProvince && !hospitalsLoading && (
                  <p className="mt-1.5 text-xs text-primary font-medium">
                    Đã tìm thấy {hospitals.length} cơ sở. Gõ tên hoặc mã để tìm,
                    không dấu cũng được.
                  </p>
                )}
              </div>
              {!external && formEnabled && (
                <ul className="space-y-0.5 text-xs text-muted md:col-span-2">
                  <li>
                    • <b>Link tra cứu bệnh viện:</b>{" "}
                    <a
                      href="https://drive.google.com/file/d/1S1oznRw_hKKeYmA6H5qVqDz0w3KxsqaM/view?usp=sharing"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      Xem tại đây
                    </a>
                  </li>
                  <li>
                    • Sinh viên chỉ chọn các Bệnh viện tại <b>TP.HCM</b> hoặc{" "}
                    <b>Đồng Nai</b>.
                  </li>
                  <li>
                    • <b>Lưu ý:</b> Sinh viên{" "}
                    <b className="text-danger-text">không</b> chọn bệnh viện{" "}
                    <b className="text-danger-text">không được đăng ký mới</b> và{" "}
                    <b className="text-danger-text">đổi nơi Khám chữa bệnh (KCBBD)</b>.
                  </li>
                </ul>
              )}
            </div>
          </section>

          <section className={ui.card}>
            <div className={ui.cardHeader}>
              <h2 className={ui.sectionTitle}>
                <CreditCard size={16} className="text-primary" /> {external ? "Hồ sơ đính kèm" : "Thanh toán & Hồ sơ"}
              </h2>
            </div>
            <div className="space-y-5 p-4 sm:space-y-6 sm:p-5">
              {/* Đơn đã nộp: đã chuyển khoản rồi nên ẩn QR + thông tin chuyển khoản. */}
              {!external && !editingRecord && <div className="flex flex-col items-center gap-5 rounded-lg border border-line bg-surface-subtle p-4 md:flex-row md:items-start md:gap-6">
                <div className="shrink-0 text-center">
                  {qrPayload ? (
                    <>
                      <div className="rounded-lg border border-line bg-white p-3">
                        <QRCode
                          value={qrPayload}
                          size={148}
                          level="M"
                          style={{ height: 148, width: 148 }}
                        />
                      </div>
                      <p className="mt-2 text-xs text-muted">
                        Quét bằng app ngân hàng bất kỳ
                      </p>
                    </>
                  ) : (
                    <div className="flex h-[176px] w-[176px] items-center justify-center rounded-lg border border-dashed border-line bg-white px-4 text-center text-xs text-muted">
                      Chưa tạo được mã QR. Vui lòng chuyển khoản thủ công theo
                      thông tin bên cạnh.
                    </div>
                  )}
                </div>

                <div className="w-full min-w-0 flex-1">
                  <h3 className="mb-2 font-semibold text-ink">
                    Thông tin chuyển khoản
                  </h3>
                  <ul className="space-y-1.5 text-sm text-ink-3">
                    <li>
                      Ngân hàng:{" "}
                      <strong className="text-ink">
                        {config?.bank_name || "—"}
                      </strong>
                      {bankBin && (
                        <span className="ml-1.5 text-xs text-muted">
                          (BIN {bankBin})
                        </span>
                      )}
                    </li>
                    <li className="flex flex-wrap items-center gap-x-2">
                      <span>
                        Số tài khoản:{" "}
                        <strong className="font-mono text-ink">
                          {config?.bank_account_number || "—"}
                        </strong>
                      </span>
                      {config?.bank_account_number && (
                        <CopyButton text={config.bank_account_number} />
                      )}
                    </li>
                    <li>
                      Chủ tài khoản:{" "}
                      <strong className="text-ink">
                        {config?.bank_account_name || "—"}
                      </strong>
                    </li>
                    <li>
                      Số tiền:{" "}
                      <strong className="text-base text-primary">
                        {config?.insurance_fee
                          ? new Intl.NumberFormat("vi-VN").format(
                              config.insurance_fee,
                            )
                          : "—"}{" "}
                        VNĐ
                      </strong>
                    </li>
                    <li className="flex flex-wrap items-center gap-x-2">
                      <span>
                        Nội dung:{" "}
                        <strong className="break-all text-ink">
                          {transferNote}
                        </strong>
                      </span>
                      <CopyButton text={transferNote} />
                    </li>
                  </ul>
                  <p className="mt-3 text-xs text-muted">
                    Mã QR đã gồm sẵn số tài khoản, số tiền và nội dung. Giữ nguyên
                    nội dung chuyển khoản để Phòng KHTC đối chiếu được hóa đơn.
                  </p>
                </div>
              </div>}

              {editingRecord && (
                <p className="text-xs text-muted">
                  {editLocked
                    ? "Ảnh đã nộp. Bấm vào ảnh để xem cỡ lớn."
                    : "Ảnh đã nộp được giữ nguyên. Chỉ chọn ảnh mới khi muốn thay thế."}
                </p>
              )}

              <div className={cn("grid items-start gap-4 sm:grid-cols-2 sm:gap-5", external ? "lg:grid-cols-3" : "lg:grid-cols-4")}>
                {imageSlots.map((slot) => {
                  const value = watch(slot.name) as FileList | string | undefined;
                  return (
                    <ImageField
                      key={slot.name}
                      label={slot.label}
                      hint={"hint" in slot ? slot.hint : undefined}
                      emptyText={slot.emptyText}
                      Icon={slot.Icon}
                      tone={slot.tone}
                      existingUrl={submittedImages[slot.name]}
                      disabled={!formEnabled || saving}
                      file={typeof value === "string" ? undefined : value?.[0]}
                      error={errors[slot.name]}
                      input={register(slot.name)}
                    />
                  );
                })}
              </div>
            </div>
          </section>

          {formEnabled && (
            <div className={cn(ui.card, "p-4 sm:p-5 transition-colors", errors.confirm_declaration && "border-danger bg-danger-soft")}>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  {...fieldA11y("confirm_declaration", !!errors.confirm_declaration)}
                  {...register("confirm_declaration")}
                  className={cn("mt-0.5 h-5 w-5 shrink-0 rounded border-line-strong text-primary focus:ring-primary", errors.confirm_declaration && "border-danger outline-none ring-2 ring-danger/20")}
                />
                <div>
                  <span className={cn("text-sm font-medium", errors.confirm_declaration ? "text-danger-text" : "text-ink")}>
                    {editingRecord
                      ? "Xác nhận thông tin chỉnh sửa là chính xác và đồng ý cung cấp thông tin cho nhà trường."
                      : external
                        ? "Xác nhận đã khai đúng thông tin và đồng ý cung cấp thông tin cho nhà trường."
                        : "Xác nhận đã khai đúng thông tin, đã chuyển khoản và đồng ý cung cấp thông tin cho nhà trường."}
                  </span>
                  <FieldError id={errorId("confirm_declaration")} message={errors.confirm_declaration?.message} />
                </div>
              </label>
            </div>
          )}
        </fieldset>

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          {editingRecord ? (
            unlocked ? (
              <>
                <button type="button" className={cn(ui.btnGhost, "w-full sm:w-auto")} disabled={saving} onClick={cancelEdit}>
                  Hủy chỉnh sửa
                </button>
                <button type="submit" disabled={saving || !canSubmit} className={cn(ui.btnPrimary, "w-full sm:w-auto")}>
                  {saving && <Loader2 size={16} className="animate-spin" />} {resubmitting ? "Gửi lại" : "Lưu thay đổi"}
                </button>
              </>
            ) : (
              <Link href="/dashboard/bao-hiem-y-te" className={cn(ui.btnOutline, "w-full sm:w-auto")}>
                Quay lại trang BHYT
              </Link>
            )
          ) : (
            <>
              <Link href="/dashboard/bao-hiem-y-te" className={cn(ui.btnGhost, "w-full sm:w-auto")}>
                Hủy
              </Link>
              <button type="submit" disabled={saving || !canSubmit} className={cn(ui.btnPrimary, "w-full sm:w-auto")}>
                {saving && <Loader2 size={16} className="animate-spin" />} {external ? "Gửi khai báo" : "Gửi đăng ký"}
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}
