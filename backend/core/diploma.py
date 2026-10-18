"""Nộp bằng tốt nghiệp THPT — nghiệp vụ phía Hub. Tài liệu: dashboard_iuoss/docs/DIPLOMA.md.

Quy trình 4 bước:
  1. SV khai thông tin văn bằng + bản scan PDF trên Hub (form này).
  2. Chuyên viên duyệt từng hồ sơ trên Dashboard (đúng → Đã duyệt; sai → Cần sửa lại kèm lý do).
  3. Hồ sơ đã duyệt vào hàng chờ; chuyên viên bấm gửi một thư hẹn (BCC) cho cả lô.
  4. SV mang bằng gốc tới, đọc MSSV (hoặc đưa mã QR trên trang này), chuyên viên xác nhận đã nhận.

Thông tin cá nhân (họ tên, MSSV, email trường, SĐT, CCCD, ảnh CCCD) KHÔNG lưu vào hồ sơ và SV
KHÔNG sửa được — đọc thẳng từ dữ liệu có sẵn, chỉ để xem. Ngoại lệ duy nhất: kho ảnh chưa có
ảnh CCCD mặt trước thì SV tải lên (lưu vào kho `student_images`, không sửa ảnh đã có).

Trang Hub có bốn chế độ (`build_state()['mode']`):
  - `imported`  : hồ sơ do chuyên viên import từ hệ thống — chỉ hiện thông tin văn bằng.
  - `submitted` : đã nộp trên Hub — hiện đơn đã nộp; chỉ sửa được khi bị trả về.
  - `form`      : chưa có hồ sơ, đang có đợt mở cho KHÓA của SV — hiện form.
  - `blocked`   : chưa có hồ sơ, không có đợt mở cho khóa của SV — hiện lý do.

Mỗi SV MỘT hồ sơ (bằng THPT chỉ có một). Đợt mở cho một hoặc nhiều khóa (`intake_years`,
so với `students.academic_entry_year`). Hồ sơ bị trả về vẫn gửi lại được sau hạn chót.
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
from .diploma_models import DiplomaEvent, DiplomaRound, DiplomaSubmission as S
from .insurance_contract import WorkflowError, fingerprint, request_key, safe_path
from .insurance_files import inspect_upload

PDF_MIME = 'application/pdf'
MAX_PDF_BYTES = 10 * 1024 * 1024
STORAGE_PREFIX = 'insurance_private/diplomas'   # prefix đã bị chặn URL thô ở Django + Nginx
CCCD_KIND = 'cccd_front'

# Cam kết cuối form — lưu phiên bản + thời điểm vào payload sự kiện. Đổi câu chữ thì tăng phiên bản.
CONSENT_VERSION = '2026-10-13'
CONSENT_TEXT = ('Tôi cam kết thông tin văn bằng đã khai và bản scan đã tải lên đúng với bằng tốt nghiệp THPT '
                'bản gốc; sẽ mang bản gốc tới Phòng Công tác Sinh viên khi nhận được thư hẹn.')

# Người dùng thường gõ khoảng trắng / chữ thường; số hiệu văn bằng giữ chữ, số, '/', '-', '.'.
DIPLOMA_NUMBER_RE = re.compile(r'^[A-Z0-9][A-Z0-9/.\-]{3,31}$')
YEAR_RE = re.compile(r'(19[5-9]\d|20\d\d)')
FIELDS = ('diploma_number', 'issued_by', 'issued_on', 'exam_session')


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


def intake_years(round_):
    return {int(y) for y in (round_.intake_years or []) if str(y).isdigit()}


def rounds_for(student):
    """Các đợt mở cho khóa của SV (lọc trong Python — số đợt nhỏ, JSON khó index)."""
    year = student.academic_entry_year
    if not year:
        return []
    return [r for r in DiplomaRound.objects.order_by('opens_at') if year in intake_years(r)]


def display_round(student, now=None):
    """Đợt của khóa SV: đang mở; không có thì sắp mở gần nhất; không nữa thì vừa đóng."""
    now = now or timezone.now()
    rounds = rounds_for(student)
    return (next((r for r in rounds if round_state(r, now) == 'open'), None)
            or next((r for r in rounds if round_state(r, now) == 'upcoming'), None)
            or next((r for r in reversed(rounds) if round_state(r, now) == 'closed'), None))


def _lines(text):
    """Mỗi dòng một ý; dòng mở đầu '+' là gạch đầu dòng — cùng quy ước gói khám sức khỏe."""
    return [{'bullet': line.startswith('+'), 'text': line.lstrip('+').strip()}
            for line in (raw.strip() for raw in (text or '').splitlines()) if line]


def serialize_round(round_):
    if round_ is None:
        return None
    return {
        'id': round_.pk, 'title': round_.title, 'intake_years': sorted(intake_years(round_)),
        'opens_at': round_.opens_at.isoformat(), 'closes_at': round_.closes_at.isoformat(),
        'state': round_state(round_),
        'description_lines': _lines(round_.description),
        'original_note_lines': _lines(round_.original_note),
    }


def _blocked_message(student, round_):
    if not student.academic_entry_year:
        return 'Hồ sơ của bạn chưa có thông tin khóa, chưa xác định được đợt nộp. Vui lòng liên hệ Phòng CTSV.'
    if round_ is None:
        return f'Hiện chưa có đợt nộp bằng tốt nghiệp THPT dành cho khóa {student.academic_entry_year}.'
    if round_state(round_) == 'upcoming':
        return f'{round_.title} mở nhận hồ sơ từ {timezone.localtime(round_.opens_at):%H:%M %d/%m/%Y}.'
    return f'{round_.title} đã kết thúc lúc {timezone.localtime(round_.closes_at):%H:%M %d/%m/%Y}.'


# ── Hồ sơ gốc (chỉ đọc) ─────────────────────────────────────────────────────

def profile(student):
    """Thông tin cá nhân hiển thị — cùng cách chọn dòng với form BHYT (`_snapshot`)."""
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
        'intake_year': student.academic_entry_year,
        'university_email': contacts.get(StudentContactPoint.TYPE_UNIVERSITY_EMAIL, '').lower(),
        'phone_number': contacts.get(StudentContactPoint.TYPE_MOBILE_PHONE, ''),
        'citizen_id': (cccd.document_number or '') if cccd else '',
    }


def current_cccd_image(student):
    return student_images.get_images(student, [CCCD_KIND]).get((CCCD_KIND, student_images.SELF))


# ── Trạng thái cho frontend ─────────────────────────────────────────────────

def serialize_submission(sub):
    if sub is None:
        return None
    imported = sub.source == S.SOURCE_IMPORT
    return {
        'id': sub.pk, 'source': sub.source, 'status': sub.status, 'status_label': sub.status_label,
        'row_version': sub.row_version,
        'diploma_number': sub.diploma_number, 'issued_by': sub.issued_by,
        'issued_on': sub.issued_on.isoformat(), 'exam_session': sub.exam_session,
        'cccd_front_url': None if imported or not sub.cccd_image_id
        else f'/api/diploma/files/cccd_front/?v={sub.row_version}',
        'diploma_pdf_url': f'/api/diploma/files/diploma_pdf/?v={sub.row_version}' if sub.diploma_pdf else None,
        'diploma_pdf_name': (sub.diploma_pdf or {}).get('original_filename') or 'bang-tot-nghiep.pdf',
        'review_note': sub.review_note or '',
        'notified_at': sub.notified_at.isoformat() if sub.notified_at else None,
        'received_at': sub.received_at.isoformat() if sub.received_at else None,
        'created_at': sub.created_at.isoformat(), 'updated_at': sub.updated_at.isoformat(),
    }


def build_state(student):
    sub = S.objects.select_related('round').filter(student=student).first()
    if sub is not None:
        mode = 'imported' if sub.source == S.SOURCE_IMPORT else 'submitted'
        round_ = sub.round
    else:
        round_ = display_round(student)
        mode = 'form' if round_ is not None and round_state(round_) == 'open' else 'blocked'
    image = current_cccd_image(student)
    return {
        'mode': mode,
        'round': serialize_round(round_),
        'submission': serialize_submission(sub),
        'profile': profile(student),
        # Ảnh đang dùng trong kho — chỉ cần khi chưa nộp; đã nộp thì xem ảnh gắn với hồ sơ.
        'cccd_image': student_images.image_payload(image) if image and sub is None else None,
        'can_edit': mode == 'submitted' and sub.status == S.STATUS_RETURNED,
        'consent_text': CONSENT_TEXT,
        'blocked_message': _blocked_message(student, round_) if mode == 'blocked' else '',
    }


# ── Kiểm dữ liệu ─────────────────────────────────────────────────────────────

def exam_year(text):
    match = YEAR_RE.search(text or '')
    return int(match.group(1)) if match else None


def clean(data):
    """Chuẩn hóa + kiểm 4 ô văn bằng. Trả (giá trị, lỗi theo ô). Dashboard import dùng chung luật này
    (bản sao ở dashboard_iuoss `diplomas/importer.clean_diploma`) — sửa luật thì sửa cả hai."""
    get = lambda key: str(data.get(key) or '').strip()  # noqa: E731
    errors = {}
    values = {
        'diploma_number': re.sub(r'\s', '', get('diploma_number')).upper(),
        'issued_by': re.sub(r'\s+', ' ', get('issued_by')),
        'exam_session': re.sub(r'\s+', ' ', get('exam_session')),
    }
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
    return {'storage_key': key, 'size': len(data), 'sha256': digest, 'original_filename': name}


def _cleanup(paths):
    for path in paths:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass


# ── Nộp / gửi lại ────────────────────────────────────────────────────────────

def submit(student, data, files):
    """Nộp hồ sơ mới, hoặc gửi lại hồ sơ bị trả về. Không nhận bất kỳ ô thông tin cá nhân nào.

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
            student = Student.objects.select_for_update().get(pk=student.pk)
            # of=('self',): không khóa luôn dòng đợt (MySQL khóa cả bảng JOIN) — mọi SV sẽ xếp hàng trên một dòng.
            sub = S.objects.select_for_update(of=('self',)).select_related('round').filter(student=student).first()
            if sub:
                replay = sub.events.filter(request_key=key).first()
                if replay:
                    if (replay.payload or {}).get('request_digest') != digest:
                        raise DiplomaError('Yêu cầu này đã được dùng cho nội dung khác. Hãy tải lại trang.', code='conflict')
                    return sub
                if sub.source == S.SOURCE_IMPORT:
                    raise DiplomaError('Thông tin văn bằng của bạn đã được nhập từ hệ thống, không cần nộp.', code='closed')
                if sub.status != S.STATUS_RETURNED:
                    raise DiplomaError('Bạn đã nộp hồ sơ. Chỉ sửa được khi Phòng CTSV trả hồ sơ về.', code='closed')
                if str(sub.row_version) != str(data.get('row_version') or ''):
                    raise DiplomaError('Hồ sơ đã thay đổi ở nơi khác. Hãy tải lại trang.', code='conflict')
            else:
                round_ = display_round(student)
                if round_ is None or round_state(round_) != 'open':
                    raise DiplomaError(_blocked_message(student, round_), code='closed')
                if not pdf:
                    raise DiplomaError('Vui lòng tải lên bản scan bằng tốt nghiệp (PDF).',
                                       errors={'diploma_pdf': 'Vui lòng tải lên bản scan (PDF).'})

            # Ảnh CCCD chỉ ĐỌC từ kho; SV chỉ tải lên khi kho chưa có — không thay ảnh đã có.
            image = current_cccd_image(student)
            if cccd and image is None:
                image = student_images.save_image(student, CCCD_KIND, student_images.SELF, cccd,
                                                  original_filename=cccd_upload.name,
                                                  source=student_images.SOURCE_DIPLOMA, written=written)
            if image is None:
                raise DiplomaError('Hồ sơ chưa có ảnh CCCD mặt trước, vui lòng tải lên.',
                                   errors={'cccd_front': 'Vui lòng tải lên ảnh CCCD mặt trước.'})
            pdf_snapshot = _write_pdf(student, pdf[0], pdf[1], pdf_upload.name, written) if pdf else None
            now = timezone.now()
            if sub is None:
                sub = S.objects.create(student=student, round=round_, source=S.SOURCE_HUB, cccd_image=image,
                                       diploma_pdf=pdf_snapshot, **values)
                kind, changes = 'SUBMITTED', {}
            else:
                changes = {name: {'before': str(getattr(sub, name)), 'after': str(value)}
                           for name, value in values.items() if str(getattr(sub, name)) != str(value)}
                if image.pk != sub.cccd_image_id:
                    changes['cccd_front'] = {'before': '', 'after': 'Ảnh mới'}
                if pdf_snapshot and pdf_snapshot['sha256'] != (sub.diploma_pdf or {}).get('sha256'):
                    changes['diploma_pdf'] = {'before': '', 'after': pdf_snapshot['original_filename']}
                    sub.diploma_pdf = pdf_snapshot
                for name, value in values.items():
                    setattr(sub, name, value)
                sub.cccd_image = image
                sub.status = S.STATUS_PENDING
                sub.submit_count += 1
                sub.supplement_pending = True
                sub.supplemented_at = now
                sub.row_version += 1
                sub.save()
                kind = 'RESUBMITTED'
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
    sub = S.objects.select_related('cccd_image').filter(student=student).first()
    if sub is None:
        return None, None
    if field == 'cccd_front':
        return student_images.image_path(sub.cccd_image) if sub.cccd_image_id else (None, None)
    if field == 'diploma_pdf' and sub.diploma_pdf:
        path = safe_path(settings.MEDIA_ROOT, sub.diploma_pdf.get('storage_key'))
        return (path, PDF_MIME) if path else (None, None)
    return None, None
