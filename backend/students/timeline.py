"""
Tính niên khóa / thời gian đào tạo cho sinh viên.

Port các hàm thuần từ Dashboard (students/views.py) sang Hub để prefill giá trị
view-only khi SV tạo request giấy xác nhận. Chỉ đọc DB (managed=False models).
"""
from datetime import date

from .models import Major, MajorTrainingDuration


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


def admission_start_year_month(student):
    term = student.admission_term
    if term and term.term_code and term.term_code.isdigit():
        return int(term.term_code) // 10, 9
    if term and term.academic_year:
        return term.academic_year, 9
    if student.academic_entry_year:
        return student.academic_entry_year, 9
    return None, None


def add_training_duration(start_year, start_month, months):
    if not start_year or not start_month or months is None:
        return None, None
    zero_based_month = (start_year * 12) + (start_month - 1) + months
    return zero_based_month // 12, (zero_based_month % 12) + 1


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
    start_year, start_month = admission_start_year_month(student)

    training_months = max_training_months = None
    graduation_year = max_year = None
    if major and start_year:
        training_months, max_training_months = resolve_training_duration(major.code, start_year)
        graduation_year, _ = add_training_duration(start_year, start_month, training_months)
        max_year, _ = add_training_duration(start_year, start_month, max_training_months)

    return {
        "start_year": start_year,
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
    start_year, start_month = admission_start_year_month(student)

    grad_y = grad_m = max_y = max_m = None
    if major and start_year:
        training_months, max_training_months = resolve_training_duration(major.code, start_year)
        grad_y, grad_m = add_training_duration(start_year, start_month, training_months)
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
    start_year, _ = admission_start_year_month(student)
    cur_start, cur_ay = current_academic_year()
    sem = current_semester()
    study_year = ""
    if start_year:
        sy = cur_start - start_year + 1
        study_year = str(sy if sy >= 1 else 1)
    return {
        "study_year": study_year,
        "current_semester": str(sem),
        "current_academic_year": cur_ay,
    }


def build_course_numbers(student):
    """Số năm đào tạo / tối đa (từ số tháng, làm tròn)."""
    major = infer_major_for_student(student)
    start_year, _ = admission_start_year_month(student)
    training_months = max_training_months = None
    if major and start_year:
        training_months, max_training_months = resolve_training_duration(major.code, start_year)

    def years(months):
        return str(round(months / 12)) if months else ""

    return {
        "course_year_number": years(training_months),
        "max_year_number": years(max_training_months),
    }


def format_student_birth_date(student):
    """DOB định dạng dd/mm/yyyy từ students.date_of_birth."""
    if student.date_of_birth:
        return student.date_of_birth.strftime("%d/%m/%Y")
    return ""
