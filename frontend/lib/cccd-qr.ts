/**
 * Đọc mã QR trên ảnh CCCD, ngay tại trình duyệt.
 *
 * Gọi riêng cho từng mặt: CCCD gắn chip in QR ở mặt trước, thẻ Căn cước mẫu mới
 * (từ 01/07/2024) in ở mặt sau — bên gọi thử cả hai.
 *
 * Chỉ trả về CHUỖI thô; việc tách trường do backend làm (core/cccd.py) để một
 * bộ đọc duy nhất phục vụ mọi luồng thu thập. Chuỗi mang dữ liệu định danh nên
 * không gửi đi đâu ngoài đơn đăng ký của chính sinh viên đó.
 */

import jsQR from 'jsqr';

/**
 * Cạnh dài tối đa khi dựng canvas. Ảnh điện thoại 4000px dựng canvas nguyên cỡ
 * dễ hết bộ nhớ trên máy yếu; 2400px vẫn thừa để đọc ô QR trên thẻ.
 */
const MAX_EDGE = 2400;

/** Lần hai hạ cỡ: ảnh quá nét đôi khi nhiễu hạt làm jsQR trượt. */
const RETRY_EDGE = 1200;

function drawToImageData(bitmap: ImageBitmap, maxEdge: number): ImageData | null {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(bitmap, 0, 0, w, h);
  try {
    return ctx.getImageData(0, 0, w, h);
  } catch {
    return null; // canvas bị đánh dấu tainted hoặc trình duyệt chặn
  }
}

/**
 * Trả về chuỗi QR đọc được, hoặc `null` khi không đọc được.
 *
 * `null` KHÔNG phải lỗi: ảnh có thể chụp mặt sau, mờ, lóa, hoặc là HEIC mà
 * trình duyệt không giải mã được. Người dùng vẫn nộp đơn bình thường.
 */
export async function readCccdQr(file: File): Promise<string | null> {
  if (typeof createImageBitmap !== 'function') return null;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null; // định dạng trình duyệt không đọc được (thường là HEIC)
  }

  try {
    for (const edge of [MAX_EDGE, RETRY_EDGE]) {
      const img = drawToImageData(bitmap, edge);
      if (!img) return null;
      const found = jsQR(img.data, img.width, img.height, {
        inversionAttempts: 'attemptBoth',
      });
      if (found?.data) return found.data;
    }
    return null;
  } finally {
    bitmap.close?.();
  }
}

/** Kiểm nhanh chuỗi có đúng khuôn QR của CCCD không, chỉ để hiện thông báo. */
export function looksLikeCccdQr(raw: string | null): boolean {
  if (!raw) return false;
  const parts = raw.split('|');
  return parts.length === 7 && /^\d{12}$/.test(parts[0].trim());
}
