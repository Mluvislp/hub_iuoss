"""Đăng nhập bằng tài khoản Microsoft (Entra ID) — Authorization Code Flow.

Client secret nằm ở server, **trình duyệt không bao giờ thấy**: trình duyệt chỉ
mang `code` về, Django mới là bên đổi `code` lấy token trực tiếp với Microsoft.
Vì thế redirect URI phải đăng ký kiểu **Web**, không phải `spa` — Microsoft từ
chối client credentials khi request mang header `Origin`.

Module này chỉ lo phần giao thức: dựng URL đăng nhập, đổi code, moi email ra khỏi
id_token. Việc email đó có được vào cổng hay không là của `core/login_policy.py`.
"""
import json
import logging
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
from base64 import urlsafe_b64encode
from hashlib import sha256

import jwt
from django.conf import settings
from django.core import signing

logger = logging.getLogger(__name__)

STATE_SALT = "hub.microsoft.oauth"
STATE_MAX_AGE = 600  # 10 phút — thừa sức cho một lần đăng nhập, đủ ngắn để chống phát lại
SCOPE = "openid profile email"


class MicrosoftAuthError(Exception):
    """Lỗi có thể hiện thẳng cho sinh viên (đã lọc, không lộ chi tiết kỹ thuật)."""


def _authority() -> str:
    return f"https://login.microsoftonline.com/{settings.MS_TENANT_ID}"


def build_authorize_url() -> str:
    """Dựng URL đẩy sinh viên sang trang đăng nhập Microsoft.

    `state` là một gói do chính mình ký (`django.core.signing`) chứa `code_verifier`
    và `nonce`, nên KHÔNG cần lưu gì ở server — quan trọng vì Gunicorn chạy nhiều
    worker, mà cache mặc định là LocMemCache theo từng tiến trình (start ở worker
    này, callback rơi vào worker khác là mất state).

    Đánh đổi đã cân nhắc: gói state đi qua trình duyệt và chỉ được KÝ chứ không mã
    hoá, nên `code_verifier` xem được. PKCE ở đây vì thế chỉ là lớp phụ; thứ thật
    sự bảo vệ là `client_secret` phía server, đúng như mọi confidential web app.
    Bù lại `state` không thể bị giả mạo (sai chữ ký là loại) và tự hết hạn.
    """
    code_verifier = secrets.token_urlsafe(64)
    nonce = secrets.token_urlsafe(16)
    challenge = (
        urlsafe_b64encode(sha256(code_verifier.encode("ascii")).digest())
        .decode("ascii")
        .rstrip("=")
    )
    state = signing.dumps({"v": code_verifier, "n": nonce}, salt=STATE_SALT)

    params = {
        "client_id": settings.MS_CLIENT_ID,
        "response_type": "code",
        "redirect_uri": settings.MS_REDIRECT_URI,
        "response_mode": "query",
        "scope": SCOPE,
        "state": state,
        "nonce": nonce,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        # Luôn hiện màn chọn tài khoản: máy phòng máy dùng chung, không được lẳng
        # lặng đăng nhập bằng tài khoản người trước còn phiên.
        "prompt": "select_account",
    }
    return f"{_authority()}/oauth2/v2.0/authorize?" + urllib.parse.urlencode(params)


def exchange_code(code: str, state: str) -> dict:
    """Đổi `code` lấy id_token, kiểm tra rồi trả về claims đã xác minh.

    Ném `MicrosoftAuthError` với câu tiếng Việt hiển thị được cho mọi trường hợp hỏng.
    """
    try:
        unpacked = signing.loads(state, salt=STATE_SALT, max_age=STATE_MAX_AGE)
    except signing.SignatureExpired:
        raise MicrosoftAuthError(
            "Phiên đăng nhập đã quá hạn. Vui lòng bấm đăng nhập lại."
        ) from None
    except signing.BadSignature:
        raise MicrosoftAuthError(
            "Yêu cầu đăng nhập không hợp lệ. Vui lòng bấm đăng nhập lại."
        ) from None

    token_response = _post_token({
        "client_id": settings.MS_CLIENT_ID,
        "client_secret": settings.MS_CLIENT_SECRET,
        "code": code,
        "redirect_uri": settings.MS_REDIRECT_URI,
        "grant_type": "authorization_code",
        "code_verifier": unpacked["v"],
        "scope": SCOPE,
    })

    id_token = token_response.get("id_token")
    if not id_token:
        logger.error("MS_NO_ID_TOKEN    | keys=%s", sorted(token_response))
        raise MicrosoftAuthError("Microsoft không trả về thông tin tài khoản.")

    return _verify_id_token(id_token, expected_nonce=unpacked["n"])


def extract_student_code(claims: dict) -> str:
    """Lấy MSSV từ email trong claims. Ném MicrosoftAuthError nếu không hợp lệ.

    Quy ước của trường: tiền tố email = MSSV
    (`FAFBIU24144@student.hcmiu.edu.vn` → `FAFBIU24144`).

    Xét lần lượt `upn` → `preferred_username` → `email`, lấy cái ĐẦU TIÊN đúng tên
    miền sinh viên. Duyệt nhiều claim vì `preferred_username` có thể là alternate
    login ID (email khác) — chứ không phải để nới lỏng: giá trị nào cũng phải qua
    đúng một phép kiểm tên miền.
    """
    domain = settings.MS_ALLOWED_EMAIL_DOMAIN.lower()
    seen = []
    for key in ("upn", "preferred_username", "email"):
        value = (claims.get(key) or "").strip().lower()
        if not value:
            continue
        seen.append(value)
        local, sep, host = value.partition("@")
        if sep and host == domain and local:
            return local.upper()

    logger.warning("MS_BAD_DOMAIN     | candidates=%s", seen)
    raise MicrosoftAuthError(
        f"Chỉ chấp nhận email sinh viên (@{settings.MS_ALLOWED_EMAIL_DOMAIN}). "
        "Tài khoản bạn vừa dùng không thuộc nhóm này."
    )


# ── nội bộ ───────────────────────────────────────────────────────────────────

def _post_token(payload: dict) -> dict:
    """POST tới /token của Microsoft. Dùng urllib để khỏi thêm phụ thuộc `requests`."""
    request = urllib.request.Request(
        f"{_authority()}/oauth2/v2.0/token",
        data=urllib.parse.urlencode(payload).encode("utf-8"),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")[:500]
        # error_description của Microsoft chứa mã AADSTS rất hữu ích khi dò lỗi
        # cấu hình (sai redirect URI, secret hết hạn…) — ghi log, đừng cho SV xem.
        logger.error("MS_TOKEN_HTTP_%s  | %s", exc.code, body)
        raise MicrosoftAuthError(
            "Không đổi được mã đăng nhập với Microsoft. Vui lòng thử lại."
        ) from exc
    except urllib.error.URLError as exc:
        logger.error("MS_TOKEN_NET      | %s", exc)
        raise MicrosoftAuthError(
            "Không kết nối được tới Microsoft. Vui lòng thử lại sau."
        ) from exc


def _verify_id_token(id_token: str, *, expected_nonce: str) -> dict:
    """Kiểm id_token rồi trả claims.

    KHÔNG kiểm chữ ký, và đó là chủ ý: token này do chính server lấy trực tiếp từ
    endpoint /token của Microsoft qua TLS, không đi qua trình duyệt, nên kênh
    truyền đã là bằng chứng nguồn gốc. (Nếu sau này chuyển sang nhận id_token từ
    phía client thì BẮT BUỘC phải kiểm chữ ký qua JWKS.)
    Vẫn kiểm đủ iss / aud / tid / nonce / exp vì chúng chống các lỗi khác.
    """
    try:
        claims = jwt.decode(id_token, options={"verify_signature": False})
    except jwt.PyJWTError as exc:
        logger.error("MS_ID_TOKEN_PARSE | %s", exc)
        raise MicrosoftAuthError("Thông tin tài khoản Microsoft không đọc được.") from exc

    expected_iss = f"{_authority()}/v2.0"
    checks = (
        ("iss", claims.get("iss"), expected_iss),
        ("aud", claims.get("aud"), settings.MS_CLIENT_ID),
        ("tid", claims.get("tid"), settings.MS_TENANT_ID),
        ("nonce", claims.get("nonce"), expected_nonce),
    )
    for name, actual, expected in checks:
        if actual != expected:
            logger.warning("MS_CLAIM_MISMATCH | %s: nhan=%r mong doi=%r",
                           name, actual, expected)
            raise MicrosoftAuthError("Thông tin đăng nhập Microsoft không hợp lệ.")

    exp = claims.get("exp")
    if not isinstance(exp, int) or exp < time.time():
        raise MicrosoftAuthError("Thông tin đăng nhập Microsoft đã hết hạn.")

    return claims
