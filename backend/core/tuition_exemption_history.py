"""Timeline hồ sơ MGHP phía Hub — bản đối ứng của `dashboard_iuoss/tuition/history.py`.

Giữ CHUNG chữ ký hàm với bản Dashboard (khác import model), như cặp
insurance_history.py. Sửa chữ ký một bên thì sửa cả bên kia.
Mọi hàm ghi CHỈ được gọi khi đang giữ khóa select_for_update() trên đơn cha
(riêng lúc tạo đơn: giữ khóa dòng students).
"""
from django.db.models import Max

from .tuition_exemption_contract import EVENT_LABELS, REASONS, Conflict, request_key
from .tuition_exemption_models import TuitionExemptionEvent

# Event SV được thấy lý do/ghi chú (phản hồi của cán bộ gửi SV). Các event khác chỉ
# hiện nhãn — không lộ tên cán bộ hay ghi chú nội bộ trong payload.
_STUDENT_VISIBLE_REASON = {'SUPPLEMENT_REQUESTED', 'REJECTED', 'CATEGORY_REVIEWED', 'REOPENED'}


def replay(application, key, digest, actor_id, source):
    """True nếu `key` đã được dùng cho ĐÚNG thao tác này (gửi lại do mạng) → bỏ qua;
    Conflict nếu key bị dùng cho nội dung khác."""
    request_key(key)
    event = application.events.filter(request_key=key).first()
    if event is None:
        return False
    if ((event.payload or {}).get('request_digest') != digest or event.actor_id != actor_id
            or event.source_app != source):
        raise Conflict('Request key đã được dùng cho thao tác khác.')
    return True


def check_version(application, value):
    try:
        value = int(value)
    except (TypeError, ValueError):
        raise Conflict('Thiếu phiên bản đơn. Hãy tải lại trang.')
    if value != application.row_version:
        raise Conflict('Đơn đã được cập nhật bởi thao tác khác. Hãy tải lại.')


def append_event(application, kind, *, source, actor_id=None, actor_name='', old=None,
                 new=None, key=None, batch=None, reason_code=None, reason_text=None,
                 payload=None):
    data = dict(payload or {})
    if actor_name:
        data['actor_name'] = actor_name
    number = (application.events.aggregate(n=Max('event_no'))['n'] or 0) + 1
    return TuitionExemptionEvent.objects.create(
        application=application, event_no=number, event_type=kind,
        from_status=old, to_status=new, reason_code=reason_code, reason_text=reason_text,
        actor_type={'Hub': 'student', 'Dashboard': 'staff'}.get(source, 'system'),
        actor_id=actor_id, source_app=source, request_key=key, batch_id=batch, payload=data)


def timeline(application):
    """Danh sách event đã dựng nhãn cho trang trạng thái của SV."""
    items = []
    for event in application.events.order_by('event_no'):
        note = ''
        if event.event_type in _STUDENT_VISIBLE_REASON or event.event_type == 'APPROVED':
            # `detail` do Dashboard ghi sẵn dạng SV đọc được ("DT03: Cần bổ sung", "Đạt: DT01…").
            note = ' — '.join(p for p in ((event.payload or {}).get('detail', ''),
                                          REASONS.get(event.reason_code or '', ''),
                                          event.reason_text or '') if p)
        items.append({
            'kind': event.event_type,
            'label': EVENT_LABELS.get(event.event_type, event.event_type),
            'at': event.created_at.isoformat(),
            'note': note,
        })
    return items
