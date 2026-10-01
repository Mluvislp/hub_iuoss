"""Hợp đồng nghiệp vụ Miễn giảm học phí (MGHP): trạng thái, event, lý do, validate.

BẢN SONG SINH, SỬA CẢ HAI NƠI — giữ GIỐNG HỆT nhau:
  dashboard_iuoss/tuition/tuition_exemption_contract.py
  hub_iuoss/backend/core/tuition_exemption_contract.py
Kiểm nhanh: diff hai file phải rỗng. Vì vậy file này KHÔNG import Django hay module
nào của app — chỉ thư viện chuẩn.

Hình dạng đơn: một SV nộp MỘT đơn mỗi đợt, chọn ĐÚNG MỘT đối tượng (từ 01/10/2026 —
bảng application_categories vẫn N–N để không đổi schema). Cán bộ xét đối tượng
(REVIEW_*), trạng thái đơn (STATUS_*) là tổng kết của cả đơn.
"""
import hashlib
import json
import re

# ── Trạng thái đơn ───────────────────────────────────────────────────────────
# TODO(mghp): chốt bộ trạng thái với nghiệp vụ trước khi viết workflow thật.
STATUS_LABELS = {
    'submitted': 'Đã nộp',
    'under_review': 'Đang xét',
    'need_supplement': 'Cần bổ sung',
    'approved': 'Đã duyệt',
    'rejected': 'Không duyệt',
}
TRANSITIONS = {
    'submitted': {'under_review', 'need_supplement', 'approved', 'rejected'},
    'under_review': {'need_supplement', 'approved', 'rejected'},
    'need_supplement': {'under_review'},      # SV bổ sung (SUPPLEMENTED)
    'rejected': {'under_review'},             # cán bộ tiếp nhận lại (REOPENED)
    'approved': {'under_review'},             # superuser mở lại, bắt buộc lý do
}
# Trạng thái mà SV còn sửa/bổ sung được từ Hub.
STUDENT_EDITABLE = {'submitted', 'need_supplement'}

# ── Kết quả xét từng đối tượng trong đơn ─────────────────────────────────────
REVIEW_LABELS = {
    'pending': 'Chờ xét',
    'approved': 'Đạt',
    'rejected': 'Không đạt',
    'need_supplement': 'Cần bổ sung',
}

# ── Lý do không duyệt / yêu cầu bổ sung ──────────────────────────────────────
REASONS = {
    'MISSING_DOCUMENTS': 'Thiếu giấy tờ',
    'INVALID_DOCUMENTS': 'Giấy tờ không hợp lệ',
    'EXPIRED_DOCUMENTS': 'Giấy tờ hết hiệu lực',
    'NOT_ELIGIBLE': 'Không thuộc đối tượng',
    'OTHER': 'Lý do khác',
}

# ── Timeline (hub_tuition_exemption_events.event_type) ───────────────────────
EVENT_LABELS = {
    'SUBMITTED': 'Nộp đơn',
    'STUDENT_UPDATED': 'Sinh viên chỉnh sửa',
    'DOCUMENT_REPLACED': 'Thay giấy tờ',
    'SUPPLEMENTED': 'Sinh viên bổ sung',
    'REVIEW_STARTED': 'Bắt đầu xét',
    'CATEGORY_REVIEWED': 'Xét đối tượng',
    'DOCUMENT_VERIFIED': 'Xác minh giấy tờ',
    'SUPPLEMENT_REQUESTED': 'Yêu cầu bổ sung',
    'APPROVED': 'Duyệt đơn',
    'REJECTED': 'Không duyệt',
    'REOPENED': 'Mở lại đơn',
    'BANK_SYNCED': 'Cập nhật tài khoản vào hồ sơ',
}

# Hệ thống tự xác định (SV không chọn): chưa từng hưởng → first_time; có trong danh
# sách đang hưởng (tuition_exemption_beneficiaries) hoặc có đơn được duyệt → gia hạn.
SUBMISSION_KINDS = {
    'first_time': 'Nộp lần đầu',
    'previously_reviewed': 'Gia hạn',
}
# Việc SV phải làm với từng diện trong đơn (xem `renewal_mode`).
RENEWAL_MODES = {
    'confirm': 'Xác nhận gia hạn',
    'supplement': 'Bổ sung hồ sơ',
    'new': 'Đăng ký mới',
}

RESUBMIT_POLICIES = {
    'every_term': 'Nộp lại mỗi học kỳ',
    'every_year': 'Nộp lại mỗi năm học',
    'once': 'Nộp một lần cho cả khóa',
}

# ── Kết quả tính (tuition_exemption_results.status) — A3' ────────────────────
RESULT_STATUS_LABELS = {
    'draft': 'Nháp',
    'previewed': 'Đã xem trước',
    'committed': 'Đã chốt',
    'superseded': 'Đã thay thế',
}
RESULT_TRANSITIONS = {
    'draft': {'previewed'},
    'previewed': {'committed', 'draft'},
    'committed': {'superseded'},
}

# Giấy tờ: giới hạn upload dùng chung cho cả kiểm tra phía Hub lẫn hiển thị Dashboard.
MAX_FILES_PER_APPLICATION = 20
MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024
# MIME SAU khi kiểm nội dung: ảnh HEIC/MPO được đổi sang JPEG lúc nhận.
ALLOWED_MIME_TYPES = {'application/pdf', 'image/jpeg', 'image/png', 'image/webp'}
MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024   # ảnh đi qua insurance_files.inspect_upload


class WorkflowError(ValueError):
    pass


class Conflict(WorkflowError):
    pass


def status_label(status):
    return STATUS_LABELS.get(status, status)


def validate_transition(old, new, transitions=TRANSITIONS):
    if new not in transitions.get(old, set()):
        raise Conflict(f'Không thể chuyển {old} → {new}. Hãy tải lại đơn.')


def request_key(value):
    """Khóa chống gửi trùng do trình duyệt sinh — cùng quy ước với BHYT."""
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]{16,80}', value):
        raise WorkflowError('Thiếu hoặc sai request key. Hãy tải lại trang.')
    return value


def fingerprint(data):
    return hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False,
                                     separators=(',', ':'), default=str).encode()).hexdigest()


def validate_reason(code, text):
    """Kiểm mã lý do + nội dung khi không duyệt / yêu cầu bổ sung. `OTHER` bắt buộc
    nội dung; tối đa 2.000 ký tự. Trả (code, text đã strip)."""
    if code not in REASONS:
        raise WorkflowError('Chọn lý do hợp lệ.')
    text = (text or '').strip()
    if code == 'OTHER' and not text:
        raise WorkflowError('Lý do khác cần ghi nội dung.')
    if len(text) > 2000:
        raise WorkflowError('Nội dung lý do tối đa 2.000 ký tự.')
    return code, text


# ── Kiểm dữ liệu form nộp đơn ────────────────────────────────────────────────
PHONE_RE = re.compile(r'0\d{9}')
CITIZEN_ID_RE = re.compile(r'\d{12}')
BANK_ACCOUNT_RE = re.compile(r'[0-9A-Za-z]{4,30}')

TEXT_FIELDS = (
    'full_name', 'student_code', 'citizen_id', 'class_code', 'department_code',
    'phone_number', 'bank_account_number', 'bank_account_holder', 'bank_name',
    'father_full_name', 'father_phone', 'mother_full_name', 'mother_phone',
    'guardian_full_name', 'guardian_phone', 'guardian_relationship',
    'permanent_address', 'permanent_ward_code', 'previous_review_note',
)
REQUIRED_FIELDS = {   # tên ô viết như trong câu "Nhập …"
    'full_name': 'họ và tên',
    'student_code': 'MSSV',
    'citizen_id': 'số CCCD',
    'phone_number': 'số điện thoại',
    'bank_account_number': 'số tài khoản',
    'bank_account_holder': 'tên chủ tài khoản',
    'bank_name': 'tên ngân hàng',
    'permanent_address': 'địa chỉ thường trú',
}


def _digits(value):
    return re.sub(r'[\s.\-]', '', value or '')


def validate_application(data, today):
    """Kiểm + chuẩn hóa dữ liệu form nộp đơn. `today` (date, giờ VN) do app truyền vì
    file này không phụ thuộc Django.

    Trả dict đã chuẩn hóa. Lỗi → WorkflowError có thuộc tính `errors` =
    {field: [thông báo]} để form tô đỏ đúng ô.
    """
    out, errors = {}, {}
    for field in TEXT_FIELDS:
        value = data.get(field)
        out[field] = ' '.join(str(value).split()) if value not in (None, '') else ''
    for field, label in REQUIRED_FIELDS.items():
        if not out[field]:
            errors[field] = [f'Nhập {label}.']

    out['citizen_id'] = _digits(out['citizen_id'])
    if out['citizen_id'] and not CITIZEN_ID_RE.fullmatch(out['citizen_id']):
        errors['citizen_id'] = ['Số CCCD gồm đúng 12 chữ số.']
    for field in ('phone_number', 'father_phone', 'mother_phone', 'guardian_phone'):
        out[field] = _digits(out[field])
        if out[field] and not PHONE_RE.fullmatch(out[field]):
            errors[field] = ['Số điện thoại gồm 10 chữ số, bắt đầu bằng 0.']
    out['bank_account_number'] = _digits(out['bank_account_number'])
    if out['bank_account_number'] and not BANK_ACCOUNT_RE.fullmatch(out['bank_account_number']):
        errors['bank_account_number'] = ['Số tài khoản chỉ gồm chữ và số (4–30 ký tự).']
    out['bank_account_holder'] = out['bank_account_holder'].upper()

    issued = data.get('citizen_id_issued_on')
    if not issued:
        errors['citizen_id_issued_on'] = ['Nhập ngày cấp CCCD.']
    elif issued > today:
        errors['citizen_id_issued_on'] = ['Ngày cấp CCCD không được sau hôm nay.']
    out['citizen_id_issued_on'] = issued
    out['date_of_birth'] = data.get('date_of_birth')

    if not any(out[f] for f in ('father_full_name', 'mother_full_name', 'guardian_full_name')):
        errors['father_full_name'] = ['Nhập họ tên cha, mẹ hoặc người giám hộ.']
    for name, phone in (('father_full_name', 'father_phone'), ('mother_full_name', 'mother_phone'),
                        ('guardian_full_name', 'guardian_phone')):
        if out[name] and not out[phone] and phone not in errors:
            errors[phone] = ['Nhập số điện thoại đi kèm họ tên.']
    if out['guardian_full_name'] and not out['guardian_relationship']:
        errors['guardian_relationship'] = ['Ghi quan hệ của người giám hộ với sinh viên.']

    if errors:
        exc = WorkflowError('Thông tin chưa hợp lệ, kiểm tra các ô được đánh dấu.')
        exc.errors = errors
        raise exc
    return out


MAX_CATEGORIES_PER_APPLICATION = 1


def validate_categories(selected_codes, active_codes):
    """Đối tượng SV chọn: ĐÚNG MỘT, đang active. SV tự chọn — hệ thống không chọn sẵn.
    Trả list một mã (giữ kiểu list để bảng application_categories không phải đổi)."""
    codes = [str(c).strip() for c in selected_codes or [] if str(c).strip()]
    if not codes:
        raise WorkflowError('Chọn một đối tượng miễn giảm.')
    if len(set(codes)) > MAX_CATEGORIES_PER_APPLICATION:
        raise WorkflowError('Mỗi sinh viên chỉ được chọn một đối tượng miễn giảm.')
    codes = codes[:1]
    unknown = [c for c in codes if c not in set(active_codes)]
    if unknown:
        raise WorkflowError(f'Đối tượng không còn nhận hồ sơ: {", ".join(unknown)}. Hãy tải lại trang.')
    return codes


# ── Thông tin riêng theo đối tượng (cột category_details) ────────────────────
# Frontend Hub dựng ô nhập từ đây; Dashboard hiển thị nhãn từ đây. Thêm trường cho một
# đối tượng = thêm vào dict này (không phải ALTER — cột là JSON).
#   type: text | textarea | checkbox ; required: bắt buộc nhập ; max: độ dài tối đa
CATEGORY_FIELDS = {
    'TSKK': [
        {'name': 'self_special_area', 'type': 'checkbox',
         'label': 'Nơi thường trú của tôi thuộc xã, thôn đặc biệt khó khăn hoặc xã biên giới'},
        {'name': 'father_permanent_address', 'type': 'text', 'max': 500,
         'label': 'Địa chỉ thường trú của cha (số nhà/thôn, xã/phường, tỉnh/thành)'},
        {'name': 'father_special_area', 'type': 'checkbox',
         'label': 'Nơi thường trú của cha thuộc xã, thôn đặc biệt khó khăn hoặc xã biên giới'},
        {'name': 'mother_permanent_address', 'type': 'text', 'max': 500,
         'label': 'Địa chỉ thường trú của mẹ (số nhà/thôn, xã/phường, tỉnh/thành)'},
        {'name': 'mother_special_area', 'type': 'checkbox',
         'label': 'Nơi thường trú của mẹ thuộc xã, thôn đặc biệt khó khăn hoặc xã biên giới'},
    ],
    'KHAC': [
        {'name': 'circumstance', 'type': 'textarea', 'required': True, 'max': 2000,
         'label': 'Hoàn cảnh, căn cứ đề nghị miễn giảm học phí'},
    ],
}
# Đối tượng bắt buộc là người dân tộc thiểu số (theo hồ sơ SV — students.ethnicity).
ETHNIC_MINORITY_CATEGORIES = {'TSKK'}
KINH_CODE = '01'


def ethnicity_code(ethnicity):
    """'01_Kinh' → '01'; '' nếu hồ sơ chưa có."""
    return (ethnicity or '').split('_', 1)[0].strip()


def ethnicity_name(ethnicity):
    value = (ethnicity or '').strip()
    return value.split('_', 1)[1] if '_' in value else value


def is_ethnic_minority(ethnicity):
    """True/False theo hồ sơ; None nếu hồ sơ chưa có dân tộc."""
    code = ethnicity_code(ethnicity)
    if not code:
        return None
    return code != KINH_CODE


def _truthy(value):
    return value in (True, 1, '1', 'true', 'True', 'on', 'yes')


def clean_category_details(code, raw, ethnicity):
    """Kiểm thông tin riêng của đối tượng `code`.

    Trả (details, errors, ineligible):
      details    — dict đã chuẩn hóa để lưu (rỗng nếu đối tượng không có trường riêng)
      errors     — {field: [thông báo]} lỗi nhập liệu (tô đỏ ô)
      ineligible — [lý do] SV KHÔNG đủ điều kiện → chặn nộp, hiện pop-up
    """
    raw = raw or {}
    details, errors, ineligible = {}, {}, []
    for f in CATEGORY_FIELDS.get(code, []):
        name = f['name']
        if f['type'] == 'checkbox':
            details[name] = _truthy(raw.get(name))
            continue
        value = str(raw.get(name) or '').strip()
        if f['type'] == 'text':
            value = ' '.join(value.split())
        if f.get('max') and len(value) > f['max']:
            errors[name] = [f'Tối đa {f["max"]} ký tự.']
        elif f.get('required') and not value:
            errors[name] = ['Vui lòng nhập thông tin này.']
        details[name] = value

    if code in ETHNIC_MINORITY_CATEGORIES:
        minority = is_ethnic_minority(ethnicity)
        if minority is None:
            ineligible.append('hồ sơ chưa có thông tin dân tộc (liên hệ Phòng CTSV để cập nhật)')
        elif not minority:
            ineligible.append(f'không thuộc dân tộc thiểu số (hồ sơ ghi: {ethnicity_name(ethnicity) or "Kinh"})')

    if code == 'TSKK':
        if not (details['father_permanent_address'] or details['mother_permanent_address']):
            errors['father_permanent_address'] = ['Nhập địa chỉ thường trú của cha hoặc mẹ.']
        for parent in ('father', 'mother'):
            if details[f'{parent}_special_area'] and not details[f'{parent}_permanent_address']:
                errors[f'{parent}_permanent_address'] = ['Nhập địa chỉ thường trú tương ứng.']
        if not details['self_special_area']:
            ineligible.append('bản thân không thường trú tại xã, thôn đặc biệt khó khăn hoặc xã biên giới')
        if not (details['father_special_area'] or details['mother_special_area']):
            ineligible.append('cả cha và mẹ đều không thường trú tại xã, thôn đặc biệt khó khăn hoặc xã biên giới')
    return details, errors, ineligible


def ineligible_message(code, reasons):
    return f'Sinh viên không đủ điều kiện hưởng đối tượng {code} do ' + '; '.join(reasons) + '.'


def details_display(code, details):
    """[(nhãn, giá trị chữ)] để hiển thị thông tin riêng (Dashboard, Hub, Excel)."""
    rows = []
    for f in CATEGORY_FIELDS.get(code, []):
        value = (details or {}).get(f['name'])
        if f['type'] == 'checkbox':
            value = 'Có' if value else 'Không'
        if value not in (None, ''):
            rows.append((f['label'], value))
    return rows


def documents_for_mode(required_documents, mode):
    """Giấy tờ SV phải nộp theo chế độ: 'new' → toàn bộ; 'supplement' (gia hạn có bổ sung)
    → chỉ giấy đánh dấu renewal_required (không đánh dấu giấy nào → toàn bộ);
    'confirm' → không giấy nào."""
    docs = list(required_documents or [])
    if mode == 'confirm':
        return []
    if mode == 'supplement':
        flagged = [d for d in docs if d.get('renewal_required')]
        return flagged or docs
    return docs


def document_types(required_documents):
    """doc_type hợp lệ của một diện. Diện chưa khai giấy tờ nhận một ô chung 'general'."""
    types = [d.get('doc_type') for d in required_documents or [] if d.get('doc_type')]
    return types or ['general']


def required_documents_missing(required_documents, uploaded_doc_types):
    """Nhãn các giấy tờ BẮT BUỘC mà SV chưa nộp, theo `required_documents` của diện
    ([{doc_type, label, required, has_expiry}]). Diện chưa khai giấy tờ: bắt buộc ít
    nhất một file ở ô chung 'general'."""
    uploaded = set(uploaded_doc_types)
    if not required_documents:
        return [] if 'general' in uploaded else ['Giấy tờ chứng minh thuộc diện']
    return [d.get('label') or d.get('doc_type') for d in required_documents
            if d.get('required') and d.get('doc_type') not in uploaded]


def renewal_mode(policy, last_verified, current):
    """Diện SV ĐÃ được hưởng thì ở kỳ `current` cần làm gì. `last_verified` và
    `current` là (academic_year, semester) — so theo năm học/học kỳ, KHÔNG theo id.

    'confirm'    — chỉ xác nhận gia hạn, không nộp giấy
    'supplement' — phải bổ sung giấy tờ
    """
    if policy == 'once' or last_verified >= current:
        return 'confirm'
    if policy == 'every_year':
        return 'confirm' if last_verified[0] == current[0] else 'supplement'
    return 'supplement'


def supplement_deadline(requested_at, days):
    """Hạn bổ sung = requested_at + `days` ngày (datetime có múi giờ do app truyền).
    TODO(mghp): số ngày lấy từ cấu hình đợt khi Dashboard cài yêu cầu bổ sung."""
    from datetime import timedelta
    return requested_at + timedelta(days=days)
