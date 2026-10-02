from datetime import datetime, timedelta, timezone as dt_timezone
from types import SimpleNamespace
from unittest import mock

from django.test import SimpleTestCase

from core.api.views import _coverage_dates, _insurance_config_error, _insurance_config_status
from core.insurance_editing import closes_at


class InsurancePeriodLogicTests(SimpleTestCase):
    def _config(self, *, active, opens, closes, graduate_closes=None):
        return SimpleNamespace(
            is_active=active,
            registration_opens_at=opens,
            registration_closes_at=closes,
            graduate_closes_at=graduate_closes,
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


GRADUATE = SimpleNamespace(current_degree_level=SimpleNamespace(code="MASTER"))
UNDERGRAD = SimpleNamespace(current_degree_level=SimpleNamespace(code="BACHELOR"))


class GraduateDeadlineTests(SimpleTestCase):
    """Học viên cao học đóng theo graduate_closes_at; sinh viên đại học không đổi."""

    def setUp(self):
        self.now = datetime.now(dt_timezone.utc)
        self.cfg = SimpleNamespace(
            is_active=True,
            registration_opens_at=self.now - timedelta(days=10),
            registration_closes_at=self.now + timedelta(days=5),
            graduate_closes_at=self.now - timedelta(hours=1),
        )

    def test_graduate_uses_own_deadline(self):
        self.assertEqual(closes_at(self.cfg, GRADUATE), self.cfg.graduate_closes_at)
        self.assertEqual(_insurance_config_status(self.cfg, self.now, GRADUATE), "expired")
        self.assertTrue(_insurance_config_error(self.cfg, GRADUATE))

    def test_undergraduate_and_anonymous_keep_shared_deadline(self):
        for student in (UNDERGRAD, None):
            self.assertEqual(closes_at(self.cfg, student), self.cfg.registration_closes_at)
            self.assertEqual(_insurance_config_status(self.cfg, self.now, student), "open")
            self.assertEqual(_insurance_config_error(self.cfg, student), "")

    def test_graduate_deadline_may_be_later_than_shared_one(self):
        self.cfg.registration_closes_at = self.now - timedelta(days=1)
        self.cfg.graduate_closes_at = self.now + timedelta(days=1)
        self.assertEqual(_insurance_config_status(self.cfg, self.now, GRADUATE), "open")
        self.assertEqual(_insurance_config_status(self.cfg, self.now, UNDERGRAD), "expired")

    def test_graduate_falls_back_when_staff_left_it_blank(self):
        self.cfg.graduate_closes_at = None
        self.assertEqual(closes_at(self.cfg, GRADUATE), self.cfg.registration_closes_at)

    def test_edit_window_closes_with_graduate_deadline(self):
        from core import insurance_editing
        with mock.patch.object(insurance_editing.HealthInsuranceConfig, "objects") as objects:
            objects.filter.return_value.first.return_value = self.cfg
            self.assertFalse(insurance_editing.window(2026, "Q4", None, GRADUATE)["can_edit"])
            self.assertTrue(insurance_editing.window(2026, "Q4", None, UNDERGRAD)["can_edit"])


class GraduateEmailDomainTests(SimpleTestCase):
    """Học viên cao học đăng nhập Microsoft bằng @mp.hcmiu.edu.vn; @hcmiu.edu.vn bị chặn."""

    def _extract(self, email, code="MTESTIU99001"):
        from core import microsoft_auth
        with mock.patch("core.login_policy.find_graduate_code_by_email", return_value=code) as lookup:
            try:
                return microsoft_auth.extract_student_code({"upn": email}), lookup
            except microsoft_auth.MicrosoftAuthError:
                return None, lookup

    def test_graduate_domain_maps_to_profile(self):
        code, lookup = self._extract("hocvien@mp.hcmiu.edu.vn")
        self.assertEqual(code, "MTESTIU99001")
        lookup.assert_called_once_with("hocvien@mp.hcmiu.edu.vn")

    def test_staff_domain_is_rejected_without_lookup(self):
        code, lookup = self._extract("canbo@hcmiu.edu.vn")
        self.assertIsNone(code)
        lookup.assert_not_called()

    def test_graduate_domain_without_profile_is_rejected(self):
        code, _ = self._extract("nguoila@mp.hcmiu.edu.vn", code=None)
        self.assertIsNone(code)

    def test_undergraduate_domain_unchanged(self):
        code, lookup = self._extract("fafbiu24144@student.hcmiu.edu.vn")
        self.assertEqual(code, "FAFBIU24144")
        lookup.assert_not_called()
