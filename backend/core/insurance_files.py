"""Private evidence storage; content validation does not trust client metadata."""
import hashlib
from io import BytesIO
from pathlib import Path
from uuid import uuid4
from django.conf import settings
from PIL import Image, UnidentifiedImageError
from .insurance_contract import WorkflowError, safe_path
from .models import InsuranceEvidence

MAX_BYTES = 5 * 1024 * 1024
FORMATS = {'JPEG': ('jpg', 'image/jpeg'), 'PNG': ('png', 'image/png'), 'WEBP': ('webp', 'image/webp')}


def inspect_upload(upload):
    data = upload.read(MAX_BYTES + 1)
    upload.seek(0)
    if not data or len(data) > MAX_BYTES:
        raise WorkflowError('Mỗi ảnh phải có dung lượng từ 1 byte đến 5 MB.')
    try:
        with Image.open(BytesIO(data)) as image:
            if image.format not in FORMATS or image.width * image.height > 25_000_000:
                raise WorkflowError('Chỉ nhận JPEG, PNG, WebP, tối đa 25 megapixel.')
            ext, mime = FORMATS[image.format]
            image.verify()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, SyntaxError, ValueError) as exc:
        raise WorkflowError('File không phải ảnh hợp lệ.') from exc
    return data, ext, mime, hashlib.sha256(data).hexdigest()


def store_evidence(reg, event, upload, checked, written):
    data, ext, mime, digest = checked
    key = f'insurance_private/{reg.pk}/{uuid4().hex}.{ext}'
    root = Path(settings.MEDIA_ROOT).resolve()
    target = root / key
    target.parent.mkdir(parents=True, exist_ok=True)
    # Exclusive create plus random names ensure uploads never overwrite old files.
    with target.open('xb') as stream:
        written.append(target)
        stream.write(data)
    return InsuranceEvidence.objects.create(registration=reg, event=event, storage_key=key,
        original_filename=Path(upload.name.replace('\\', '/')).name[:255],
        mime_type=mime, file_size_bytes=len(data), sha256=digest)


def link_initial_receipt(reg, event, original_filename=None):
    path = safe_path(settings.MEDIA_ROOT, str(reg.payment_receipt_image))
    if path is None:
        raise WorkflowError('Không thể đọc biên lai vừa lưu.')
    with path.open('rb') as f:
        data, ext, mime, digest = inspect_upload(f)
    InsuranceEvidence.objects.create(registration=reg, event=event,
        storage_key=str(reg.payment_receipt_image), original_filename=Path((original_filename or path.name).replace('\\', '/')).name[:255],
        mime_type=mime, file_size_bytes=len(data), sha256=digest)
