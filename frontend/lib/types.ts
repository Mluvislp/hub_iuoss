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
  medical_insurance_code: string;
  hospital_code: string;
  valid_until: string | null;
  is_current: boolean;
}

export interface CivicActivity {
  id: number;
  activity_code: string;
  attempt_no: number;
  result_value: 'YES' | 'NO' | 'UNKNOWN';
  completed_at: string | null;
}

export type RequestType = 'enrollment' | 'graduation' | 'deferment' | 'thuong_binh' | 'other';
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

export interface DashboardData {
  student: Student | null;
  health_insurance: HealthInsuranceCard | null;
  civic_activities: CivicActivity[];
  confirmation_requests: ConfirmationRequest[];
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
