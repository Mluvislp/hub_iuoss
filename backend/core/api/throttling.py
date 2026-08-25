from rest_framework.throttling import ScopedRateThrottle

class HubScopedRateThrottle(ScopedRateThrottle):
    """
    Override ScopedRateThrottle to use ldap_uid instead of request.user.pk
    because our custom StudentPrincipal doesn't have a .pk attribute.
    """
    def get_cache_key(self, request, view):
        if request.user and request.user.is_authenticated:
            ident = getattr(request.user, "ldap_uid", "anonymous")
        else:
            ident = self.get_ident(request)

        return self.cache_format % {
            "scope": self.scope,
            "ident": ident
        }