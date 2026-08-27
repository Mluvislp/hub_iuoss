/**
 * Dựng payload VietQR (chuẩn EMVCo QR của Napas) ngay tại trình duyệt.
 *
 * Cố ý KHÔNG dùng dịch vụ sinh ảnh QR bên ngoài (img.vietqr.io và tương tự):
 * nội dung chuyển khoản mang họ tên và MSSV của sinh viên, không gửi sang bên
 * thứ ba. Toàn bộ chuỗi được dựng tại chỗ, thư viện chỉ làm việc vẽ hình.
 */

/** Ngân hàng → mã BIN 6 số của Napas + từ khóa để dò từ tên tự do trong cấu hình. */
export interface BankEntry {
  bin: string;
  name: string;
  keywords: string[];
}

/**
 * ⚠️ Danh sách rút gọn, chỉ gồm các ngân hàng phổ biến. Mã BIN sai nghĩa là tiền
 * đi sai nơi — trước khi dùng thật phải đối chiếu với danh sách BIN do Napas
 * công bố. Màn hình có in mã BIN đã dò ra để nhân viên kiểm bằng mắt.
 */
export const BANKS: BankEntry[] = [
  { bin: '970436', name: 'Vietcombank', keywords: ['vietcombank', 'ngoai thuong', 'vcb'] },
  { bin: '970415', name: 'VietinBank', keywords: ['vietinbank', 'cong thuong', 'ctg', 'icb'] },
  { bin: '970418', name: 'BIDV', keywords: ['bidv', 'dau tu va phat trien'] },
  { bin: '970405', name: 'Agribank', keywords: ['agribank', 'nong nghiep'] },
  { bin: '970407', name: 'Techcombank', keywords: ['techcombank', 'ky thuong', 'tcb'] },
  { bin: '970422', name: 'MB Bank', keywords: ['mbbank', 'mb bank', 'quan doi'] },
  { bin: '970416', name: 'ACB', keywords: ['acb', 'a chau'] },
  { bin: '970432', name: 'VPBank', keywords: ['vpbank', 'viet nam thinh vuong'] },
  { bin: '970403', name: 'Sacombank', keywords: ['sacombank', 'sai gon thuong tin', 'stb'] },
  { bin: '970423', name: 'TPBank', keywords: ['tpbank', 'tien phong'] },
  { bin: '970437', name: 'HDBank', keywords: ['hdbank', 'phat trien tp'] },
  { bin: '970441', name: 'VIB', keywords: ['vib', 'quoc te'] },
  { bin: '970443', name: 'SHB', keywords: ['shb', 'sai gon ha noi'] },
  { bin: '970431', name: 'Eximbank', keywords: ['eximbank', 'xuat nhap khau', 'eib'] },
  { bin: '970426', name: 'MSB', keywords: ['msb', 'hang hai', 'maritime'] },
  { bin: '970448', name: 'OCB', keywords: ['ocb', 'phuong dong'] },
  { bin: '970440', name: 'SeABank', keywords: ['seabank', 'dong nam a'] },
  { bin: '970449', name: 'LPBank', keywords: ['lpbank', 'lienvietpostbank', 'buu dien lien viet'] },
  { bin: '970428', name: 'Nam A Bank', keywords: ['nam a bank', 'namabank'] },
  { bin: '970425', name: 'ABBANK', keywords: ['abbank', 'an binh'] },
  { bin: '970412', name: 'PVcomBank', keywords: ['pvcombank', 'dai chung'] },
  { bin: '970419', name: 'NCB', keywords: ['ncb', 'quoc dan'] },
];

/** Bỏ dấu tiếng Việt và viết hoa — nội dung chuyển khoản có dấu bị nhiều app ngân hàng cắt hỏng. */
export function toAscii(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, (m) => (m === 'đ' ? 'd' : 'D'))
    .replace(/[^\w\s.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Dò ngân hàng từ tên tự do trong `hub_insurance_configs.bank_name`. */
export function findBank(bankName: string | null | undefined): BankEntry | null {
  if (!bankName) return null;
  const hay = toAscii(bankName).toLowerCase();
  return BANKS.find((b) => b.keywords.some((k) => hay.includes(k))) ?? null;
}

/** Một khối TLV: id + độ dài 2 chữ số + giá trị. */
function tlv(id: string, value: string): string {
  return id + String(value.length).padStart(2, '0') + value;
}

/** CRC-16/CCITT-FALSE — chuẩn bắt buộc của trường 63. */
function crc16(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export interface VietQrInput {
  /** Mã BIN 6 số của ngân hàng thụ hưởng. */
  bin: string;
  accountNumber: string;
  /** Số tiền VNĐ. Bỏ trống thì QR là loại tĩnh, người quét tự nhập. */
  amount?: number | null;
  /** Nội dung chuyển khoản. Sẽ được bỏ dấu và cắt còn 99 ký tự. */
  addInfo?: string;
}

/**
 * Trả về chuỗi để vẽ thành QR. Trả `null` khi thiếu dữ liệu bắt buộc —
 * thà không hiện QR còn hơn hiện một mã quét ra sai tài khoản.
 */
export function buildVietQrPayload({ bin, accountNumber, amount, addInfo }: VietQrInput): string | null {
  const acc = (accountNumber || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(bin) || !acc) return null;

  const beneficiary = tlv('00', bin) + tlv('01', acc);
  const merchantAccount =
    tlv('00', 'A000000727') +   // GUID của Napas
    tlv('01', beneficiary) +
    tlv('02', 'QRIBFTTA');      // chuyển khoản tới số tài khoản

  let payload =
    tlv('00', '01') +                             // phiên bản
    tlv('01', amount ? '12' : '11') +              // 12 = có sẵn số tiền
    tlv('38', merchantAccount) +
    tlv('53', '704');                              // VND

  if (amount && amount > 0) payload += tlv('54', String(Math.round(amount)));
  payload += tlv('58', 'VN');

  const info = toAscii(addInfo || '').slice(0, 99);
  if (info) payload += tlv('62', tlv('08', info));

  payload += '6304';
  return payload + crc16(payload);
}
