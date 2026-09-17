from django.conf import settings
from django.conf.urls.static import static
from django.urls import path, include, re_path
from django.http import Http404


def private_insurance_media(request, *args, **kwargs):
    # Raw storage URLs must never bypass the authenticated evidence endpoints.
    raise Http404

# Backend chỉ phục vụ API. Giao diện do Next.js (:3000) đảm nhiệm — bản render
# bằng template Django đã được gỡ bỏ, xem docs/AUTH_FLOW.md.
urlpatterns = [
    re_path(r'^media/(insurance_private|insurance_data)/', private_insurance_media),
    path("api/", include("core.api.urls")),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
