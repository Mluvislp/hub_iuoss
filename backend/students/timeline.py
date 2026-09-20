"""
Tính niên khóa / thời gian đào tạo cho sinh viên.

Port các hàm thuần từ Dashboard (`students/timeline.py`) sang Hub để prefill giá
trị view-only khi SV tạo request giấy xác nhận. Chỉ đọc DB (managed=False models).

⚠️ **Luật tính mốc được chép ở ba nơi, sửa một chỗ phải sửa cả ba:** file này ·
`dashboard_iuoss/students/timeline.py` · app XNVQS2026 (`gxn/fields.py` +
`config/settings.json`). Hai luật dễ sai nhất:

1. **Tháng bắt đầu theo học kỳ nhập học**, không phải luôn tháng 9. Học kỳ là
   chữ số cuối của `term_code` (`20242` = khóa 2024 học kỳ 2).
2. **Ngày ra trường cộng bù một tháng** khi thời lượng không chia hết cho 12;
   mốc đào tạo **tối đa thì không** — cộng thẳng.
"""
from datetime import date

from .models import Major, MajorTrainingDuration

# Học kỳ nhập học → (tháng bắt đầu, số năm cộng thêm). HK1 vào tháng 9 cùng
# năm; HK2/HK3 rơi sang năm dương lịch kế tiếp.
SEMESTER_START = {1: (9, 0), 2: (1, 1), 3: (6, 1)}
CERTAIN_SEMESTER = 1


def infer_major_from_student_code(student_code):
    if not student_code:
        return None
    normalized = student_code.strip().upper()

    major_code = normalized[:4]
    if major_code:
        major = Major.objects.filter(code__iexact=major_code, is_active=True).first()
        if major:
            return major

    for major in Major.objects.filter(is_active=True).order_by("-code"):
        if normalized.startswith(major.code.upper()):
            return major
    return None


def infer_major_for_student(student):
    return infer_major_from_student_code(student.current_student_code)


def admission_start(student):
    """Trả `(entry_year, start_year, start_month, semester)`.

    `entry_year` là KHÓA — dùng tra bảng thời lượng. `start_year/start_month` là
    mốc bắt đầu học thật, dùng để cộng ra ngày ra trường; với HK2/HK3 hai giá trị
    lệch nhau một năm. `semester` là None khi nguồn không mang thông tin học kỳ.
    """
    term = student.admission_term

    if term and term.term_code and term.term_code.isdigit():
        code = int(term.term_code)
        entry_year, semester = code // 10, code % 10
        rule = SEMESTER_START.get(semester)
        if rule is None:
            # Học kỳ lạ (0, 4…): không đoán tháng, nhưng khóa vẫn dùng được.
            return entry_year, None, None, semester
        month, year_offset = rule
        return entry_year, entry_year + year_offset, month, semester

    # Hai nguồn dự phòng chỉ có năm, không có học kỳ.
    if term and term.academic_year:
        year = term.academic_year
        return year, year, SEMESTER_START[CERTAIN_SEMESTER][0], None
    if student.academic_entry_year:
        year = student.academic_entry_year
        return year, year, SEMESTER_START[CERTAIN_SEMESTER][0], None
    return None, None, None, None


def admission_start_year_month(student):
    """Giữ chữ ký cũ `(năm bắt đầu, tháng bắt đầu)` cho code gọi sẵn."""
    _, start_year, start_month, _ = admission_start(student)
    return start_year, start_month


def add_training_duration(start_year, start_month, months):
    """Cộng thẳng số tháng. Dùng cho mốc đào tạo TỐI ĐA."""
    if not start_year or not start_month or months is None:
        return None, None
    zero_based_month = (start_year * 12) + (start_month - 1) + months
    return zero_based_month // 12, (zero_based_month % 12) + 1


def graduation_milestone(start_year, start_month, months):
    """Mốc RA TRƯỜNG đúng tiến độ — cộng bù 1 tháng khi có phần tháng lẻ.

    Phần năm chẵn tính tới đúng tháng kỷ niệm, phần tháng lẻ tính TIẾP SAU tháng
    đó: nhập học 09/2025 + 53 tháng → tròn 4 năm là 09/2029, 5 tháng lẻ là
    10/2029…02/2030 → ra trường 03/2030. Thời lượng tròn năm thì không cộng thêm
    (09/2023 + 48 tháng = 09/2027).

    Nói gọn: **+1 tháng khi và chỉ khi `months % 12 != 0`**. Mốc đào tạo tối đa
    KHÔNG áp luật này.
    """
    if not start_year or not start_month or months is None:
        return None, None
    extra = 1 if months % 12 else 0
    return add_training_duration(start_year, start_month, months + extra)


def resolve_training_duration(major_code, intake_year):
    """Trả (training_months, max_training_months) cho khóa intake_year."""
    if not major_code or not intake_year:
        return None, None
    duration = (
        MajorTrainingDuration.objects
        .filter(major_code__iexact=major_code, effective_from_year__lte=intake_year)
        .order_by("-effective_from_year")
        .first()
    )
    if not duration:
        return None, None
    return duration.training_months, duration.max_training_months


def build_study_timeline(student):
    major = infer_major_for_student(student)
    entry_year, start_year, start_month, _ = admission_start(student)

    training_months = max_training_months = None
    graduation_year = max_year = None
    if major and entry_year:
        training_months, max_training_months = resolve_training_duration(major.code, entry_year)
        graduation_year, _ = graduation_milestone(start_year, start_month, training_months)
        max_year, _ = add_training_duration(start_year, start_month, max_training_months)

    return {
        # Niên khóa lấy KHÓA nhập học, không lấy năm bắt đầu học: sinh viên nhập
        # học học kỳ 2 thuộc khóa 2024 dù tháng bắt đầu rơi sang 01/2025.
        "start_year": entry_year,
        "graduation_year": graduation_year,
        "max_year": max_year,
    }


def course_year_label(student):
    """Niên khóa định dạng 'yyyy-yyyy' (năm nhập học - năm tốt nghiệp dự kiến)."""
    tl = build_study_timeline(student)
    if tl["start_year"] and tl["graduation_year"]:
        return f"{tl['start_year']}-{tl['graduation_year']}"
    return ""


def max_year_label(student):
    """Thời gian đào tạo tối đa định dạng 'yyyy'."""
    tl = build_study_timeline(student)
    return str(tl["max_year"]) if tl["max_year"] else ""


def _mm_yyyy(year, month):
    return f"{month:02d}/{year}" if year and month else ""


def build_timeline_labels(student):
    """Nhãn mm/yyyy: nhập học, tốt nghiệp đúng tiến độ, đào tạo tối đa."""
    major = infer_major_for_student(student)
    entry_year, start_year, start_month, _ = admission_start(student)

    grad_y = grad_m = max_y = max_m = None
    if major and entry_year:
        training_months, max_training_months = resolve_training_duration(major.code, entry_year)
        grad_y, grad_m = graduation_milestone(start_year, start_month, training_months)
        max_y, max_m = add_training_duration(start_year, start_month, max_training_months)

    return {
        "start_label": _mm_yyyy(start_year, start_month),
        "graduation_label": _mm_yyyy(grad_y, grad_m),
        "max_label": _mm_yyyy(max_y, max_m),
    }


def current_academic_year(today=None):
    """(năm bắt đầu, 'yyyy-yyyy'). Năm học tính từ tháng 9."""
    today = today or date.today()
    start = today.year if today.month >= 9 else today.year - 1
    return start, f"{start}-{start + 1}"


def current_semester(today=None):
    """Học kỳ hiện tại: HK1=T9–T1, HK2=T2–T6, HK3(hè)=T7–T8."""
    m = (today or date.today()).month
    if m in (9, 10, 11, 12, 1):
        return 1
    if m in (2, 3, 4, 5, 6):
        return 2
    return 3


def build_academic_progress(student):
    """study_year (năm thứ mấy), current_semester, current_academic_year (theo hôm nay)."""
    entry_year, _, _, _ = admission_start(student)
    cur_start, cur_ay = current_academic_year()
    sem = current_semester()
    study_year = ""
    if entry_year:
        sy = cur_start - entry_year + 1
        study_year = str(sy if sy >= 1 else 1)
    return {
        "study_year": study_year,
        "current_semester": str(sem),
        "current_academic_year": cur_ay,
    }


def build_course_numbers(student):
    """Số năm đào tạo / tối đa (từ số tháng, làm tròn)."""
    major = infer_major_for_student(student)
    entry_year, _, _, _ = admission_start(student)
    training_months = max_training_months = None
    if major and entry_year:
        training_months, max_training_months = resolve_training_duration(major.code, entry_year)

    def years(months):
        return str(round(months / 12)) if months else ""

    def months_(months):
        return str(months) if months else ""

    return {
        "course_year_number": years(training_months),
        "course_month_number": months_(training_months),
        "max_year_number": years(max_training_months),
        "max_month_number": months_(max_training_months),
    }


def format_student_birth_date(student):
    """DOB định dạng dd/mm/yyyy từ students.date_of_birth."""
    if student.date_of_birth:
        return student.date_of_birth.strftime("%d/%m/%Y")
    return ""
