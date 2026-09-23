# Hệ sinh thái IUOSS — phần của Hub

**Bản chính: [`dashboard_iuoss/docs/ECOSYSTEM.md`](../../dashboard_iuoss/docs/ECOSYSTEM.md)**
— quyền sở hữu từng bảng, hai luồng dữ liệu chính, luật đổi schema, danh sách file
tồn tại hai bản. Đọc file đó trước.

File này chỉ giữ thứ riêng của Hub. (Trước 23/09/2026 đây là một bản chép 249 dòng đã
lệch hẳn khỏi bản chính và còn bảng roadmap sai hiện trạng.)

## LDAP dùng chung với WordPress

| Thông số | Giá trị |
|---|---|
| Server | `ldap://ldap.hcmiu.edu.vn:389` |
| Service account | `cn=ctsv,dc=hcmiu,dc=edu,dc=vn` |
| Username attribute | `uid` — thường bằng MSSV (vd `ITCSIU24092`) |

**Dashboard KHÔNG dùng LDAP** — nhân viên OSS đăng nhập bằng Django auth nội bộ. Hai
app không bao giờ dùng chung session hay auth backend; cookie cũng khác tên
(`hub_sessionid` ↔ `sessionid`) vì chung domain cha `.iuoss.com`.

Chi tiết luồng đăng nhập, Entra ID, chính sách vào cổng: [`AUTH_FLOW.md`](AUTH_FLOW.md).

## Hub ghi được vào đâu

Nguyên tắc: **Hub chỉ đọc bảng Dashboard sở hữu**, chỉ ghi bảng `hub_*` của mình.
Hai ngoại lệ có chủ ý, đều đã chốt:

1. **Khai báo ngoại trú** — SV ghi thẳng `student_addresses`, `student_contact_points`,
   `student_identity_documents`. CCCD / email cá nhân / SĐT **không cần duyệt**
   (`approval: False`); dòng `hub_profile_change_requests` chỉ đóng vai nhật ký, vì Hub
   không ghi AuditLog. Xem `dashboard_iuoss/docs/OFFCAMPUS.md`.
2. **BHYT workflow v2** — Hub và Dashboard **cùng ghi** vào ba bảng event/assessment/
   evidence theo kiểu append-only. Xem [`INSURANCE.md`](INSURANCE.md).

## Đã ship, đừng ghi là "kế hoạch" nữa

Bảng roadmap cũ liệt kê mấy mục dưới đây là chưa có. Tính tới 23/09/2026 **đã chạy
trên production**: yêu cầu giấy tờ (5 loại) · đăng ký BHYT trực tuyến + duyệt đơn ·
khai BHYT tại nơi khác · khai báo ngoại trú · SV tự sửa CCCD/email/SĐT ·
**trao đổi hai chiều SV ↔ chuyên viên** trên yêu cầu giấy tờ
(`hub_confirmation_request_comments`) · email thông báo tự động.

Còn chưa có: thông báo chung từ phòng CTSV (`hub_announcements`), SSO WordPress ↔ Hub.
