from django.conf import settings


def feature_flags(request):
    """Đưa cờ FEATURE_* vào mọi template Django (bản render cũ).

    Nhờ vậy sidebar ở base.html ẩn/hiện đúng mà không cần view nào truyền tay.
    Bản Next.js đọc cùng nguồn qua GET /api/features/.
    """
    return {
        "feature_document_requests": settings.FEATURE_DOCUMENT_REQUESTS,
        "feature_civic_activities": settings.FEATURE_CIVIC_ACTIVITIES,
    }
