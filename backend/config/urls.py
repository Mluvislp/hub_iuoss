from django.urls import path, include

# Backend chỉ phục vụ API. Giao diện do Next.js (:3000) đảm nhiệm — bản render
# bằng template Django đã được gỡ bỏ, xem docs/AUTH_FLOW.md.
urlpatterns = [
    path("api/", include("core.api.urls")),
]
