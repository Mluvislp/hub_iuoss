"""
Tính niên khóa / thời gian đào tạo cho sinh viên.

Port các hàm thuần từ Dashboard (students/views.py) sang Hub để prefill giá trị
view-only khi SV tạo request giấy xác nhận. Chỉ đọc DB (managed=False models).
"""
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


def format_student_birth_date(student):
    """DOB định dạng dd/mm/yyyy từ students.date_of_birth."""
    if student.date_of_birth:
        return student.date_of_birth.strftime("%d/%m/%Y")
    return ""
