"""Sự kiện cộng tác viên phía Hub: sự kiện SV thấy, form đăng ký, gửi / sửa / hủy đăng ký.

Dashboard tạo sự kiện + chọn đối tượng + duyệt (`dashboard_iuoss/volunteers/`). Hub chỉ ghi
`volunteer_registrations`. Nghiệp vụ: dashboard_iuoss/docs/VOLUNTEER_EVENTS.md.

- SV thấy sự kiện khi: đã công bố VÀ (toàn trường + SV đại học đang học | có trong danh sách chỉ định),
  hoặc SV đã có đăng ký ở sự kiện đó (để theo dõi kết quả kể cả khi bị gỡ khỏi danh sách).
- Gửi / sửa / hủy chỉ trong thời gian đăng ký. Sửa được khi còn "Chờ duyệt"; đã được xét thì khóa.
- File SV nộp nằm dưới MEDIA_ROOT/volunteer_events/<sự kiện>/reg/<SV>/ — Dashboard đọc qua HUB_MEDIA_ROOT.
"""
import json
from datetime import timedelta
from pathlib import Path
from uuid import uuid4

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import Exists, OuterRef, Q
from django.utils import timezone

from students.models import Student, StudentContactPoint

from . import volunteer_form as fs
from .insurance_contract import WorkflowError, safe_path
from .insurance_files import inspect_upload
from .richtext import sanitize
from .volunteer_models import VolunteerEvent as E
from .volunteer_models import VolunteerEventStudent as Aud
from .volunteer_models import VolunteerRegistration as R

MEDIA_DIR = 'volunteer_events'
MAX_PDF_BYTES = 10 * 1024 * 1024
PAST_DAYS = 120          # sự kiện đã qua vẫn hiện trong danh sách bao lâu (chỉ với SV đã đăng ký)
EDITABLE = (R.PENDING,)
CANCELLABLE = (R.PENDING, R.WAITLIST, R.APPROVED)


class VolunteerError(ValueError):
    """Lỗi nghiệp vụ, câu thông báo hiện thẳng cho SV."""

    def __init__(self, message, *, errors=None, code=''):
        self.errors = errors or {}
        self.code = code
        super().__init__(message)


# ── Đối tượng + trạng thái — bản đối ứng: dashboard volunteers/services.py + models.py ──

def all_students_q(prefix=''):
    """SV bậc đại học có trạng thái Đang học."""
    return Q(**{f'{prefix}current_degree_level__code': 'BACHELOR',
                f'{prefix}current_status__status_group': 'ACTIVE'})


def is_regular(student):
    return Student.objects.filter(all_students_q(), pk=student.pk).exists()


def registration_state(event, now=None):
    """unset | upcoming | open | closed."""
    if not event.registration_opens_at or not event.registration_closes_at:
        return 'unset'
    now = now or timezone.now()
    if now < event.registration_opens_at:
        return 'upcoming'
    if now >= event.registration_closes_at:
        return 'closed'
    return 'open'


def visible_events(student):
    """Sự kiện SV được thấy (đã công bố), kèm cờ `in_list` / `has_reg`."""
    regular = is_regular(student)
    in_list = Aud.objects.filter(event_id=OuterRef('pk'), student_id=student.pk)
    has_reg = R.objects.filter(event_id=OuterRef('pk'), student_id=student.pk)
    qs = (E.objects.filter(published_at__isnull=False)
          .annotate(in_list=Exists(in_list), has_reg=Exists(has_reg)))
    cond = Q(audience_mode=E.MODE_LIST, in_list=True) | Q(has_reg=True)
    if regular:
        cond |= Q(audience_mode=E.MODE_ALL)
    return qs.filter(cond)


def eligible(student, event):
    if event.audience_mode == E.MODE_ALL:
        return is_regular(student)
    if event.audience_mode == E.MODE_LIST:
        return Aud.objects.filter(event_id=event.pk, student_id=student.pk).exists()
    return False


def get_event(student, pk):
    return visible_events(student).filter(pk=pk).first()


# ── Hồ sơ điền sẵn ───────────────────────────────────────────────────────────

def profile_defaults(student):
    contacts = {}
    for kind, value in (StudentContactPoint.objects
                        .filter(student_id=student.pk, is_current=True,
                                contact_type__in=[StudentContactPoint.TYPE_MOBILE_PHONE,
                                                  StudentContactPoint.TYPE_UNIVERSITY_EMAIL,
                                                  StudentContactPoint.TYPE_PERSONAL_EMAIL])
                        .order_by('-id').values_list('contact_type', 'contact_value')):
        contacts.setdefault(kind, (value or '').strip())
    dept = student.current_department
    return {
        'student_code': student.current_student_code or '',
        'full_name': student.full_name or '',
        'date_of_birth': student.date_of_birth.strftime('%d/%m/%Y') if student.date_of_birth else '',
        'sex': student.sex or '',
        'class_code': student.class_code or '',
        'department': (dept.name_vi or dept.code) if dept else '',
        'phone': contacts.get(StudentContactPoint.TYPE_MOBILE_PHONE, ''),
        'email': (contacts.get(StudentContactPoint.TYPE_UNIVERSITY_EMAIL)
                  or contacts.get(StudentContactPoint.TYPE_PERSONAL_EMAIL) or '').lower(),
    }


# ── Trình bày ────────────────────────────────────────────────────────────────

def _iso(dt):
    return timezone.localtime(dt).isoformat() if dt else None


def _day_count(event):
    a, b = timezone.localtime(event.starts_at).date(), timezone.localtime(event.ends_at).date()
    return (b - a).days + 1


def _media_url(event, key):
    return f'/api/volunteer-events/{event.pk}/media/?key={key}' if key else None


def serialize_summary(event, reg=None, now=None):
    return {
        'id': event.pk, 'title': event.title, 'location': event.location or '',
        'starts_at': _iso(event.starts_at), 'ends_at': _iso(event.ends_at), 'day_count': _day_count(event),
        'registration_opens_at': _iso(event.registration_opens_at),
        'registration_closes_at': _iso(event.registration_closes_at),
        'registration_state': registration_state(event, now),
        'ended': (now or timezone.now()) >= event.ends_at,
        'capacity': event.capacity,
        'cover_url': _media_url(event, event.cover_image_key),
        'my_status': reg.status if reg else None,
        'my_status_label': R.STATUS_LABELS.get(reg.status) if reg else None,
    }


def _public_files(files):
    return [{'idx': i, 'name': f.get('name', ''), 'size': f.get('size', 0), 'mime': f.get('mime', '')}
            for i, f in enumerate(files or []) if isinstance(f, dict)]


def serialize_registration(event, reg, now=None):
    if reg is None:
        return None
    state = registration_state(event, now)
    answers = dict(reg.answers or {})
    for q in fs.questions_of(event.form_schema):
        if q['type'] == 'file' and q['id'] in answers:
            answers[q['id']] = _public_files(answers[q['id']])
    return {
        'status': reg.status, 'status_label': R.STATUS_LABELS.get(reg.status, reg.status),
        'review_note': reg.review_note or '', 'submitted_at': _iso(reg.submitted_at),
        'answers': answers,
        'can_edit': state == 'open' and reg.status in EDITABLE,
        'can_cancel': state == 'open' and reg.status in CANCELLABLE,
        'can_reregister': state == 'open' and reg.status == R.CANCELLED,
    }


def serialize_detail(student, event, now=None):
    now = now or timezone.now()
    reg = R.objects.filter(event_id=event.pk, student_id=student.pk).first()
    schema = event.form_schema or {}
    profile = fs.profile_of(schema)
    defaults = profile_defaults(student)
    questions = []
    for q in fs.questions_of(schema):
        item = {k: v for k, v in q.items() if k != 'note_image'}
        item['note_image_url'] = _media_url(event, q.get('note_image'))
        questions.append(item)
    fields = [*fs.FIXED_PROFILE, *profile['fields']]
    return {
        **serialize_summary(event, reg, now),
        'description': sanitize(event.description or ''),
        'eligible': eligible(student, event),
        'form': {
            'profile': [{'key': f, 'label': fs.PROFILE_FIELDS[f], 'value': defaults.get(f, ''),
                         'editable': f in profile['editable']} for f in fields],
            'questions': questions,
            'max_file_bytes': fs.MAX_FILE_BYTES,
        },
        'registration': serialize_registration(event, reg, now),
    }


def list_for(student, now=None):
    now = now or timezone.now()
    events = list(visible_events(student).order_by('starts_at'))
    regs = {r.event_id: r for r in R.objects.filter(student_id=student.pk, event_id__in=[e.pk for e in events])}
    out = []
    for e in events:
        reg = regs.get(e.pk)
        if now >= e.ends_at and (reg is None or now - e.ends_at > timedelta(days=PAST_DAYS)):
            continue            # sự kiện đã qua: chỉ giữ cái SV đã đăng ký, trong 120 ngày
        out.append(serialize_summary(e, reg, now))
    return out


# ── File SV nộp ──────────────────────────────────────────────────────────────

def _store(event, student, data, ext, written):
    key = f'{MEDIA_DIR}/{event.pk}/reg/{student.pk}/{uuid4().hex}.{ext}'
    target = Path(settings.MEDIA_ROOT).resolve() / key
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open('xb') as stream:
        written.append(target)
        stream.write(data)
    return key


def _check_file(q, upload):
    """→ (bytes, ext, mime). Kiểm nội dung thật, không tin đuôi file."""
    head = upload.read(5)
    upload.seek(0)
    accept = q.get('accept', 'any')
    if head == b'%PDF-':
        if accept == 'image':
            raise VolunteerError('Câu này chỉ nhận ảnh.')
        data = upload.read(MAX_PDF_BYTES + 1)
        if len(data) > MAX_PDF_BYTES:
            raise VolunteerError('File PDF tối đa 10 MB.')
        return data, 'pdf', 'application/pdf'
    if accept == 'pdf':
        raise VolunteerError('Câu này chỉ nhận file PDF.')
    try:
        data, ext, mime, _ = inspect_upload(upload)
    except WorkflowError as exc:
        raise VolunteerError(str(exc))
    return data, ext, mime


def _collect_files(event, student, data, files, reg, written):
    """{id câu file: [meta]} — giữ file cũ SV chọn giữ + file mới tải lên."""
    old = (reg.answers or {}) if reg else {}
    out, errors = {}, {}
    for q in fs.questions_of(event.form_schema):
        if q['type'] != 'file':
            continue
        qid = q['id']
        kept = []
        try:
            keep = json.loads(data.get(f'keep:{qid}') or '[]')
        except ValueError:
            keep = []
        prev = old.get(qid) or []
        for i in keep if isinstance(keep, list) else []:
            if isinstance(i, int) and 0 <= i < len(prev):
                kept.append(prev[i])
        uploads = files.getlist(f'file:{qid}') if hasattr(files, 'getlist') else []
        if len(kept) + len(uploads) > q.get('max_files', 1):
            errors[qid] = f'Tối đa {q.get("max_files", 1)} file.'
            continue
        for up in uploads:
            try:
                blob, ext, mime = _check_file(q, up)
            except VolunteerError as exc:
                errors[qid] = f'{up.name}: {exc}'
                break
            name = Path((up.name or '').replace('\\', '/')).name[:200] or f'file.{ext}'
            kept.append({'key': _store(event, student, blob, ext, written), 'name': name, 'size': len(blob), 'mime': mime})
        out[qid] = kept
    return out, errors


def _cleanup(paths):
    for p in paths:
        try:
            p.unlink(missing_ok=True)
        except OSError:
            pass


# ── Gửi / sửa / hủy ──────────────────────────────────────────────────────────

def _json(data, key):
    raw = data.get(key)
    if isinstance(raw, dict):
        return raw
    try:
        value = json.loads(raw or '{}')
    except ValueError:
        return {}
    return value if isinstance(value, dict) else {}


def submit(student, event, data, files, now=None):
    """Gửi mới / sửa (khi Chờ duyệt) / đăng ký lại (sau khi tự hủy). Lỗi ⇒ VolunteerError (errors theo ô)."""
    now = now or timezone.now()
    if registration_state(event, now) != 'open':
        raise VolunteerError('Sự kiện không trong thời gian nhận đăng ký.', code='closed')
    if not eligible(student, event):
        raise VolunteerError('Sinh viên không thuộc đối tượng được đăng ký sự kiện này.', code='closed')
    schema = event.form_schema or {}
    written = []
    try:
        with transaction.atomic():
            reg = R.objects.select_for_update().filter(event_id=event.pk, student_id=student.pk).first()
            if reg and reg.status not in (R.PENDING, R.CANCELLED):
                raise VolunteerError('Đăng ký đã được Phòng CTSV xét, không sửa được.', code='closed')
            profile, perrs = fs.clean_profile_answers(schema, _json(data, 'profile'), profile_defaults(student))
            file_answers, ferrs = _collect_files(event, student, data, files, reg, written)
            answers, errors = fs.clean_answers(schema, _json(data, 'answers'), file_answers)
            errors.update(ferrs)
            errors.update({f'profile.{k}': v for k, v in perrs.items()})
            if errors:
                raise VolunteerError('Thông tin chưa hợp lệ, vui lòng kiểm tra các ô được đánh dấu đỏ.', errors=errors)
            payload = {'profile': profile, **answers}
            if reg is None:
                try:
                    with transaction.atomic():
                        reg = R.objects.create(event_id=event.pk, student_id=student.pk,
                                               student_code=student.current_student_code, answers=payload,
                                               submitted_at=now)
                except IntegrityError:
                    raise VolunteerError('Đăng ký vừa được gửi ở nơi khác. Hãy tải lại trang.', code='conflict')
            else:
                if reg.status == R.CANCELLED:
                    reg.reviewed_by_id = reg.reviewed_at = reg.review_note = None
                reg.status, reg.answers, reg.submitted_at, reg.cancelled_at = R.PENDING, payload, now, None
                reg.student_code = student.current_student_code
                reg.save(update_fields=['status', 'answers', 'submitted_at', 'cancelled_at', 'student_code',
                                        'reviewed_by_id', 'reviewed_at', 'review_note', 'updated_at'])
    except Exception:
        _cleanup(written)
        raise
    return reg


def cancel(student, event, now=None):
    if registration_state(event, now) != 'open':
        raise VolunteerError('Đã hết thời gian đăng ký, không hủy được. Liên hệ Phòng CTSV nếu cần.', code='closed')
    with transaction.atomic():
        reg = R.objects.select_for_update().filter(event_id=event.pk, student_id=student.pk).first()
        if reg is None or reg.status not in CANCELLABLE:
            raise VolunteerError('Không có đăng ký để hủy.', code='closed')
        reg.status, reg.cancelled_at = R.CANCELLED, timezone.now()
        reg.save(update_fields=['status', 'cancelled_at', 'updated_at'])
    return reg


def media_path(student, event, key):
    """Ảnh bìa / ảnh ghi chú của sự kiện, hoặc file của CHÍNH SV → đường dẫn; còn lại None."""
    if not key or not key.startswith(f'{MEDIA_DIR}/{event.pk}/'):
        return None
    allowed = {event.cover_image_key} | {q.get('note_image') for q in fs.questions_of(event.form_schema)}
    if key not in allowed:
        reg = R.objects.filter(event_id=event.pk, student_id=student.pk).first()
        own = {f.get('key') for v in (reg.answers or {}).values() if isinstance(v, list)
               for f in v if isinstance(f, dict)} if reg else set()
        if key not in own:
            return None
    return safe_path(settings.MEDIA_ROOT, key)
