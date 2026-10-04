"""Nạp ảnh CCCD/thẻ BHYT từ các đơn BHYT cũ vào kho `student_images`. Mặc định CHỈ ĐỌC.

Mỗi SV, mỗi loại ảnh (CCCD mặt trước/sau, thẻ BHYT): lấy file dùng được MỚI NHẤT trong hai
bảng BHYT (hub_insurance_registrations · student_external_health_insurance_declarations),
xếp theo `created_at` (lúc nộp), làm ảnh profile của ô đó. File mới nhất mất hoặc hỏng thì
lùi sang file cũ hơn. Ô đã có ảnh đang dùng (SV vừa nộp đơn mới sau khi deploy) thì giữ nguyên — ảnh
trong kho luôn mới hơn. Chạy lại bao nhiêu lần cũng an toàn.

Đơn BHYT KHÔNG bị sửa: cột `cccd_image`… của đơn vẫn là bản ghi lúc nộp.

Gom theo `student_id`, KHÔNG theo MSSV: MSSV đổi được (đảo mã), id thì không.

File trình duyệt đọc được (JPEG/PNG/WebP) được DÙNG LẠI tại chỗ — dòng kho trỏ vào
storage_key cũ, không chép file. File HEIC/MPO (ca đơn #174) được chuyển sang JPEG thành
file mới, vì kho phục vụ ảnh inline cho trình duyệt. File mất trên đĩa được in ra để xử lý tay.

    python manage.py backfill_student_images                     # xem trước
    python manage.py backfill_student_images --student-code ITITIU21001
    python manage.py backfill_student_images --apply --database-name iuoss_student_data
"""
import hashlib
from collections import defaultdict
from io import BytesIO

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction
from PIL import Image, UnidentifiedImageError

from core import student_images
from core.insurance_contract import safe_path
from core.insurance_files import CONVERT_TO_JPEG, FORMATS, _to_jpeg
from core.models import ExternalInsuranceDeclaration, HealthInsuranceRegistration, StudentImage
from students.models import Student


def _candidates(student_ids):
    """{student_id: {kind: [(thời điểm nộp, storage_key, nguồn)] mới → cũ}}."""
    found = defaultdict(lambda: defaultdict(list))
    fields = list(student_images.REGISTRATION_IMAGE_KINDS)
    regs = HealthInsuranceRegistration.objects.all()
    externals = ExternalInsuranceDeclaration.objects.all()
    if student_ids is not None:
        regs, externals = regs.filter(student_id__in=student_ids), externals.filter(student_id__in=student_ids)
    # Sắp theo created_at (lúc nộp), KHÔNG theo updated_at: nhân viên đổi trạng thái đơn cũ
    # trên Dashboard cũng bump updated_at và làm đơn cũ lấn át đơn mới.
    for row in regs.values('id', 'student_id', 'created_at', *fields):
        for field, kind in student_images.REGISTRATION_IMAGE_KINDS.items():
            if row[field]:
                found[row['student_id']][kind].append(
                    (row['created_at'], str(row[field]), f'bhyt_registration#{row["id"]}'))
    for row in externals.values('id', 'student_id', 'created_at', 'images'):
        for field, kind in student_images.REGISTRATION_IMAGE_KINDS.items():
            key = ((row['images'] or {}).get(field) or {}).get('storage_key')
            if key:
                found[row['student_id']][kind].append(
                    (row['created_at'], str(key), f'external_insurance#{row["id"]}'))
    for kinds in found.values():
        for items in kinds.values():
            items.sort(key=lambda item: item[0], reverse=True)
    return found


def _inspect(path):
    """('inplace', mime, data) | ('convert', mime, jpeg_data) | (None, lý do, None)."""
    raw = path.read_bytes()
    if not raw:
        return None, 'file rỗng', None
    try:
        with Image.open(BytesIO(raw)) as image:
            fmt = image.format
            image.verify()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, SyntaxError, ValueError):
        return None, 'không phải ảnh hợp lệ', None
    if fmt in FORMATS:
        return 'inplace', FORMATS[fmt][1], raw
    if fmt in CONVERT_TO_JPEG:
        try:
            return 'convert', FORMATS['JPEG'][1], _to_jpeg(raw)
        except Exception as exc:  # noqa: BLE001 — một file hỏng không được dừng cả lô
            return None, f'không chuyển được {fmt} sang JPEG: {exc}', None
    return None, f'định dạng {fmt} không hỗ trợ', None


class Command(BaseCommand):
    help = 'Nạp ảnh CCCD/thẻ BHYT của đơn cũ vào student_images; --apply --database-name NAME mới ghi.'

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true')
        parser.add_argument('--database-name')
        parser.add_argument('--student-code', action='append', default=[],
                            help='Chỉ chạy cho MSSV này (hiện hành); lặp lại được.')

    def handle(self, *args, **options):
        apply = options['apply']
        if apply and options['database_name'] != connection.settings_dict['NAME']:
            raise CommandError('Truyền --database-name trùng tên database đích đã kiểm tra.')
        student_ids = None
        if options['student_code']:
            student_ids = list(Student.objects.filter(current_student_code__in=options['student_code'])
                               .values_list('pk', flat=True))
            if not student_ids:
                raise CommandError('Không tìm thấy MSSV nào.')

        stats = defaultdict(int)
        for student_id, kinds in sorted(_candidates(student_ids).items()):
            stats['students'] += 1
            for kind, items in kinds.items():
                if StudentImage.objects.filter(student_id=student_id, kind=kind,
                                               subject=student_images.SELF, is_current=True).exists():
                    stats['skip_has_image'] += 1
                    continue
                for _, key, origin in items:
                    label = f'student={student_id} {kind} ← {origin}'
                    path = safe_path(settings.MEDIA_ROOT, key)
                    if path is None:
                        stats['missing_file'] += 1
                        self.stderr.write(f'THIẾU FILE  {label} key={key}')
                        continue
                    mode, mime, data = _inspect(path)
                    if mode is None:
                        stats['unreadable'] += 1
                        self.stderr.write(f'BỎ QUA      {label} — {mime}')
                        continue
                    stats[f'create_{mode}'] += 1
                    self.stdout.write(f'{"GHI" if apply else "SẼ GHI"}  {label} ({mode}) {key}')
                    if apply:
                        stats['raced'] += not self._write(student_id, kind, key, path, mode, mime, data)
                    break
                else:
                    stats['slot_without_usable_file'] += 1
        summary = ' · '.join(f'{name}={value}' for name, value in sorted(stats.items()))
        self.stdout.write(f'{"ĐÃ GHI" if apply else "XEM TRƯỚC (chưa ghi gì)"} — {summary}')

    def _write(self, student_id, kind, key, path, mode, mime, data):
        """Trả False nếu ô đã có dòng (SV nộp đơn mới đúng lúc đang chạy) — ảnh của SV mới hơn, giữ nguyên."""
        written = []
        try:
            with transaction.atomic():
                student = Student.objects.select_for_update().get(pk=student_id)
                if StudentImage.objects.filter(student=student, kind=kind, subject=student_images.SELF,
                                               is_current=True).exists():
                    return False
                if mode == 'convert':
                    key = student_images.write_file(student, FORMATS['JPEG'][0], data, written)
                student_images.add_image(
                    student, kind, student_images.SELF, storage_key=key, original_filename=path.name[:255],
                    mime_type=mime, file_size_bytes=len(data), sha256=hashlib.sha256(data).hexdigest(),
                    source=student_images.SOURCE_BACKFILL)
                return True
        except Exception:
            for target in written:
                target.unlink(missing_ok=True)
            raise
