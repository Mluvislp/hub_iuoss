"""BHYT workflow contract v2. Keep identical to Dashboard's copy."""
import hashlib
import json
import re
from pathlib import Path, PureWindowsPath

STATUS_LABELS = {
    'iu_processing': 'ĐHQT xử lý', 'waiting_bhxh': 'Chờ BHXH xử lý',
    'issued': 'Phát hành', 'rejected': 'Từ chối',
}
LEGACY = {'pending': 'iu_processing', 'processing': 'iu_processing', 'done': 'issued'}
TRANSITIONS = {'iu_processing': {'waiting_bhxh', 'rejected'}, 'waiting_bhxh': {'issued'}}
REASONS = {'UNPAID': 'Chưa thanh toán tiền', 'UNDERPAID': 'Thanh toán thiếu tiền',
           'HOSPITAL_NOT_ACCEPTED': 'Bệnh viện không chấp nhận', 'OTHER': 'Lý do khác'}
EVENT_LABELS = {'SUBMITTED': 'Nộp đơn', 'REJECTED': 'Từ chối đơn',
    'HOSPITAL_CHANGED': 'Điều chỉnh bệnh viện', 'PAYMENT_EVIDENCE_SUBMITTED': 'Gửi minh chứng thanh toán',
    'PAYMENT_ASSESSED': 'Đối soát tiền', 'RESUBMITTED': 'Gửi lại đơn',
    'SENT_TO_BHXH': 'Chuyển BHXH', 'ISSUED': 'Phát hành thẻ', 'REOPENED': 'Mở lại đơn',
    'LEGACY_IMPORTED': 'Ghi nhận dữ liệu cũ'}


class WorkflowError(ValueError):
    pass


class Conflict(WorkflowError):
    pass


def normalized(status):
    return LEGACY.get(status, status)


def status_label(status):
    canonical = normalized(status)
    return STATUS_LABELS.get(canonical, canonical)


def validate_transition(old, new):
    if new not in TRANSITIONS.get(normalized(old), set()):
        raise Conflict(f'Không thể chuyển {old} → {new}. Hãy tải lại đơn.')


def integer(value, label='Số tiền'):
    if isinstance(value, bool) or not re.fullmatch(r'\d{1,15}', str(value)):
        raise WorkflowError(f'{label} phải là số nguyên không âm (tối đa 15 chữ số).')
    return int(value)


def assessment(required, paid, reason=None):
    required, paid = integer(required, 'Mức phí'), integer(paid, 'Tổng đã xác nhận')
    if reason == 'UNPAID' and paid != 0:
        raise WorkflowError('Chưa thanh toán: tổng đã xác nhận phải bằng 0.')
    if reason == 'UNDERPAID' and not 0 < paid < required:
        raise WorkflowError('Thiếu tiền: tổng đã xác nhận phải lớn hơn 0 và nhỏ hơn mức phí.')
    return dict(required_amount_vnd=required, confirmed_paid_total_vnd=paid,
                missing_amount_vnd=max(required - paid, 0))


def validate_reason(code, text):
    if code not in REASONS:
        raise WorkflowError('Chọn mã lý do từ chối hợp lệ.')
    if len(text) > 2000 or (code == 'OTHER' and not text.strip()):
        raise WorkflowError('Lý do khác cần nội dung; tối đa 2.000 ký tự.')


def request_key(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]{16,80}', value):
        raise WorkflowError('Thiếu hoặc sai request key. Hãy tải lại trang.')
    return value


def fingerprint(data):
    return hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False,
                                    separators=(',', ':')).encode()).hexdigest()


def safe_path(root, key):
    if not root or not key or '\\' in key or Path(key).is_absolute() or PureWindowsPath(key).drive:
        return None
    if '..' in Path(key).parts:
        return None
    try:
        root = Path(root).resolve()
        path = (root / key).resolve()
        path.relative_to(root)
        return path if path.is_file() else None
    except (ValueError, OSError):
        return None
