"""Form đăng ký sự kiện cộng tác viên — cấu trúc câu hỏi + kiểm câu trả lời.

⚠️ BẢN SAO GIỐNG HỆT: Dashboard `volunteers/form_schema.py` ⇄ Hub `core/volunteer_form.py`.
Dashboard dùng `clean_schema` (staff lưu form) + `format_answer` (xem / xuất Excel);
Hub dùng `clean_answers` (SV gửi). Sửa một bên phải chép sang bên kia.

Form lưu ở `volunteer_events.form_schema`:

    {"profile": {"fields": ["class_code", "phone", ...], "editable": ["phone"]},
     "questions": [{"id": "q_1a2b3c4d", "type": "single", "title": "...", "required": true,
                    "note": "...", "note_image": "volunteer_events/5/note-<uuid>.jpg",
                    "options": [{"id": "o_9f8e7d6c", "label": "..."}], "other": false, ...}]}

Câu trả lời lưu ở `volunteer_registrations.answers` THEO ID câu hỏi (cách Google Forms /
Typeform làm): đổi nhãn, đổi thứ tự, thêm câu không làm lệch dữ liệu đã có; câu bị xoá thì
câu trả lời cũ vẫn nằm đó, chỉ không hiện nữa.

    {"profile": {"phone": "...", "email": "..."},
     "q_..": "chữ" | "o_.." | ["o_..", "__other__"] | "2026-11-24" | "12.5" | [{"key", "name", "size", "mime"}],
     "q_..:other": "chữ của lựa chọn Khác",
     "q_..": "yes" | "no", "q_..:reason": "lý do khi chọn Không"}
"""
import re
import secrets
from datetime import date

QUESTION_TYPES = {
    "short_text": "Trả lời ngắn",
    "long_text": "Đoạn văn",
    "yes_no": "Có / Không",
    "single": "Chọn một",
    "multi": "Chọn nhiều",
    "dropdown": "Danh sách thả xuống",
    "date": "Ngày",
    "number": "Số",
    "file": "Tải file lên",
}
CHOICE_TYPES = ("single", "multi", "dropdown")
TEXT_FORMATS = {"text": "Chữ tự do", "email": "Email", "phone": "Số điện thoại"}
FILE_ACCEPT = {"image": "Ảnh", "pdf": "PDF", "any": "Ảnh hoặc PDF"}
OTHER = "__other__"
YES, NO = "yes", "no"
YES_NO_LABELS = {YES: "Có", NO: "Không"}
DEFAULT_REASON_LABEL = "Lý do không tham gia"

# Thông tin lấy sẵn từ hồ sơ — MSSV + họ tên luôn hiện; SV chỉ sửa được ô trong EDITABLE_PROFILE
# và giá trị sửa chỉ lưu vào câu trả lời, KHÔNG ghi ngược hồ sơ.
PROFILE_FIELDS = {
    "student_code": "MSSV",
    "full_name": "Họ và tên",
    "date_of_birth": "Ngày sinh",
    "sex": "Giới tính",
    "class_code": "Lớp",
    "department": "Khoa",
    "phone": "Số điện thoại",
    "email": "Email",
}
FIXED_PROFILE = ("student_code", "full_name")
EDITABLE_PROFILE = ("phone", "email")
DEFAULT_PROFILE = {"fields": ["class_code", "department", "phone", "email"], "editable": ["phone", "email"]}

MAX_QUESTIONS = 50
MAX_OPTIONS = 60
MAX_TITLE = 300
MAX_NOTE = 2000
MAX_OPTION = 200
MAX_SHORT = 500
MAX_LONG = 5000
MAX_FILES = 5
MAX_FILE_BYTES = 10 * 1024 * 1024

_ID = re.compile(r"^[qo]_[0-9a-f]{8}$")
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_PHONE = re.compile(r"^(\+?84|0)[0-9]{9,10}$")
_NUMBER = re.compile(r"^-?\d{1,12}([.,]\d{1,4})?$")


def new_id(prefix):
    return f"{prefix}_{secrets.token_hex(4)}"


def _text(value, limit):
    return re.sub(r"[ \t]+", " ", str(value or "")).strip()[:limit]


def _int(value, lo, hi, default):
    try:
        n = int(value)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, n))


def _num(value):
    s = str(value if value is not None else "").strip().replace(",", ".")
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


# ── Staff lưu form ───────────────────────────────────────────────────────────

def clean_profile(raw):
    raw = raw if isinstance(raw, dict) else {}
    fields = [f for f in raw.get("fields") or [] if f in PROFILE_FIELDS and f not in FIXED_PROFILE]
    fields = list(dict.fromkeys(fields))
    editable = [f for f in raw.get("editable") or [] if f in EDITABLE_PROFILE and f in fields]
    return {"fields": fields, "editable": list(dict.fromkeys(editable))}


def clean_question(raw, used_ids):
    """Một câu hỏi → (câu hỏi đã chuẩn hoá, lỗi | None)."""
    if not isinstance(raw, dict):
        return None, "Câu hỏi không hợp lệ."
    qtype = raw.get("type")
    if qtype not in QUESTION_TYPES:
        return None, "Loại câu hỏi không hợp lệ."
    qid = raw.get("id") if isinstance(raw.get("id"), str) and _ID.match(raw.get("id")) else ""
    if not qid or qid in used_ids or not qid.startswith("q_"):
        qid = new_id("q")
    used_ids.add(qid)
    title = _text(raw.get("title"), MAX_TITLE)
    q = {
        "id": qid, "type": qtype, "title": title, "required": bool(raw.get("required")),
        "note": str(raw.get("note") or "").strip()[:MAX_NOTE],
    }
    image = str(raw.get("note_image") or "").strip()
    if image:
        q["note_image"] = image[:255]
    if not title:
        return q, "Câu hỏi chưa có nội dung."
    if qtype in CHOICE_TYPES:
        options, seen = [], set()
        for opt in raw.get("options") or []:
            label = _text(opt.get("label") if isinstance(opt, dict) else opt, MAX_OPTION)
            if not label or label.lower() in seen:
                continue
            seen.add(label.lower())
            oid = opt.get("id") if isinstance(opt, dict) else ""
            if not (isinstance(oid, str) and _ID.match(oid) and oid.startswith("o_")) or oid in used_ids:
                oid = new_id("o")
            used_ids.add(oid)
            options.append({"id": oid, "label": label})
        q["options"] = options[:MAX_OPTIONS]
        q["other"] = bool(raw.get("other")) and qtype != "dropdown"
        if not options:
            return q, f"Câu \"{title}\" chưa có lựa chọn."
        if qtype == "multi":
            q["min"] = _int(raw.get("min"), 0, len(options), 0)
            q["max"] = _int(raw.get("max"), 0, len(options), 0)
            if q["max"] and q["min"] > q["max"]:
                return q, f"Câu \"{title}\": số lựa chọn tối thiểu lớn hơn tối đa."
    elif qtype == "yes_no":
        # Hai lựa chọn cố định; chọn "Không" thì BẮT BUỘC ghi lý do (nhãn ô lý do staff sửa được).
        q["reason_label"] = _text(raw.get("reason_label"), MAX_OPTION) or DEFAULT_REASON_LABEL
    elif qtype == "short_text":
        q["format"] = raw.get("format") if raw.get("format") in TEXT_FORMATS else "text"
    elif qtype == "number":
        lo, hi = _num(raw.get("min")), _num(raw.get("max"))
        q["min"], q["max"] = lo, hi
        q["integer"] = bool(raw.get("integer"))
        if lo is not None and hi is not None and lo > hi:
            return q, f"Câu \"{title}\": giá trị nhỏ nhất lớn hơn lớn nhất."
    elif qtype == "file":
        q["accept"] = raw.get("accept") if raw.get("accept") in FILE_ACCEPT else "any"
        q["max_files"] = _int(raw.get("max_files"), 1, MAX_FILES, 1)
    return q, None


def clean_schema(raw):
    """Form staff gửi lên → (form đã chuẩn hoá, [lỗi]). Lỗi ⇒ không lưu."""
    raw = raw if isinstance(raw, dict) else {}
    questions, errors, used = [], [], set()
    items = raw.get("questions") or []
    if len(items) > MAX_QUESTIONS:
        errors.append(f"Tối đa {MAX_QUESTIONS} câu hỏi.")
    for i, item in enumerate(items[:MAX_QUESTIONS], start=1):
        q, err = clean_question(item, used)
        if err:
            errors.append(f"Câu {i}: {err}")
        if q:
            questions.append(q)
    return {"profile": clean_profile(raw.get("profile")), "questions": questions}, errors


def questions_of(schema):
    return [q for q in (schema or {}).get("questions") or [] if isinstance(q, dict) and q.get("id")]


def profile_of(schema):
    if not schema or "profile" not in schema:
        return dict(DEFAULT_PROFILE)
    return clean_profile(schema.get("profile"))


# ── SV gửi câu trả lời ───────────────────────────────────────────────────────

def _blank(value):
    return value is None or value == "" or value == []


def clean_answer(q, value, other_text=""):
    """Một câu trả lời → (giá trị lưu, lỗi | None). File kiểm riêng ở Hub (`files` đã lưu).

    `other_text`: chữ lựa chọn "Khác" (chọn một / nhiều) hoặc lý do khi chọn "Không" (Có / Không)."""
    qtype = q.get("type")
    required = q.get("required")
    if qtype == "yes_no":
        v = str(value or "").strip()
        if not v:
            return "", "Vui lòng chọn Có hoặc Không." if required else None
        if v not in YES_NO_LABELS:
            return "", "Lựa chọn không hợp lệ."
        if v == NO and not str(other_text or "").strip():
            return v, f"Vui lòng ghi {(q.get('reason_label') or DEFAULT_REASON_LABEL).lower()}."
        return v, None
    if qtype == "file":
        files = value if isinstance(value, list) else []
        if required and not files:
            return files, "Vui lòng tải file lên."
        if len(files) > q.get("max_files", 1):
            return files, f"Tối đa {q.get('max_files', 1)} file."
        return files, None
    if qtype in ("short_text", "long_text"):
        limit = MAX_SHORT if qtype == "short_text" else MAX_LONG
        text = str(value or "").strip()
        if qtype == "short_text":
            text = re.sub(r"\s+", " ", text)
        if len(text) > limit:
            return text[:limit], f"Tối đa {limit} ký tự."
        if not text:
            return "", "Vui lòng trả lời câu hỏi này." if required else None
        fmt = q.get("format")
        if fmt == "email" and not _EMAIL.match(text):
            return text, "Email không hợp lệ."
        if fmt == "phone":
            digits = re.sub(r"[\s.\-]", "", text)
            if not _PHONE.match(digits):
                return text, "Số điện thoại không hợp lệ."
            text = digits
        return text, None
    if qtype in ("single", "dropdown"):
        ids = {o["id"] for o in q.get("options") or []}
        v = str(value or "").strip()
        if not v:
            return "", "Vui lòng chọn một lựa chọn." if required else None
        if v == OTHER and q.get("other"):
            if not str(other_text or "").strip():
                return v, "Vui lòng ghi rõ lựa chọn Khác."
            return v, None
        if v not in ids:
            return "", "Lựa chọn không hợp lệ."
        return v, None
    if qtype == "multi":
        ids = [o["id"] for o in q.get("options") or []]
        picked = value if isinstance(value, list) else ([value] if value else [])
        allowed = set(ids) | ({OTHER} if q.get("other") else set())
        picked = [v for v in dict.fromkeys(str(x) for x in picked) if v in allowed]
        if not picked:
            return [], "Vui lòng chọn ít nhất một lựa chọn." if required else None
        if OTHER in picked and not str(other_text or "").strip():
            return picked, "Vui lòng ghi rõ lựa chọn Khác."
        lo, hi = q.get("min") or 0, q.get("max") or 0
        if lo and len(picked) < lo:
            return picked, f"Chọn ít nhất {lo} lựa chọn."
        if hi and len(picked) > hi:
            return picked, f"Chọn tối đa {hi} lựa chọn."
        return picked, None
    if qtype == "date":
        v = str(value or "").strip()
        if not v:
            return "", "Vui lòng chọn ngày." if required else None
        try:
            return date.fromisoformat(v).isoformat(), None
        except ValueError:
            return "", "Ngày không hợp lệ."
    if qtype == "number":
        v = str(value if value is not None else "").strip().replace(",", ".")
        if not v:
            return "", "Vui lòng nhập số." if required else None
        if not _NUMBER.match(v):
            return v, "Vui lòng nhập một số."
        n = float(v)
        if q.get("integer") and n != int(n):
            return v, "Vui lòng nhập số nguyên."
        if q.get("min") is not None and n < q["min"]:
            return v, f"Giá trị nhỏ nhất là {_fmt_num(q['min'])}."
        if q.get("max") is not None and n > q["max"]:
            return v, f"Giá trị lớn nhất là {_fmt_num(q['max'])}."
        return v, None
    return None, "Loại câu hỏi không hợp lệ."


def clean_profile_answers(schema, data, defaults):
    """Ô hồ sơ staff cho SV sửa (SĐT / email) → (giá trị lưu, lỗi theo ô). Ô chỉ xem không lưu."""
    profile = profile_of(schema)
    data = data if isinstance(data, dict) else {}
    out, errors = {}, {}
    for f in profile["editable"]:
        v = str((data.get(f) if f in data else defaults.get(f)) or "").strip()
        if f == "phone":
            v = re.sub(r"[\s.\-]", "", v)
            if not v:
                errors[f] = "Vui lòng nhập số điện thoại."
            elif not _PHONE.match(v):
                errors[f] = "Số điện thoại không hợp lệ."
        elif f == "email":
            v = v.lower()
            if not v:
                errors[f] = "Vui lòng nhập email."
            elif not _EMAIL.match(v):
                errors[f] = "Email không hợp lệ."
        out[f] = v[:255]
    return out, errors


def clean_answers(schema, data, files):
    """Toàn bộ câu trả lời (trừ ô hồ sơ) → (answers, lỗi theo id câu hỏi).

    `data`: {id: giá trị, "id:other": chữ}; `files`: {id: [meta file đã lưu]}."""
    data = data if isinstance(data, dict) else {}
    answers, errors = {}, {}
    for q in questions_of(schema):
        qid = q["id"]
        other = data.get(f"{qid}:reason" if q["type"] == "yes_no" else f"{qid}:other", "")
        value = files.get(qid, []) if q["type"] == "file" else data.get(qid)
        cleaned, err = clean_answer(q, value, other)
        if err:
            errors[qid] = err
        if not _blank(cleaned):
            answers[qid] = cleaned
            if q["type"] in ("single", "multi") and OTHER in (cleaned if isinstance(cleaned, list) else [cleaned]):
                answers[f"{qid}:other"] = str(other).strip()[:MAX_SHORT]
            if q["type"] == "yes_no" and cleaned == NO:
                answers[f"{qid}:reason"] = str(other).strip()[:MAX_LONG]
    return answers, errors


# ── Hiển thị ─────────────────────────────────────────────────────────────────

def _fmt_num(n):
    return str(int(n)) if float(n) == int(n) else str(n)


def format_answer(q, answers):
    """Câu trả lời của một câu hỏi → chuỗi đọc được (xem chi tiết, xuất Excel)."""
    value = (answers or {}).get(q["id"])
    if _blank(value):
        return ""
    labels = {o["id"]: o["label"] for o in q.get("options") or []}
    other = (answers or {}).get(f"{q['id']}:other", "")
    qtype = q.get("type")
    if qtype == "yes_no":
        reason = (answers or {}).get(f"{q['id']}:reason", "")
        return f"Không — {reason}" if value == NO and reason else YES_NO_LABELS.get(value, str(value))
    if qtype in ("single", "dropdown"):
        return f"Khác: {other}" if value == OTHER else labels.get(value, "(lựa chọn đã xoá)")
    if qtype == "multi":
        return "; ".join(f"Khác: {other}" if v == OTHER else labels.get(v, "(lựa chọn đã xoá)")
                         for v in value)
    if qtype == "date":
        try:
            return date.fromisoformat(value).strftime("%d/%m/%Y")
        except ValueError:
            return str(value)
    if qtype == "file":
        return "; ".join(f.get("name", "") for f in value if isinstance(f, dict))
    return str(value)
