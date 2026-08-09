import logging
from django.conf import settings
from django.contrib import messages
from django.http import Http404
from django.shortcuts import redirect, render
from django.utils import timezone
from django.views.decorators.http import require_http_methods

from students.models import Student, HealthInsuranceCard, CivicActivity
from .auth import verify_ldap
from .decorators import hub_login_required
from .login_policy import check_login
from .models import HubStudent, ConfirmationRequest
from .session import clear_student_session, set_student_session, current_student

logger = logging.getLogger(__name__)


def _get_ip(request):
    return request.META.get("HTTP_X_FORWARDED_FOR", request.META.get("REMOTE_ADDR", "-")).split(",")[0].strip()


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

    ip = _get_ip(request)
    logger.info("LOGIN_ATTEMPT     | uid=%-20s | ip=%s", uid, ip)

    if verify_ldap(uid, password) is None:
        logger.warning("LOGIN_FAIL        | uid=%-20s | ip=%s", uid, ip)
        messages.error(request, "Tài khoản hoặc mật khẩu không đúng.")
        return render(request, "core/login.html", {"uid": uid, "next": next_url})

    # Mật khẩu đúng nhưng chưa chắc được vào — xem core/login_policy.py.
    decision = check_login(uid)
    if not decision.allowed:
        logger.warning(
            "LOGIN_DENIED      | uid=%-20s | reason=%-18s | ip=%s",
            uid, decision.reason, ip,
        )
        messages.error(request, decision.message)
        return render(request, "core/login.html", {"uid": uid, "next": next_url})

    student = decision.student

    # Tạo/cập nhật hub_students
    hub_student, _ = HubStudent.objects.get_or_create(ldap_uid=uid)
    hub_student.last_login_at = timezone.now()
    hub_student.login_count = (hub_student.login_count or 0) + 1
    hub_student.student_id = student.pk
    hub_student.save(update_fields=["last_login_at", "login_count", "student_id"])

    set_student_session(
        request,
        ldap_uid=uid,
        student_id=student.pk,
        student_code=student.current_student_code,
        full_name=student.full_name,
    )

    logger.info(
        "LOGIN_SUCCESS     | uid=%-20s | student_id=%-6s | ip=%s",
        uid, student.pk, ip,
    )
    return redirect(next_url if next_url.startswith("/") else "/")


def logout_view(request):
    student_session = current_student(request)
    if student_session:
        logger.info("LOGOUT            | uid=%-20s | ip=%s", student_session.get("ldap_uid", "-"), _get_ip(request))
    clear_student_session(request)
    return redirect("core:login")


@hub_login_required
def home_view(request):
    student_session = current_student(request)
    student = None
    health_insurance = None
    civic_activities = []

    if student_session.get("student_id"):
        student = Student.objects.select_related(
            "current_department",
            "current_degree_level",
            "current_status",
        ).filter(pk=student_session["student_id"]).first()

        if student:
            health_insurance = HealthInsuranceCard.objects.filter(
                student=student, is_current=True
            ).first()
            # Cờ tắt (mặc định trên production) → không truy vấn, không hiển thị.
            if settings.FEATURE_CIVIC_ACTIVITIES:
                civic_activities = list(
                    CivicActivity.objects.filter(student=student)
                )

    confirmation_requests = (
        list(ConfirmationRequest.objects.filter(ldap_uid=student_session["ldap_uid"])[:10])
        if settings.FEATURE_DOCUMENT_REQUESTS else []
    )

    return render(request, "core/home.html", {
        "student": student,
        "student_session": student_session,
        "health_insurance": health_insurance,
        "civic_activities": civic_activities,
        "confirmation_requests": confirmation_requests,
    })


@hub_login_required
@require_http_methods(["GET", "POST"])
def confirmation_request_create_view(request):
    if not settings.FEATURE_DOCUMENT_REQUESTS:
        raise Http404("Chức năng yêu cầu giấy tờ đang tạm ngưng.")

    student_session = current_student(request)

    if request.method == "GET":
        return render(request, "core/confirmation_request_form.html", {
            "student_session": student_session,
            "request_types": ConfirmationRequest.REQUEST_TYPES,
        })

    request_type = request.POST.get("request_type", "").strip()
    purpose = request.POST.get("purpose", "").strip()
    note = request.POST.get("note", "").strip()

    valid_types = dict(ConfirmationRequest.REQUEST_TYPES)
    errors = []
    if not request_type or request_type not in valid_types:
        errors.append("Vui lòng chọn loại giấy xác nhận.")
    if not purpose:
        errors.append("Vui lòng nhập mục đích.")

    if errors:
        for e in errors:
            messages.error(request, e)
        return render(request, "core/confirmation_request_form.html", {
            "student_session": student_session,
            "request_types": ConfirmationRequest.REQUEST_TYPES,
            "form_data": request.POST,
        })

    ConfirmationRequest.objects.create(
        student_id=student_session.get("student_id") or 0,
        ldap_uid=student_session["ldap_uid"],
        request_type=request_type,
        purpose=purpose,
        note=note or None,
    )

    logger.info(
        "CONFIRMATION_REQUEST | uid=%-20s | type=%s | purpose=%s",
        student_session["ldap_uid"], request_type, purpose,
    )
    messages.success(request, "Yêu cầu đã được gửi. Phòng CTSV sẽ xử lý trong thời gian sớm nhất.")
    return redirect("core:home")
