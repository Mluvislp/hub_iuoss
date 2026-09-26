import type { InsurancePeriod } from './insurance-periods';

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
  registration_type_code: string | null;
  registration_year: number | null;
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
  status: 'iu_processing' | 'waiting_bhxh' | 'issued' | 'rejected';
  rejection_reason: string | null;
}

export interface ExternalInsuranceDeclaration {
  id: number;
  medical_insurance_code: string;
  social_insurance_code: string;
  hospital_code: string;
  hospital_name: string | null;
  valid_from: string;
  valid_until: string;
  registration_year: number;
  status: 'pending' | 'confirmed' | 'rejected';
  review_note: string | null;
  created_at: string;
  reviewed_at: string | null;
  declared: { label: string; value: string }[];
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
  external_declarations: ExternalInsuranceDeclaration[];
  periods: InsurancePeriod[];
  is_eligible: boolean;
}

export interface InsurancePeriodConfig extends InsurancePeriod {
  description: string;
  insurance_fee: number;
  bank_name: string;
  bank_bin: string;
  bank_account_number: string;
  bank_account_name: string;
}

export interface CivicActivity {
  id: number;
  activity_code: string;
  attempt_no: number;
  result_value: 'YES' | 'NO' | 'UNKNOWN';
  completed_at: string | null;
}

export type RequestType = 'enrollment' | 'graduation' | 'deferment' | 'thuong_binh' | 'bank_loan' | 'english_form' | 'other';
export type RequestStatus = 'pending' | 'processing' | 'awaiting_info' | 'done' | 'rejected';

export interface ConfirmationRequest {
  id: number;
  request_type: RequestType;
  purpose: string;
  note: string | null;
  payload: Record<string, unknown> | null;
  status: RequestStatus;
  /** Mã hồ sơ portal — sinh viên trình mã này khi tới nhận giấy. */
  portal_code: string | null;
  comment_count: number;
  student_can_comment: boolean;
  created_at: string;
  updated_at: string;
}

/** Một lượt trao đổi trên yêu cầu. `event` khác null = đi kèm một lần đổi trạng thái. */
export interface RequestComment {
  id: number;
  author_role: 'student' | 'staff';
  author_name: string;
  body: string;
  event: string | null;
  created_at: string;
}

export interface ConfirmationRequestDetail extends ConfirmationRequest {
  comments: RequestComment[];
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
  dob: string;
  start_label: string;
  graduation_label: string;
  max_label: string;
  /** Đã có bản thường trú chuẩn hóa 2 cấp (CURRENT_STD) — dữ liệu đáng tin, khóa sẵn. */
  address_standardized: boolean;
  // Địa chỉ tách riêng 3 phần; chưa chuẩn hóa thì đây là giá trị ĐOÁN từ dữ liệu cũ
  // (có thể rỗng nếu đoán không ra).
  province_code: string;
  province_name: string;
  ward_code: string;
  ward_name: string;
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
  /** Hồ sơ đã có CCCD 12 số ⇒ ô khóa sẵn, bấm "Yêu cầu chỉnh sửa" mới mở. false ⇒ bắt buộc nhập. */
  cccd_valid: boolean;
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
  /** Hồ sơ đã có CCCD 12 số ⇒ ô khóa sẵn, bấm "Yêu cầu chỉnh sửa" mới mở. false ⇒ bắt buộc nhập. */
  cccd_valid: boolean;
  citizen_id: string;
  citizen_id_issue_date: string;
  /** Mã lớp hồ sơ; rỗng ⇒ ô mở sẵn, bắt buộc nhập. SV sửa thì chuyên viên duyệt. */
  class_code: string;
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
  health_check: boolean;
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
  awaiting_info: 'Chờ bổ sung thông tin',
  done: 'Hoàn thành',
  rejected: 'Từ chối',
};

// Màu trạng thái theo hệ thống (semantic tokens, dùng với `badge.base`)
export const REQUEST_STATUS_STYLES: Record<RequestStatus, string> = {
  pending:    'bg-warning-soft text-warning-text border-warning-line',
  processing: 'bg-primary-soft text-primary-text border-primary-line',
  // Cố ý KHÁC hẳn 'pending': đây là trạng thái việc đang nằm ở phía sinh viên,
  // phải nhìn ra ngay giữa một danh sách toàn màu vàng "chờ xử lý".
  awaiting_info: 'bg-violet-50 text-violet-700 border-violet-200',
  done:       'bg-success-soft text-success-text border-success-line',
  rejected:   'bg-danger-soft text-danger-text border-danger-line',
};

export interface InsuranceEvidence { id:number; filename:string; url:string; }
export interface InsuranceAssessment { required_amount_vnd:number; confirmed_paid_total_vnd:number; missing_amount_vnd:number; }
export interface HospitalSnapshot { hospital_code:string; hospital_name:string; province_code:string; province_name:string; }
export interface InsuranceTimelineItem {
  id:number; label:string; created_at:string; source_app:string; from_status:string|null; to_status:string|null;
  reason_label:string; reason_text:string|null; assessment:InsuranceAssessment|null; evidences:InsuranceEvidence[];
  payload:{before?:HospitalSnapshot; after?:HospitalSnapshot};
}
export interface InsuranceDetail {
  hospital_code: string;
  id:number; status:string; row_version:number; reason_code:string|null; reason_label:string; reason_text:string|null;
  timeline:InsuranceTimelineItem[];
  payment:(InsuranceAssessment & {qr_url:string|null; bank_name:string; bank_account_number:string; bank_account_name:string; reference:string})|null;
}

// ── Khám sức khỏe định kỳ (/api/health-check/) ──────────────────────────────

export type HealthCheckRoundState = 'upcoming' | 'open' | 'closed';

export interface HealthCheckRound {
  id: number;
  academic_year: string;
  title: string;
  opens_at: string;
  closes_at: string;
  state: HealthCheckRoundState;
  package_name: string;
  /** Dòng `bullet` là gạch đầu dòng con của dòng thường đứng trước nó. */
  package_lines: { bullet: boolean; text: string }[];
  schedule_note: string;
}

export interface HealthCheckResidence {
  eligible: boolean;
  permanent_hcm: boolean;
  temporary_hcm: boolean;
  permanent: string;
  temporary: string;
  declared_with_registration?: boolean;
}

export type HealthCheckStatus =
  | 'pending' | 'approved' | 'rejected'        // choice = examined
  | 'registered' | 'attended' | 'absent';      // choice = register

export interface HealthCheckResponse {
  id: number;
  choice: 'examined' | 'register';
  status: HealthCheckStatus;
  status_label: string;
  submitted_at: string;
  submit_count: number;
  consent_at: string | null;
  review_note: string;
  reviewed_at: string | null;
  evidence: { index: number; name: string }[];
  residence: HealthCheckResidence | null;
}

export interface HealthCheckState {
  round: HealthCheckRound | null;
  response: HealthCheckResponse | null;
  can_submit: boolean;
  can_resubmit: boolean;
  max_evidence_files: number;
  offcampus: OffCampusForm;
  residence: HealthCheckResidence;
}
