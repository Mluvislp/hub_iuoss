export interface StudentSession {
  ldap_uid: string;
  student_id: number | null;
  student_code: string;
  full_name: string;
}

export interface Department {
  id: number;
  code: string;
  name_vi: string;
}

export interface DegreeLevel {
  id: number;
  code: string;
  name: string;
}

export interface StudentStatus {
  id: number;
  code: string;
  name_vi: string;
  status_group: string;
}

export interface Student {
  id: number;
  current_student_code: string;
  full_name: string;
  date_of_birth: string | null;
  academic_entry_year: number | null;
  current_department: Department | null;
  current_degree_level: DegreeLevel | null;
  current_status: StudentStatus | null;
}

export interface HealthInsuranceCard {
  id: number;
  /** Mã số BHXH (10 chữ số chuẩn, dữ liệu thật còn ngoại lệ). */
  social_insurance_code: string | null;
  medical_insurance_code: string | null;
  /** Mã nơi đăng ký KCB. */
  hospital_code: string | null;
  /** Tên cơ sở KCB tra từ danh mục `hospitals`; null nếu mã không có trong danh mục. */
  hospital_name: string | null;
  /** Tên diện đăng ký (đã phẳng hoá từ danh mục). */
  registration_type: string | null;
  valid_from: string | null;
  valid_until: string | null;
  /** "Thẻ đang dùng" — KHÔNG phải "còn hiệu lực". */
  is_current: boolean;
}

export interface HealthInsuranceRegistration {
  id: number;
  registration_year: number;
  registration_period: string;
  created_at: string;
  status: 'pending' | 'processing' | 'done' | 'rejected';
  rejection_reason: string | null;
}

export interface InsuranceRegistrationPrefill {
  full_name: string;
  student_code: string;
  gender: string;
  dob: string;
  ethnicity: string;
  phone_number: string;
  social_insurance_number: string;
  citizen_id: string;
  permanent_province: string;
  permanent_ward: string;
  permanent_street: string;
  config: {
    description: string;
    insurance_fee: number;
    bank_name: string;
    bank_bin: string;
    bank_account_number: string;
    bank_account_name: string;
  };
  is_eligible: boolean;
  existing_registration_id: number | null;
}

export interface HealthInsuranceData {
  current: HealthInsuranceCard | null;
  history: HealthInsuranceCard[];
  registrations: HealthInsuranceRegistration[];
  is_eligible: boolean;
}

export interface CivicActivity {
  id: number;
  activity_code: string;
  attempt_no: number;
  result_value: 'YES' | 'NO' | 'UNKNOWN';
  completed_at: string | null;
}

export type RequestType = 'enrollment' | 'graduation' | 'deferment' | 'thuong_binh' | 'bank_loan' | 'english_form' | 'other';
export type RequestStatus = 'pending' | 'processing' | 'done' | 'rejected';

export interface ConfirmationRequest {
  id: number;
  request_type: RequestType;
  purpose: string;
  note: string | null;
  payload: Record<string, unknown> | null;
  status: RequestStatus;
  staff_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface PurposeChoice {
  code: string;
  label: string;
}

export interface OtherRequestPrefill {
  student_name: string;
  student_id: string;
  department: string;
  cur_status_vi: string;
  course_year: string;
  max_year: string;
  dob: string;
  citizen_id: string;
}

export interface OtherRequestFormData {
  purpose_choices: PurposeChoice[];
  program_purpose_code: string;
  prefill: OtherRequestPrefill;
}

export interface DefermentPrefill {
  student_name: string;
  student_id: string;
  department: string;
  cur_status_vi: string;
  start_label: string;
  graduation_label: string;
  max_label: string;
  dob: string;
  // Địa chỉ đã ở dạng 2 cấp (CURRENT_STD) → khóa, không cho sửa
  address_locked: boolean;
  address_display: string;
  // Prefill địa chỉ (khi chưa khóa): match sẵn nếu khớp bảng chuẩn, ngược lại rỗng
  province_code: string;
  ward_code: string;
  street: string;
}

export interface DefermentFormData {
  prefill: DefermentPrefill;
}

export interface ThuongBinhPrefill {
  student_name: string;
  student_id: string;
  department: string;
  study_year: string;
  current_semester: string;
  current_academic_year: string;
  course_year: string;
  course_year_number: string;
  max_year_number: string;
  // CCCD chỉ cho sửa khi chưa có CCCD 12 số
  cccd_locked: boolean;
  citizen_id: string;
  citizen_id_issue_date: string;
}

export interface ThuongBinhFormData {
  prefill: ThuongBinhPrefill;
}

export interface BankLoanPrefill {
  student_name: string;
  student_id: string;
  sex: string;
  department: string;
  major_code: string;
  cur_status_vi: string;
  course_year: string;
  current_semester: string;
  start_label: string;
  graduation_label: string;
  course_year_number: string;
  course_month_number: string;
  max_year_number: string;
  max_month_number: string;
  dob: string;
  cccd_locked: boolean;
  citizen_id: string;
  citizen_id_issue_date: string;
}

export interface BankLoanFormData {
  prefill: BankLoanPrefill;
}

export interface EnglishPrefill {
  student_name: string;
  student_id: string;
  cur_status_en: string;
  academic_unit_label: string;
  start_label: string;
  graduation_label: string;
  dob: string;
}

export interface EnglishFormData {
  purpose_choices: PurposeChoice[];
  program_purpose_code: string;
  prefill: EnglishPrefill;
}

// Đơn vị hành chính (cơ cấu 2025)
export interface Province {
  code: string;
  name: string;
  unit_type: string;
}

export interface Ward {
  code: string;
  name: string;
  unit_type: string;
}

// ── Khai báo thông tin ngoại trú ────────────────────────────────────────────

/** EMPTY = chưa có gì · LEGACY = dữ liệu cũ trước 2025 · STANDARD = đã khai lại */
export type AddressState = 'EMPTY' | 'LEGACY' | 'STANDARD';

export interface OffCampusAddressBlock {
  state: AddressState;
  display: string;
  legacy_display: string;
  declared_on: string | null;
  prefill: { province_code: string; ward_code: string; street: string };
}

/** CCCD gồm 3 phần nằm chung một dòng hồ sơ nên đi cùng nhau */
export interface CccdValue {
  number: string;
  issue_place: string;
  issue_date: string;
}

export interface OffCampusField {
  label: string;
  shape: 'scalar' | 'json';
  value: string | CccdValue;
  editable: boolean;
  pending_value: string | CccdValue | null;
}

export interface OffCampusForm {
  /** Đã khai rồi và chưa được phòng CTSV mở lại → form chỉ xem */
  locked: boolean;
  declared_on: string | null;
  /** Đang có vé mở lại → khai được thêm một lần */
  reopened: boolean;
  /** SV đã bấm "yêu cầu chỉnh sửa lại", đang chờ CTSV xử lý */
  reopen_requested: boolean;
  reopen_requested_at: string | null;
  student: {
    full_name: string;
    student_code: string;
    department: string;
    university_email: string;
  };
  fields: Record<string, OffCampusField>;
  permanent: OffCampusAddressBlock;
  temporary: OffCampusAddressBlock;
  temporary_in_hcmc: boolean | null;
  hcmc_province_code: string;
}

export interface OffCampusAddressInput {
  province_code?: string;
  ward_code: string;
  street: string;
}

export interface OffCampusSubmit {
  citizen_id?: CccdValue;
  personal_email?: string;
  mobile_phone?: string;
  permanent: OffCampusAddressInput;
  temporary_in_hcmc: boolean | null;
  temporary: OffCampusAddressInput;
}

export interface OffCampusResult {
  ok: boolean;
  group_key: string;
  fields: Record<string, 'applied' | 'pending'>;
  warnings: Record<string, string[]>;
}

// Cờ bật/tắt tính năng — backend quyết định (settings.FEATURE_*), mặc định tắt
// trên production. Xem lib/features.ts.
export interface FeatureFlags {
  document_requests: boolean;
  civic_activities: boolean;
}

/**
 * Toàn bộ payload của `GET /api/features/`: cờ menu (FeatureFlags) + cờ hạ tầng
 * không lên menu. Tách ra vì `FeatureKey = keyof FeatureFlags` điều khiển
 * FEATURE_META — thêm thẳng vào FeatureFlags sẽ bắt khai báo một mục menu không
 * hề tồn tại.
 */
export interface FeaturesResponse extends FeatureFlags {
  /** Backend đã cấu hình app registration Microsoft chưa (suy ra, không bật tay). */
  microsoft_login: boolean;
}

export interface DashboardData {
  student: Student | null;
  health_insurance: HealthInsuranceCard | null;
  civic_activities: CivicActivity[];
  confirmation_requests: ConfirmationRequest[];
  features: FeatureFlags;
}

export interface LoginResponse {
  access: string;
  refresh: string;
  student_session: StudentSession;
}

export interface ApiError {
  detail?: string;
  non_field_errors?: string[];
  [key: string]: unknown;
}

export const REQUEST_TYPE_LABELS: Record<RequestType, string> = {
  enrollment: 'Xác nhận đang học',
  graduation: 'Xác nhận tốt nghiệp',
  deferment: 'Hoãn nghĩa vụ quân sự',
  thuong_binh: 'Ưu đãi giáo dục (thương binh)',
  bank_loan: 'Vay vốn ngân hàng',
  english_form: 'Xác nhận (mẫu tiếng Anh)',
  other: 'Khác',
};

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  pending: 'Chờ xử lý',
  processing: 'Đang xử lý',
  done: 'Hoàn thành',
  rejected: 'Từ chối',
};

// Màu trạng thái theo hệ thống (semantic tokens, dùng với `badge.base`)
export const REQUEST_STATUS_STYLES: Record<RequestStatus, string> = {
  pending:    'bg-warning-soft text-warning-text border-warning-line',
  processing: 'bg-primary-soft text-primary-text border-primary-line',
  done:       'bg-success-soft text-success-text border-success-line',
  rejected:   'bg-danger-soft text-danger-text border-danger-line',
};
