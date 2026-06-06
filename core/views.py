from django.contrib import messages
from django.shortcuts import redirect, render
from django.utils import timezone
from django.views.decorators.http import require_http_methods

from students.models import Student
from .auth import verify_ldap
from .decorators import hub_login_required
from .models import HubStudent
from .session import clear_student_session, set_student_session, current_student


@require_http_methods(["GET", "POST"])
def login_view(request):
    if current_student(request):
        return redirect("core:home")

    if request.method == "GET":
        return render(request, "core/login.html", {"next": request.GET.get("next", "/")})

    uid = request.POST.get("uid", "").strip()
    password = request.POST.get("password", "")
    next_url = request.POST.get("next", "/")

    if not uid or not password:
        messages.error(request, "Vui lòng nhập đầy đủ tài khoản và mật khẩu.")
        return render(request, "core/login.html", {"next": next_url})

    ldap_info = verify_ldap(uid, password)
    if ldap_info is None:
        messages.error(request, "Tài khoản hoặc mật khẩu không đúng.")
        return render(request, "core/login.html", {"uid": uid, "next": next_url})

    # Tìm student record trong DB theo uid (thường uid = MSSV)
    student = Student.objects.filter(
        current_student_code__iexact=uid
    ).first()

    # Tạo/cập nhật hub_students
    hub_student, _ = HubStudent.objects.get_or_create(ldap_uid=uid)
    hub_student.last_login_at = timezone.now()
    hub_student.login_count = (hub_student.login_count or 0) + 1
    if student:
        hub_student.student_id = student.pk
    hub_student.save(update_fields=["last_login_at", "login_count", "student_id"])

    set_student_session(
        request,
        ldap_uid=uid,
        student_id=student.pk if student else None,
        student_code=student.current_student_code if student else uid,
        full_name=student.full_name if student else ldap_info.get("display_name", uid),
    )

    return redirect(next_url if next_url.startswith("/") else "/")


def logout_view(request):
    clear_student_session(request)
    return redirect("core:login")


@hub_login_required
def home_view(request):
    student_session = current_student(request)
    student = None
    if student_session.get("student_id"):
        student = Student.objects.select_related(
            "current_department",
            "current_degree_level",
            "current_status",
        ).filter(pk=student_session["student_id"]).first()

    return render(request, "core/home.html", {
        "student": student,
        "student_session": student_session,
    })
