"""Link rút gọn hub.iuoss.com/<slug> — bảng của Dashboard; imported by models.py for Django discovery.

Schema: dashboard_iuoss/docs/sql/20261125_short_links.sql. Bản đối ứng: dashboard_iuoss/shortlinks/models.py.
Hub chỉ ĐỌC + tăng `click_count` / `last_clicked_at`. Nghiệp vụ: dashboard_iuoss/docs/SHORT_LINKS.md.
"""
from django.db import models


class ShortLink(models.Model):
    id = models.BigAutoField(primary_key=True)
    slug = models.CharField(max_length=64)
    target_url = models.CharField(max_length=1000)
    title = models.CharField(max_length=255, null=True, blank=True)
    event_id = models.BigIntegerField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    click_count = models.PositiveIntegerField(default=0)
    last_clicked_at = models.DateTimeField(null=True, blank=True)
    created_by_id = models.IntegerField()
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'short_links'
