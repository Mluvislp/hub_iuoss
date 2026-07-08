from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView
from . import views

urlpatterns = [
    # Health check (no auth) — cho monitor / load balancer
    path("health/",              views.HealthView.as_view(),  name="api_health"),

    # Auth
    path("auth/login/",          views.LoginView.as_view(),   name="api_login"),
    path("auth/logout/",         views.LogoutView.as_view(),  name="api_logout"),
    path("auth/token/refresh/",  TokenRefreshView.as_view(),  name="api_token_refresh"),

    # Data
    path("dashboard/",  views.DashboardView.as_view(),  name="api_dashboard"),
    path("requests/",             views.RequestsView.as_view(),          name="api_requests"),
    path("requests/other/form/",      views.OtherRequestFormView.as_view(),      name="api_other_request_form"),
    path("requests/deferment/form/",   views.DefermentRequestFormView.as_view(),   name="api_deferment_request_form"),
    path("requests/thuong-binh/form/", views.ThuongBinhRequestFormView.as_view(),  name="api_thuongbinh_request_form"),
    path("requests/bank-loan/form/",   views.BankLoanRequestFormView.as_view(),    name="api_bankloan_request_form"),

    # Danh mục đơn vị hành chính (2025)
    path("locations/provinces/",  views.ProvinceListView.as_view(),  name="api_provinces"),
    path("locations/wards/",      views.WardListView.as_view(),      name="api_wards"),
]
