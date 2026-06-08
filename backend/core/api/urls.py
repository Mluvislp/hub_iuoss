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
    path("requests/",   views.RequestsView.as_view(),   name="api_requests"),
]
