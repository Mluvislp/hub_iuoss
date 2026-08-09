"""Điều kiện được phép vào cổng — nơi DUY NHẤT giữ chính sách đăng nhập.

Cả API (`core/api/views.py`) lẫn view Django cũ (`core/views.py`) đều gọi
`check_login()`, nên đổi quy định chỉ cần sửa file này, không phải đi lùng từng
view. LDAP chỉ trả lời "đúng người, đúng mật khẩu"; việc người đó có được dùng
cổng hay không do đây quyết định.
"""
import logging

from dataclasses import dataclass

from students.models import Student, StudentCodeHistory

logger = logging.getLogger(__name__)

# Chỉ hai nhóm này được vào cổng (quyết định của Phòng CTSV, 2026-08-09).
# Bị chặn: WITHDRAWN (đã nghỉ học/rút hồ sơ), SUSPENDED (tạm dừng/tạm nghỉ),
# UNKNOWN (chưa xác định), và cả hồ sơ không có trạng thái.
ALLOWED_STATUS_GROUPS = frozenset({"ACTIVE", "GRADUATED"})

# Lý do bị chặn — chỉ dùng cho log, không hiện cho sinh viên.
REASON_OLD_CODE = "old_code"
REASON_NO_PROFILE = "no_profile"
REASON_STATUS = "status_not_allowed"


@dataclass(frozen=True)
class LoginDecision:
    """Kết quả xét duyệt. `student` có thể khác None ngay cả khi bị chặn (chặn vì
    trạng thái) — luôn kiểm tra `allowed`, đừng kiểm tra `student`."""

    student: Student | None = None
    reason: str | None = None
    message: str = ""

    @property
    def allowed(self) -> bool:
        return self.student is not None and self.reason is None


def check_login(uid: str) -> LoginDecision:
    """Xét một uid ĐÃ qua xác thực LDAP có được vào cổng không.

    Gọi SAU khi `verify_ldap()` thành công: thông báo ở đây có tiết lộ mã số hiện
    tại của sinh viên, nên chỉ được trả về cho người đã chứng minh danh tính.
    """
    student = (
        Student.objects
        .select_related("current_status")
        .filter(current_student_code__iexact=uid)
        .first()
    )

    if student is None:
        moved = _find_by_old_code(uid)
        if moved is not None:
            return LoginDecision(
                reason=REASON_OLD_CODE,
                message=(
                    f"Mã số sinh viên {uid} đã được đổi thành "
                    f"{moved.current_student_code}. "
                    f"Vui lòng đăng nhập bằng mã số sinh viên hiện tại."
                ),
            )
        return LoginDecision(
            reason=REASON_NO_PROFILE,
            message=(
                "Tài khoản này chưa gắn với hồ sơ sinh viên nào. "
                "Vui lòng liên hệ Phòng Công tác sinh viên để được hỗ trợ."
            ),
        )

    status_group = student.current_status.status_group if student.current_status else None
    if status_group not in ALLOWED_STATUS_GROUPS:
        status_name = (
            student.current_status.name_vi if student.current_status
            else "chưa xác định"
        )
        return LoginDecision(
            student=student,
            reason=REASON_STATUS,
            message=(
                "Cổng thông tin chỉ dành cho sinh viên đang học hoặc đã tốt nghiệp "
                f"(trạng thái hiện tại: {status_name}). "
                "Vui lòng liên hệ Phòng Công tác sinh viên nếu cần hỗ trợ."
            ),
        )

    return LoginDecision(student=student)


def _find_by_old_code(uid: str) -> Student | None:
    """Tra sinh viên theo mã cũ. None nếu uid không phải mã cũ của ai."""
    row = (
        StudentCodeHistory.objects
        .select_related("student")
        .filter(student_code__iexact=uid)
        .first()
    )
    if row is None:
        return None
    student = row.student
    # Dòng CURRENT cũng nằm trong bảng này. Tới đây nghĩa là tra theo mã hiện tại
    # đã trượt, nên mã trùng nhau là dữ liệu lệch — coi như không tìm thấy còn hơn
    # báo "mã đã đổi thành chính nó".
    if student is None or student.current_student_code.lower() == uid.lower():
        return None
    return student
