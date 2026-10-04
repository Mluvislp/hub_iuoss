"""Kho ảnh cố định (profile) của sinh viên — đường ghi/đọc DUY NHẤT cho bảng `student_images`.

Ảnh ít đổi (CCCD của SV và cha mẹ/người giám hộ, thẻ BHYT, ảnh thẻ, avatar) lưu một lần ở
đây; luồng nghiệp vụ lấy ảnh từ `get_images()` thay vì bắt SV tải lại.

Dòng bất biến: thay ảnh = THÊM dòng mới (`is_current=1`) và hạ dòng cũ về `is_current=0`.
Mỗi ô (kind, subject) có tối đa một dòng hiện hành. Không sửa dòng, không xóa dòng, không
xóa file: các đơn BHYT đã nộp giữ đường dẫn riêng ở cột của đơn và có thể đang trỏ vào file đó.
"""
from pathlib import Path
from uuid import uuid4

from django.conf import settings
from django.db import transaction

from .insurance_contract import WorkflowError, safe_path
from .student_image_models import StudentImage

SELF = StudentImage.SUBJECT_SELF
FAMILY = (StudentImage.SUBJECT_FATHER, StudentImage.SUBJECT_MOTHER, StudentImage.SUBJECT_GUARDIAN)

SUBJECT_LABELS = {
    StudentImage.SUBJECT_SELF: 'Sinh viên',
    StudentImage.SUBJECT_FATHER: 'Cha',
    StudentImage.SUBJECT_MOTHER: 'Mẹ',
    StudentImage.SUBJECT_GUARDIAN: 'Người giám hộ',
}

# kind → (nhãn, các subject được phép). Thêm loại ảnh = thêm một dòng ở đây; không cần đổi
# schema. Đổi tên kind đã có dữ liệu là phá dữ liệu — chỉ được thêm.
KINDS = {
    'cccd_front': ('CCCD mặt trước', (SELF, *FAMILY)),
    'cccd_back': ('CCCD mặt sau', (SELF, *FAMILY)),
    'bhyt_card': ('Thẻ BHYT', (SELF,)),
    'portrait': ('Ảnh thẻ', (SELF,)),
    'avatar': ('Ảnh đại diện', (SELF,)),
}

# Giá trị `source` — ảnh được tải lên từ luồng nào. Thêm luồng mới = thêm hằng số, không đổi schema.
SOURCE_BHYT_REGISTRATION = 'bhyt_registration'   # form đăng ký BHYT
SOURCE_EXTERNAL_INSURANCE = 'external_insurance'  # khai BHYT nơi khác
SOURCE_MGHP = 'mghp'                              # miễn giảm học phí
SOURCE_BACKFILL = 'backfill'                      # nạp từ đơn cũ

# Tên trường ảnh trên form/cột của 2 bảng BHYT (hub_insurance_registrations,
# student_external_health_insurance_declarations) → kind trong kho. Biên lai KHÔNG có ở đây
# (gắn với một lần nộp, không phải ảnh profile).
REGISTRATION_IMAGE_KINDS = {
    'cccd_image': 'cccd_front',
    'cccd_image_back': 'cccd_back',
    'bhyt_image': 'bhyt_card',
}

STORAGE_PREFIX = 'insurance_private/student_images'


def validate_slot(kind, subject):
    """Lỗi tiếng Việt nếu (kind, subject) không có trong registry."""
    if kind not in KINDS:
        raise WorkflowError('Loại ảnh không hợp lệ.')
    if subject not in KINDS[kind][1]:
        raise WorkflowError(f'{KINDS[kind][0]} không áp dụng cho {SUBJECT_LABELS.get(subject, subject)}.')


def get_images(student, kinds=None):
    """{(kind, subject): StudentImage} ảnh ĐANG DÙNG (`is_current`) của SV."""
    rows = StudentImage.objects.filter(student=student, is_current=True)
    if kinds is not None:
        rows = rows.filter(kind__in=kinds)
    return {(row.kind, row.subject): row for row in rows}


def get_image(student, image_id):
    """Ảnh của CHÍNH SV theo id (kể cả ảnh đã bị thay), hoặc None."""
    return StudentImage.objects.filter(student=student, pk=image_id).first()


def image_path(image):
    """(Path, mime) để phục vụ file, hoặc (None, None) nếu file mất / key không an toàn."""
    path = safe_path(settings.MEDIA_ROOT, image.storage_key) if image else None
    return (path, image.mime_type) if path else (None, None)


def write_file(student, ext, data, written=None):
    """Ghi bytes ra đĩa dưới thư mục kho của SV, trả storage_key.

    Nằm dưới `insurance_private/` vì prefix này ĐÃ bị chặn URL thô ở cả Django
    (config/urls.py) lẫn Nginx (docs/INSURANCE.md §4). Đặt thư mục gốc mới là CCCD
    lộ ra /media/ ngay khi Nginx phục vụ media trực tiếp mà quên thêm luật chặn.
    """
    key = f'{STORAGE_PREFIX}/{student.pk}/{uuid4().hex}.{ext}'
    target = Path(settings.MEDIA_ROOT).resolve() / key
    target.parent.mkdir(parents=True, exist_ok=True)
    # Tên ngẫu nhiên + mở 'xb' (tạo độc quyền) — không bao giờ ghi đè file cũ.
    with target.open('xb') as stream:
        if written is not None:
            written.append(target)
        stream.write(data)
    return key


def save_image(student, kind, subject, checked, *, original_filename, source, written=None):
    """Lưu ảnh đã kiểm làm ảnh đang dùng của ô (kind, subject); trả StudentImage.

    `checked` là bộ (data, ext, mime, sha256) từ `insurance_files.inspect_upload` — hàm này
    KHÔNG tự kiểm nội dung file. Bắt buộc gọi trong `transaction.atomic()` đã khóa dòng
    `students` của SV (các luồng BHYT đã làm vậy) — đó là thứ giữ cho mỗi ô chỉ có một dòng
    hiện hành, vì DB không ép. File đã ghi được thêm vào `written` để caller xóa khi giao dịch
    hỏng (cùng khuôn `insurance_files.store_evidence`).

    Tải lại đúng tấm đang dùng (trùng sha256) thì trả dòng cũ, không sinh file/dòng mới — gửi
    lại form nhiều lần không làm phình kho. Ảnh khác thì thêm dòng mới, hạ dòng cũ về 0.
    """
    if not transaction.get_connection().in_atomic_block:
        raise RuntimeError('save_image phải chạy trong transaction.atomic().')
    validate_slot(kind, subject)
    data, ext, mime, digest = checked
    current = StudentImage.objects.filter(student=student, kind=kind, subject=subject, is_current=True)
    if current.filter(sha256=digest).exists():
        return current.filter(sha256=digest).first()
    key = write_file(student, ext, data, written)
    name = Path((original_filename or '').replace('\\', '/')).name[:255] or f'{kind}.{ext}'
    return add_image(student, kind, subject, storage_key=key, original_filename=name, mime_type=mime,
                     file_size_bytes=len(data), sha256=digest, source=source)


def add_image(student, kind, subject, **fields):
    """Thêm dòng mới làm ảnh đang dùng của ô; hạ mọi dòng hiện hành cũ của ô về 0."""
    StudentImage.objects.filter(student=student, kind=kind, subject=subject, is_current=True).update(is_current=False)
    return StudentImage.objects.create(student=student, kind=kind, subject=subject, is_current=True, **fields)


def image_payload(image):
    """Dạng JSON trả cho frontend."""
    label = KINDS.get(image.kind, (image.kind,))[0]
    return {
        'id': image.pk,
        'kind': image.kind,
        'subject': image.subject,
        'label': label if image.subject == SELF else f'{label} — {SUBJECT_LABELS.get(image.subject, image.subject)}',
        'mime_type': image.mime_type,
        'is_current': image.is_current,
        'source': image.source,
        'created_at': image.created_at,
        'url': f'/api/student-images/{image.pk}/file/',
    }


def kinds_payload():
    return [{'kind': kind, 'label': label, 'subjects': list(subjects)}
            for kind, (label, subjects) in KINDS.items()]
