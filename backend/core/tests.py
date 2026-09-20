from datetime import datetime, timedelta, timezone as dt_timezone
from types import SimpleNamespace

from django.test import SimpleTestCase

from core.api.views import _coverage_dates, _insurance_config_error, _insurance_config_status


class InsurancePeriodLogicTests(SimpleTestCase):
    def _config(self, *, active, opens, closes):
        return SimpleNamespace(
            is_active=active,
            registration_opens_at=opens,
            registration_closes_at=closes,
        )

    def test_only_active_period_inside_window_is_open(self):
        now = datetime(2026, 9, 16, 12, tzinfo=dt_timezone.utc)
        opens = now - timedelta(days=1)
        closes = now + timedelta(days=1)

        self.assertEqual(
            _insurance_config_status(self._config(active=True, opens=opens, closes=closes), now),
            "open",
        )
        self.assertEqual(
            _insurance_config_status(self._config(active=False, opens=opens, closes=closes), now),
            "upcoming",
        )

    def test_expired_period_stays_expired(self):
        now = datetime(2026, 9, 16, 12, tzinfo=dt_timezone.utc)
        config = self._config(
            active=True,
            opens=now - timedelta(days=2),
            closes=now - timedelta(days=1),
        )
        self.assertEqual(_insurance_config_status(config, now), "expired")

    def test_direct_form_access_requires_active_period_inside_window(self):
        now = datetime.now(dt_timezone.utc)
        inactive = self._config(
            active=False,
            opens=now - timedelta(hours=1),
            closes=now + timedelta(hours=1),
        )
        future = self._config(
            active=True,
            opens=now + timedelta(hours=1),
            closes=now + timedelta(hours=2),
        )
        open_config = self._config(
            active=True,
            opens=now - timedelta(hours=1),
            closes=now + timedelta(hours=1),
        )

        self.assertTrue(_insurance_config_error(inactive))
        self.assertTrue(_insurance_config_error(future))
        self.assertEqual(_insurance_config_error(open_config), "")

    def test_coverage_starts_at_period_quarter_and_ends_at_year_end(self):
        self.assertEqual(tuple(map(str, _coverage_dates("MAIN", 2027))), ("2027-01-01", "2027-12-31"))
        self.assertEqual(tuple(map(str, _coverage_dates("Q2", 2027))), ("2027-04-01", "2027-12-31"))
        self.assertEqual(tuple(map(str, _coverage_dates("Q3", 2027))), ("2027-07-01", "2027-12-31"))
        self.assertEqual(tuple(map(str, _coverage_dates("Q4", 2027))), ("2027-10-01", "2027-12-31"))
