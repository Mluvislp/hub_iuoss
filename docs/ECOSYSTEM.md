# Hệ sinh thái IUOSS — phần của Hub

**Bản chính: [`dashboard_iuoss/docs/ECOSYSTEM.md`](../../dashboard_iuoss/docs/ECOSYSTEM.md)** — quyền sở hữu bảng, luật đổi
schema, danh sách file song sinh. File này chỉ giữ thứ riêng của Hub.

## LDAP dùng chung với WordPress

| Thông số | Giá trị |
|---|---|
| Server | `ldap://ldap.hcmiu.edu.vn:389` |
| Service account | `cn=ctsv,dc=hcmiu,dc=edu,dc=vn` |
| Username attribute | `uid` — thường bằng MSSV |

Dashboard **không** dùng LDAP (Django auth nội bộ); hai app không chung session, cookie khác tên (`hub_sessionid` ↔
`sessionid`). Luồng đăng nhập: [`AUTH_FLOW.md`](AUTH_FLOW.md).

## Hub ghi được vào đâu

Nguyên tắc: Hub chỉ đọc bảng Dashboard sở hữu. Ngoại lệ có chủ ý:
1. **Khai báo địa chỉ / ngoại trú** — SV ghi thẳng `student_addresses`, `student_contact_points`,
   `student_identity_documents` (không duyệt); `hub_profile_change_requests` làm nhật ký. **Thông tin cá nhân** thì chỉ
   tạo dòng chờ duyệt. (`dashboard_iuoss/docs/OFFCAMPUS.md`)
2. **BHYT workflow v2** — cùng ghi append-only 3 bảng event/assessment/evidence ([`INSURANCE.md`](INSURANCE.md)).
3. Bảng của luồng SV tự nộp (khám sức khỏe, bằng THPT, lễ tốt nghiệp, nạp giấy, ticket, `student_images`) và
   `email_messages` (Hub chỉ INSERT, Dashboard gửi).

Chưa có: thông báo chung từ Phòng CTSV, SSO WordPress ↔ Hub.
