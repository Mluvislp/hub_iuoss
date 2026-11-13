"""Khai báo địa chỉ (/api/address-declaration/) + đóng Khai báo ngoại trú.

Chạy: python manage.py test core.test_address_declaration --settings=config.insurance_test_settings
"""
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from core import address_service as addr
from core import offcampus
from core.api.authentication import StudentPrincipal
from students.models import ProfileChangeRequest, Student, VnProvince, VnWard

HCM_WARD = "26734"
DN_WARD = "20194"


def payload(permanent_ward, permanent_province, **temp):
    return {
        "permanent": {"province_code": permanent_province, "ward_code": permanent_ward,
                      "street": "12 đường Lê Lợi"},
        **temp,
    }


class AddressDeclarationTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        VnProvince.objects.create(code="79", name="Thành phố Hồ Chí Minh", unit_type="Thành phố")
        VnProvince.objects.create(code="48", name="Thành phố Đà Nẵng", unit_type="Thành phố")
        VnWard.objects.create(code=HCM_WARD, name="Phường Linh Xuân", unit_type="Phường",
                              province_code="79")
        VnWard.objects.create(code=DN_WARD, name="Phường Hải Châu", unit_type="Phường",
                              province_code="48")
        cls.student = Student.objects.create(current_student_code="ITITIU20001",
                                             full_name="Nguyễn Văn A", sex="Nam")

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(StudentPrincipal({"ldap_uid": "TEST001",
                                                         "student_id": self.student.pk}))

    def post(self, url, data):
        return self.client.post(url, data, format="json")

    def test_no_temporary_allowed_for_any_permanent(self):
        resp = self.post("/api/address-declaration/",
                         payload(DN_WARD, "48", temporary_none=True, temporary_in_hcmc=None))
        self.assertEqual(resp.status_code, 200, resp.content)
        temp = addr.get_effective(self.student, offcampus.TEMPORARY)
        self.assertTrue(addr.is_declared_empty(temp))
        stamp = ProfileChangeRequest.objects.get(student=self.student,
                                                 target="declaration.offcampus_done")
        self.assertEqual(stamp.source, ProfileChangeRequest.SOURCE_ADDRESS)

    def test_outside_hcmc_cannot_pick_hcmc(self):
        resp = self.post("/api/address-declaration/", payload(
            HCM_WARD, "79", temporary_in_hcmc=False,
            temporary={"province_code": "79", "ward_code": HCM_WARD, "street": "5 đường số 3"}))
        self.assertEqual(resp.status_code, 400)
        self.assertIn("temporary_province", resp.json()["errors"])

    def test_temporary_in_hcmc_forces_province(self):
        resp = self.post("/api/address-declaration/", payload(
            DN_WARD, "48", temporary_in_hcmc=True,
            temporary={"province_code": "48", "ward_code": HCM_WARD, "street": "5 đường số 3"}))
        self.assertEqual(resp.status_code, 200, resp.content)
        temp = addr.get_effective(self.student, offcampus.TEMPORARY)
        self.assertEqual(temp.province_code, "79")

    def test_shared_lock_with_offcampus(self):
        offcampus.submit(self.student, payload(HCM_WARD, "79", temporary_none=True))
        form = self.client.get("/api/address-declaration/").json()
        self.assertTrue(form["locked"])
        resp = self.post("/api/address-declaration/",
                         payload(DN_WARD, "48", temporary_none=True))
        self.assertEqual(resp.status_code, 409)

    def test_reopen_request_via_new_endpoint(self):
        offcampus.submit(self.student, payload(HCM_WARD, "79", temporary_none=True))
        resp = self.post("/api/address-declaration/request-reopen/", {"reason": "đổi chỗ trọ"})
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertTrue(self.client.get("/api/address-declaration/").json()["reopen_requested"])

    def test_offcampus_rule_unchanged_for_health_check(self):
        with self.assertRaises(offcampus.DeclarationError) as ctx:
            offcampus.submit(self.student, payload(DN_WARD, "48", temporary_none=True))
        self.assertIn("temporary_in_hcmc", ctx.exception.errors)

    @override_settings(FEATURE_OFFCAMPUS=False)
    def test_offcampus_api_closed(self):
        self.assertEqual(self.client.get("/api/offcampus/").status_code, 404)
        self.assertFalse(self.client.get("/api/features/").json()["offcampus"])

    @override_settings(FEATURE_OFFCAMPUS=True)
    def test_offcampus_api_reopenable_by_flag(self):
        self.assertEqual(self.client.get("/api/offcampus/").status_code, 200)
