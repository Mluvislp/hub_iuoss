from django.urls import path
from . import views

urlpatterns = [
    # Health check (no auth) — cho monitor / load balancer
    path("health/",              views.HealthView.as_view(),  name="api_health"),

    # Cờ tính năng (no auth) — frontend đọc để ẩn menu/nút tương ứng
    path("features/",            views.FeaturesView.as_view(), name="api_features"),

    # Auth
    path("auth/login/",          views.LoginView.as_view(),   name="api_login"),
    path("auth/logout/",         views.LogoutView.as_view(),  name="api_logout"),
    path("auth/microsoft/start/",    views.MicrosoftStartView.as_view(),
         name="api_microsoft_start"),
    path("auth/microsoft/callback/", views.MicrosoftCallbackView.as_view(),
         name="api_microsoft_callback"),
    path("auth/token/refresh/",  views.HubTokenRefreshView.as_view(), name="api_token_refresh"),

    # Data
    path("dashboard/",  views.DashboardView.as_view(),  name="api_dashboard"),
    path("health-insurance/", views.HealthInsuranceView.as_view(), name="api_health_insurance"),
    path("health-insurance/registrations/", views.InsuranceRegistrationView.as_view(), name="api_health_insurance_registrations"),
    path("requests/",             views.RequestsView.as_view(),          name="api_requests"),
    path("requests/other/form/",      views.OtherRequestFormView.as_view(),      name="api_other_request_form"),
    path("requests/deferment/form/",   views.DefermentRequestFormView.as_view(),   name="api_deferment_request_form"),
    path("requests/thuong-binh/form/", views.ThuongBinhRequestFormView.as_view(),  name="api_thuongbinh_request_form"),
    path("requests/bank-loan/form/",   views.BankLoanRequestFormView.as_view(),    name="api_bankloan_request_form"),
    path("requests/english/form/",     views.EnglishRequestFormView.as_view(),     name="api_english_request_form"),

    # Khai báo thông tin ngoại trú
    path("offcampus/", views.OffCampusDeclarationView.as_view(), name="api_offcampus"),
    path("offcampus/request-reopen/", views.OffCampusReopenRequestView.as_view(),
         name="api_offcampus_request_reopen"),

    # Danh mục đơn vị hành chính (2025)
    path("locations/provinces/",  views.ProvinceListView.as_view(),  name="api_provinces"),
    path("locations/wards/",      views.WardListView.as_view(),      name="api_wards"),
    path("locations/ethnicities/", views.EthnicityListView.as_view(), name="api_ethnicities"),
    path("hospitals/",            views.HospitalListView.as_view(),  name="api_hospitals"),
]
