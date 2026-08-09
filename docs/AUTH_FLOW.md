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
    ▼ (LDAP OK — mới chỉ là "đúng người, đúng mật khẩu")
    │
    ▼ check_login(uid)  ← core/login_policy.py
    │  Xét có được vào cổng không (xem mục "Điều kiện được phép vào cổng")
    │  → Bị chặn: API trả 403 + câu giải thích, view Django hiện messages.error
    │             KHÔNG tạo session, KHÔNG đụng hub_students
    │
    ▼ (được phép)
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

Việc tra cứu này nằm trong `check_login()` ở `core/login_policy.py` — **một chỗ duy nhất**, dùng chung cho cả API lẫn view Django cũ. Cần đổi cách matching thì sửa ở đó, đừng sửa trong từng view.

---

## Điều kiện được phép vào cổng

LDAP chỉ trả lời "đúng người, đúng mật khẩu". Việc người đó có được dùng cổng hay không do `core/login_policy.py::check_login()` quyết định, gọi **sau** khi `verify_ldap()` thành công.

Xét theo đúng thứ tự sau:

| # | Trường hợp | `reason` | Kết quả |
|---|---|---|---|
| 1 | uid khớp `students.current_student_code` | — | đi tiếp bước 3 |
| 2 | uid không khớp mã hiện tại nhưng có trong `student_code_history` | `old_code` | **Chặn** — báo mã số đã đổi thành mã nào |
| 3 | không tìm thấy hồ sơ sinh viên nào | `no_profile` | **Chặn** — báo liên hệ Phòng CTSV |
| 4 | tìm thấy nhưng `status_group` ∉ `ALLOWED_STATUS_GROUPS` | `status_not_allowed` | **Chặn** — báo kèm tên trạng thái hiện tại |
| 5 | còn lại | — | Cho vào |

```python
ALLOWED_STATUS_GROUPS = frozenset({"ACTIVE", "GRADUATED"})
```

Chỉ **đang học** và **đã tốt nghiệp** được vào (quyết định của Phòng CTSV, 2026-08-09). Bị chặn: `WITHDRAWN` (đã nghỉ học / rút hồ sơ), `SUSPENDED` (tạm dừng / tạm nghỉ), `UNKNOWN` (chưa xác định), và cả hồ sơ không có trạng thái. Đổi chính sách = sửa đúng hằng số này.

**Vì sao bước 2 phải nằm sau LDAP:** thông báo có nêu mã số hiện tại của sinh viên, nên chỉ được trả về cho người đã chứng minh danh tính bằng mật khẩu. Hệ quả: nếu tài khoản LDAP mang mã cũ đã bị xóa thì sinh viên vẫn chỉ thấy "Tài khoản hoặc mật khẩu không đúng" — thông báo "mã đã đổi" không xuất hiện. Muốn hiện cả trong trường hợp đó thì phải tra `student_code_history` ngay cả khi LDAP thất bại, và **không** được nêu mã mới.

`student_code` là UNIQUE trên toàn bảng `student_code_history` nên tra ngược từ mã cũ luôn ra đúng một sinh viên — đã đo trên dữ liệu thật: 0 trường hợp mã cũ trùng mã hiện tại của sinh viên khác.

**Bị chặn thì không để lại dấu vết:** không tạo/cập nhật `hub_students`, không phát token, không tạo session. Chỉ ghi một dòng `LOGIN_DENIED` kèm `reason` vào `logs/auth.log`.

### Gia hạn phiên cũng bị xét lại

`POST /api/auth/token/refresh/` (`HubTokenRefreshView`) gọi lại `check_login()` trước khi cấp cặp token mới. Không có bước này thì refresh token sống 7 ngày sẽ cho sinh viên vừa bị khóa dùng tiếp gần một tuần.

> View này **không** dùng `TokenRefreshView` của SimpleJWT. Serializer của nó tra `get_user_model().objects.get(id=<claim>)`, mà Hub đặt `USER_ID_CLAIM = "ldap_uid"` và không dùng `django.contrib.auth` — nên bản cũ ném `ValueError: Field 'id' expected a number` với **mọi** refresh token hợp lệ. Lỗi này không lộ ra vì frontend chưa bao giờ gọi endpoint đó (access token 8 giờ, hết hạn thì đăng nhập lại).

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
