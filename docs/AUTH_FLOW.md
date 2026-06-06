# Authentication Flow — LDAP + Custom Session

## Tổng quan

Hub không dùng `django.contrib.auth`. Toàn bộ authentication được xây từ đầu với 3 thành phần:

| File | Vai trò |
|---|---|
| `core/auth.py` | Kết nối LDAP, xác minh credentials |
| `core/session.py` | Quản lý session sau khi login thành công |
| `core/decorators.py` | Bảo vệ views yêu cầu đăng nhập |

---

## Luồng đăng nhập chi tiết

```
[Browser] POST /login/ {uid, password}
         │
         ▼
login_view (core/views.py)
    │  validate: uid và password không rỗng
    │
    ▼ verify_ldap(uid, password)  ← core/auth.py
    │
    │  Bước 1 — Service account bind
    │  Server: ldap://ldap.hcmiu.edu.vn:389
    │  Bind: cn=ctsv,dc=hcmiu,dc=edu,dc=vn + LDAP_BIND_PASSWORD
    │  Search: (&(uid={uid})(|(objectClass=person)(objectClass=user)))
    │  → Tìm DN của user (vd: uid=BABAWE21603,ou=students,dc=hcmiu,dc=edu,dc=vn)
    │
    │  Bước 2 — User bind (xác minh password)
    │  Bind: {user_dn} + {password nhập vào}
    │  → OK: trả {uid, mail, display_name}
    │  → Fail: trả None → hiện lỗi, dừng
    │
    ▼ (LDAP OK)
    │  Tìm Student trong DB: students.current_student_code = uid
    │  Tạo/update HubStudent: hub_students (ldap_uid, student_id, last_login_at, login_count)
    │
    ▼ set_student_session(request, ...)  ← core/session.py
    │  request.session["hub_student"] = {
    │      ldap_uid, student_id, student_code, full_name
    │  }
    │  session.cycle_key()  ← chống session fixation
    │
    ▼ redirect → next_url hoặc /
```

---

## LDAP Server của trường

| Thông số | Giá trị |
|---|---|
| Server | `ldap://ldap.hcmiu.edu.vn:389` |
| Protocol | OpenLDAP, plain (không TLS) |
| Search base | `dc=hcmiu,dc=edu,dc=vn` |
| Username attribute | `uid` |
| Search filter | `(&(uid=?)(|(objectClass=person)(objectClass=user)))` |
| Service account DN | `cn=ctsv,dc=hcmiu,dc=edu,dc=vn` |

**Lý do dùng 2-bước bind** thay vì bind trực tiếp bằng user:
- Cần tìm **DN đầy đủ** của user trước khi bind (LDAP yêu cầu DN, không chấp nhận `uid` đơn thuần)
- DN có thể thay đổi theo cấu trúc OU: `uid=X,ou=students,...` khác với `uid=X,ou=staff,...`

---

## Security considerations

### LDAP Injection
`_ldap_escape()` trong `core/auth.py` escape 5 ký tự đặc biệt trước khi đưa vào search filter:
```
\ → \5c
* → \2a
( → \28
) → \29
\0 → \00
```

### Session Fixation
`session.cycle_key()` được gọi sau khi set session → session ID mới được cấp sau login, tránh attacker dùng session ID cũ.

### Session Timeout
Cookie `hub_sessionid` tự hết hạn sau **8 giờ** (`SESSION_COOKIE_AGE = 28800`).

### Cookie Security (production)
Khi `DEBUG=False`, `SESSION_COOKIE_SECURE=True` → cookie chỉ gửi qua HTTPS.

---

## Dữ liệu lưu trong session

```python
request.session["hub_student"] = {
    "ldap_uid":     "BABAWE21603",      # uid từ LDAP
    "student_id":   12345,              # PK trong bảng students (None nếu không tìm thấy)
    "student_code": "BABAWE21603",      # current_student_code (hoặc uid nếu không match)
    "full_name":    "Nguyễn Văn A",     # từ DB nếu có, từ LDAP nếu không
}
```

**Lưu ý:** Session này được lưu vào bảng `django_session` (do `django.contrib.sessions` quản lý). Bảng `hub_students` chỉ lưu **lịch sử đăng nhập**, không liên quan tới session.

---

## Bảng `hub_students`

Tự động tạo/cập nhật khi login thành công lần đầu:

```sql
CREATE TABLE hub_students (
    id             BIGINT      AUTO_INCREMENT PRIMARY KEY,
    ldap_uid       VARCHAR(64) NOT NULL UNIQUE,   -- uid từ LDAP
    student_id     BIGINT      NULL,              -- soft ref → students.id
    last_login_at  DATETIME(6) NULL,
    login_count    INT         NOT NULL DEFAULT 0,
    created_at     DATETIME(6) NOT NULL
);
```

- `student_id` là **soft reference** (không có FK constraint) — vì hai bảng có thể ở schema khác nhau và để tránh lỗi nếu sinh viên bị xóa khỏi `students`
- Trường hợp uid LDAP không khớp với `current_student_code` nào → `student_id = NULL`, sinh viên vẫn đăng nhập được nhưng không xem được thông tin hồ sơ

---

## Liên kết LDAP uid ↔ Student

Matching hiện tại: `students.current_student_code__iexact = ldap_uid`

Giả định: `uid` trong LDAP = MSSV của sinh viên (vd: `BABAWE21603`).

Nếu sau này cần matching phức tạp hơn (vd: email, hay MSSV định dạng khác), sửa trong `login_view` tại `core/views.py`:

```python
student = Student.objects.filter(
    current_student_code__iexact=uid
).first()
```

---

## Dev bypass (test không cần LDAP)

Khi phát triển mà không kết nối được LDAP server (không ở trong mạng trường), có thể tạm bypass trong `core/auth.py`:

```python
def verify_ldap(uid: str, password: str) -> dict | None:
    # DEV ONLY — xóa block này trước khi deploy
    if settings.DEBUG and password == "devpass":
        return {"uid": uid, "mail": None, "display_name": uid}
    # ... code thật bên dưới
```

> **Không commit code bypass lên production.**

---

## Đăng xuất

`logout_view` gọi `clear_student_session()`:
1. Xóa key `hub_student` khỏi session
2. `cycle_key()` → session ID mới (session record cũ vẫn tồn tại trong DB nhưng rỗng, sẽ bị dọn dẹp bởi `manage.py clearsessions`)
3. Redirect về `/login/`
