"""Helpers để đọc/ghi hub student session — không dùng Django auth."""

SESSION_KEY = "hub_student"


def set_student_session(request, *, ldap_uid, student_id, student_code, full_name):
    request.session[SESSION_KEY] = {
        "ldap_uid": ldap_uid,
        "student_id": student_id,
        "student_code": student_code,
        "full_name": full_name,
    }
    request.session.cycle_key()


def get_student_session(request) -> dict | None:
    return request.session.get(SESSION_KEY)


def clear_student_session(request):
    request.session.pop(SESSION_KEY, None)
    request.session.cycle_key()


def current_student(request) -> dict | None:
    return get_student_session(request)
