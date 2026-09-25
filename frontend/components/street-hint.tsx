/**
 * Hướng dẫn nhập ô "Địa chỉ chi tiết" — dùng chung cho mọi form địa chỉ chuẩn
 * 2 cấp (khai báo ngoại trú, giấy hoãn NVQS). Lời văn chỉ viết ở đây.
 */
export const STREET_PLACEHOLDER = 'Ví dụ: 123 Nguyễn Văn Cừ, Khu phố 3';

export function StreetHint() {
  return (
    <ul className="mt-1.5 space-y-0.5 text-[0.75rem] text-muted">
      <li>• Chỉ ghi <b>số nhà, tên đường, thôn/ấp/khu phố</b>.</li>
      <li>• <b>Không</b> nhập lại phường/xã, quận/huyện, tỉnh/thành đã chọn ở trên.</li>
      <li>• Viết hoa chữ cái đầu mỗi từ, <b>không viết tắt</b> (ghi “Khu phố 3”, không ghi “KP.3”).</li>
    </ul>
  );
}
