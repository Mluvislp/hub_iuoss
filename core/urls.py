from django.urls import path
from . import views

app_name = "core"

urlpatterns = [
    path("", views.home_view, name="home"),
    path("login/", views.login_view, name="login"),
    path("logout/", views.logout_view, name="logout"),
    path("requests/new/", views.confirmation_request_create_view, name="confirmation_request_create"),
]
