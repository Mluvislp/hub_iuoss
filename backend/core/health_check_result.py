"""
Danh mục các trường "Kết quả khám sức khỏe" — SV đã khám nơi khác tự khai lại theo
mẫu `Mau_Ket qua KSK 2026.xlsx` (sheet "Tổng", 116 cột A→DL).

⚠️ BẢN SAO ở `dashboard_iuoss/healthcheck/result_fields.py` — Dashboard dùng để hiển
thị và xuất Excel đúng mẫu. Sửa một bên phải sửa bên kia.

Đây là NGUỒN DUY NHẤT của form: frontend Hub nhận `SCHEMA` qua API rồi dựng từng
bước từ đây, không khai lại trường nào ở TypeScript.

Bỏ khỏi form:
  - Cột hành chính A–J: Dashboard tự điền từ hồ sơ + khai báo ngoại trú lúc xuất
    (Phòng ban → Khoa, Chức vụ → "Sinh viên", Mã nhân viên để trống).
  - Cột CO (phân loại nội khoa tổng) và DJ (phân loại sức khỏe) được TÍNH, không nhập
    tay hoàn toàn — xem `compute()`. Công thức gốc ở cột CO của mẫu bỏ sót hệ Tâm
    thần (CL); ở đây tính đủ 8 hệ.
Thêm ngoài mẫu: ngày khám + nơi khám (cần để chuyên viên đối chiếu minh chứng).
"""
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation

NORMAL = "Bình thường"
ICD_DEFAULT = "Z00.0-Khám sức khỏe tổng quát"
CLASSES = ["I", "II", "III", "IV", "V"]
LAB_SUMMARY = ["Bình thường", "Bất thường", "Không thực hiện"]
URINE_QUALITATIVE = ["neg", "trace", "1+", "2+", "3+", "4+", "pos"]   # mức bán định lượng của que thử


def _f(key, label, type_="text", *, col=None, default="", required=False, unit="",
       min_=None, max_=None, choices=None, placeholder="", hint="", female_default=None):
    return {
        "key": key, "label": label, "type": type_, "col": col, "default": default,
        "required": required, "unit": unit, "min": min_, "max": max_,
        "choices": choices, "placeholder": placeholder, "hint": hint,
        "female_default": female_default,
    }


def _organ(key, label, col_result, col_class):
    """Một dòng khám theo chuyên khoa: kết quả (mặc định Bình thường) + phân loại I–V."""
    return {
        "key": key, "label": label,
        "result": _f(f"{key}_result", label, col=col_result, default=NORMAL, required=True),
        "class": _f(f"{key}_class", "Phân loại", "class", col=col_class, default="I",
                    required=True, choices=CLASSES),
    }


def _lab(key, label, col, unit="", type_="number"):
    return _f(key, label, type_, col=col, unit=unit,
              choices=URINE_QUALITATIVE if type_ == "choice" else None)


# layout: "grid" (ô nhập xếp lưới) · "organ" (bảng: tên | kết quả | phân loại)
SCHEMA = [
    {
        "key": "visit", "title": "Lần khám và thể lực",
        "desc": "Thông tin chung của lần khám và các chỉ số đo được.",
        "groups": [
            {"title": "Lần khám", "layout": "grid", "cols": 2, "fields": [
                _f("exam_date", "Ngày khám", "date", required=True),
                _f("exam_place", "Nơi khám", required=True,
                   placeholder="Trạm Y tế phường…, Bệnh viện…"),
            ]},
            {"title": "Thể lực và sinh hiệu", "layout": "grid", "cols": 3, "fields": [
                _f("height_cm", "Chiều cao", "number", col="BR", required=True, unit="cm", min_=100, max_=230),
                _f("weight_kg", "Cân nặng", "number", col="BS", required=True, unit="kg", min_=25, max_=250),
                _f("bmi", "BMI", "computed", col="BT", hint="Tự tính từ chiều cao và cân nặng"),
                _f("pulse", "Mạch", "number", col="BU", required=True, unit="lần/phút", min_=30, max_=200),
                _f("bp_systolic", "Huyết áp tâm thu", "number", col="BV", required=True, unit="mmHg", min_=60, max_=250),
                _f("bp_diastolic", "Huyết áp tâm trương", "number", required=True, unit="mmHg", min_=30, max_=160),
            ]},
            {"title": "Tiền sử", "layout": "grid", "cols": 2, "fields": [
                _f("history_personal", "Tiền sử bệnh", col="BN", default="Không", required=True),
                _f("history_family", "Tiền sử gia đình", col="BO", default="Không", required=True),
                _f("history_drug_allergy", "Tiền sử dị ứng thuốc", col="BP", default="Không", required=True),
                _f("history_pregnancy", "Tiền sử thai sản", col="BQ", default="Không", required=True),
            ]},
        ],
    },
    {
        "key": "clinical", "title": "Khám lâm sàng",
        "desc": "Đã điền sẵn “Bình thường” và phân loại I — chỉ sửa những mục phiếu khám ghi khác.",
        "groups": [
            {"title": "Nội khoa", "layout": "organ", "organs": [
                _organ("circulation", "Tuần hoàn", "BW", "BX"),
                _organ("respiratory", "Hô hấp", "BY", "BZ"),
                _organ("digestive", "Tiêu hóa", "CA", "CB"),
                _organ("urinary", "Thận - tiết niệu", "CC", "CD"),
                _organ("endocrine", "Nội tiết", "CE", "CF"),
                _organ("musculoskeletal", "Cơ xương khớp", "CG", "CH"),
                _organ("neurology", "Thần kinh", "CI", "CJ"),
                _organ("psychiatry", "Tâm thần", "CK", "CL"),
                _organ("internal", "Kết quả nội chung", "CM", "CN"),
            ]},
            {"title": "Ngoại khoa, sản phụ khoa", "layout": "organ", "organs": [
                _organ("surgery", "Ngoại khoa", "CP", "CQ"),
            ], "fields": [
                _f("obgyn", "Sản phụ khoa", col="CR", default="Không khám", female_default=NORMAL,
                   required=True),
            ]},
            {"title": "Mắt", "layout": "grid", "cols": 4, "fields": [
                _f("eye_left_bare", "Mắt trái không kính", col="CS", default="10/10", placeholder="10/10"),
                _f("eye_left_glasses", "Mắt trái có kính", col="CT", placeholder="Để trống nếu không đeo"),
                _f("eye_right_bare", "Mắt phải không kính", col="CU", default="10/10", placeholder="10/10"),
                _f("eye_right_glasses", "Mắt phải có kính", col="CV", placeholder="Để trống nếu không đeo"),
            ], "organs": [_organ("eye", "Bệnh về mắt", "CW", "CX")]},
            {"title": "Tai - Mũi - Họng", "layout": "grid", "cols": 4, "fields": [
                _f("ear_left_normal", "Tai trái nói thường", "number", col="CY", default="5", unit="m", min_=0, max_=10),
                _f("ear_left_whisper", "Tai trái nói thầm", "number", col="CZ", default="0.5", unit="m", min_=0, max_=10),
                _f("ear_right_normal", "Tai phải nói thường", "number", col="DA", default="5", unit="m", min_=0, max_=10),
                _f("ear_right_whisper", "Tai phải nói thầm", "number", col="DB", default="0.5", unit="m", min_=0, max_=10),
            ], "organs": [_organ("ent", "Bệnh về tai mũi họng", "DC", "DD")]},
            {"title": "Răng - Hàm - Mặt", "layout": "grid", "cols": 2, "fields": [
                _f("jaw_upper", "Hàm trên", col="DF", default=NORMAL, required=True),
                _f("jaw_lower", "Hàm dưới", col="DE", default=NORMAL, required=True),
            ], "organs": [_organ("dental", "Răng hàm mặt", "DG", "DH")]},
        ],
    },
    {
        "key": "lab", "title": "Cận lâm sàng",
        "desc": "Chỉ số chi tiết nhập theo phiếu kết quả; chỉ số phiếu không có thì để trống.",
        "groups": [
            {"title": "Kết quả chung", "layout": "grid", "cols": 3, "fields": [
                _f("lab_blood", "Kết quả xét nghiệm máu", "choice", col="BK", default=NORMAL,
                   required=True, choices=LAB_SUMMARY),
                _f("lab_urine", "Kết quả xét nghiệm nước tiểu", "choice", col="BL", default=NORMAL,
                   required=True, choices=LAB_SUMMARY),
                _f("lab_xray", "Kết quả X-quang phổi", "choice", col="BM", default=NORMAL,
                   required=True, choices=LAB_SUMMARY),
            ]},
            {"title": "Hóa sinh máu", "layout": "grid", "cols": 5, "collapsible": True, "fields": [
                _lab("alt", "ALT (GPT)", "R", "U/L"),
                _lab("ast", "AST (GOT)", "S", "U/L"),
                _lab("creatinine", "Creatinin", "T", "µmol/L"),
                _lab("glucose", "Glucose", "U", "mmol/L"),
                _lab("urea", "Urê", "V", "mmol/L"),
            ]},
            {"title": "Tổng phân tích nước tiểu", "layout": "grid", "cols": 5, "collapsible": True, "fields": [
                _lab("u_blood", "Blood", "W", type_="text"),
                _lab("u_bilirubin", "Bilirubin", "X", type_="choice"),
                _lab("u_glucose", "Glucose", "Y", type_="choice"),
                _lab("u_ketones", "Ketones", "Z", type_="choice"),
                _lab("u_leukocyte", "Leukocyte", "AA", type_="choice"),
                _lab("u_nitrite", "Nitrite", "AB", type_="choice"),
                _lab("u_protein", "Protein", "AC", type_="choice"),
                _lab("u_sg", "SG", "AD"),
                _lab("u_urobilinogen", "Urobilinogen", "AE"),
                _lab("u_ph", "pH", "AF"),
            ]},
            {"title": "Tổng phân tích tế bào máu", "layout": "grid", "cols": 5, "collapsible": True, "fields": [
                _lab("baso", "BASO", "AG"), _lab("baso_pct", "BASO %", "AH"),
                _lab("ch", "CH", "AI"), _lab("chcm", "CHCM", "AJ"),
                _lab("eos", "EOS", "AK"), _lab("eos_pct", "EOS %", "AL"),
                _lab("hct", "HCT", "AM"), _lab("hdw", "HDW", "AN"),
                _lab("hgb", "HGB", "AO"), _lab("ig_pct", "IG%", "AP"),
                _lab("luc", "LUC", "AQ"), _lab("luc_pct", "LUC%", "AR"),
                _lab("lym", "LYM", "AS"), _lab("lym_pct", "LYM %", "AT"),
                _lab("mch", "MCH", "AU"), _lab("mchc", "MCHC", "AV"),
                _lab("mcv", "MCV", "AW"), _lab("mdw", "MDW", "AX"),
                _lab("mono", "MONO", "AY"), _lab("mono_pct", "MONO %", "AZ"),
                _lab("mpv", "MPV", "BA"), _lab("neu", "NEU", "BB"),
                _lab("neu_pct", "NEU %", "BC"), _lab("nrbc", "NRBC#", "BD"),
                _lab("nrbc_pct", "NRBC%", "BE"), _lab("plt", "PLT", "BF"),
                _lab("rbc", "RBC", "BG"), _lab("rdw_cv", "RDW-CV", "BH"),
                _lab("rdw_sd", "RDW-SD", "BI"), _lab("wbc", "WBC", "BJ"),
            ]},
        ],
    },
    {
        "key": "conclusion", "title": "Kết luận và minh chứng",
        "desc": "Phân loại sức khỏe tự tính theo phân loại cao nhất ở các bước trước; sửa nếu phiếu khám ghi khác.",
        "groups": [
            {"title": "Phân loại và kết luận", "layout": "grid", "cols": 2, "fields": [
                _f("physical_class", "Phân loại thể lực", "class", col="DI", default="I",
                   required=True, choices=CLASSES),
                _f("health_class", "Phân loại sức khỏe", "class", col="DJ", default="I",
                   required=True, choices=CLASSES, hint="Tự tính, sửa được"),
                _f("disease_conclusion", "Kết luận bệnh", col="DK", default="Không", required=True),
                _f("recommendations", "Những điều cần giải quyết", col="DL"),
            ]},
            {"title": "Mã kết luận theo chuyên khoa (ICD)", "layout": "grid", "cols": 2, "collapsible": True, "fields": [
                _f("icd_general", "Kết luận chung", col="K", default=ICD_DEFAULT, required=True),
                _f("icd_eye", "Mắt", col="L", default=ICD_DEFAULT, required=True),
                _f("icd_surgery", "Ngoại khoa, Da liễu", col="M", default=ICD_DEFAULT, required=True),
                _f("icd_internal", "Nội khoa", col="N", default=ICD_DEFAULT, required=True),
                _f("icd_dental", "Răng Hàm Mặt", col="O", default=ICD_DEFAULT, required=True),
                _f("icd_obgyn", "Sản phụ khoa", col="P", default=ICD_DEFAULT, required=True),
                _f("icd_ent", "Tai Mũi Họng", col="Q", default=ICD_DEFAULT, required=True),
            ]},
        ],
    },
]

# Phân loại dùng để tính phân loại sức khỏe chung (DJ) = phân loại cao nhất.
INTERNAL_ORGANS = ["circulation", "respiratory", "digestive", "urinary", "endocrine",
                   "musculoskeletal", "neurology", "psychiatry"]
HEALTH_CLASS_SOURCES = ["internal_class", "internal_overall", "surgery_class", "eye_class",
                        "ent_class", "dental_class", "physical_class"]


def iter_fields():
    """Mọi trường nhập (kể cả ô kết quả/phân loại trong dòng chuyên khoa)."""
    for section in SCHEMA:
        for group in section["groups"]:
            for organ in group.get("organs", []):
                yield section["key"], organ["result"]
                yield section["key"], organ["class"]
            for field in group.get("fields", []):
                yield section["key"], field


def _max_class(values):
    ranks = [CLASSES.index(v) for v in values if v in CLASSES]
    return CLASSES[max(ranks)] if ranks else "I"


def compute(result):
    """Các giá trị tính ra — ghi đè giá trị client gửi, không tin client."""
    out = {}
    try:
        h = Decimal(str(result.get("height_cm"))) / 100
        w = Decimal(str(result.get("weight_kg")))
        out["bmi"] = str((w / (h * h)).quantize(Decimal("0.01"))) if h > 0 else ""
    except (InvalidOperation, TypeError, ValueError, ZeroDivisionError):
        out["bmi"] = ""
    out["internal_overall"] = _max_class(result.get(f"{k}_class") for k in INTERNAL_ORGANS)
    out["blood_pressure"] = (
        f"{result.get('bp_systolic')}/ {result.get('bp_diastolic')}"
        if result.get("bp_systolic") and result.get("bp_diastolic") else ""
    )
    return out


def suggested_health_class(result):
    merged = {**result, **compute(result)}
    return _max_class(merged.get(k) for k in HEALTH_CLASS_SOURCES)


def _number(raw):
    text = str(raw).strip().replace(",", ".")
    try:
        return Decimal(text)
    except InvalidOperation:
        return None


def clean(raw, *, today=None):
    """Kiểm + chuẩn hóa. Trả (result, errors) — errors là map key → câu lỗi."""
    today = today or date.today()
    raw = raw if isinstance(raw, dict) else {}
    result, errors = {}, {}
    for _, field in iter_fields():
        key, kind = field["key"], field["type"]
        if kind == "computed":
            continue
        value = raw.get(key)
        value = "" if value is None else str(value).strip()[:255]
        if not value:
            if field["required"]:
                errors[key] = "Không được để trống."
            result[key] = ""
            continue
        if kind == "number":
            num = _number(value)
            if num is None:
                errors[key] = "Phải là số."
            elif field["min"] is not None and not (field["min"] <= num <= field["max"]):
                errors[key] = f"Ngoài khoảng hợp lệ {field['min']}–{field['max']}."
            else:
                value = format(num.normalize(), "f")
        elif kind in ("class", "choice") and field["choices"] and value not in field["choices"]:
            errors[key] = "Giá trị không hợp lệ."
        elif kind == "date":
            try:
                d = datetime.strptime(value, "%Y-%m-%d").date()
            except ValueError:
                errors[key] = "Ngày không hợp lệ."
            else:
                if d > today:
                    errors[key] = "Ngày khám không được ở tương lai."
                elif d < today - timedelta(days=548):
                    errors[key] = "Ngày khám quá 18 tháng trước."
        result[key] = value
    sys_, dia = _number(result.get("bp_systolic") or "x"), _number(result.get("bp_diastolic") or "x")
    if sys_ is not None and dia is not None and "bp_diastolic" not in errors and dia >= sys_:
        errors["bp_diastolic"] = "Huyết áp tâm trương phải thấp hơn tâm thu."
    result.update(compute(result))
    return result, errors


def defaults(female=False):
    """Giá trị mặc định cho form — frontend nạp khi SV mở bước đầu tiên."""
    out = {}
    for _, field in iter_fields():
        if field["type"] == "computed":
            continue
        value = field["default"]
        if female and field["female_default"] is not None:
            value = field["female_default"]
        out[field["key"]] = value
    return out
