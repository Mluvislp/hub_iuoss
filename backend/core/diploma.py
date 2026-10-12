"""Nộp bằng tốt nghiệp THPT — nghiệp vụ phía Hub. Tài liệu: dashboard_iuoss/docs/DIPLOMA.md.

Quy trình 4 bước:
  1. SV khai online (form này) + ảnh CCCD mặt trước (lấy từ kho `student_images`) + bản scan PDF.
  2. Chuyên viên duyệt từng hồ sơ trên Dashboard (đúng → Đã duyệt; sai → Cần sửa lại kèm lý do).
  3. Hồ sơ đã duyệt vào hàng chờ; chuyên viên bấm gửi một thư hẹn (BCC) cho cả lô.
  4. SV mang bằng gốc tới, đọc MSSV (hoặc đưa mã QR trên trang này), chuyên viên xác nhận đã nhận.

Mỗi SV MỘT hồ sơ (bằng THPT chỉ có một). Đợt (`diploma_rounds`) chỉ quyết định lúc nào
nhận hồ sơ MỚI; hồ sơ bị trả về vẫn sửa được sau hạn chót (SV không có lỗi khi chuyên viên
duyệt muộn), giống ngoại lệ của khám sức khỏe.

Họ tên, MSSV, email trường lấy nguyên từ hồ sơ và không sửa được; SĐT, CCCD là số SV khai —
khác hồ sơ thì ghi vào `profile_diff` cho chuyên viên đối chiếu, KHÔNG tự ghi đè hồ sơ
(`students/` là read-only với Hub).
"""
import hashlib
import re
from datetime import date
from pathlib import Path
from uuid import uuid4

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from students.models import Student, StudentContactPoint, StudentIdentityDocument

from . import student_images
from .diploma_models import DiplomaEvent, DiplomaRound, DiplomaSubmission
from .insurance_contract import WorkflowError, fingerprint, request_key, safe_path
from .insurance_files import inspect_upload

PDF_MIME = 'application/pdf'
MAX_PDF_BYTES = 10 * 1024 * 1024
STORAGE_PREFIX = 'insurance_private/diplomas'   # prefix đã bị chặn URL thô ở Django + Nginx
CCCD_KIND = 'cccd_front'

# Cam kết cuối form — lưu đúng câu SV đồng ý vào payload sự kiện. Đổi câu chữ thì tăng phiên bản.
CONSENT_VERSION = '2026-10-12'
CONSENT_TEXT = ('Tôi cam kết thông tin đã khai và bản scan đã tải lên đúng với bằng tốt nghiệp THPT bản gốc; '
                'sẽ mang bản gốc tới Phòng Công tác Sinh viên khi nhận được thư hẹn.')

# Người dùng thường gõ khoảng trắng / chữ thường; số hiệu văn bằng giữ chữ, số, '/', '-', '.'.
DIPLOMA_NUMBER_RE = re.compile(r'^[A-Z0-9][A-Z0-9/.\-]{3,31}$')
PHONE_RE = re.compile(r'^(0|\+84)\d{9,10}$')
YEAR_RE = re.compile(r'(19[5-9]\d|20\d\d)')

EDITABLE_STATUSES = (DiplomaSubmission.STATUS_PENDING, DiplomaSubmission.STATUS_RETURNED)


class DiplomaError(ValueError):
    """Lỗi nghiệp vụ, câu thông báo hiển thị thẳng cho SV; `errors` gắn theo từng ô."""

    def __init__(self, message, *, errors=None, code=''):
        self.errors = errors or {}
        self.code = code
        super().__init__(message)


# ── Đợt ──────────────────────────────────────────────────────────────────────

def round_state(round_, now=None):
    now = now or timezone.now()
    if now < round_.opens_at:
        return 'upcoming'
    if now > round_.closes_at:
        return 'closed'
    return 'open'


def display_round(now=None):
    """Đợt đang mở; không có thì đợt sắp mở gần nhất; không nữa thì đợt vừa đóng."""
    now = now or timezone.now()
    rounds = DiplomaRound.objects.all()
    return (rounds.filter(opens_at__lte=now, closes_at__gte=now).order_by('-opens_at').first()
            or rounds.filter(opens_at__gt=now).order_by('opens_at').first()
            or rounds.filter(closes_at__lt=now).order_by('-closes_at').first())


def _lines(text):
    """Mỗi dòng một ý; dòng mở đầu '+' là gạch đầu dòng — cùng quy ước gói khám sức khỏe."""
    out = []
    for raw in (text or '').splitlines():
        line = raw.strip()
        if line:
            out.append({'bullet': line.startswith('+'), 'text': line.lstrip('+').strip()})
    return out


def serialize_round(round_):
    if round_ is None:
        return None
    return {
        'id': round_.pk, 'title': round_.title,
        'opens_at': round_.opens_at.isoformat(), 'closes_at': round_.closes_at.isoformat(),
        'state': round_state(round_),
        'description_lines': _lines(round_.description),
        'original_note_lines': _lines(round_.original_note),
    }


# ── Hồ sơ gốc ────────────────────────────────────────────────────────────────

def profile(student):
    """Thông tin điền sẵn — cùng cách chọn dòng với form BHYT (`_snapshot`)."""
    contacts = {}
    for kind, value in (StudentContactPoint.objects
                        .filter(student_id=student.pk, is_current=True,
                                contact_type__in=[StudentContactPoint.TYPE_MOBILE_PHONE,
                                                  StudentContactPoint.TYPE_UNIVERSITY_EMAIL])
                        .order_by('-id').values_list('contact_type', 'contact_value')):
        contacts.setdefault(kind, (value or '').strip())
    cccd = (StudentIdentityDocument.objects
            .filter(student_id=student.pk, document_type=StudentIdentityDocument.TYPE_CCCD, is_current=True)
            .order_by('-id').first())
    return {
        'full_name': student.full_name or '',
        'student_code': student.current_student_code or '',
        'university_email': contacts.get(StudentContactPoint.TYPE_UNIVERSITY_EMAIL, '').lower(),
        'phone_number': contacts.get(StudentContactPoint.TYPE_MOBILE_PHONE, ''),
        'citizen_id': (cccd.document_number or '') if cccd else '',
    }


def current_cccd_image(student):
    return student_images.get_images(student, [CCCD_KIND]).get((CCCD_KIND, student_images.SELF))


# ── Trạng thái cho frontend ─────────────────────────────────────────────────

def _file_url(submission, field):
    return f'/api/diploma/files/{field}/?v={submission.row_version}'


def serialize_submission(sub):
    if sub is None:
        return None
    return {
        'id': sub.pk, 'status': sub.status, 'status_label': sub.status_label,
        'row_version': sub.row_version, 'round_id': sub.round_id,
        'student_code': sub.student_code, 'full_name': sub.full_name,
        'university_email': sub.university_email, 'phone_number': sub.phone_number,
        'citizen_id': sub.citizen_id, 'diploma_number': sub.diploma_number,
        'issued_by': sub.issued_by, 'issued_on': sub.issued_on.isoformat(),
        'exam_session': sub.exam_session,
        'cccd_front_url': _file_url(sub, 'cccd_front'),
        'diploma_pdf_url': _file_url(sub, 'diploma_pdf'),
        'diploma_pdf_name': (sub.diploma_pdf or {}).get('original_filename') or 'bang-tot-nghiep.pdf',
        'review_note': sub.review_note or '',
        'reviewed_at': sub.reviewed_at.isoformat() if sub.reviewed_at else None,
        'notified_at': sub.notified_at.isoformat() if sub.notified_at else None,
        'received_at': sub.received_at.isoformat() if sub.received_at else None,
        'created_at': sub.created_at.isoformat(), 'updated_at': sub.updated_at.isoformat(),
        'submit_count': sub.submit_count,
    }


def _can_edit(sub, round_):
    """Đang chờ duyệt: sửa khi đợt của hồ sơ còn mở. Bị trả về: sửa lúc nào cũng được."""
    if sub is None:
        return False
    if sub.status == DiplomaSubmission.STATUS_RETURNED:
        return True
    return sub.status == DiplomaSubmission.STATUS_PENDING and round_state(sub.round) == 'open'


def build_state(student):
    sub = DiplomaSubmission.objects.select_related('round').filter(student=student).first()
    round_ = sub.round if sub else display_round()
    image = current_cccd_image(student)
    return {
        'round': serialize_round(round_),
        'submission': serialize_submission(sub),
        'profile': profile(student),
        'cccd_image': student_images.image_payload(image) if image else None,
        'can_submit': sub is None and round_ is not None and round_state(round_) == 'open',
        'can_edit': _can_edit(sub, round_),
        'consent_text': CONSENT_TEXT,
        'closed_message': '' if sub else _closed_message(round_),
    }


def _closed_message(round_):
    if round_ is None:
        return 'Hiện chưa có đợt nhận hồ sơ bằng tốt nghiệp THPT.'
    state = round_state(round_)
    if state == 'upcoming':
        return f'{round_.title} mở nhận hồ sơ từ {timezone.localtime(round_.opens_at):%H:%M %d/%m/%Y}.'
    if state == 'closed':
        return f'{round_.title} đã kết thúc lúc {timezone.localtime(round_.closes_at):%H:%M %d/%m/%Y}.'
    return ''


# ── Kiểm dữ liệu ─────────────────────────────────────────────────────────────

def exam_year(text):
    match = YEAR_RE.search(text or '')
    return int(match.group(1)) if match else None


def clean(data):
    """Chuẩn hóa + kiểm các ô SV nhập. Trả (giá trị, lỗi theo ô)."""
    get = lambda key: str(data.get(key) or '').strip()  # noqa: E731
    errors = {}
    values = {
        'phone_number': re.sub(r'[\s.\-]', '', get('phone_number')),
        'citizen_id': re.sub(r'\s', '', get('citizen_id')),
        'diploma_number': re.sub(r'\s', '', get('diploma_number')).upper(),
        'issued_by': re.sub(r'\s+', ' ', get('issued_by')),
        'exam_session': re.sub(r'\s+', ' ', get('exam_session')),
    }
    if not PHONE_RE.fullmatch(values['phone_number']):
        errors['phone_number'] = 'Số điện thoại không hợp lệ.'
    if not re.fullmatch(r'\d{12}', values['citizen_id']):
        errors['citizen_id'] = 'Số CCCD gồm 12 chữ số.'
    if not DIPLOMA_NUMBER_RE.fullmatch(values['diploma_number']):
        errors['diploma_number'] = 'Số hiệu văn bằng gồm 4–32 ký tự chữ, số, "/", "-" (ghi đúng như trên bằng).'
    if not 3 <= len(values['issued_by']) <= 255:
        errors['issued_by'] = 'Vui lòng nhập nơi cấp, ghi đúng như trên bằng (VD: Sở GD&ĐT TP. Hồ Chí Minh).'
    year = exam_year(values['exam_session'])
    if not values['exam_session'] or len(values['exam_session']) > 32 or year is None:
        errors['exam_session'] = 'Khóa thi phải có năm (VD: 2025 hoặc 26/06/2025).'
    try:
        issued_on = date.fromisoformat(get('issued_on'))
    except ValueError:
        issued_on = None
        errors['issued_on'] = 'Vui lòng chọn ngày cấp.'
    if issued_on:
        if issued_on > timezone.localdate():
            errors['issued_on'] = 'Ngày cấp không thể ở tương lai.'
        elif issued_on.year < 1975:
            errors['issued_on'] = 'Ngày cấp không hợp lệ.'
        elif year and issued_on.year < year:
            errors['issued_on'] = 'Ngày cấp không thể trước năm của khóa thi.'
    values['issued_on'] = issued_on
    return values, errors


def check_pdf(upload):
    """Kiểm chữ ký thật của file (không tin đuôi/Content-Type), cùng cách `tickets._check_pdf`."""
    data = upload.read(MAX_PDF_BYTES + 1)
    upload.seek(0)
    if not data or len(data) > MAX_PDF_BYTES:
        raise DiplomaError('Bản scan tối đa 10 MB.', errors={'diploma_pdf': 'Bản scan tối đa 10 MB.'})
    if not data.startswith(b'%PDF-'):
        raise DiplomaError('Bản scan phải là file PDF.', errors={'diploma_pdf': 'Chỉ nhận file PDF.'})
    return data, hashlib.sha256(data).hexdigest()


def _write_pdf(student, data, digest, original_name, written):
    key = f'{STORAGE_PREFIX}/{student.pk}/{uuid4().hex}.pdf'
    target = Path(settings.MEDIA_ROOT).resolve() / key
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open('xb') as stream:   # tên ngẫu nhiên + 'x' ⇒ không bao giờ ghi đè
        written.append(target)
        stream.write(data)
    name = Path((original_name or '').replace('\\', '/')).name[:255] or 'bang-tot-nghiep.pdf'
    return {'storage_key': key, 'mime_type': PDF_MIME, 'size': len(data), 'sha256': digest,
            'original_filename': name}


def _cleanup(paths):
    for path in paths:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass


# ── Nộp / sửa ────────────────────────────────────────────────────────────────

def submit(student, data, files):
    """Tạo hồ sơ mới, hoặc sửa hồ sơ đang chờ duyệt / gửi lại hồ sơ bị trả về.

    Đọc và kiểm file TRƯỚC transaction; ghi file trong transaction đã khóa dòng SV, lỗi ở
    bất kỳ bước nào thì xóa sạch file vừa ghi. Idempotent theo `request_key`.
    """
    key = request_key(data.get('request_key'))
    if str(data.get('confirm') or '').lower() not in ('1', 'true', 'on'):
        raise DiplomaError('Vui lòng tích ô cam kết.', errors={'confirm': 'Vui lòng tích ô cam kết.'})
    values, errors = clean(data)
    pdf_upload, cccd_upload = files.get('diploma_pdf'), files.get('cccd_front')
    pdf = cccd = None
    if pdf_upload:
        try:
            pdf = check_pdf(pdf_upload)
        except DiplomaError as exc:
            errors.update(exc.errors)
    if cccd_upload:
        try:
            cccd = inspect_upload(cccd_upload)
        except WorkflowError as exc:
            errors['cccd_front'] = str(exc)
    if errors:
        raise DiplomaError('Thông tin chưa hợp lệ, vui lòng kiểm tra các ô được đánh dấu đỏ.', errors=errors)

    digest = fingerprint({**{k: str(v) for k, v in values.items()},
                          'pdf': pdf[1] if pdf else '', 'cccd': cccd[3] if cccd else '',
                          'row_version': str(data.get('row_version') or '')})
    written = []
    try:
        with transaction.atomic():
            Student.objects.select_for_update().filter(pk=student.pk).first()
            # of=('self',): không khóa luôn dòng đợt (MySQL khóa cả bảng JOIN) — mọi SV sẽ xếp hàng trên một dòng.
            sub = (DiplomaSubmission.objects.select_for_update(of=('self',)).select_related('round')
                   .filter(student=student).first())
            if sub:
                replay = sub.events.filter(request_key=key).first()
                if replay:
                    if (replay.payload or {}).get('request_digest') != digest:
                        raise DiplomaError('Yêu cầu này đã được dùng cho nội dung khác. Hãy tải lại trang.', code='conflict')
                    return sub
                if str(sub.row_version) != str(data.get('row_version') or ''):
                    raise DiplomaError('Hồ sơ đã thay đổi ở nơi khác. Hãy tải lại trang.', code='conflict')
                if not _can_edit(sub, sub.round):
                    raise DiplomaError('Hồ sơ đã được duyệt hoặc đợt đã đóng, không thể chỉnh sửa.', code='closed')
                round_ = sub.round
            else:
                round_ = display_round()
                if round_ is None or round_state(round_) != 'open':
                    raise DiplomaError(_closed_message(round_) or 'Hiện không nhận hồ sơ.', code='closed')
                if not pdf:
                    raise DiplomaError('Vui lòng tải lên bản scan bằng tốt nghiệp (PDF).',
                                       errors={'diploma_pdf': 'Vui lòng tải lên bản scan (PDF).'})

            # Ảnh CCCD: ảnh mới → kho student_images (nguồn diploma); không thì dùng ảnh đang có.
            image = (student_images.save_image(student, CCCD_KIND, student_images.SELF, cccd,
                                               original_filename=cccd_upload.name,
                                               source=student_images.SOURCE_DIPLOMA, written=written)
                     if cccd else current_cccd_image(student))
            if image is None and not sub:
                raise DiplomaError('Vui lòng tải lên ảnh CCCD mặt trước.',
                                   errors={'cccd_front': 'Vui lòng tải lên ảnh CCCD mặt trước.'})
            cccd_snapshot = ({'storage_key': image.storage_key, 'mime_type': image.mime_type, 'image_id': image.pk}
                             if image and (cccd or not sub) else None)
            pdf_snapshot = _write_pdf(student, pdf[0], pdf[1], pdf_upload.name, written) if pdf else None

            base = profile(student)
            diff = {field: {'profile': base[field], 'declared': values[field]}
                    for field in ('phone_number', 'citizen_id') if base[field] and base[field] != values[field]}
            fields = dict(values, full_name=base['full_name'] or student.full_name or '',
                          student_code=base['student_code'], university_email=base['university_email'],
                          profile_diff=diff or None)
            now = timezone.now()
            if sub is None:
                sub = DiplomaSubmission.objects.create(
                    round=round_, student=student, cccd_front=cccd_snapshot, diploma_pdf=pdf_snapshot, **fields)
                kind, changes = 'SUBMITTED', {}
            else:
                changes = {}
                for name, value in values.items():
                    before = getattr(sub, name)
                    if str(before) != str(value):
                        changes[name] = {'before': str(before), 'after': str(value)}
                if cccd_snapshot and cccd_snapshot['storage_key'] != (sub.cccd_front or {}).get('storage_key'):
                    changes['cccd_front'] = {'before': '', 'after': 'Ảnh mới'}
                    sub.cccd_front = cccd_snapshot
                if pdf_snapshot and pdf_snapshot['sha256'] != (sub.diploma_pdf or {}).get('sha256'):
                    changes['diploma_pdf'] = {'before': '', 'after': pdf_snapshot['original_filename']}
                    sub.diploma_pdf = pdf_snapshot
                resubmitted = sub.status == DiplomaSubmission.STATUS_RETURNED
                if not changes and not resubmitted:
                    raise DiplomaError('Bạn chưa thay đổi thông tin nào.')
                for name, value in fields.items():
                    setattr(sub, name, value)
                if resubmitted:
                    sub.status = DiplomaSubmission.STATUS_PENDING
                    sub.submit_count += 1
                    sub.supplement_pending = True
                    sub.supplemented_at = now
                sub.row_version += 1
                sub.save()
                kind = 'RESUBMITTED' if resubmitted else 'STUDENT_UPDATED'
            DiplomaEvent.objects.create(
                submission=sub, event_type=kind, actor_id=student.pk, source_app='Hub', request_key=key,
                payload={'request_digest': digest, 'changes': changes,
                         'consent': {'version': CONSENT_VERSION, 'at': now.isoformat()}})
    except Exception:
        _cleanup(written)
        raise
    return sub


def file_path(student, field):
    """(Path, mime) của ảnh CCCD / PDF trong hồ sơ của CHÍNH SV, hoặc (None, None)."""
    sub = DiplomaSubmission.objects.filter(student=student).first()
    if sub is None or field not in ('cccd_front', 'diploma_pdf'):
        return None, None
    data = getattr(sub, field) or {}
    path = safe_path(settings.MEDIA_ROOT, data.get('storage_key'))
    return (path, data.get('mime_type')) if path else (None, None)
