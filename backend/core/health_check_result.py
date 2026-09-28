"""
Danh mục các trường "Kết quả khám sức khỏe" — SV đã khám nơi khác tự khai lại theo
mẫu `Mau_File ket qua gui PYT_10092025.xlsx` (sheet "KQ_Lâm sàng + Cận lâm sàng",
43 cột A→AQ; dòng 3 là tiêu đề, dòng 6 của file gốc ghi kiểu dữ liệu từng cột).

⚠️ BẢN SAO ở `dashboard_iuoss/healthcheck/result_fields.py` — Dashboard dùng để hiển
thị và xuất Excel đúng mẫu. Sửa một bên phải sửa bên kia.

Đây là NGUỒN DUY NHẤT của form: frontend Hub nhận `SCHEMA` qua API rồi dựng từng
bước từ đây, không khai lại trường nào ở TypeScript.

Hai kiểu phân loại theo đúng ghi chú của mẫu:
  - `CLASSES`       "I".."V"          — Phân loại thể lực (K), Phân loại thị lực (AA)
  - `LOAI_CLASSES`  "Loại I".."Loại V" — 11 mục lâm sàng (L–V), TMH (AB), RHM (AC),
                                         Phân loại sức khỏe (AP)
Cột hành chính A–E (STT, họ tên, CCCD, MSSV, giới tính 0=Nam/1=Nữ) Dashboard tự điền
từ hồ sơ lúc xuất — SV không nhập.
Thêm ngoài mẫu: ngày khám + nơi khám (cần để chuyên viên đối chiếu minh chứng).
"""
import re
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation

ROMANS = ["I", "II", "III", "IV", "V"]
CLASSES = ROMANS
LOAI_CLASSES = [f"Loại {r}" for r in ROMANS]


def _f(key, label, type_="text", *, col=None, default="", required=False, unit="",
       min_=None, max_=None, choices=None, placeholder="", hint="", female_default=None):
    return {
        "key": key, "label": label, "type": type_, "col": col, "default": default,
        "required": required, "unit": unit, "min": min_, "max": max_,
        "choices": choices, "placeholder": placeholder, "hint": hint,
        "female_default": female_default,
    }


def _loai(key, label, col, **kw):
    """Phân loại dạng "Loại I".."Loại V", mặc định Loại I."""
    kw.setdefault("default", "Loại I")
    kw.setdefault("required", True)
    return _f(key, label, "class", col=col, choices=LOAI_CLASSES, **kw)


def _vision(key, label, col, required=False):
    """Thị lực điểm thang 10. Nhận "10/10" hoặc "10" (phiếu ghi kiểu nào nhập kiểu đó),
    lưu và xuất ra điểm — mẫu ghi chú cột W–Z là "điểm thang 10". Không đặt mặc định:
    thị lực phải chép từ phiếu, điền sẵn 10/10 dễ thành số liệu sai."""
    # Ô bắt buộc KHÔNG có chữ gợi ý trong ô — "VD: 10/10" mờ bị đọc nhầm thành giá trị
    # điền sẵn; hướng dẫn nằm ở dòng chú thích bên dưới.
    return _f(key, label, "vision", col=col, min_=0, max_=10, required=required,
              placeholder="" if required else "VD: 10/10",
              hint="Nhập theo phiếu, VD 10/10" if required else "Để trống nếu không đeo kính")


def _lab(key, label, col, unit, max_=None):
    return _f(key, label, "number", col=col, unit=unit, min_=0, max_=max_, required=True)


# layout: "grid" — ô nhập xếp lưới `cols` cột.
SCHEMA = [
    {
        "key": "visit", "title": "Lần khám và thể lực",
        "desc": "Thông tin chung của lần khám và kết quả khám thể lực.",
        "groups": [
            {"title": "Lần khám", "layout": "grid", "cols": 2, "fields": [
                _f("exam_date", "Ngày khám", "date", required=True),
                _f("exam_place", "Nơi khám", required=True,
                   placeholder="Trạm Y tế phường…, Bệnh viện…"),
            ]},
            {"title": "Kết quả khám thể lực", "layout": "grid", "cols": 3, "fields": [
                _f("height_cm", "Chiều cao", "number", col="F", required=True, unit="cm", min_=100, max_=230),
                _f("weight_kg", "Cân nặng", "number", col="G", required=True, unit="kg", min_=25, max_=250),
                _f("bmi", "BMI", "computed", col="H", hint="Tự tính từ chiều cao và cân nặng"),
                _f("pulse", "Nhịp tim", "number", col="I", required=True, unit="lần/phút", min_=30, max_=200),
                _f("blood_pressure", "Huyết áp", "pressure", col="J", required=True, unit="mmHg",
                   placeholder="VD: 110/70"),
                _f("physical_class", "Phân loại thể lực", "class", col="K", default="I",
                   required=True, choices=CLASSES),
            ]},
        ],
    },
    {
        "key": "clinical", "title": "Khám lâm sàng",
        "desc": "Đã chọn sẵn Loại I — chỉ sửa những mục phiếu khám ghi loại khác.",
        "groups": [
            {"title": "Phân loại theo chuyên khoa", "layout": "grid", "cols": 4, "fields": [
                _loai("circulation", "Tuần hoàn", "L"),
                _loai("respiratory", "Hô hấp", "M"),
                _loai("digestive", "Tiêu hóa", "N"),
                _loai("urinary", "Thận - tiết niệu", "O"),
                _loai("endocrine", "Nội tiết", "P"),
                _loai("musculoskeletal", "Cơ - xương - khớp", "Q"),
                _loai("neurology", "Thần kinh", "R"),
                _loai("psychiatry", "Tâm thần", "S"),
                _loai("surgery", "Ngoại khoa", "T"),
                _loai("dermatology", "Da liễu", "U"),
                # Nam: để trống (không khám); nữ: mặc định Loại I.
                _loai("obgyn", "Sản phụ khoa", "V", default="", required=False,
                      female_default="Loại I", hint="Chỉ với nữ"),
                _loai("ent", "Tai - mũi - họng", "AB"),
                _loai("dental", "Răng - hàm - mặt", "AC"),
            ]},
            {"title": "Mắt (thị lực, điểm thang 10)", "layout": "grid", "cols": 5, "fields": [
                _vision("eye_left_bare", "Không kính - mắt trái", "W", required=True),
                _vision("eye_right_bare", "Không kính - mắt phải", "X", required=True),
                _vision("eye_left_glasses", "Có kính - mắt trái", "Y"),
                _vision("eye_right_glasses", "Có kính - mắt phải", "Z"),
                _f("vision_class", "Phân loại thị lực", "class", col="AA", default="I",
                   required=True, choices=CLASSES),
            ]},
        ],
    },
    {
        "key": "lab", "title": "Cận lâm sàng",
        "desc": "Nhập theo phiếu kết quả xét nghiệm. Dùng dấu chấm hoặc dấu phẩy cho số thập phân.",
        "groups": [
            {"title": "Xét nghiệm máu", "layout": "grid", "cols": 4, "fields": [
                _lab("rbc", "Số lượng hồng cầu (RBC)", "AD", "T/L", 20),
                _lab("wbc", "Số lượng bạch cầu (WBC)", "AE", "G/L", 200),
                _lab("plt", "Số lượng tiểu cầu (PLT)", "AF", "G/L", 3000),
                _lab("glucose", "Đường huyết đói", "AG", "mmol/L", 60),
                _lab("urea", "Urê máu", "AH", "mmol/L", 100),
                _lab("creatinine", "Creatinine", "AI", "µmol/L", 3000),
                _lab("ast", "ASAT (GOT)", "AJ", "U/L", 10000),
                _lab("alt", "ALAT (GPT)", "AK", "U/L", 10000),
            ]},
            {"title": "Xét nghiệm nước tiểu", "layout": "grid", "cols": 4, "fields": [
                _lab("u_glucose", "Glucose niệu", "AL", "mmol/L", 200),
                _lab("u_protein", "Protein niệu", "AM", "g/L", 50),
            ]},
            {"title": "Chẩn đoán hình ảnh", "layout": "grid", "cols": 1, "fields": [
                _f("xray", "Chẩn đoán X-quang tim phổi thẳng", col="AN",
                   placeholder="Để trống nếu không chụp"),
            ]},
        ],
    },
    {
        "key": "conclusion", "title": "Kết luận và minh chứng",
        "desc": "Phân loại sức khỏe tự lấy loại cao nhất ở các bước trước; sửa nếu phiếu khám ghi khác.",
        "groups": [
            {"title": "Kết luận", "layout": "grid", "cols": 2, "fields": [
                _loai("health_class", "Phân loại sức khỏe", "AP", hint="Tự tính, sửa được"),
                _f("doctor_conclusion", "Kết luận của bác sĩ", col="AO", required=True,
                   placeholder="Theo phiếu khám"),
                _f("diseases", "Các bệnh, tật (nếu có)", col="AQ",
                   placeholder="Ví dụ: Cận thị. Để trống nếu không có"),
            ]},
        ],
    },
]

# Phân loại sức khỏe gợi ý = loại cao nhất trong MỌI ô phân loại khác.
HEALTH_KEY = "health_class"


def iter_fields():
    """Mọi trường nhập, kèm khóa bước chứa nó."""
    for section in SCHEMA:
        for group in section["groups"]:
            for field in group.get("fields", []):
                yield section["key"], field


def class_rank(value):
    """"Loại III" / "III" → 2; không phải phân loại → -1."""
    roman = str(value or "").replace("Loại", "").strip()
    return ROMANS.index(roman) if roman in ROMANS else -1


def suggested_health_class(result):
    ranks = [class_rank(result.get(f["key"])) for _, f in iter_fields()
             if f["type"] == "class" and f["key"] != HEALTH_KEY]
    return LOAI_CLASSES[max([0, *ranks])]


def compute(result):
    """Các giá trị tính ra — ghi đè giá trị client gửi, không tin client."""
    out = {}
    try:
        h = Decimal(str(result.get("height_cm"))) / 100
        w = Decimal(str(result.get("weight_kg")))
        out["bmi"] = str((w / (h * h)).quantize(Decimal("0.01"))) if h > 0 else ""
    except (InvalidOperation, TypeError, ValueError, ZeroDivisionError):
        out["bmi"] = ""
    return out


_PRESSURE = re.compile(r"^\s*(\d{2,3})\s*/\s*(\d{2,3})\s*(mmhg)?\s*$", re.IGNORECASE)
_VISION = re.compile(r"^\s*(\d{1,2}(?:[.,]\d+)?)\s*(?:/\s*10)?\s*$")


def parse_pressure(value):
    """"110/70", "110 / 70", "110/70 mmHg" → (110, 70); sai dạng → None."""
    m = _PRESSURE.match(str(value or ""))
    return (int(m.group(1)), int(m.group(2))) if m else None


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
        if kind == "pressure":
            bp = parse_pressure(value)
            if bp is None:
                errors[key] = "Nhập theo dạng tâm thu/tâm trương, VD 110/70."
            elif not (60 <= bp[0] <= 250 and 30 <= bp[1] <= 160):
                errors[key] = "Huyết áp ngoài khoảng hợp lệ."
            elif bp[1] >= bp[0]:
                errors[key] = "Số sau (tâm trương) phải nhỏ hơn số trước (tâm thu)."
            else:
                value = f"{bp[0]}/{bp[1]}"
        elif kind == "vision":
            m = _VISION.match(value)
            num = _number(m.group(1)) if m else None
            if num is None or not (0 <= num <= 10):
                errors[key] = "Nhập điểm thang 10, VD 10/10 hoặc 8."
            else:
                value = format(num.normalize(), "f")
        elif kind == "number":
            num = _number(value)
            if num is None:
                errors[key] = "Phải là số."
            elif field["min"] is not None and field["max"] is not None \
                    and not (field["min"] <= num <= field["max"]):
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
