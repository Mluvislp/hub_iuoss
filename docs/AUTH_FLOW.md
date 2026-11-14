# Đăng nhập — LDAP + Microsoft, JWT

Hub không dùng `django.contrib.auth`; backend chỉ phục vụ API, xác thực duy nhất là **JWT**.

| File | Vai trò |
|---|---|
| `core/auth.py` | `verify_ldap()` — bind 2 bước, `_ldap_escape()` chống LDAP injection |
| `core/microsoft_auth.py` | giao thức Entra ID |
| `core/login_policy.py` | `check_login()` — **một chỗ duy nhất** quyết ai được vào cổng (cả LDAP lẫn Microsoft, cả refresh) |
| `core/api/views.py` | `LoginView` · `MicrosoftStartView/CallbackView` · `HubTokenRefreshView` · `issue_session()` |
| `core/api/authentication.py` | `IsHubAuthenticated`, `BHYT_ONLY_URL_NAMES` |

Lễ tốt nghiệp có phiên riêng (`GraduationToken`) — `dashboard_iuoss/docs/GRADUATION.md`.

## Luồng LDAP

```
POST /api/auth/login/ {uid, password}
 → verify_ldap: bind service account (cn=ctsv,dc=hcmiu,dc=edu,dc=vn) → search (&(uid=?)(|(objectClass=person)(objectClass=user)))
               → bind DN user + password (cần DN đầy đủ, OU khác nhau)
 → check_login(uid)        bị chặn ⇒ 403 + lý do; KHÔNG phát token, KHÔNG ghi hub_students, chỉ log LOGIN_DENIED
 → HubStudent.record_login()
 → issue_session() ⇒ {access, refresh, student}
```

LDAP `ldap://ldap.hcmiu.edu.vn:389`, plain, base `dc=hcmiu,dc=edu,dc=vn`, attribute `uid`.

**Phiên**: access **8 giờ** (= hạn cookie `hub_token`), refresh **7 ngày** qua `POST /api/auth/token/refresh/`
(`HubTokenRefreshView` **gọi lại `check_login()`**; không dùng `TokenRefreshView` của SimpleJWT vì nó tra
`get_user_model()`). Cookie `hub_sessionid` chỉ còn cho `django.contrib.sessions`, không mang danh tính. Đăng xuất
(`POST /api/auth/logout/`) chỉ ghi log; frontend tự xoá token.

**Throttle `login`** có cấu hình nhưng **đang tắt** (comment `throttle_scope` trong `LoginView`); `LocMemCache` ⇒ đếm
theo từng worker.

## Điều kiện vào cổng — `check_login()`

| # | Trường hợp | `reason` | Kết quả |
|---|---|---|---|
| 1 | uid khớp `students.current_student_code` (iexact) | — | xét tiếp |
| 2 | uid là mã cũ trong `student_code_history` | `old_code` | LDAP: **chặn**, bảo gõ mã hiện tại · Microsoft: **tự ánh xạ** sang mã hiện tại (`follow_old_code=True`) |
| 3 | không có hồ sơ | `no_profile` | chặn |
| 4 | `status_group` ∉ `ALLOWED_STATUS_GROUPS` | `status_not_allowed` | chặn, kèm tên trạng thái |

```python
ALLOWED_STATUS_GROUPS = frozenset({"ACTIVE", "SUSPENDED", "GRADUATED"})
```

- Microsoft được ánh xạ mã cũ vì tiền tố email do trường cấp, SV không đổi được.
- Bước 2 nằm **sau** LDAP vì thông báo có nêu mã hiện tại — chỉ trả cho người đã chứng minh danh tính.
- **Học viên cao học** (`current_degree_level` ∈ MASTER/DOCTOR) bỏ qua bước xét trạng thái nhưng phiên **chỉ dùng BHYT**:
  JWT claim `bhyt_only` (tính lại mỗi lần cấp/gia hạn) · backend chỉ cho route trong `BHYT_ONLY_URL_NAMES` (**danh sách
  cho phép** — endpoint mới mặc định bị chặn) · frontend chỉ còn mục BHYT, tắt polling ticket.

## `hub_students` — nhật ký đăng nhập

Một dòng mỗi SV: `ldap_uid` (UNIQUE — **tên di sản**, lưu MSSV hiện tại cho mọi kênh), `student_id` (soft ref),
`last_login_at`, `last_login_ldap_at`, `last_login_ms_at`, `login_count`. Ghi duy nhất qua `HubStudent.record_login()`;
kênh mới = 1 dòng `_CHANNEL_FIELD` + 1 cột. Có thể có dòng mồ côi theo mã cũ ⇒ thống kê dùng `COUNT(DISTINCT student_id)`.

## Microsoft (Entra ID)

Chạy song song LDAP (không thay thế). Frontend: nút ở `/login` + `app/auth/microsoft/callback/`.

```
GET /api/auth/microsoft/start/ → {authorize_url}   (trả URL, không 302 — fetch nuốt redirect)
 → authorize: code + PKCE S256 + nonce + prompt=select_account
 → /auth/microsoft/callback (Next) POST {code, state} → /api/auth/microsoft/callback/
 → Django đổi code lấy token (client_secret + code_verifier), kiểm id_token iss·aud·tid·nonce·exp
 → email → MSSV → check_login(mssv, follow_old_code=True) → issue_session()
```

- Đổi token ở **server** (redirect URI kiểu **Web**, không `spa`); `client_secret` không xuống trình duyệt.
- `state` = `signing.dumps({v: code_verifier, n: nonce})`, 10 phút — không lưu server (nhiều worker + LocMemCache).
- **Email → MSSV**: xét `upn` → `preferred_username` → `email`, lấy giá trị đầu tiên đúng tên miền
  `MS_ALLOWED_EMAIL_DOMAIN` (`student.hcmiu.edu.vn`), tiền tố = MSSV. ⚠️ Nhân viên và SV **cùng tenant** — lọc theo hậu
  tố email là bắt buộc.
- **Học viên cao học** `@mp.hcmiu.edu.vn` (`MS_GRADUATE_EMAIL_DOMAIN`, rỗng = tắt): không tin tiền tố —
  `find_graduate_code_by_email()` chỉ nhận khi tiền tố = MSSV của một học viên, hoặc email trùng `student_contact_points`
  của **đúng một** học viên. Học viên chưa có email này trong hồ sơ thì chưa vào được.

| Biến | Ghi chú |
|---|---|
| `MS_TENANT_ID` · `MS_CLIENT_ID` · `MS_CLIENT_SECRET` | thiếu một ⇒ `MS_LOGIN_ENABLED=False`, endpoint 404, nút ẩn. ⚠️ **Secret hết hạn 08/08/2028** — đặt lịch gia hạn |
| `MS_REDIRECT_URI` | prod `https://hub.iuoss.com/auth/microsoft/callback` |
| `MS_EXTRA_REDIRECT_URIS` | tên miền phụ (graduation…) — phải khai cả ở Azure |
| `MS_ALLOWED_EMAIL_DOMAIN` · `MS_GRADUATE_EMAIL_DOMAIN` | xem trên |

## Dev không có LDAP

Tạm bypass trong `verify_ldap()` khi `settings.DEBUG and password == "devpass"` — **không bao giờ commit**.
