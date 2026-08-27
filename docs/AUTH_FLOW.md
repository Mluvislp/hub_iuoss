# Authentication Flow — LDAP + Custom Session

## Tổng quan

Hub không dùng `django.contrib.auth`. Toàn bộ authentication được xây từ đầu:

| File | Vai trò |
|---|---|
| `core/auth.py` | Kết nối LDAP, xác minh credentials |
| `core/login_policy.py` | `check_login()` — quyết định ai được phép vào cổng |
| `core/api/views.py` | Endpoint đăng nhập (LDAP + Microsoft), phát JWT |

> Backend **chỉ phục vụ API**. Bản giao diện render bằng template Django (kèm
> session cookie, `core/views.py`, `core/session.py`, `core/decorators.py`) đã được
> **gỡ bỏ hoàn toàn** — giao diện duy nhất là Next.js, xác thực duy nhất là JWT.

---

## Luồng đăng nhập chi tiết

```
[Browser] POST /api/auth/login/ {uid, password}
         │
         ▼
LoginView (core/api/views.py)
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
    │  → Bị chặn: trả 403 + câu giải thích.
    │             KHÔNG phát token, KHÔNG đụng hub_students
    │
    ▼ (được phép)
    │  HubStudent.record_login(): hub_students
    │  (ldap_uid, student_id, last_login_at, last_login_ldap_at, login_count)
    │
    ▼ issue_session() → phát JWT (claim `ldap_uid`)
    │  { access, refresh, student: {…} }
    │
    ▼ Next.js lưu token, chuyển hướng tới `next` hoặc /dashboard
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

Nhật ký đăng nhập, **một dòng cho mỗi sinh viên** (không phải mỗi lần đăng nhập). Tự động tạo/cập nhật mỗi lần login thành công.

```sql
CREATE TABLE hub_students (
    id                  BIGINT      AUTO_INCREMENT PRIMARY KEY,
    ldap_uid            VARCHAR(64) NOT NULL UNIQUE,   -- xem cảnh báo tên cột bên dưới
    student_id          BIGINT      NULL,              -- soft ref → students.id
    last_login_at       DATETIME(6) NULL,              -- lần cuối, kênh nào cũng tính
    last_login_ldap_at  DATETIME(6) NULL,              -- lần cuối qua LDAP
    last_login_ms_at    DATETIME(6) NULL,              -- lần cuối qua Microsoft
    login_count         INT         NOT NULL DEFAULT 0,
    created_at          DATETIME(6) NOT NULL
);
```

> ⚠️ **Tên `ldap_uid` là di sản.** Từ 2026-08-09 nó lưu **MSSV hiện tại**, không phải chuỗi người dùng gõ và không riêng gì LDAP — đăng nhập bằng Microsoft cũng ghi vào đây (MSSV lấy từ tiền tố email, mã cũ đã ánh xạ sang mã mới). Không đổi tên vì model `managed=False`: đổi cột buộc phải ALTER prod trước rồi mới deploy, đắt hơn giá trị thu được.

- Đường ghi **duy nhất** là `HubStudent.record_login()`. Bảng ánh xạ kênh → cột nằm ở `HubStudent._CHANNEL_FIELD`; thêm kênh đăng nhập thứ ba = thêm 1 dòng ở đó + 1 cột.
- `student_id` là **soft reference** (không FK) — hai bảng có thể ở schema khác nhau, và tránh lỗi nếu sinh viên bị xoá khỏi `students`.
- `student_id = NULL` giờ **chỉ còn ở dòng cũ**. Từ khi có `check_login()`, đăng nhập được nghĩa là chắc chắn có hồ sơ sinh viên.
- Có thể tồn tại **dòng mồ côi** từ trước: ai từng đăng nhập bằng MSSV cũ sẽ có một dòng theo mã cũ, và một dòng nữa theo mã mới. Nên khi thống kê hãy đếm `COUNT(DISTINCT student_id)`.

### Câu truy vấn hay dùng

Xem một sinh viên vào lần cuối bằng đường nào:

```sql
SELECT h.ldap_uid, s.full_name, h.last_login_ldap_at, h.last_login_ms_at, h.login_count
FROM hub_students h
LEFT JOIN students s ON s.id = h.student_id
ORDER BY h.last_login_at DESC;
```

Mức độ chuyển sang Microsoft (để biết bao giờ tắt được LDAP):

```sql
SELECT COUNT(*)                                                        AS tong,
       SUM(last_login_ldap_at IS NOT NULL)                             AS tung_dung_ldap,
       SUM(last_login_ms_at   IS NOT NULL)                             AS tung_dung_microsoft,
       SUM(last_login_ms_at IS NOT NULL AND last_login_ldap_at IS NULL) AS chi_dung_microsoft
FROM hub_students;
```

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
| 2 | uid không khớp mã hiện tại nhưng có trong `student_code_history` | `old_code` | **Tuỳ đường đăng nhập** — xem dưới |
| 3 | không tìm thấy hồ sơ sinh viên nào | `no_profile` | **Chặn** — báo liên hệ Phòng CTSV |
| 4 | tìm thấy nhưng `status_group` ∉ `ALLOWED_STATUS_GROUPS` | `status_not_allowed` | **Chặn** — báo kèm tên trạng thái hiện tại |
| 5 | còn lại | — | Cho vào |

**Bước 2 xử lý khác nhau theo đường đăng nhập** (`check_login(uid, follow_old_code=...)`):

| Đường | `follow_old_code` | Gặp mã cũ thì |
|---|---|---|
| LDAP | `False` | **Chặn**, bảo sinh viên gõ lại bằng mã hiện tại |
| Microsoft | `True` | **Tự ánh xạ** sang mã hiện tại rồi cho vào |

Lý do bất đối xứng: với LDAP thì MSSV do sinh viên tự gõ nên sửa được; với Microsoft thì MSSV lấy từ tiền tố email do trường cấp, sinh viên **không** đổi được — chặn ở đó là khoá họ ra ngoài vĩnh viễn. Đo trên dữ liệu thật: 893 sinh viên đang giữ email mang mã cũ (37 người đang học).

```python
ALLOWED_STATUS_GROUPS = frozenset({"ACTIVE", "GRADUATED"})
```

Chỉ **đang học** và **đã tốt nghiệp** được vào (quyết định của Phòng CTSV, 2026-08-09). Bị chặn: `WITHDRAWN` (đã nghỉ học / rút hồ sơ), `SUSPENDED` (tạm dừng / tạm nghỉ), `UNKNOWN` (chưa xác định), và cả hồ sơ không có trạng thái. Đổi chính sách = sửa đúng hằng số này.

**Vì sao bước 2 phải nằm sau LDAP:** thông báo có nêu mã số hiện tại của sinh viên, nên chỉ được trả về cho người đã chứng minh danh tính bằng mật khẩu. Hệ quả: nếu tài khoản LDAP mang mã cũ đã bị xóa thì sinh viên vẫn chỉ thấy "Tài khoản hoặc mật khẩu không đúng" — thông báo "mã đã đổi" không xuất hiện. Muốn hiện cả trong trường hợp đó thì phải tra `student_code_history` ngay cả khi LDAP thất bại, và **không** được nêu mã mới.

`student_code` là UNIQUE trên toàn bảng `student_code_history` nên tra ngược từ mã cũ luôn ra đúng một sinh viên — đã đo trên dữ liệu thật: 0 trường hợp mã cũ trùng mã hiện tại của sinh viên khác.

**Bị chặn thì không để lại dấu vết:** không tạo/cập nhật `hub_students`, không phát token, không tạo session. Chỉ ghi một dòng `LOGIN_DENIED` kèm `reason` vào `logs/auth.log`.

---

## Đăng nhập bằng tài khoản Microsoft (Entra ID)

Đường đăng nhập thứ hai, chạy song song với LDAP — **không thay thế**: 2 sinh viên đang học không có email trường nào, và nếu Entra hỏng thì còn đường vào.

Code: `core/microsoft_auth.py` (giao thức) + `MicrosoftStartView` / `MicrosoftCallbackView` (`core/api/views.py`). Frontend: nút ở `/login` + trang nhận kết quả `app/auth/microsoft/callback/`.

### Luồng

```
[Next.js] bấm "Đăng nhập bằng tài khoản Microsoft"
    │ GET /api/auth/microsoft/start/  → { authorize_url }
    │ (trả URL chứ không 302: fetch sẽ nuốt mất redirect)
    ▼
login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize
    │ response_type=code · scope="openid profile email"
    │ PKCE S256 · nonce · prompt=select_account
    ▼ redirect kèm ?code&state
/auth/microsoft/callback   (trang Next.js, KHÔNG tự giải mã gì)
    │ POST { code, state } → /api/auth/microsoft/callback/
    ▼
[Django] POST /{tenant}/oauth2/v2.0/token  (client_secret + code_verifier)
    │ kiểm id_token: iss · aud · tid · nonce · exp
    │ email → tiền tố → MSSV
    ▼ check_login(mssv, follow_old_code=True)
    ▼ issue_session()  ← dùng chung với đường LDAP
```

### Vì sao đặt ở server chứ không dùng MSAL.js

`client_secret` không bao giờ xuống trình duyệt, nên redirect URI phải đăng ký kiểu **Web**, không phải `spa` — Microsoft từ chối client credentials khi request mang header `Origin`, và ngược lại từ chối redirect URI `spa` khi không có `Origin`. Nếu sau này chuyển sang nhận `id_token` từ phía client thì **bắt buộc** phải kiểm chữ ký qua JWKS; hiện tại không cần vì token do chính server lấy trực tiếp từ endpoint `/token` qua TLS.

### `state` tự chứa, không lưu server

`state` là gói `django.core.signing.dumps({v: code_verifier, n: nonce})`, hết hạn sau 10 phút. Không dùng session/cache vì Gunicorn chạy nhiều worker, mà cache mặc định là LocMemCache theo từng tiến trình — start ở worker này, callback rơi vào worker khác là mất state.

> Đánh đổi đã cân nhắc: gói state chỉ được **ký** chứ không mã hoá, nên `code_verifier` xem được từ trình duyệt. PKCE ở đây vì thế chỉ là lớp phụ; thứ thật sự bảo vệ là `client_secret` phía server, đúng như mọi confidential web app. Bù lại `state` không giả mạo được và tự hết hạn.

### Ánh xạ email → MSSV

Quy ước của trường: tiền tố email = MSSV (`FAFBIU24144@student.hcmiu.edu.vn` → `FAFBIU24144`).

Xét lần lượt `upn` → `preferred_username` → `email`, lấy giá trị **đầu tiên đúng tên miền** `MS_ALLOWED_EMAIL_DOMAIN`. Duyệt nhiều claim vì `preferred_username` có thể là alternate login ID; mọi giá trị vẫn phải qua đúng một phép kiểm tên miền.

> ⚠️ `hcmiu.edu.vn` (nhân viên) và `student.hcmiu.edu.vn` (sinh viên) nằm **cùng một tenant** — kiểm `tid` KHÔNG phân biệt được hai nhóm. Việc lọc theo hậu tố email là bắt buộc, không phải trang trí.

Microsoft khuyến cáo dùng `oid` làm khoá định danh bền vững thay vì email. Ở đây vẫn phải đi qua email vì MSSV là thứ hệ thống của trường sở hữu, còn Entra thì không biết MSSV. Rủi ro được chặn bằng: khoá tenant + khoá tên miền + đo thực tế 0 tiền tố email trùng nhau giữa 2 sinh viên.

### Biến môi trường

| Biến | Ghi chú |
|---|---|
| `MS_TENANT_ID` | `a7380202-eb54-415a-9b66-4d9806cfab42` |
| `MS_CLIENT_ID` | Application (client) ID của app registration |
| `MS_CLIENT_SECRET` | Hết hạn **08/08/2028** — đặt lịch gia hạn, hết hạn là sập đường Microsoft |
| `MS_REDIRECT_URI` | prod `https://hub.iuoss.com/auth/microsoft/callback`, dev `http://localhost:3000/...` |
| `MS_ALLOWED_EMAIL_DOMAIN` | `student.hcmiu.edu.vn` |

Thiếu 3 biến đầu → `settings.MS_LOGIN_ENABLED = False` → endpoint trả 404 và `GET /api/features/` trả `microsoft_login: false` nên frontend ẩn nút. LDAP không bị ảnh hưởng.

---

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
