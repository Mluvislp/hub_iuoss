"""LDAP authentication — hoàn toàn tách biệt với Django auth."""
import logging
import ldap3
import ldap3.core.exceptions
from django.conf import settings

logger = logging.getLogger(__name__)


def _ldap_escape(value: str) -> str:
    """Escape ký tự đặc biệt trong LDAP search filter."""
    return (
        value
        .replace("\\", "\\5c")
        .replace("*",  "\\2a")
        .replace("(",  "\\28")
        .replace(")",  "\\29")
        .replace("\0", "\\00")
    )


def verify_ldap(uid: str, password: str) -> dict | None:
    """
    Xác thực uid + password qua LDAP server của trường.

    Trả về dict thông tin user từ LDAP nếu thành công, None nếu thất bại.
    dict keys: uid, mail, display_name
    """
    if not uid or not password:
        return None

    logger.debug("LDAP_START        | uid=%-20s", uid)

    server = ldap3.Server(
        settings.LDAP_SERVER_URI,
        get_info=ldap3.NONE,
        connect_timeout=5,
    )

    # Bước 1 — bind bằng service account để tìm DN của user
    try:
        svc_conn = ldap3.Connection(
            server,
            user=settings.LDAP_BIND_DN,
            password=settings.LDAP_BIND_PASSWORD,
            auto_bind=ldap3.AUTO_BIND_TLS_BEFORE_BIND
            if settings.LDAP_SERVER_URI.startswith("ldaps")
            else ldap3.AUTO_BIND_NO_TLS,
            raise_exceptions=True,
        )
        logger.debug("LDAP_SVC_BIND_OK  | uid=%-20s", uid)
    except ldap3.core.exceptions.LDAPException as e:
        logger.error("LDAP_SVC_BIND_FAIL | uid=%-20s | %s: %s", uid, type(e).__name__, e)
        return None

    search_filter = (
        f"(&({settings.LDAP_USER_ATTR}={_ldap_escape(uid)})"
        "(|(objectClass=person)(objectClass=user)))"
    )
    svc_conn.search(
        search_base=settings.LDAP_SEARCH_BASE,
        search_filter=search_filter,
        search_scope=ldap3.SUBTREE,
        attributes=["uid", "mail", "cn", "displayName"],
    )

    if not svc_conn.entries:
        logger.warning("LDAP_USER_NOTFOUND | uid=%-20s | filter=%s", uid, search_filter)
        svc_conn.unbind()
        return None

    entry = svc_conn.entries[0]
    user_dn = entry.entry_dn
    logger.debug("LDAP_USER_FOUND   | uid=%-20s | dn=%s", uid, user_dn)
    user_attrs = {
        "uid": str(entry.uid) if "uid" in entry else uid,
        "mail": str(entry.mail) if "mail" in entry else None,
        "display_name": (
            str(entry.displayName) if "displayName" in entry
            else str(entry.cn) if "cn" in entry
            else uid
        ),
    }
    svc_conn.unbind()

    # Bước 2 — bind bằng chính user để xác minh password
    try:
        user_conn = ldap3.Connection(
            server,
            user=user_dn,
            password=password,
            raise_exceptions=True,
        )
        user_conn.bind()
        user_conn.unbind()
        logger.info("LDAP_AUTH_OK      | uid=%-20s | dn=%s", uid, user_dn)
        return user_attrs
    except ldap3.core.exceptions.LDAPInvalidCredentialsResult:
        logger.warning("LDAP_WRONG_PASS   | uid=%-20s", uid)
        return None
    except ldap3.core.exceptions.LDAPException as e:
        logger.error("LDAP_AUTH_FAIL    | uid=%-20s | %s: %s", uid, type(e).__name__, e)
        return None
