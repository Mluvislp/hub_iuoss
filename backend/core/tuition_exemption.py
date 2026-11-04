"""Nghiệp vụ "Miễn giảm học phí" (MGHP) phía sinh viên.

SV nộp MỘT đơn mỗi đợt, TỰ CHỌN ĐÚNG MỘT đối tượng, tải giấy tờ theo đối tượng đó.
Cán bộ xét trên Dashboard (`dashboard_iuoss/tuition/`). Hai app không gọi API của
nhau — Hub đọc danh mục/đợt/kết quả/danh sách đang hưởng thẳng từ bảng Dashboard sở hữu.

Hệ thống TỰ nhận diện SV nộp lần đầu hay gia hạn (`participation`), SV không chọn:
  - chưa từng hưởng diện nào         → "Nộp hồ sơ": form đầy đủ + giấy tờ
  - đã hưởng, mọi diện chỉ cần gia hạn → "Xác nhận gia hạn": kiểm lại thông tin, không nộp giấy
  - đã hưởng, có diện phải bổ sung    → "Bổ sung hồ sơ": chỉ nộp giấy cho diện đó
Diện nào "phải bổ sung" ở kỳ này: `contract.renewal_mode` theo `resubmit_policy`.
Đơn gia hạn vẫn là một đơn (submission_kind='previously_reviewed'); việc phải làm với
từng diện được ghi vào payload event SUBMITTED (`categories: {mã: confirm|supplement|new}`)
để cán bộ biết diện nào chỉ cần xác nhận.

Quy tắc ghi (cùng khuôn BHYT):
  - request_key chống gửi trùng; transaction.atomic; khóa dòng students (select_for_update).
  - Kiểm lại đợt còn mở Ở SERVER; UNIQUE (student, round) chặn đơn thứ hai.
  - Thông tin form chỉ lưu vào đơn (ảnh chụp) — KHÔNG ghi students* hay
    student_bank_accounts (Dashboard sở hữu, phương án A).
  - File kiểm bằng NỘI DUNG (PDF: chữ ký %PDF-; ảnh: insurance_files.inspect_upload,
    HEIC → JPEG), lưu MEDIA_ROOT/tuition_private/<đơn>/<uuid>.<đuôi>; lỗi DB thì xóa file.
"""
import hashlib
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone

from students.models import (
    Student,
    StudentBankAccount,
    TuitionExemptionAward,
    TuitionExemptionBeneficiary,
    TuitionExemptionCategory,
    TuitionExemptionRound,
    TuitionSpecialAreaWard,
    VnWard,
)

from . import address_service as addr
from . import insurance_contract
from . import profile_changes as pc
from . import tuition_exemption_contract as contract
from .insurance_files import inspect_upload
from .tuition_exemption_history import append_event, timeline
from .tuition_exemption_models import (
    TuitionExemptionApplication,
    TuitionExemptionApplicationCategory,
    TuitionExemptionDocument,
    TuitionExemptionEvent,
)

STORAGE_DIR = "tuition_private"
FILE_FIELD_PREFIX = "doc_"
FILE_FIELD_SEP = "__"          # doc_<MÃ_DIỆN>__<doc_type>

# Cột ảnh chụp chép sang đơn — cũng là cột điền sẵn từ đơn trước khi gia hạn.
SNAPSHOT_FIELDS = (
    "citizen_id", "citizen_id_issued_on", "phone_number",
    "bank_account_number", "bank_account_holder", "bank_name",
    "father_full_name", "father_phone", "mother_full_name", "mother_phone",
    "guardian_full_name", "guardian_phone", "guardian_relationship",
    "permanent_address", "permanent_ward_code",
)


class TuitionExemptionError(ValueError):
    """Lỗi nghiệp vụ trả cho SV. `code` giúp view chọn HTTP status (closed/exists/conflict → 409)."""

    def __init__(self, message, code="", errors=None):
        super().__init__(message)
        self.code = code
        self.errors = errors or {}


# ── Đọc ──────────────────────────────────────────────────────────────────────

def open_round(now=None):
    """Đợt đang nhận hồ sơ: is_active và opens_at <= now <= closes_at. None nếu không có."""
    now = now or timezone.now()
    return (TuitionExemptionRound.objects.select_related("academic_term")
            .filter(is_active=True, opens_at__lte=now, closes_at__gte=now)
            .order_by("-opens_at").first())


def round_is_open(round_, now=None):
    """Đợt còn nhận hồ sơ/bổ sung: bật và đang trong khung giờ — đọc SỐNG từ đợt, nên
    cán bộ gia hạn giờ đóng đợt là hạn bổ sung cũng lùi theo (như BHYT)."""
    now = now or timezone.now()
    return bool(round_ and round_.is_active and round_.opens_at <= now <= round_.closes_at)


def serialize_round(round_):
    if round_ is None:
        return None
    term = round_.academic_term
    return {
        "id": round_.pk,
        "title": round_.title,
        "description": round_.description or "",
        "term_code": term.term_code,
        "term_label": f"HK{term.semester} năm học {term.academic_year}-{term.academic_year + 1}",
        "opens_at": round_.opens_at.isoformat(),
        "closes_at": round_.closes_at.isoformat(),
    }


def _term_key(term):
    return (term.academic_year, term.semester)


def _term_label(key):
    return f"HK{key[1]} năm học {key[0]}-{key[0] + 1}"


def participation(student, *, exclude_round_id=None):
    """Lịch sử hưởng MGHP: {category_id: (academic_year, semester) gần nhất được xác nhận}.

    Hai nguồn, lấy kỳ muộn nhất cho mỗi diện:
      1. `tuition_exemption_beneficiaries` status='active' (Dashboard nạp danh sách cũ /
         cập nhật khi duyệt) — nguồn chính;
      2. diện Đạt trong đơn ĐÃ HOÀN THÀNH ở đợt khác — phòng khi bước 1 chưa kịp ghi.
    """
    history = {}

    def keep(category_id, key):
        if key > history.get(category_id, (0, 0)):
            history[category_id] = key

    for b in (TuitionExemptionBeneficiary.objects.filter(student=student, status="active")
              .select_related("last_verified_term")):
        keep(b.category_id, _term_key(b.last_verified_term))
    approved = (TuitionExemptionApplicationCategory.objects
                .filter(application__student=student, application__status="done",
                        review_status="approved")
                .select_related("application__round__academic_term"))
    if exclude_round_id:
        approved = approved.exclude(application__round_id=exclude_round_id)
    for link in approved:
        keep(link.category_id, _term_key(link.application.round.academic_term))
    return history


def _serialize_category(c, mode=None, last_key=None):
    # Diện chưa khai giấy tờ: một ô chung "general" (contract.document_types).
    docs = c.required_documents or [{"doc_type": "general", "label": "Giấy tờ chứng minh thuộc diện",
                                     "required": True, "has_expiry": False}]
    return {
        "id": c.pk,
        "code": c.code,
        "name": c.name_vi,
        "description": c.description or "",
        "resubmit_policy": c.resubmit_policy,
        "resubmit_label": contract.RESUBMIT_POLICIES.get(c.resubmit_policy, ""),
        # Giấy phải nộp THEO CHẾ ĐỘ: gia hạn có bổ sung chỉ còn giấy renewal_required;
        # chỉ xác nhận → rỗng (contract.documents_for_mode).
        "documents": contract.documents_for_mode(docs, mode) if mode else docs,
        "fields": contract.student_fields(c.code),
        "requires_ethnic_minority": c.code in contract.ETHNIC_MINORITY_CATEGORIES,
        "requires_special_area": c.code in contract.SPECIAL_AREA_CATEGORIES,
        "mode": mode,
        "mode_label": contract.RENEWAL_MODES.get(mode, "") if mode else "",
        "last_verified": _term_label(last_key) if last_key else None,
    }


def special_area_status(student):
    """(có trong danh sách xã ĐBKK?, tên xã) theo xã thường trú trong hồ sơ — dòng
    thường trú đang dùng của `address_service` (CURRENT_STD trước, CURRENT sau).
    (None, …) khi hồ sơ chưa có xã thường trú, hoặc mã xã không có trong vn_wards (dòng
    thường trú cũ chưa chuẩn hóa theo cơ cấu 2025) — báo SV liên hệ Phòng CTSV thay vì
    kết luận sai là "không thường trú tại xã ĐBKK"."""
    address = addr.get_permanent(student)
    code = (getattr(address, "ward_code", None) or "").strip()
    if not code:
        return None, ""
    ward = VnWard.objects.filter(code=code, is_active=True).first()
    label = ward.name if ward else (address.ward or code)
    if getattr(address, "province", None):
        label = f"{label}, {address.province}"
    if ward is None:
        return None, label
    return TuitionSpecialAreaWard.objects.filter(ward_code=code).exists(), label


def build_plan(student, round_):
    """Việc SV phải làm ở đợt `round_`: loại đơn + chế độ của từng diện đang mở."""
    categories = list(TuitionExemptionCategory.objects.filter(is_active=True).order_by("sort_order", "code"))
    history = participation(student, exclude_round_id=round_.pk if round_ else None)
    current = _term_key(round_.academic_term) if round_ else None
    renewals, others = [], []
    for c in categories:
        if c.pk in history and current:
            mode = contract.renewal_mode(c.resubmit_policy, history[c.pk], current)
            renewals.append(_serialize_category(c, mode, history[c.pk]))
        else:
            others.append(_serialize_category(c, "new"))
    kind = "previously_reviewed" if history else "first_time"
    if kind == "first_time":
        action = "submit"
    elif any(r["mode"] == "supplement" for r in renewals):
        action = "supplement"
    else:
        action = "confirm"
    # Diện đã hưởng nhưng nay cán bộ tắt: không gia hạn được — báo để SV biết.
    inactive = [cid for cid in history if cid not in {c.pk for c in categories}]
    return {
        "submission_kind": kind,
        "submission_kind_label": contract.SUBMISSION_KINDS[kind],
        "action": action,
        "action_label": {"submit": "Nộp hồ sơ", "confirm": "Xác nhận gia hạn",
                         "supplement": "Bổ sung hồ sơ"}[action],
        "renewals": renewals,
        "others": others,
        # SV tự chọn ĐÚNG MỘT đối tượng; hệ thống không chọn sẵn.
        "max_categories": contract.MAX_CATEGORIES_PER_APPLICATION,
        "ethnicity": contract.ethnicity_name(student.ethnicity),
        "is_ethnic_minority": contract.is_ethnic_minority(student.ethnicity),
        # Xã thường trú theo hồ sơ có thuộc danh sách xã ĐBKK không (null = hồ sơ chưa có).
        "special_area": dict(zip(("in_list", "ward"), special_area_status(student))),
        "inactive_history": [
            {"code": c.code, "name": c.name_vi}
            for c in TuitionExemptionCategory.objects.filter(pk__in=inactive)
        ],
    }


def _iso_date(value):
    """'09/05/2021' hoặc '2021-05-09' → '2021-05-09'; không đọc được → ''."""
    for fmt in ("%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(str(value or "").strip(), fmt).date().isoformat()
        except ValueError:
            continue
    return ""


def build_prefill(student):
    """Giá trị điền sẵn cho form. Đã có đơn trước → chép ảnh chụp của đơn gần nhất
    (gia hạn chỉ cần kiểm lại). Chưa có → lấy từ hồ sơ (chỉ đọc). SV sửa trên form;
    phần sửa chỉ nằm trong đơn.

    TODO(mghp): cha mẹ từ student_family_members (Hub chưa có model).
    """
    dept = student.current_department
    base = {
        "student_code": student.current_student_code,
        "full_name": student.full_name,
        "date_of_birth": student.date_of_birth.isoformat() if student.date_of_birth else None,
        "class_code": student.class_code or "",
        "department_code": dept.code if dept else "",
        "department_name": dept.name_vi if dept else "",
    }
    previous = (TuitionExemptionApplication.objects.filter(student=student)
                .order_by("-submitted_at", "-id").first())
    if previous is not None:
        fields = {f: getattr(previous, f) or "" for f in SNAPSHOT_FIELDS}
        fields["citizen_id_issued_on"] = (previous.citizen_id_issued_on.isoformat()
                                          if previous.citizen_id_issued_on else "")
        link = previous.categories.select_related("category").first()
        return {**base, "fields": fields, "source": "previous_application",
                # Thông tin riêng đã khai lần trước — form chỉ điền lại nếu SV chọn đúng đối tượng đó.
                "category_details": ({"code": link.category.code, "values": previous.category_details}
                                     if link and previous.category_details else None)}

    # SV hưởng từ trước khi có hệ thống: Phòng CTSV nạp đủ thông tin trong danh sách đang hưởng.
    imported = (TuitionExemptionBeneficiary.objects.filter(student=student, status="active",
                                                           application_data__isnull=False)
                .select_related("category").order_by("-updated_at", "-id").first())
    if imported is not None and (imported.application_data or {}).get("fields"):
        data = imported.application_data
        fields = {f: "" for f in SNAPSHOT_FIELDS}
        fields.update({f: str(v or "") for f, v in data["fields"].items() if f in fields})
        return {**base, "fields": fields, "source": "beneficiary_import",
                "category_details": ({"code": data.get("category_code") or imported.category.code,
                                      "values": data.get("category_details")}
                                     if data.get("category_details") else None)}

    profile = pc.read_profile(student)
    cccd = profile.get("student.citizen_id", {}).get("value") or {}
    bank = (StudentBankAccount.objects.filter(student=student, is_current=True)
            .order_by("-id").first())
    permanent = addr.get_effective(student, "CURRENT_STD") or addr.get_effective(student, "CURRENT")
    fields = {f: "" for f in SNAPSHOT_FIELDS}
    fields.update({
        "citizen_id": cccd.get("number") or "",
        "citizen_id_issued_on": _iso_date(cccd.get("issue_date")),
        "phone_number": profile.get("contact.mobile_phone", {}).get("value") or "",
        "bank_account_number": bank.account_number if bank else "",
        "bank_name": bank.bank_name if bank else "",
        "permanent_address": addr.format_address(permanent) if permanent else "",
        "permanent_ward_code": (permanent.ward_code or "") if permanent else "",
    })
    return {**base, "fields": fields, "source": "profile", "category_details": None}


def _category_modes(app):
    """{mã diện: mode} ghi lúc nộp (payload event SUBMITTED)."""
    event = app.events.filter(event_type="SUBMITTED").order_by("event_no").first()
    return ((event.payload or {}).get("categories") or {}) if event else {}


def serialize_application(app, *, with_details=False):
    modes = _category_modes(app) if with_details else {}
    data = {
        "id": app.pk,
        "round_id": app.round_id,
        "round_title": app.round.title,
        "term_code": app.round.academic_term.term_code,
        "submission_kind": app.submission_kind,
        "submission_kind_label": contract.SUBMISSION_KINDS.get(app.submission_kind, app.submission_kind),
        "status": app.status,
        "status_label": contract.status_label(app.status),
        "submitted_at": app.submitted_at.isoformat(),
        "review_note": app.review_note or "",
        "supplement_pending": app.supplement_pending,
        "row_version": app.row_version,
        "categories": [
            {"code": link.category.code, "name": link.category.name_vi,
             "review_status": link.review_status, "review_note": link.review_note or "",
             "mode": modes.get(link.category.code),
             "mode_label": contract.RENEWAL_MODES.get(modes.get(link.category.code), "")}
            for link in app.categories.select_related("category").order_by("category__sort_order", "category__code")
        ],
    }
    # Có cả ở danh sách: trang tổng quan nhắc SV bổ sung mà không cần mở chi tiết.
    rejected_fixable = app.status == "rejected" and app.rejection_reason_code in contract.RESUBMITTABLE_REASONS
    fixable = rejected_fixable or app.status == "awaiting_supplement"
    open_ = round_is_open(app.round)
    data["can_supplement"] = contract.can_resubmit(app.status, app.rejection_reason_code, open_)
    data["supplement_overdue"] = rejected_fixable and not open_
    data["invalid_documents"] = invalid_documents(app) if app.status == "awaiting_supplement" else []
    data["supplement_closes_at"] = app.round.closes_at.isoformat()
    data["rejection_reason"] = contract.REASONS.get(app.rejection_reason_code or "", "")
    if with_details:
        labels = {}
        for link in app.categories.select_related("category"):
            for d in link.category.required_documents or []:
                labels[(link.category.code, d.get("doc_type"))] = d.get("label") or d.get("doc_type")
        data["timeline"] = timeline(app)
        data["documents"] = [
            {"id": d.pk, "doc_type": d.doc_type,
             "doc_label": labels.get((d.application_category.category.code if d.application_category else "",
                                      d.doc_type), "Giấy tờ chứng minh thuộc diện"),
             "category_code": d.application_category.category.code if d.application_category else "",
             "original_filename": d.original_filename, "mime_type": d.mime_type,
             "expires_at": d.expires_at.isoformat() if d.expires_at else None}
            for d in app.documents.filter(is_superseded=False)
            .select_related("application_category__category").order_by("id")
        ]
        data["snapshot"] = {f: (getattr(app, f).isoformat() if f == "citizen_id_issued_on" and app.citizen_id_issued_on
                                else getattr(app, f) or "") for f in SNAPSHOT_FIELDS}
        data["supplement_targets"] = supplement_targets(app) if fixable else []
        link = app.categories.select_related("category").first()
        data["category_details"] = [
            {"label": label, "value": value}
            for label, value in contract.details_display(link.category.code if link else "", app.category_details)]
    return data


# Căn cứ hiện cho SV, suy từ tiêu đề mục trong file danh sách (so chữ hoa).
_AWARD_BASES = (
    ("238/2025", "Nghị định 238/2025/NĐ-CP"),
    ("181/QĐ", "Quyết định 181/QĐ-ĐHQT của Hiệu trưởng"),
    ("XÉT RIÊNG", "Trường hợp xét riêng, đặc biệt"),
)

PAYMENT_LABELS = {"paid": "Đã đóng học phí", "unpaid": "Chưa đóng học phí"}


def _mask_account(number):
    digits = (number or "").strip()
    return ("•••• " + digits[-4:]) if len(digits) > 4 else digits


def _award_basis(section_title):
    title = (section_title or "").upper()
    return next((label for key, label in _AWARD_BASES if key in title), "")


def awards(student):
    """Kết quả MGHP theo kỳ của SV, kỳ mới nhất trước. STK chỉ hiện 4 số cuối."""
    rows = (TuitionExemptionAward.objects.filter(student=student)
            .select_related("academic_term", "category")
            .order_by("-academic_term__academic_year", "-academic_term__semester"))
    out = []
    for a in rows:
        term = a.academic_term
        fee = a.base_fee_vnd if a.base_fee_vnd is not None else a.first_fee_vnd
        payable = a.payable_vnd if a.payable_vnd is not None else (
            max(fee - a.received_vnd, 0) if fee is not None else None)
        # Đối tượng nhà nước chi trả bị giới hạn bởi mức trần: được giảm < HP × %.
        capped = (a.ceiling_vnd is not None and fee is not None and a.percent is not None
                  and a.received_vnd < round(fee * float(a.percent) / 100))
        out.append({
            "id": a.pk,
            "term_code": term.term_code,
            "term_label": _term_label(_term_key(term)),
            "basis": _award_basis(a.section_title),
            "category": (a.category.name_vi if a.category else None) or a.category_label or a.category_code or "",
            "percent": float(a.percent) if a.percent is not None else None,
            "first_fee_vnd": a.first_fee_vnd,
            "retake_fee_vnd": a.retake_fee_vnd,
            "base_fee_vnd": a.base_fee_vnd,
            "decree_amount_vnd": a.decree_amount_vnd,
            "school_support_vnd": a.school_support_vnd,
            "received_vnd": a.received_vnd,
            "payable_vnd": payable,
            "ceiling_vnd": a.ceiling_vnd,
            "capped_by_ceiling": capped,
            "payment_status": a.payment_status,
            "payment_label": PAYMENT_LABELS.get(a.payment_status, ""),
            "note": a.note or "",
            "bank_account": _mask_account(a.bank_account_number),
            "bank_name": a.bank_name or "",
            "updated_at": a.updated_at.isoformat(),
        })
    return out


def build_state(student):
    """Toàn bộ dữ liệu trang MGHP của SV."""
    round_ = open_round()
    apps = list(TuitionExemptionApplication.objects.filter(student=student)
                .select_related("round__academic_term").order_by("-submitted_at"))
    current = next((a for a in apps if round_ and a.round_id == round_.pk), None)
    return {
        "round": serialize_round(round_),
        "plan": build_plan(student, round_) if round_ else None,
        "application": serialize_application(current) if current else None,
        "history": [serialize_application(a) for a in apps],
        "awards": awards(student),
        "prefill": build_prefill(student),
        "limits": {"max_files": contract.MAX_FILES_PER_APPLICATION,
                   "max_pdf_mb": contract.MAX_FILE_SIZE_BYTES // (1024 * 1024),
                   "max_image_mb": contract.MAX_IMAGE_SIZE_BYTES // (1024 * 1024)},
    }


def get_application(student, pk):
    """Đơn của CHÍNH SV đăng nhập — đơn của người khác coi như không tồn tại."""
    return (TuitionExemptionApplication.objects.select_related("round__academic_term")
            .filter(pk=pk, student=student).first())


# ── File ─────────────────────────────────────────────────────────────────────

def inspect_document(upload):
    """(bytes, đuôi, mime, sha256) sau khi kiểm NỘI DUNG — không tin tên/MIME client gửi."""
    head = upload.read(5)
    upload.seek(0)
    if head == b"%PDF-":
        data = upload.read(contract.MAX_FILE_SIZE_BYTES + 1)
        upload.seek(0)
        if len(data) > contract.MAX_FILE_SIZE_BYTES:
            raise contract.WorkflowError(
                f"File PDF tối đa {contract.MAX_FILE_SIZE_BYTES // (1024 * 1024)} MB.")
        return data, "pdf", "application/pdf", hashlib.sha256(data).hexdigest()
    try:
        return inspect_upload(upload)
    except insurance_contract.WorkflowError as exc:
        text = str(exc)
        if text.startswith("File không phải ảnh hợp lệ"):
            # Câu gốc của BHYT chỉ nói về ảnh (kèm gợi ý HEIC) — ở đây file có thể là PDF hỏng.
            text = "File không phải PDF hoặc ảnh hợp lệ. Chỉ nhận PDF hoặc ảnh JPG/PNG/WebP/HEIC."
        raise contract.WorkflowError(text) from exc


def _parse_uploads(uploads):
    """{(mã diện, doc_type): [file…]} từ các trường `doc_<MÃ>__<doc_type>`."""
    grouped = {}
    for field, files in (uploads.lists() if hasattr(uploads, "lists") else uploads.items()):
        if not field.startswith(FILE_FIELD_PREFIX):
            continue
        code, sep, doc_type = field[len(FILE_FIELD_PREFIX):].partition(FILE_FIELD_SEP)
        if not sep or not code or not doc_type:
            raise TuitionExemptionError(f"Tên trường file không hợp lệ: {field}.")
        grouped.setdefault((code, doc_type), []).extend(files if isinstance(files, list) else [files])
    return grouped


def _store(app, event, link, doc_type, upload, checked, written):
    data, ext, mime, digest = checked
    key = f"{STORAGE_DIR}/{app.pk}/{uuid4().hex}.{ext}"
    target = Path(settings.MEDIA_ROOT).resolve() / key
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("xb") as stream:     # tên ngẫu nhiên + tạo độc quyền: không ghi đè file cũ
        written.append(target)
        stream.write(data)
    return TuitionExemptionDocument.objects.create(
        application=app, application_category=link, event=event, doc_type=doc_type,
        storage_key=key, original_filename=Path(upload.name.replace("\\", "/")).name[:255],
        mime_type=mime, file_size_bytes=len(data), sha256=digest)


# ── Ghi ──────────────────────────────────────────────────────────────────────

def submit(student, data, uploads, *, request_key):
    """Nộp đơn (lần đầu hoặc gia hạn) cho đợt đang mở. Trả đơn vừa tạo (hoặc đơn cũ
    nếu đây là lần gửi lại cùng request_key)."""
    try:
        contract.request_key(request_key)
    except contract.WorkflowError as exc:
        raise TuitionExemptionError(str(exc)) from exc

    round_ = open_round()
    if round_ is None:
        raise TuitionExemptionError("Hiện không có đợt nhận hồ sơ nào đang mở.", code="closed")
    # Kiểm sớm cho thông báo rõ; trong transaction vẫn kiểm lại + UNIQUE chặn chắc chắn.
    already = TuitionExemptionApplication.objects.filter(student=student, round=round_).first()
    if already is not None and not already.events.filter(request_key=request_key).exists():
        raise TuitionExemptionError("Bạn đã nộp đơn cho đợt này.", code="exists")

    # Gom lỗi thông tin + lỗi giấy tờ để SV sửa một lần.
    errors = {}
    try:
        cleaned = contract.validate_application(data, timezone.localdate())
    except contract.WorkflowError as exc:
        cleaned = None
        errors.update(getattr(exc, "errors", None) or {"__all__": [str(exc)]})

    plan = build_plan(student, round_)
    offered = {c["code"]: c for c in plan["renewals"] + plan["others"]}
    try:
        codes = contract.validate_categories(data.get("category_codes"), offered.keys())
    except contract.WorkflowError as exc:
        codes = []
        errors["category_codes"] = [str(exc)]

    # ── Thông tin riêng + điều kiện của đối tượng (TSKK: DTTS + thường trú ĐBKK) ──
    details = None
    if codes:
        special_area, ward_label = (special_area_status(student)
                                    if codes[0] in contract.SPECIAL_AREA_CATEGORIES else (None, ""))
        details, detail_errors, ineligible = contract.clean_category_details(
            codes[0], data.get("category_details"), student.ethnicity, special_area, ward_label)
        if ineligible:
            message = contract.ineligible_message(codes[0], ineligible)
            raise TuitionExemptionError(message, code="ineligible", errors={"eligibility": [message]})
        errors.update({f"detail_{k}": v for k, v in detail_errors.items()})
        details = details or None

    # ── Giấy tờ theo từng diện ──
    grouped = _parse_uploads(uploads)
    total = sum(len(v) for v in grouped.values())
    if total > contract.MAX_FILES_PER_APPLICATION:
        raise TuitionExemptionError(f"Tối đa {contract.MAX_FILES_PER_APPLICATION} file mỗi đơn.")
    checked = {}
    for (code, doc_type), files in grouped.items():
        field = f"{FILE_FIELD_PREFIX}{code}{FILE_FIELD_SEP}{doc_type}"
        cat = offered.get(code)
        if code not in codes or cat is None:
            errors[field] = ["File gửi kèm cho nhóm đối tượng không được chọn."]
            continue
        if cat["mode"] == "confirm":
            errors[field] = ["Diện này chỉ cần xác nhận gia hạn, không cần nộp giấy tờ."]
            continue
        if doc_type not in {d["doc_type"] for d in cat["documents"]}:
            errors[field] = ["Loại giấy tờ không có trong danh sách của diện này."]
            continue
        for i, upload in enumerate(files):
            try:
                checked[(code, doc_type, i)] = (upload, inspect_document(upload))
            except contract.WorkflowError as exc:
                errors.setdefault(field, []).append(f"{upload.name}: {exc}")
    for code in codes:
        cat = offered[code]
        if cat["mode"] == "confirm":
            continue
        uploaded = {dt for (c, dt) in grouped if c == code}
        missing = contract.required_documents_missing(
            [d for d in cat["documents"] if d["doc_type"] != "general"] or None, uploaded)
        if missing:
            errors[f"category_{code}"] = [f"Còn thiếu: {', '.join(missing)}."]
    if errors:
        message = ("Thông tin chưa hợp lệ, kiểm tra các ô được đánh dấu." if cleaned is None
                   else "Giấy tờ chưa đầy đủ hoặc chưa hợp lệ.")
        raise TuitionExemptionError(message, errors=errors)

    modes = {code: offered[code]["mode"] for code in codes}
    digest = contract.fingerprint({
        "fields": cleaned, "codes": codes, "details": details,
        "files": sorted(f"{c}/{dt}/{chk[3]}" for (c, dt, _), (_, chk) in checked.items()),
    })

    written = []
    try:
        with transaction.atomic():
            Student.objects.select_for_update().filter(pk=student.pk).first()
            replayed = (TuitionExemptionEvent.objects
                        .filter(application__student=student, source_app="Hub",
                                event_type="SUBMITTED", request_key=request_key)
                        .select_related("application").first())
            if replayed is not None:
                if (replayed.payload or {}).get("request_digest") != digest:
                    raise TuitionExemptionError("Request key đã dùng cho nội dung khác. Hãy tải lại trang.",
                                                code="conflict")
                return replayed.application
            if TuitionExemptionApplication.objects.filter(student=student, round=round_).exists():
                raise TuitionExemptionError("Bạn đã nộp đơn cho đợt này.", code="exists")

            now = timezone.now()
            app = TuitionExemptionApplication.objects.create(
                student=student, round=round_,
                student_code=cleaned["student_code"], full_name=cleaned["full_name"],
                date_of_birth=cleaned["date_of_birth"],
                class_code=cleaned["class_code"] or None,
                department_code=cleaned["department_code"] or None,
                department_name=(student.current_department.name_vi
                                 if student.current_department else None),
                submission_kind=plan["submission_kind"],
                previous_review_note=cleaned["previous_review_note"] or None,
                category_details=details,
                status="processing", submitted_at=now,
                **{f: (cleaned[f] or None) for f in SNAPSHOT_FIELDS},
            )
            links = {code: TuitionExemptionApplicationCategory.objects.create(
                application=app, category_id=offered[code]["id"]) for code in codes}
            event = append_event(
                app, "SUBMITTED", source="Hub", actor_id=student.pk, new="processing",
                key=request_key,
                payload={"request_digest": digest, "submission_kind": plan["submission_kind"],
                         "categories": modes, "files": len(checked)})
            for (code, doc_type, _), (upload, chk) in checked.items():
                _store(app, event, links[code], doc_type, upload, chk, written)
            return app
    except IntegrityError as exc:
        for path in written:
            path.unlink(missing_ok=True)
        raise TuitionExemptionError("Bạn đã nộp đơn cho đợt này.", code="exists") from exc
    except Exception:
        for path in written:
            path.unlink(missing_ok=True)
        raise


def _invalid_docs(app):
    return list(app.documents.filter(is_superseded=False, verified_status="invalid")
                .select_related("application_category__category").order_by("id"))


def invalid_documents(app):
    """Giấy cán bộ đánh dấu Không hợp lệ (chưa được thay) — để SV biết phải nộp lại gì."""
    out = []
    for d in _invalid_docs(app):
        cat = d.application_category.category if d.application_category else None
        labels = {x.get("doc_type"): x.get("label") for x in (cat.required_documents or [])} if cat else {}
        out.append({"category_code": cat.code if cat else "", "doc_type": d.doc_type,
                    "label": labels.get(d.doc_type) or "Giấy tờ chứng minh thuộc diện",
                    "original_filename": d.original_filename, "note": d.verified_note or ""})
    return out


def supplement_targets(app):
    """Đối tượng trong đơn kèm danh sách giấy tờ để SV bổ sung/thay giấy. Đơn Chờ sinh viên
    bổ sung: CHỈ các giấy bị đánh dấu Không hợp lệ (kèm lý do của cán bộ)."""
    invalid = {}
    if app.status == "awaiting_supplement":
        for d in invalid_documents(app):
            invalid.setdefault(d["category_code"], {})[d["doc_type"]] = d["note"]
    out = []
    for l in app.categories.select_related("category").order_by("category__sort_order", "category__code"):
        item = {"link_id": l.pk, **_serialize_category(l.category), "review_note": l.review_note or ""}
        if app.status == "awaiting_supplement":
            wanted = invalid.get(l.category.code, {})
            if not wanted:
                continue
            item["documents"] = [{**d, "invalid_note": wanted[d["doc_type"]]}
                                 for d in item["documents"] if d["doc_type"] in wanted]
            known = {d["doc_type"] for d in item["documents"]}
            item["documents"] += [{"doc_type": dt, "label": "Giấy tờ chứng minh thuộc diện", "required": True,
                                   "has_expiry": False, "invalid_note": note}
                                  for dt, note in wanted.items() if dt not in known]
        out.append(item)
    return out


def supplement(student, application, data, uploads, *, request_key, row_version):
    """SV bổ sung/thay giấy tờ → Đang xử lý kèm cờ "SV đã bổ sung" (như BHYT), event
    SUPPLEMENTED; file cũ cùng (diện, doc_type) → is_superseded=True. Hai trường hợp:
    - đơn Chờ sinh viên bổ sung (cán bộ đánh dấu giấy Không hợp lệ): nộp lại ĐỦ các giấy
      bị đánh dấu, không phụ thuộc giờ đóng đợt;
    - đơn Từ chối vì lý do sửa được: khi đợt còn mở.

    Bổ sung giấy ở ĐỢT MỚI (diện every_term/every_year) không đi đường này mà là đơn
    gia hạn — xem `submit`. Hub ghi status/cờ bổ sung/row_version ở đây là ngoại lệ đã
    ghi trong schema (SV gửi bổ sung), như `insurance_workflow.resubmit`.
    """
    try:
        contract.request_key(request_key)
    except contract.WorkflowError as exc:
        raise TuitionExemptionError(str(exc)) from exc

    targets = {t["code"]: t for t in supplement_targets(application)}
    grouped = _parse_uploads(uploads)
    if not grouped:
        raise TuitionExemptionError("Chọn ít nhất một file để bổ sung.")
    if sum(len(v) for v in grouped.values()) > contract.MAX_FILES_PER_APPLICATION:
        raise TuitionExemptionError(f"Tối đa {contract.MAX_FILES_PER_APPLICATION} file mỗi lần.")
    errors, checked = {}, {}
    for (code, doc_type), files in grouped.items():
        field = f"{FILE_FIELD_PREFIX}{code}{FILE_FIELD_SEP}{doc_type}"
        target = targets.get(code)
        if target is None:
            errors[field] = ["Diện này không cần bổ sung."]
            continue
        if doc_type not in {d["doc_type"] for d in target["documents"]}:
            errors[field] = ["Loại giấy tờ không có trong danh sách của diện này."]
            continue
        for i, upload in enumerate(files):
            try:
                checked[(code, doc_type, i)] = (upload, inspect_document(upload))
            except contract.WorkflowError as exc:
                errors.setdefault(field, []).append(f"{upload.name}: {exc}")
    if application.status == "awaiting_supplement":
        for code, target in targets.items():
            for d in target["documents"]:
                field = f"{FILE_FIELD_PREFIX}{code}{FILE_FIELD_SEP}{d['doc_type']}"
                if (code, d["doc_type"]) not in grouped and field not in errors:
                    errors[field] = ["Nộp lại giấy này — cán bộ đã đánh dấu không hợp lệ."]
    if errors:
        raise TuitionExemptionError("Giấy tờ chưa hợp lệ.", errors=errors)
    digest = contract.fingerprint({
        "supplement": application.pk,
        "files": sorted(f"{c}/{dt}/{chk[3]}" for (c, dt, _), (_, chk) in checked.items()),
    })

    written = []
    try:
        with transaction.atomic():
            Student.objects.select_for_update().filter(pk=student.pk).first()
            app = TuitionExemptionApplication.objects.select_for_update().get(pk=application.pk, student=student)
            done = app.events.filter(request_key=request_key).first()
            if done is not None:
                if (done.payload or {}).get("request_digest") != digest:
                    raise TuitionExemptionError("Request key đã dùng cho nội dung khác. Hãy tải lại trang.",
                                                code="conflict")
                return app
            try:
                if int(row_version) != app.row_version:
                    raise ValueError
            except (TypeError, ValueError):
                raise TuitionExemptionError("Đơn vừa được cán bộ cập nhật. Hãy tải lại trang rồi gửi lại.",
                                            code="conflict")
            awaiting = app.status == "awaiting_supplement"
            if not awaiting and (app.status != "rejected"
                                 or app.rejection_reason_code not in contract.RESUBMITTABLE_REASONS):
                raise TuitionExemptionError("Đơn hiện không bổ sung được. Liên hệ Phòng CTSV nếu cần.",
                                            code="conflict")
            if not awaiting and not round_is_open(app.round):
                raise TuitionExemptionError("Đợt đã đóng nên không bổ sung được nữa. Liên hệ Phòng CTSV.",
                                            code="closed")
            contract.validate_transition(app.status, "processing")
            event = append_event(app, "SUPPLEMENTED", source="Hub", actor_id=student.pk,
                                 old=app.status, new="processing", key=request_key,
                                 reason_code="INVALID_DOCUMENTS" if awaiting else app.rejection_reason_code,
                                 payload={"request_digest": digest, "files": len(checked),
                                          "categories": sorted({c for (c, _, _) in checked}),
                                          "previous_note": app.review_note or ""})
            replaced = 0
            for (code, doc_type, _), (upload, chk) in checked.items():
                link_id = targets[code]["link_id"]
                replaced += (TuitionExemptionDocument.objects
                             .filter(application=app, application_category_id=link_id, doc_type=doc_type,
                                     is_superseded=False).exclude(event=event)
                             .update(is_superseded=True))
                link = TuitionExemptionApplicationCategory.objects.get(pk=link_id)
                _store(app, event, link, doc_type, upload, chk, written)
            app.status = "processing"
            app.rejection_reason_code = None
            app.review_note = None
            app.supplement_pending = True
            app.supplemented_at = timezone.now()
            app.row_version += 1
            app.save(update_fields=["status", "rejection_reason_code", "review_note", "supplement_pending",
                                    "supplemented_at", "row_version", "updated_at"])
            return app
    except Exception:
        for path in written:
            path.unlink(missing_ok=True)
        raise


def document_path(student, application, document_id):
    """Đường dẫn file giấy tờ của chính SV (kèm dòng document); None nếu không hợp lệ."""
    doc = application.documents.filter(pk=document_id).first()
    if doc is None:
        return None, None
    path = insurance_contract.safe_path(settings.MEDIA_ROOT, doc.storage_key)
    if path is None or not path.is_file():
        return None, None
    return path, doc
