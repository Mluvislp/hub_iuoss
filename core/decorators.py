from functools import wraps
from django.conf import settings
from django.shortcuts import redirect
from .session import get_student_session


def hub_login_required(view_func):
    """Thay thế @login_required của Django cho student hub."""
    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        if not get_student_session(request):
            login_url = getattr(settings, "HUB_LOGIN_URL", "/login/")
            return redirect(f"{login_url}?next={request.path}")
        return view_func(request, *args, **kwargs)
    return wrapper
