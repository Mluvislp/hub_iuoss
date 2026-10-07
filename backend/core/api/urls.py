from django.urls import path
from . import health_check_views, ticket_views, views
from .student_image_views import StudentImageFileView, StudentImagesView
from .insurance_views import InsuranceDetailView, InsuranceEvidenceView, InsuranceImageView
from .external_insurance_views import ExternalInsuranceView, ExternalInsuranceImageView
from .hospital_change_views import HospitalChangeView, HospitalChangeImageView
from .personal_info_views import PersonalInfoView

urlpatterns = [
    path('health-insurance/external/<int:pk>/', ExternalInsuranceView.as_view(), name='api_external_insurance_detail'),
    path('health-insurance/external/<int:pk>/images/<str:field>/', ExternalInsuranceImageView.as_view(), name='api_external_insurance_image'),
    path('health-insurance/registrations/<int:pk>/images/<str:field>/', InsuranceImageView.as_view(), name='api_insurance_image'),
    path('health-insurance/external/', ExternalInsuranceView.as_view(), name='api_external_insurance'),
    path('health-insurance/registrations/<int:pk>/', InsuranceDetailView.as_view(), name='api_insurance_detail'),
    path('health-insurance/registrations/<int:pk>/evidence/<int:evidence_id>/', InsuranceEvidenceView.as_view(), name='api_insurance_evidence'),
    path('health-insurance/hospital-change/', HospitalChangeView.as_view(), name='api_hospital_change'),
    path('health-insurance/hospital-change/<int:pk>/', HospitalChangeView.as_view(), name='api_hospital_change_detail'),
    path('health-insurance/hospital-change/<int:pk>/images/<str:field>/', HospitalChangeImageView.as_view(), name='api_hospital_change_image'),
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
    path("requests/availability/", views.RequestAvailabilityView.as_view(), name="api_request_availability"),
    path("requests/<int:pk>/",          views.RequestDetailView.as_view(),   name="api_request_detail"),
    path("requests/<int:pk>/comments/", views.RequestCommentsView.as_view(), name="api_request_comments"),
    path("requests/<int:pk>/soft-copy/", views.RequestSoftCopyView.as_view(), name="api_request_soft_copy"),
    path("requests/other/form/",      views.OtherRequestFormView.as_view(),      name="api_other_request_form"),
    path("requests/deferment/form/",   views.DefermentRequestFormView.as_view(),   name="api_deferment_request_form"),
    path("requests/thuong-binh/form/", views.ThuongBinhRequestFormView.as_view(),  name="api_thuongbinh_request_form"),
    path("requests/bank-loan/form/",   views.BankLoanRequestFormView.as_view(),    name="api_bankloan_request_form"),
    path("requests/english/form/",     views.EnglishRequestFormView.as_view(),     name="api_english_request_form"),
    path("requests/conduct-score/form/", views.ConductScoreRequestFormView.as_view(), name="api_conduct_request_form"),

    # Khai báo thông tin ngoại trú
    path("personal-info/", PersonalInfoView.as_view(), name="api_personal_info"),
    path("offcampus/", views.OffCampusDeclarationView.as_view(), name="api_offcampus"),
    path("offcampus/request-reopen/", views.OffCampusReopenRequestView.as_view(),
         name="api_offcampus_request_reopen"),

    # Khám sức khỏe định kỳ
    path("health-check/", health_check_views.HealthCheckView.as_view(), name="api_health_check"),
    path("health-check/evidence/", health_check_views.HealthCheckEvidenceView.as_view(),
         name="api_health_check_evidence"),
    path("health-check/evidence/<int:index>/", health_check_views.HealthCheckEvidenceFileView.as_view(),
         name="api_health_check_evidence_file"),
    path("health-check/register/", health_check_views.HealthCheckRegisterView.as_view(),
         name="api_health_check_register"),
    path("health-check/citizen-id/", health_check_views.HealthCheckCitizenIdView.as_view(),
         name="api_health_check_citizen_id"),

    # Hỏi đáp (ticket) — core/tickets.py
    path("tickets/",                 ticket_views.TicketsView.as_view(),       name="api_tickets"),
    path("tickets/topics/",          ticket_views.TicketTopicsView.as_view(),  name="api_ticket_topics"),
    path("tickets/unread/",          ticket_views.TicketUnreadView.as_view(),  name="api_ticket_unread"),
    path("tickets/<int:pk>/",        ticket_views.TicketDetailView.as_view(),  name="api_ticket_detail"),
    path("tickets/<int:pk>/messages/", ticket_views.TicketMessagesView.as_view(), name="api_ticket_messages"),
    path("tickets/<int:pk>/close/",  ticket_views.TicketCloseView.as_view(),   name="api_ticket_close"),
    path("tickets/<int:pk>/attachments/<int:att_id>/", ticket_views.TicketAttachmentView.as_view(),
         name="api_ticket_attachment"),

    # Kho ảnh cố định của SV (CCCD, thẻ BHYT, ảnh thẻ, avatar) — core/student_images.py
    path("student-images/",               StudentImagesView.as_view(),    name="api_student_images"),
    path("student-images/<int:pk>/file/", StudentImageFileView.as_view(), name="api_student_image_file"),

    # Danh mục đơn vị hành chính (2025)
    path("locations/provinces/",  views.ProvinceListView.as_view(),  name="api_provinces"),
    path("locations/wards/",      views.WardListView.as_view(),      name="api_wards"),
    path("locations/ethnicities/", views.EthnicityListView.as_view(), name="api_ethnicities"),
    path("hospitals/",            views.HospitalListView.as_view(),  name="api_hospitals"),
]
