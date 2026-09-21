"""Private evidence storage; content validation does not trust client metadata."""
import hashlib
from io import BytesIO
from pathlib import Path
from uuid import uuid4
from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image, ImageOps, UnidentifiedImageError
from .insurance_contract import WorkflowError
from .models import InsuranceEvidence

# Ảnh iPhone mặc định là HEIC. Pillow không đọc được nếu thiếu plugin, nên đăng ký
# ở đây; thiếu gói thì app vẫn chạy, chỉ là HEIC bị từ chối như trước.
try:
    from pillow_heif import register_heif_opener
except ImportError:
    HEIF_SUPPORTED = False
else:
    register_heif_opener()
    HEIF_SUPPORTED = True

MAX_BYTES = 5 * 1024 * 1024
FORMATS = {'JPEG': ('jpg', 'image/jpeg'), 'PNG': ('png', 'image/png'), 'WEBP': ('webp', 'image/webp')}
# HEIC/HEIF được nhận nhưng KHÔNG lưu nguyên dạng: trình duyệt (trừ Safari) không
# hiển thị được, mà Dashboard phục vụ ảnh inline cho chuyên viên xem. Chuyển sang
# JPEG ngay lúc nhận để mọi khâu phía sau không phải biết HEIC là gì.
CONVERT_TO_JPEG = {'HEIF', 'HEIC'}
# iPhone Pro chụp 48 MP, vượt mốc 25 MP cũ. Nới đủ cho máy hiện hành; ảnh to hơn
# thì thu nhỏ chứ không từ chối — xem `_to_jpeg`.
MAX_PIXELS = 60_000_000
JPEG_QUALITY = 85


def _to_jpeg(data):
    """Giải mã rồi mã hoá lại thành JPEG, vừa khung 5 MB.

    `exif_transpose` bắt buộc: ảnh iPhone gài chiều xoay trong EXIF, bỏ qua là
    biên lai nằm ngang khi chuyên viên mở ra.
    """
    with Image.open(BytesIO(data)) as image:
        frame = ImageOps.exif_transpose(image)
        if frame.mode not in ('RGB', 'L'):
            frame = frame.convert('RGB')
        for scale in (1, 0.75, 0.5, 0.35, 0.25):
            work = frame if scale == 1 else frame.resize(
                (max(1, int(frame.width * scale)), max(1, int(frame.height * scale))),
                Image.LANCZOS,
            )
            buffer = BytesIO()
            work.save(buffer, format='JPEG', quality=JPEG_QUALITY, optimize=True)
            out = buffer.getvalue()
            if len(out) <= MAX_BYTES:
                return out
    raise WorkflowError('Ảnh quá lớn, không nén được xuống dưới 5 MB. Gửi lại ảnh nhỏ hơn.')


def inspect_upload(upload):
    data = upload.read(MAX_BYTES + 1)
    upload.seek(0)
    if not data or len(data) > MAX_BYTES:
        raise WorkflowError('Mỗi ảnh phải có dung lượng từ 1 byte đến 5 MB.')
    try:
        with Image.open(BytesIO(data)) as image:
            fmt = image.format
            if image.width * image.height > MAX_PIXELS:
                raise WorkflowError('Ảnh vượt 60 megapixel. Gửi lại ảnh có độ phân giải thấp hơn.')
            if fmt not in FORMATS and fmt not in CONVERT_TO_JPEG:
                raise WorkflowError(
                    f'Không nhận định dạng {fmt or "này"}. Chỉ nhận JPG, PNG, WebP'
                    + (', HEIC.' if HEIF_SUPPORTED else '.')
                )
            image.verify()
    # WorkflowError là con của ValueError nên PHẢI bắt riêng trước, nếu không mọi
    # thông báo cụ thể ở trên đều bị nuốt và thay bằng câu chung chung bên dưới —
    # đúng lỗi đã làm không ai chẩn đoán được ca ảnh HEIC ngày 21/09/2026.
    except WorkflowError:
        raise
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, SyntaxError, ValueError) as exc:
        hint = ' Ảnh iPhone (HEIC) chưa được hỗ trợ trên máy chủ này.' if not HEIF_SUPPORTED else ''
        raise WorkflowError('File không phải ảnh hợp lệ.' + hint) from exc

    if fmt in CONVERT_TO_JPEG:
        data = _to_jpeg(data)
        ext, mime = FORMATS['JPEG']
    else:
        ext, mime = FORMATS[fmt]
    return data, ext, mime, hashlib.sha256(data).hexdigest()


def normalized_upload(upload, data, ext, mime):
    """Bọc lại file đã kiểm để Django lưu ĐÚNG bytes đã xác thực.

    Cần thiết vì ảnh lúc nộp đơn đi qua `FileField`, mà FileField lưu nguyên
    bytes gốc và lấy đuôi file từ TÊN DO CLIENT GỬI (`models.get_registration_filename`).
    Không bọc lại thì ảnh HEIC nằm trên đĩa dưới tên .jpg: chuyên viên mở ra là
    ảnh vỡ, vì trình duyệt ngoài Safari không đọc được HEIC. Đã dính thật ngày
    21/09/2026 — đơn #174 có hai file CCCD lưu dạng HEIF mang đuôi .jpg.
    """
    raw = getattr(upload, 'name', '') or 'upload'
    stem = Path(raw.replace('\\', '/')).stem[:80] or 'upload'
    return SimpleUploadedFile(f'{stem}.{ext}', data, content_type=mime)


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
