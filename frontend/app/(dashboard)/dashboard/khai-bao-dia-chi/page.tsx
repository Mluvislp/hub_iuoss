'use client';

import DeclarationPage from '../khai-bao-ngoai-tru/DeclarationPage';

/* Khai báo địa chỉ toàn trường — thay Khai báo ngoại trú. Cùng dữ liệu và cùng khoá
   "đã khai"; tạm trú có 3 lựa chọn (xem DeclarationForm.tsx, variant 'address'). */
export default function AddressDeclarationPage() {
  return <DeclarationPage variant="address" />;
}
