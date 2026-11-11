"""Lễ tốt nghiệp — đăng ký tham dự trên Hub (trang công khai /le-tot-nghiep).

Luồng: chọn đối tượng → xác minh → đăng ký (ảnh trình chiếu không bắt buộc) → mã QR check-in.
- Sinh viên (IU / UWE / AD): xác minh bằng LDAP hoặc Outlook (Microsoft). Không có đường nhập
  thông tin — quyết định của Phòng CTSV 04/11/2026.
- Học viên cao học (MASTER / DOCTOR): mã học viên + họ tên + giới tính + ngày sinh, đối chiếu hồ sơ.
Cổng duy nhất là CÓ TÊN trong danh sách đợt (`graduation_round_students`) — không xét
`login_policy` (danh sách do Phòng Đào tạo gửi đã là nguồn quyết định ai được dự lễ).

Mã QR = `QR_PREFIX` + `checkin_token` (32 ký tự ngẫu nhiên, `secrets`). Không suy ra được từ
MSSV và Dashboard chỉ nhận token còn trong DB ⇒ QR tự chế / QR của đăng ký đã hủy đều bị từ chối.

Ảnh trình chiếu: lưu NGUYÊN bản (không nén lại — màn LED cần ảnh gốc) dưới
`insurance_private/graduation/<round>/`, prefix đã bị chặn URL thô ở Django + Nginx.
Ảnh mới thay ảnh cũ ⇒ file cũ bị xóa sau khi giao dịch commit.

Tiền thế chân lễ phục: SV chuyển khoản vào tài khoản KHTC (`DEPOSIT_ACCOUNT`, số tiền theo nhóm `DEPOSIT_VND`,
nội dung `deposit_reference`) rồi tải minh chứng (ảnh / PDF) — BẮT BUỘC khi đăng ký; người đăng ký trước khi có
mục này nộp bổ sung. Minh chứng lưu cạnh ảnh trình chiếu, thư mục `receipts/`.
"""
import io
import re
import logging
import secrets
import unicodedata
from datetime import date
from pathlib import Path
from uuid import uuid4

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from PIL import Image, UnidentifiedImageError

from students.models import Student, StudentBankAccount, StudentCodeHistory

from .graduation_models import Bank, GraduationRound, GraduationRoundStudent as Member
from .insurance_contract import safe_path

logger = logging.getLogger(__name__)

QR_PREFIX = "IUGRAD:"                 # Dashboard: graduation/services.py::QR_PREFIX — giữ giống hệt
STUDENT_GROUPS = frozenset({"IU", "UWE", "AD"})
GRADUATE_GROUPS = frozenset({"MASTER", "DOCTOR"})
AUDIENCE_STUDENT = "student"
AUDIENCE_GRADUATE = "graduate"

# Buổi lễ — bản song sinh: dashboard_iuoss/graduation/models.py::SESSIONS.
SESSIONS = {
    "SAT_AM": "Sáng thứ Bảy, 28/11/2026",
    "SAT_PM": "Chiều thứ Bảy, 28/11/2026",
    "SUN_AM": "Sáng Chủ nhật, 29/11/2026",
    "SUN_PM": "Chiều Chủ nhật, 29/11/2026",
}
GROUP_LABELS = {"IU": "Đại học", "UWE": "Chương trình liên kết UWE", "AD": "Chương trình liên kết Andrews",
                "MASTER": "Thạc sĩ", "DOCTOR": "Tiến sĩ"}

PHOTO_PREFIX = "insurance_private/graduation"
PHOTO_MIN_BYTES = 1024 * 1024          # 1 MB — dưới mức này dễ vỡ nét trên LED
PHOTO_MAX_BYTES = 5 * 1024 * 1024      # dưới 5 MB
PHOTO_MIN_SIDE = 600                   # cạnh ngắn tối thiểu (px)
PHOTO_MAX_PIXELS = 80_000_000          # chặn ảnh "bom giải nén"
CANCEL_REASON_MIN, CANCEL_REASON_MAX = 5, 500
ACCOUNT_MIN, ACCOUNT_MAX = 6, 20          # số tài khoản ngân hàng VN: 6–20 chữ số
HOLDER_MIN, HOLDER_MAX = 2, 100


class GraduationError(Exception):
    """Lỗi hiện thẳng cho sinh viên."""


# ── Đợt ──────────────────────────────────────────────────────────────────────

def current_round():
    """Đợt đang dùng = đợt tạo sau cùng. Link /le-tot-nghiep cố định qua các năm."""
    return GraduationRound.objects.order_by("-id").first()


def not_open_yet(round_, now=None):
    """Chưa mở đợt: chưa đặt hạn, hoặc chưa tới giờ mở. (Đã qua hạn chót KHÔNG tính là chưa mở.)"""
    now = now or timezone.now()
    if not (round_.registration_opens_at and round_.registration_closes_at):
        return True
    return now < round_.registration_opens_at


def round_payload(round_):
    if round_ is None:
        return None
    local = lambda v: timezone.localtime(v).isoformat() if v else None  # noqa: E731
    return {
        "title": round_.title,
        "ceremony_date": round_.ceremony_date.isoformat() if round_.ceremony_date else None,
        "registration_opens_at": local(round_.registration_opens_at),
        "registration_closes_at": local(round_.registration_closes_at),
        "registration_open": round_.registration_open(),
    }


# ── Xác minh ─────────────────────────────────────────────────────────────────

def _student_for_uid(uid):
    """MSSV gõ ở LDAP / tiền tố email Outlook → hồ sơ (theo mã hiện tại, rồi mã cũ)."""
    uid = (uid or "").strip()
    if not uid:
        return None
    student = Student.objects.filter(current_student_code__iexact=uid).first()
    if student is None:
        row = StudentCodeHistory.objects.select_related("student").filter(student_code__iexact=uid).first()
        student = row.student if row else None
    return student


def member_for_account(round_, uid):
    """Sinh viên đã qua LDAP / Microsoft → dòng danh sách của họ trong đợt.

    Ném GraduationError (thông báo cho SV) nếu không có tên hoặc chọn nhầm đối tượng.
    """
    student = _student_for_uid(uid)
    member = (Member.objects.select_related("student", "student__current_department")
              .filter(round=round_, student=student).first()) if student else None
    if member is None:
        raise GraduationError(
            f"Tài khoản {uid.upper()} không có trong danh sách {round_.title}. "
            "Vui lòng liên hệ Phòng Công tác Sinh viên nếu cho rằng đây là nhầm lẫn.")
    if member.program_group in GRADUATE_GROUPS:
        raise GraduationError("Mã số này thuộc danh sách học viên cao học — vui lòng chọn đối tượng "
                              "“Học viên cao học” để xác minh.")
    return member


_TONE_MARKS = {"̀", "́", "̃", "̉", "̣"}


def normalize_name(text):
    """So khớp họ tên: bỏ dấu THANH (giữ â ă ê ô ơ ư đ), chữ thường, gộp khoảng trắng.

    Bỏ dấu thanh để "Thuỳ" (kiểu cũ) và "Thùy" (kiểu mới) — đều đúng chính tả — là một;
    phép xác minh còn đi kèm mã + ngày sinh + giới tính nên không nới lỏng đáng kể.
    """
    text = unicodedata.normalize("NFD", text or "")
    text = "".join(ch for ch in text if ch not in _TONE_MARKS)
    return " ".join(unicodedata.normalize("NFC", text).lower().split())


def normalize_sex(text):
    value = normalize_name(text)
    return {"nam": "nam", "nư": "nu", "nu": "nu", "nữ": "nu"}.get(value, value)


INFO_MISMATCH = ("Thông tin chưa khớp với danh sách học viên tốt nghiệp. Kiểm tra lại mã học viên, "
                 "họ tên, giới tính, ngày sinh — hoặc liên hệ Phòng Công tác Sinh viên.")


def member_for_info(round_, *, code, full_name, sex, date_of_birth):
    """Học viên cao học: cả 4 thông tin phải khớp. Lỗi chung một câu — không lộ trường nào sai."""
    code = (code or "").strip()
    member = (Member.objects.select_related("student", "student__current_department")
              .filter(round=round_, student_code__iexact=code).first()) if code else None
    if member is None or member.program_group not in GRADUATE_GROUPS:
        if member is not None:
            raise GraduationError("Mã số này thuộc danh sách sinh viên — vui lòng chọn đối tượng "
                                  "“Sinh viên” và xác minh bằng tài khoản sinh viên.")
        raise GraduationError(INFO_MISMATCH)
    s = member.student
    ok = (normalize_name(full_name) == normalize_name(s.full_name)
          and normalize_sex(sex) == normalize_sex(s.sex)
          and isinstance(date_of_birth, date) and s.date_of_birth == date_of_birth)
    if not ok:
        raise GraduationError(INFO_MISMATCH)
    return member


# ── Ảnh trình chiếu ──────────────────────────────────────────────────────────

def _mb(n):
    return f"{n / (1024 * 1024):.2f} MB".replace(".", ",")


def stored_photo_name(member, ext):
    """Tên file chuẩn khi lưu: <mã trong danh sách>.<jpg|png> — SV không phải tự đổi tên (bỏ luật 05/11/2026)."""
    return f"{member.student_code.upper()}.{ext}"


def validate_photo(upload, member):
    """Kiểm NỘI DUNG ảnh tải lên → (bytes, ext 'jpg' | 'png'). Không xét tên file: tên do máy chủ đặt lại
    (`stored_photo_name`), đuôi theo định dạng thật của ảnh. Ném GraduationError với câu cụ thể."""
    if upload is None:
        raise GraduationError("Chưa chọn ảnh.")
    data = upload.read(PHOTO_MAX_BYTES + 1)
    size = len(data)
    if size >= PHOTO_MAX_BYTES:
        raise GraduationError(f"Ảnh quá lớn ({_mb(size) if size <= PHOTO_MAX_BYTES else 'trên 5 MB'}). "
                              "Dung lượng phải dưới 5 MB.")
    if size < PHOTO_MIN_BYTES:
        raise GraduationError(f"Ảnh quá nhỏ ({_mb(size)}). Dung lượng cần từ 1 MB trở lên để không bị vỡ nét "
                              "khi trình chiếu.")

    is_jpeg = data[:3] == b"\xff\xd8\xff"
    is_png = data[:8] == b"\x89PNG\r\n\x1a\n"
    if not (is_jpeg or is_png):
        raise GraduationError("File không phải ảnh JPG / PNG thật (có thể chỉ đổi đuôi). Vui lòng xuất lại ảnh "
                              "ở định dạng JPG hoặc PNG.")
    try:
        Image.MAX_IMAGE_PIXELS = PHOTO_MAX_PIXELS
        with Image.open(io.BytesIO(data)) as probe:
            probe.verify()
        with Image.open(io.BytesIO(data)) as image:
            fmt, (width, height) = image.format, image.size
            image.load()
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError, Image.DecompressionBombError):
        raise GraduationError("Không đọc được ảnh — file có thể bị hỏng. Vui lòng chọn ảnh khác.") from None
    if fmt not in ("JPEG", "PNG"):
        raise GraduationError("Chỉ nhận ảnh JPG / JPEG / PNG.")
    if min(width, height) < PHOTO_MIN_SIDE:
        raise GraduationError(f"Ảnh có độ phân giải thấp ({width}×{height} px). Cạnh ngắn cần từ "
                              f"{PHOTO_MIN_SIDE} px trở lên.")
    return data, ("png" if is_png else "jpg")


def _write_photo(member, data, ext, written):
    key = f"{PHOTO_PREFIX}/{member.round_id}/{member.student_code.upper()}_{uuid4().hex[:12]}.{ext}"
    target = Path(settings.MEDIA_ROOT).resolve() / key
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("xb") as stream:          # tên ngẫu nhiên + 'xb' — không bao giờ ghi đè
        written.append(target)
        stream.write(data)
    return key


def _delete_file(key):
    path = safe_path(settings.MEDIA_ROOT, key) if key else None
    if path is None:
        return
    try:
        path.unlink(missing_ok=True)
    except OSError:
        logger.exception("GRAD_PHOTO_DELETE_FAIL | key=%s", key)


def photo_path(member):
    return safe_path(settings.MEDIA_ROOT, member.photo_storage_key) if member.photo_storage_key else None


PHOTO_PENDING, PHOTO_APPROVED, PHOTO_REJECTED = "pending", "approved", "rejected"


def _clear_review(member):
    """Ảnh mới / gỡ ảnh ⇒ bỏ kết quả duyệt cũ. Trả key ảnh đã crop (để xóa sau commit)."""
    stale = member.photo_cropped_storage_key
    member.photo_crop = member.photo_cropped_storage_key = None
    member.photo_review_note = member.photo_reviewed_by_id = member.photo_reviewed_at = None
    return stale


def _apply_photo(member, upload, written):
    """Ghi ảnh mới lên dòng (chưa save) — về Chờ duyệt. Trả các key CŨ (gốc + đã crop) để xóa sau commit."""
    data, ext = validate_photo(upload, member)
    stale = [member.photo_storage_key, _clear_review(member)]
    member.photo_storage_key = _write_photo(member, data, ext, written)
    member.photo_original_filename = stored_photo_name(member, ext)
    member.photo_size_bytes = len(data)
    member.photo_uploaded_at = timezone.now()
    member.photo_status = PHOTO_PENDING
    return stale


PHOTO_FIELDS = ["photo_storage_key", "photo_original_filename", "photo_size_bytes", "photo_uploaded_at",
                "photo_status", "photo_crop", "photo_cropped_storage_key", "photo_review_note",
                "photo_reviewed_by_id", "photo_reviewed_at"]


# ── Tiền thế chân lễ phục ────────────────────────────────────────────────────

# Thông báo Phòng KHTC (11/11/2026). Andrews tính như UWE (Phòng CTSV chốt 11/11/2026).
# Bản đối ứng ở Dashboard `graduation/models.py::DEPOSIT_VND` — giữ giống hệt.
DEPOSIT_VND = {"IU": 800_000, "MASTER": 800_000, "UWE": 3_300_000, "AD": 3_300_000, "DOCTOR": 1_500_000}
DEPOSIT_ACCOUNT = {
    "bank_name": "BIDV - Chi nhánh Đông Sài Gòn", "bank_bin": "970418",
    "account_number": "3145559799", "account_name": "Trường Đại học Quốc tế",
}
DEPOSIT_TAG = "LPTN2026"
DEPOSIT_DEADLINE = date(2026, 11, 18)            # hết ngày (giờ VN) — mốc "Hạn cuối đóng tiền thế chân" trên timeline
RECEIPT_MAX_BYTES = 10 * 1024 * 1024
RECEIPT_EXT_MIME = {"jpg": "image/jpeg", "png": "image/png", "pdf": "application/pdf"}
RECEIPT_FIELDS = ["deposit_receipt_storage_key", "deposit_receipt_uploaded_at"]


def deposit_reference(member):
    """Nội dung chuyển khoản theo cú pháp KHTC "MSSV – Họ tên – LPTN2026": mã ĐÚNG như danh sách (SĐH = mã học
    viên), họ tên BỎ DẤU, gạch ngang thường — app ngân hàng hay làm hỏng ký tự có dấu / gạch dài."""
    text = unicodedata.normalize("NFD", member.student.full_name or "")
    name = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    name = name.replace("đ", "d").replace("Đ", "D").replace("Ð", "D")
    # Cùng luật `lib/vietqr.ts::toAscii` (ký tự khác chữ/số/khoảng trắng/.- thành khoảng trắng) ⇒ chữ hiển thị
    # luôn TRÙNG nội dung nằm trong mã QR, kể cả tên có dấu nháy / ký tự lạ.
    name = re.sub(r"[^A-Za-z0-9_\s.-]", " ", name)
    return f"{member.student_code.upper()} - {' '.join(name.split())} - {DEPOSIT_TAG}"


def validate_receipt(upload):
    """Minh chứng chuyển khoản: ảnh JPG / PNG hoặc PDF, tối đa 10 MB, kiểm theo NỘI DUNG → (bytes, ext)."""
    if upload is None:
        raise GraduationError("Vui lòng tải lên ảnh minh chứng đã chuyển khoản tiền thế chân lễ phục.")
    data = upload.read(RECEIPT_MAX_BYTES + 1)
    if len(data) > RECEIPT_MAX_BYTES:
        raise GraduationError("Minh chứng quá lớn — dung lượng tối đa 10 MB.")
    if not data:
        raise GraduationError("File minh chứng trống.")
    if data[:5] == b"%PDF-":
        return data, "pdf"
    is_png = data[:8] == b"\x89PNG\r\n\x1a\n"
    if not (is_png or data[:3] == b"\xff\xd8\xff"):
        raise GraduationError("Minh chứng phải là ảnh JPG / PNG hoặc file PDF.")
    try:
        Image.MAX_IMAGE_PIXELS = PHOTO_MAX_PIXELS
        with Image.open(io.BytesIO(data)) as probe:
            probe.verify()
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError, Image.DecompressionBombError):
        raise GraduationError("Không đọc được ảnh minh chứng — file có thể bị hỏng. Vui lòng chọn ảnh khác.") from None
    return data, ("png" if is_png else "jpg")


def _apply_receipt(member, upload, written):
    """Ghi minh chứng mới lên dòng (chưa save). Trả key CŨ để xóa sau commit."""
    data, ext = validate_receipt(upload)
    key = f"{PHOTO_PREFIX}/{member.round_id}/receipts/{member.student_code.upper()}_{uuid4().hex[:12]}.{ext}"
    target = Path(settings.MEDIA_ROOT).resolve() / key
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("xb") as stream:          # tên ngẫu nhiên + 'xb' — không bao giờ ghi đè
        written.append(target)
        stream.write(data)
    stale = member.deposit_receipt_storage_key
    member.deposit_receipt_storage_key = key
    member.deposit_receipt_uploaded_at = timezone.now()
    return stale


def receipt_path(member):
    key = member.deposit_receipt_storage_key
    return safe_path(settings.MEDIA_ROOT, key) if key else None


def receipt_mime(member):
    ext = (member.deposit_receipt_storage_key or "").rsplit(".", 1)[-1].lower()
    return RECEIPT_EXT_MIME.get(ext, "application/octet-stream")


def can_upload_receipt(member):
    """Nộp / thay minh chứng: đang đăng ký (registered) và còn hạn đăng ký — như đổi tài khoản hoàn cọc."""
    return member.round.registration_open() and member.registration_status == Member.STATUS_REGISTERED


def deposit_payload(member):
    key = member.deposit_receipt_storage_key or ""
    uploaded = member.deposit_receipt_uploaded_at
    return {
        **DEPOSIT_ACCOUNT,
        "amount": DEPOSIT_VND.get(member.program_group),
        "reference": deposit_reference(member),
        "deadline": DEPOSIT_DEADLINE.isoformat(),
        "overdue": timezone.localdate() > DEPOSIT_DEADLINE,
        "has_receipt": bool(key),
        "receipt_is_pdf": key.lower().endswith(".pdf"),
        "receipt_uploaded_at": timezone.localtime(uploaded).isoformat() if uploaded else None,
        "can_upload": can_upload_receipt(member),
    }


# ── Tài khoản hoàn tiền cọc lễ phục ─────────────────────────────────────────

def banks_payload():
    return [{"id": b.id, "short_name": b.short_name, "full_name": b.full_name}
            for b in Bank.objects.filter(is_active=True).order_by("sort_order", "short_name")]


HOLDER_RE = re.compile(r"^[A-Z ]+$")


def normalize_holder(text):
    """Tên chủ tài khoản: IN HOA, gộp khoảng trắng. KHÔNG tự bỏ dấu — có dấu là lỗi (parse_bank)."""
    return " ".join((text or "").upper().split())


def holder_of(full_name):
    """Họ tên người tốt nghiệp → dạng chủ tài khoản ngân hàng: bỏ HẾT dấu, đ→D, IN HOA, gộp khoảng trắng.
    Bản đối ứng ở frontend `lib/graduation.ts::holderOf` — giữ giống hệt."""
    text = unicodedata.normalize("NFD", full_name or "")
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    text = text.replace("đ", "d").replace("Đ", "D").upper()
    return " ".join(re.sub(r"[^A-Z]", " ", text).split())


def parse_bank(bank_id, account_number, holder, owner_name=None):
    """→ (Bank, số tài khoản, chủ tài khoản) đã chuẩn hoá. Ném GraduationError với câu cụ thể.

    `owner_name` (họ tên người tốt nghiệp): có thì tên chủ tài khoản phải TRÙNG ĐÚNG họ tên đó sau khi bỏ
    dấu — chỉ nhận tài khoản đứng tên chính người tốt nghiệp (Phòng CTSV chốt 09/11/2026; rà live: 3 người
    khai tài khoản người khác, 4 người gõ sai tên)."""
    raw_id = str(bank_id or "").strip()
    bank = Bank.objects.filter(pk=int(raw_id), is_active=True).first() if raw_id.isdigit() else None
    if bank is None:
        raise GraduationError("Vui lòng chọn ngân hàng nhận hoàn tiền cọc.")
    number = "".join(ch for ch in str(account_number or "") if ch not in " .-")
    if not number:
        raise GraduationError("Vui lòng nhập số tài khoản ngân hàng.")
    if not number.isdigit():
        raise GraduationError("Số tài khoản chỉ gồm chữ số.")
    if not ACCOUNT_MIN <= len(number) <= ACCOUNT_MAX:
        raise GraduationError(f"Số tài khoản phải có từ {ACCOUNT_MIN} đến {ACCOUNT_MAX} chữ số.")
    name = normalize_holder(holder)
    if not name:
        raise GraduationError("Vui lòng nhập tên chủ tài khoản.")
    if not HOLDER_RE.match(name):
        if any(ord(ch) > 127 for ch in name):
            raise GraduationError("Tên chủ tài khoản phải nhập KHÔNG DẤU (VD: NGUYEN VAN AN).")
        raise GraduationError("Tên chủ tài khoản chỉ gồm chữ cái không dấu và khoảng trắng.")
    if not HOLDER_MIN <= len(name) <= HOLDER_MAX:
        raise GraduationError("Tên chủ tài khoản không hợp lệ.")
    expected = holder_of(owner_name) if owner_name else ""
    if expected and name != expected:
        raise GraduationError(
            f"Tên chủ tài khoản phải trùng họ tên người tốt nghiệp ({expected}). "
            "Chỉ nhận tài khoản ngân hàng đứng tên chính người tốt nghiệp.")
    return bank, number, name


BANK_FIELDS = ["bank", "bank_account_number", "bank_account_holder"]


def _apply_bank(member, bank_info):
    member.bank, member.bank_account_number, member.bank_account_holder = parse_bank(
        *bank_info, owner_name=member.student.full_name)


def bank_suggestion(member):
    """Gợi ý điền sẵn ngân hàng + số tài khoản từ hồ sơ SV (nếu tên ngân hàng khớp danh mục).
    Tên chủ tài khoản KHÔNG điền sẵn — SV tự nhập (Phòng CTSV chốt 06/11/2026)."""
    suggestion = {"bank_id": None, "account_number": "", "holder": ""}
    row = (StudentBankAccount.objects.filter(student_id=member.student_id, is_current=True)
           .exclude(account_number="").order_by("-updated_at").first())
    if row:
        name = (row.bank_name or "").strip()
        bank = (Bank.objects.filter(is_active=True, short_name__iexact=name).first()
                or Bank.objects.filter(is_active=True, full_name__iexact=name).first())
        if bank:
            suggestion["bank_id"] = bank.id
        suggestion["account_number"] = "".join(ch for ch in row.account_number if ch.isdigit())
    return suggestion


# ── Ghi ──────────────────────────────────────────────────────────────────────

def _locked(member_id):
    return (Member.objects.select_for_update().select_related("round", "student", "student__current_department", "bank")
            .get(pk=member_id))


def _require_open(member):
    if not member.round.registration_open():
        raise GraduationError("Ngoài thời gian đăng ký — không thay đổi được đăng ký.")


def _run(member_id, change):
    """Chạy `change(member, written)` trên dòng đã khóa; dọn file mới nếu hỏng, file cũ nếu thành công."""
    written = []
    try:
        with transaction.atomic():
            member = _locked(member_id)
            stale = change(member, written)
            for key in (stale if isinstance(stale, (list, tuple)) else [stale]):
                if key:
                    transaction.on_commit(lambda key=key: _delete_file(key))
        return member
    except Exception:
        for path in written:
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass
        raise


def register(member_id, *, via, bank_info, upload=None, receipt=None):
    def change(member, written):
        _require_open(member)
        if member.is_registered:
            raise GraduationError("Đã đăng ký tham dự rồi.")
        _apply_bank(member, bank_info)          # bắt buộc — kiểm trước khi ghi file
        stale = [_apply_receipt(member, receipt, written)]                      # bắt buộc
        stale += _apply_photo(member, upload, written) if upload is not None else []
        member.registration_status = Member.STATUS_REGISTERED
        member.registered_at = timezone.now()
        member.verified_via = via
        member.checkin_token = secrets.token_urlsafe(24)          # 32 ký tự, 192 bit
        member.cancel_reason = member.cancel_requested_at = None
        member.cancel_reviewed_at = member.cancel_review_note = None
        fields = ["registration_status", "registered_at", "verified_via", "checkin_token", "cancel_reason",
                  "cancel_requested_at", "cancel_reviewed_at", "cancel_review_note", "updated_at"]
        member.save(update_fields=fields + BANK_FIELDS + RECEIPT_FIELDS
                    + (PHOTO_FIELDS if upload is not None else []))
        logger.info("GRAD_REGISTER     | code=%-14s | via=%s | photo=%s", member.student_code, via,
                    "yes" if upload is not None else "no")
        return stale
    return _run(member_id, change)


def _require_editable(member):
    _require_open(member)
    if member.registration_status == Member.STATUS_CANCEL_REQUESTED:
        raise GraduationError("Yêu cầu hủy đang chờ Phòng CTSV duyệt — tạm thời không thay đổi được.")
    if member.registration_status != Member.STATUS_REGISTERED:
        raise GraduationError("Chưa đăng ký tham dự.")


def can_replace_photo(member):
    """Đổi ảnh: như mọi thay đổi khác (còn hạn, đang registered) — HOẶC ảnh vừa bị Phòng CTSV từ chối thì
    được tải ảnh khác cả khi đã hết hạn (lỗi phát hiện sau khi duyệt, SV không có lỗi về thời hạn)."""
    if member.photo_status == PHOTO_REJECTED and member.is_registered:
        return True
    return member.round.registration_open() and member.registration_status == Member.STATUS_REGISTERED


def replace_photo(member_id, upload):
    def change(member, written):
        if not can_replace_photo(member):
            _require_editable(member)                     # ném đúng câu lỗi
        stale = _apply_photo(member, upload, written)
        member.save(update_fields=PHOTO_FIELDS + ["updated_at"])
        logger.info("GRAD_PHOTO        | code=%-14s | replaced=%s", member.student_code, bool(stale[0]))
        return stale
    return _run(member_id, change)


def remove_photo(member_id):
    def change(member, written):
        _require_editable(member)
        if not member.photo_storage_key:
            raise GraduationError("Chưa có ảnh nào để gỡ.")
        stale = [member.photo_storage_key, member.photo_cropped_storage_key]
        for field in PHOTO_FIELDS:
            setattr(member, field, None)
        member.save(update_fields=PHOTO_FIELDS + ["updated_at"])
        return stale
    return _run(member_id, change)


def replace_receipt(member_id, upload):
    def change(member, written):
        if not can_upload_receipt(member):
            _require_editable(member)                     # ném đúng câu lỗi
        stale = _apply_receipt(member, upload, written)
        member.save(update_fields=RECEIPT_FIELDS + ["updated_at"])
        logger.info("GRAD_RECEIPT      | code=%-14s | replaced=%s", member.student_code, bool(stale))
        return stale
    return _run(member_id, change)


def update_bank(member_id, bank_info):
    def change(member, written):
        _require_editable(member)
        _apply_bank(member, bank_info)
        member.save(update_fields=BANK_FIELDS + ["updated_at"])
        logger.info("GRAD_BANK         | code=%-14s", member.student_code)
        return None
    return _run(member_id, change)


def request_cancel(member_id, reason):
    reason = " ".join((reason or "").split())
    if len(reason) < CANCEL_REASON_MIN:
        raise GraduationError("Vui lòng nêu lý do hủy đăng ký.")
    if len(reason) > CANCEL_REASON_MAX:
        raise GraduationError(f"Lý do tối đa {CANCEL_REASON_MAX} ký tự.")

    def change(member, written):
        _require_editable(member)
        if member.checked_in_at:
            raise GraduationError("Đã check-in tại lễ — không gửi yêu cầu hủy được.")
        member.registration_status = Member.STATUS_CANCEL_REQUESTED
        member.cancel_reason = reason
        member.cancel_requested_at = timezone.now()
        member.cancel_reviewed_at = member.cancel_review_note = None
        member.save(update_fields=["registration_status", "cancel_reason", "cancel_requested_at",
                                   "cancel_reviewed_at", "cancel_review_note", "updated_at"])
        logger.info("GRAD_CANCEL_REQ   | code=%-14s", member.student_code)
        return None
    return _run(member_id, change)


# ── Đọc ──────────────────────────────────────────────────────────────────────

# Phần trong ngoặc của xếp loại UWE ("Second Class (Upper Division)") không hiện cho SV —
# Phòng CTSV chốt 08/11/2026 chỉ nói tới "Second Class". DB giữ bản đầy đủ (Dashboard vẫn thấy).
_DEGREE_DETAIL = re.compile(r"\s*\([^)]*\)\s*$")


def degree_class_label(value):
    return _DEGREE_DETAIL.sub("", (value or "").strip())


def member_payload(member):
    s = member.student
    round_ = member.round
    can_edit = round_.registration_open() and member.registration_status == Member.STATUS_REGISTERED
    local = lambda v: timezone.localtime(v).isoformat() if v else None  # noqa: E731
    return {
        "student": {
            "full_name": s.full_name,
            "student_code": member.student_code,
            "date_of_birth": s.date_of_birth.strftime("%d/%m/%Y") if s.date_of_birth else "",
            "sex": (s.sex or "").strip(),
            "group": member.program_group,
            "group_label": GROUP_LABELS.get(member.program_group, member.program_group),
            "is_graduate": member.program_group in GRADUATE_GROUPS,
            "major": member.major_name or "",
            "department": s.current_department.name_vi if s.current_department_id else "",
            "award_title": member.award_title or "",
            "degree_class": degree_class_label(member.degree_class),
            "session": member.ceremony_session or "",
            "session_label": SESSIONS.get(member.ceremony_session or "", ""),
        },
        "registration": {
            "status": member.registration_status,
            "registered_at": local(member.registered_at),
            "qr": f"{QR_PREFIX}{member.checkin_token}" if member.is_registered and member.checkin_token else None,
            "has_photo": bool(member.photo_storage_key),
            "photo_status": member.photo_status,
            "photo_review_note": member.photo_review_note or "",
            "can_replace_photo": bool(member.photo_storage_key or member.is_registered) and can_replace_photo(member),
            "photo_name": member.photo_original_filename or "",
            "photo_size": member.photo_size_bytes,
            "photo_uploaded_at": local(member.photo_uploaded_at),
            "cancel_reason": member.cancel_reason or "",
            "cancel_requested_at": local(member.cancel_requested_at),
            "cancel_reviewed_at": local(member.cancel_reviewed_at),
            "cancel_review_note": member.cancel_review_note or "",
            "checked_in": bool(member.checked_in_at),
            "can_edit": can_edit,
            "can_register": round_.registration_open() and not member.is_registered,
        },
        "bank": {
            "bank_id": member.bank_id,
            "bank_short_name": member.bank.short_name,
            "bank_full_name": member.bank.full_name,
            "account_number": member.bank_account_number or "",
            "holder": member.bank_account_holder or "",
        } if member.bank_id else None,
        "bank_suggestion": None if member.bank_id else bank_suggestion(member),
        "deposit": deposit_payload(member),
        "round": round_payload(round_),
    }
