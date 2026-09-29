"""
Nghiệp vụ "Khám sức khỏe định kỳ" (theo chỉ thị của UBND TP.HCM).

SV trả lời một câu hỏi mỗi năm học:
  - "Đã khám rồi"  → nộp ảnh minh chứng, chuyên viên xác nhận trên Dashboard.
  - "Chưa khám"    → đăng ký khám tập trung tại trường. Gồm 2 phần:
      1. Khai báo thông tin cá nhân — CHÍNH LÀ form khai báo ngoại trú
         (`offcampus.submit`), nên nộp xong là cũng tính là đã khai ngoại trú.
      2. Đồng ý tham gia khám — chỉ mở khi thường trú HOẶC tạm trú ở TP.HCM.

Cả hai phần đi trong MỘT transaction: điều kiện TP.HCM được tính lại ở server từ
địa chỉ vừa ghi xuống, không tin cờ client gửi. Không đủ điều kiện thì rollback
luôn phần khai báo — đúng yêu cầu "vô hiệu phần 2 và không ghi nhận thông tin".

Mở/khóa theo đợt (`health_check_rounds`, một đợt mỗi năm học). Ngoại lệ duy
nhất sau hạn chót: minh chứng BỊ TỪ CHỐI vẫn nộp lại được, vì chuyên viên có thể
duyệt sau khi đợt đóng và SV không có lỗi gì trong việc đó.
"""

from pathlib import Path
from uuid import uuid4

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone

from students.models import ProfileChangeRequest, Student

from . import address_service as addr
from . import health_check_result as result_spec
from . import offcampus
from . import profile_changes as pc
from .health_check_models import HealthCheckResponse as Response_
from .health_check_models import HealthCheckRound
from .insurance_contract import WorkflowError, safe_path
from .insurance_files import inspect_upload

# Cam kết + đồng ý cung cấp thông tin ở cuối form của CẢ HAI lựa chọn. Kết quả khám
# là dữ liệu sức khỏe — dữ liệu cá nhân nhạy cảm theo Nghị định 13/2023/NĐ-CP — nên
# lưu lại đúng câu chữ SV đã đồng ý + thời điểm (trong cột `evidence`, không thêm
# cột). Đổi câu chữ thì TĂNG phiên bản để phân biệt người đồng ý bản cũ.
DATA_CONSENT_VERSION = "2026-09-28"
DATA_CONSENT_TEXT = {
    "examined": (
        "Cam kết các thông tin đã khai và minh chứng đã tải lên là trung thực, chính xác; "
        "đồng ý để Trường Đại học Quốc tế – ĐHQG-HCM thu thập, lưu trữ và sử dụng thông tin "
        "cá nhân và kết quả khám sức khỏe nêu trên phục vụ công tác quản lý, chăm sóc sức khỏe "
        "sinh viên và báo cáo cơ quan y tế có thẩm quyền, theo quy định về bảo vệ dữ liệu cá nhân."
    ),
    "register": (
        "Cam kết các thông tin đã khai là trung thực, chính xác; đồng ý để Trường Đại học Quốc "
        "tế – ĐHQG-HCM thu thập, lưu trữ và sử dụng thông tin cá nhân nêu trên phục vụ việc tổ "
        "chức khám sức khỏe, quản lý, chăm sóc sức khỏe sinh viên và báo cáo cơ quan y tế có "
        "thẩm quyền, theo quy định về bảo vệ dữ liệu cá nhân."
    ),
}


def _data_consent(choice):
    return {"version": DATA_CONSENT_VERSION, "text": DATA_CONSENT_TEXT[choice],
            "at": timezone.now().isoformat()}


def _require_data_consent(value):
    if value not in (True, "true", "1", "on"):
        raise HealthCheckError(
            "Vui lòng tích xác nhận cam kết và đồng ý cung cấp thông tin.",
            errors={"data_consent": "Chưa xác nhận."}, code="data_consent",
        )


MAX_EVIDENCE_FILES = 10   # nginx hub: client_max_body_size 64m ≥ 10 × 5 MB
EVIDENCE_DIR = "health_check"


class HealthCheckError(ValueError):
    """Lỗi nghiệp vụ, câu thông báo hiển thị thẳng cho SV."""

    def __init__(self, message, *, errors=None, code=""):
        self.errors = errors or {}
        self.code = code
        super().__init__(message)


# ── Đợt ──────────────────────────────────────────────────────────────────────

def round_state(round_, now=None):
    now = now or timezone.now()
    if now < round_.opens_at:
        return "upcoming"
    if now > round_.closes_at:
        return "closed"
    return "open"


def display_round(now=None):
    """Đợt Hub đang hiển thị: đợt đang mở; không có thì đợt gần nhất đã mở
    (để SV xem lại phản hồi của mình); không có nữa thì đợt sắp mở."""
    now = now or timezone.now()
    rounds = HealthCheckRound.objects.all()
    current = rounds.filter(opens_at__lte=now, closes_at__gte=now).order_by("-opens_at").first()
    if current:
        return current
    past = rounds.filter(opens_at__lte=now).order_by("-closes_at").first()
    if past:
        return past
    return rounds.filter(opens_at__gt=now).order_by("opens_at").first()


def _package_lines(text):
    """Nội dung gói khám → danh sách dòng. Dòng mở đầu '+' là gạch đầu dòng con."""
    lines = []
    for raw in (text or "").splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("+"):
            lines.append({"bullet": True, "text": line.lstrip("+").strip()})
        else:
            lines.append({"bullet": False, "text": line})
    return lines


def serialize_round(round_):
    if round_ is None:
        return None
    return {
        "id": round_.pk,
        "academic_year": round_.academic_year,
        "title": round_.title,
        "opens_at": round_.opens_at.isoformat(),
        "closes_at": round_.closes_at.isoformat(),
        "state": round_state(round_),
        "package_name": round_.package_name,
        "package_lines": _package_lines(round_.package_content),
        "schedule_note": round_.schedule_note or "",
    }


# ── Điều kiện TP.HCM ────────────────────────────────────────────────────────

def residence_snapshot(student):
    """Địa chỉ đang dùng + kết luận có thuộc diện khám tại TP.HCM hay không.

    Đọc qua `get_effective()` như form ngoại trú: có bản chuẩn hoá thì lấy bản
    đó. Chỉ tin `province_code` — dòng dữ liệu cũ không có mã nên không bao giờ
    tự được tính là TP.HCM.
    """
    perm = addr.get_effective(student, offcampus.PERMANENT)
    temp = addr.get_effective(student, offcampus.TEMPORARY)
    perm_hcm = bool(perm and perm.province_code == addr.HCMC_PROVINCE_CODE)
    temp_hcm = bool(temp and temp.province_code == addr.HCMC_PROVINCE_CODE)
    temp_none = addr.is_declared_empty(temp)
    return {
        "eligible": perm_hcm or temp_hcm,
        "permanent_hcm": perm_hcm,
        "temporary_hcm": temp_hcm,
        "temporary_none": temp_none,
        "permanent": addr.format_address(perm),
        "temporary": "Không có tạm trú" if temp_none else addr.format_address(temp),
    }


# ── Đọc ─────────────────────────────────────────────────────────────────────

def evidence_files(evidence):
    """Danh sách file minh chứng. Cột `evidence` là `{"files": [...], "result": {...}}`;
    bản đầu (chỉ có ảnh) lưu thẳng danh sách — vẫn đọc được."""
    if isinstance(evidence, list):
        return evidence
    return (evidence or {}).get("files") or []


def evidence_result(evidence):
    """Kết quả khám SV tự khai (nhánh "Đã khám rồi"); {} nếu không có."""
    return (evidence or {}).get("result") or {} if isinstance(evidence, dict) else {}


def is_female(student):
    return (student.sex or "").strip().lower() in ("nữ", "nu", "female", "f")


def _serialize_response(resp):
    if resp is None:
        return None
    local = timezone.localtime
    return {
        "id": resp.pk,
        "choice": resp.choice,
        "status": resp.status,
        "status_label": Response_.STATUS_LABELS.get(resp.status, resp.status),
        "submitted_at": local(resp.submitted_at).isoformat(),
        "submit_count": resp.submit_count,
        "consent_at": local(resp.consent_at).isoformat() if resp.consent_at else None,
        "review_note": resp.review_note or "",
        "reviewed_at": local(resp.reviewed_at).isoformat() if resp.reviewed_at else None,
        "evidence": [
            {"index": i, "name": item.get("original_filename") or f"Ảnh {i + 1}"}
            for i, item in enumerate(evidence_files(resp.evidence))
        ],
        "result": evidence_result(resp.evidence),
        "data_consent_at": ((resp.evidence or {}).get("data_consent") or {}).get("at")
        if isinstance(resp.evidence, dict) else None,
        "residence": resp.residence or None,
    }


def build_state(student):
    """Toàn bộ dữ liệu dựng trang cho SV."""
    round_ = display_round()
    resp = (
        Response_.objects.filter(round=round_, student_id=student.pk).first()
        if round_ else None
    )
    state = round_state(round_) if round_ else None
    return {
        "round": serialize_round(round_),
        "response": _serialize_response(resp),
        "can_submit": state == "open" and resp is None,
        "can_resubmit": bool(
            resp and resp.choice == Response_.CHOICE_EXAMINED
            and resp.status == Response_.STATUS_REJECTED
        ),
        "max_evidence_files": MAX_EVIDENCE_FILES,
        # Form kết quả khám dựng hoàn toàn từ đây — xem core/health_check_result.py.
        "result_schema": result_spec.SCHEMA,
        "result_defaults": result_spec.defaults(female=is_female(student)),
        "female": is_female(student),
        "data_consent_text": DATA_CONSENT_TEXT,
        # Luồng khám sức khỏe BẮT BUỘC có CCCD (cột C file gửi PYT).
        "cccd_missing": pc.cccd_missing(student),
        # Phần 1 của nhánh "Chưa khám" dựng lại đúng form ngoại trú.
        "offcampus": offcampus.build_prefill(student),
        # Điều kiện theo địa chỉ ĐÃ LƯU — dùng khi form ngoại trú đang khóa.
        # Form còn mở thì frontend tự tính theo ô đang nhập, server tính lại lúc nộp.
        "residence": residence_snapshot(student),
    }


def evidence_path(student, index):
    """File minh chứng thứ `index` của chính SV ở đợt đang hiển thị."""
    round_ = display_round()
    if round_ is None:
        return None, None
    resp = Response_.objects.filter(round=round_, student_id=student.pk).first()
    items = evidence_files(resp.evidence) if resp else []
    if index < 0 or index >= len(items):
        return None, None
    item = items[index]
    return safe_path(settings.MEDIA_ROOT, item.get("storage_key")), item.get("mime_type")


# ── Ghi ─────────────────────────────────────────────────────────────────────

def _require_cccd(student):
    if pc.cccd_missing(student):
        raise HealthCheckError(
            "Hồ sơ chưa có số CCCD. Bổ sung CCCD ở bước Thông tin cá nhân.",
            errors={"citizen_id": "Bắt buộc nhập số CCCD để khai báo khám sức khỏe."},
            code="missing_cccd",
        )


def add_citizen_id(student, data):
    """Bổ sung CCCD khi hồ sơ CHƯA có — dùng cho SV đã khai ngoại trú (form khóa)
    nhưng thiếu CCCD. Đi qua đúng đường sửa CCCD của khai báo ngoại trú (không cần
    duyệt, ghi nhật ký), nguồn "kham_suc_khoe". Đã có CCCD thì không cho sửa ở đây."""
    if not pc.cccd_missing(student):
        raise HealthCheckError("Hồ sơ đã có số CCCD.", code="exists")
    value = {
        "number": (data.get("number") or "").strip(),
        "issue_place": (data.get("issue_place") or "").strip(),
        "issue_date": (data.get("issue_date") or "").strip(),
    }
    if not value["number"]:
        raise HealthCheckError("Vui lòng nhập số CCCD.", errors={"citizen_id": "Không được để trống."})
    try:
        with transaction.atomic():
            pc.submit_change(student, "student.citizen_id", value,
                             source=ProfileChangeRequest.SOURCE_HEALTH_CHECK)
    except pc.ChangeError as exc:
        raise HealthCheckError(str(exc), errors={"citizen_id": str(exc)}) from exc


def _lock_student(student):
    # Khóa dòng SV để 2 lần bấm gửi song song không cùng lọt qua bước kiểm tra.
    Student.objects.select_for_update().filter(pk=student.pk).first()


def submit_evidence(student, uploads, result_raw=None, declaration=None, data_consent=None):
    """Nhánh "Đã khám rồi": khai báo ngoại trú (nếu chưa) + kết quả khám theo mẫu
    + ảnh minh chứng, chờ chuyên viên xác nhận.

    Kiểm kết quả khám và định dạng ảnh TRƯỚC transaction (đọc file chậm), ghi file
    trong transaction; lỗi ở bất kỳ bước nào thì rollback cả khai báo ngoại trú và
    xóa sạch file đã ghi. Lỗi trả về theo từng ô: ô kết quả mang tiền tố `result.`.
    """
    _require_data_consent(data_consent)
    result, result_errors = result_spec.clean(result_raw)
    if result_errors:
        raise HealthCheckError(
            "Vui lòng kiểm tra lại các ô kết quả khám được đánh dấu.",
            errors={f"result.{k}": v for k, v in result_errors.items()},
        )
    uploads = [u for u in uploads if u]
    if not uploads:
        raise HealthCheckError("Vui lòng tải lên ít nhất một ảnh minh chứng.",
                               errors={"evidence": "Chưa có ảnh nào."})
    if len(uploads) > MAX_EVIDENCE_FILES:
        raise HealthCheckError(f"Chỉ nhận tối đa {MAX_EVIDENCE_FILES} ảnh.",
                               errors={"evidence": f"Tối đa {MAX_EVIDENCE_FILES} ảnh."})
    try:
        checked = [(u, inspect_upload(u)) for u in uploads]
    except WorkflowError as exc:
        raise HealthCheckError(str(exc), errors={"evidence": str(exc)}) from exc

    written = []
    try:
        with transaction.atomic():
            _lock_student(student)
            round_ = display_round()
            if round_ is None:
                raise HealthCheckError("Chưa có đợt khai báo khám sức khỏe nào.")
            resp = (Response_.objects.select_for_update()
                    .filter(round=round_, student_id=student.pk).first())
            resubmit = bool(resp and resp.choice == Response_.CHOICE_EXAMINED
                            and resp.status == Response_.STATUS_REJECTED)
            if resp is not None and not resubmit:
                raise HealthCheckError("Đã có phản hồi cho đợt này.", code="exists")
            if resp is None and round_state(round_) != "open":
                raise HealthCheckError(_closed_message(round_), code="closed")

            # Như nhánh đăng ký khám: chưa khai ngoại trú thì khai luôn ở đây.
            locked, _ = offcampus.lock_state(student)
            declared_now = False
            if not locked:
                try:
                    offcampus.submit(student, declaration or {})
                except offcampus.DeclarationError as exc:
                    raise HealthCheckError("Vui lòng kiểm tra lại phần khai báo thông tin.",
                                           errors=exc.errors) from exc
                declared_now = True
            _require_cccd(student)
            residence = residence_snapshot(student)
            residence["declared_with_registration"] = declared_now

            root = Path(settings.MEDIA_ROOT).resolve()
            items = []
            for upload, (data, ext, mime, digest) in checked:
                key = f"{EVIDENCE_DIR}/{round_.pk}/{student.pk}/{uuid4().hex}.{ext}"
                target = root / key
                target.parent.mkdir(parents=True, exist_ok=True)
                with target.open("xb") as stream:     # tên ngẫu nhiên + 'x' → không bao giờ ghi đè
                    written.append(target)
                    stream.write(data)
                items.append({
                    "storage_key": key, "mime_type": mime, "size": len(data), "sha256": digest,
                    "original_filename": Path((upload.name or "").replace("\\", "/")).name[:255],
                })

            now = timezone.now()
            if resp is None:
                resp = Response_.objects.create(
                    round=round_, student_id=student.pk,
                    choice=Response_.CHOICE_EXAMINED, status=Response_.STATUS_PENDING,
                    evidence={"files": items, "result": result,
                              "data_consent": _data_consent(Response_.CHOICE_EXAMINED)},
                    residence=residence,
                    submit_count=1, submitted_at=now,
                )
            else:
                # Nộp lại sau khi bị từ chối: thay bộ ảnh, đưa về hàng chờ. Lý do
                # từ chối cũ giữ lại để chuyên viên biết lần trước sai ở đâu.
                resp.evidence = {"files": items, "result": result,
                                 "data_consent": _data_consent(Response_.CHOICE_EXAMINED)}
                resp.residence = residence
                resp.status = Response_.STATUS_PENDING
                resp.submit_count += 1
                resp.submitted_at = now
                resp.reviewed_by_id = None
                resp.reviewed_at = None
                resp.save(update_fields=[
                    "evidence", "residence", "status", "submit_count", "submitted_at",
                    "reviewed_by_id", "reviewed_at", "updated_at",
                ])
        return resp
    except IntegrityError as exc:
        _cleanup(written)
        raise HealthCheckError("Đã có phản hồi cho đợt này.", code="exists") from exc
    except Exception:
        _cleanup(written)
        raise


def register(student, data):
    """Nhánh "Chưa khám": khai báo (nếu form ngoại trú đang mở) + đăng ký khám."""
    if data.get("consent") is not True:
        raise HealthCheckError(
            "Vui lòng tích xác nhận đồng ý tham gia khám sức khỏe tập trung.",
            errors={"consent": "Chưa xác nhận đồng ý."},
        )
    _require_data_consent(data.get("data_consent"))
    try:
        with transaction.atomic():
            _lock_student(student)
            round_ = display_round()
            if round_ is None or round_state(round_) != "open":
                raise HealthCheckError(_closed_message(round_), code="closed")
            if Response_.objects.filter(round=round_, student_id=student.pk).exists():
                raise HealthCheckError("Đã có phản hồi cho đợt này.", code="exists")

            locked, _ = offcampus.lock_state(student)
            declared_now = False
            if not locked:
                try:
                    offcampus.submit(student, {**(data.get("declaration") or {}),
                                               "require_citizen_id": True})
                except offcampus.DeclarationError as exc:
                    raise HealthCheckError("Vui lòng kiểm tra lại phần khai báo thông tin.",
                                           errors=exc.errors) from exc
                declared_now = True
            _require_cccd(student)

            # Tính lại từ địa chỉ vừa ghi (hoặc đã có) — không tin client.
            residence = residence_snapshot(student)
            if not residence["eligible"]:
                # Exception → rollback cả phần khai báo vừa ghi ở trên.
                raise HealthCheckError(
                    "Chỉ sinh viên có địa chỉ thường trú hoặc tạm trú tại Thành phố "
                    "Hồ Chí Minh mới đăng ký được khám sức khỏe tập trung tại trường.",
                    code="not_eligible",
                )
            residence["declared_with_registration"] = declared_now
            now = timezone.now()
            return Response_.objects.create(
                round=round_, student_id=student.pk,
                choice=Response_.CHOICE_REGISTER, status=Response_.STATUS_REGISTERED,
                residence=residence, consent_at=now, submit_count=1, submitted_at=now,
                evidence={"data_consent": _data_consent(Response_.CHOICE_REGISTER)},
            )
    except IntegrityError as exc:
        raise HealthCheckError("Đã có phản hồi cho đợt này.", code="exists") from exc


def _closed_message(round_):
    if round_ is None:
        return "Chưa có đợt khai báo khám sức khỏe nào."
    if round_state(round_) == "upcoming":
        return ("Đợt khai báo năm học " + round_.academic_year + " chưa mở. Thời gian mở: "
                + timezone.localtime(round_.opens_at).strftime("%H:%M %d/%m/%Y") + ".")
    return ("Đợt khai báo năm học " + round_.academic_year + " đã kết thúc lúc "
            + timezone.localtime(round_.closes_at).strftime("%H:%M %d/%m/%Y") + ".")


def _cleanup(paths):
    for path in paths:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass
