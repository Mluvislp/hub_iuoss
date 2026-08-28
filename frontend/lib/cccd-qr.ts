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
 * Cạnh dài tối đa khi dựng canvas cho lượt quét TOÀN KHUNG. Ảnh điện thoại
 * 4000px dựng canvas nguyên cỡ dễ hết bộ nhớ trên máy yếu.
 */
const MAX_EDGE = 2400;

/** Lần hai hạ cỡ: ảnh quá nét đôi khi nhiễu hạt làm jsQR trượt. */
const RETRY_EDGE = 1200;

/**
 * Lượt ba cắt ô. Ô bằng 1/4 cạnh, bước nhảy bằng nửa ô để mã QR không rơi đúng
 * đường cắt. Đo trên ảnh thật (1920×2560, QR ở mặt sau thẻ Căn cước mẫu mới):
 * quét toàn khung trượt ở MỌI tỉ lệ, nhưng ô 480×640 đọc ra ngay.
 */
const TILE_FRACTION = 0.25;

/**
 * Trần thời gian cho lượt cắt ô. Ảnh không có QR sẽ duyệt hết 49 ô; chạy nền
 * trong lúc sinh viên còn điền form nên không chặn ai, nhưng vẫn phải có trần.
 */
const TILE_BUDGET_MS = 6000;

function decode(img: ImageData): string | null {
  const found = jsQR(img.data, img.width, img.height, {
    inversionAttempts: 'attemptBoth',
  });
  return found?.data ?? null;
}

/**
 * Vẽ một phần của ảnh ra canvas rồi lấy pixel.
 *
 * Cắt bằng `drawImage` 9 tham số nên canvas chỉ to bằng đúng ô cần đọc — không
 * bao giờ phải dựng buffer nguyên cỡ ảnh gốc.
 */
function readRegion(
  bitmap: ImageBitmap,
  sx: number, sy: number, sw: number, sh: number,
  dw: number, dh: number,
): ImageData | null {
  const canvas = document.createElement('canvas');
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, dw, dh);
  try {
    return ctx.getImageData(0, 0, dw, dh);
  } catch {
    return null; // canvas bị đánh dấu tainted hoặc trình duyệt chặn
  }
}

/** Toàn khung, hạ xuống `maxEdge`. */
function readWhole(bitmap: ImageBitmap, maxEdge: number): ImageData | null {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  return readRegion(bitmap, 0, 0, bitmap.width, bitmap.height, w, h);
}

/**
 * Quét theo ô, đi từ giữa ra ngoài.
 *
 * ⚠️ Ô phải cắt ở ĐỘ PHÂN GIẢI GỐC. Đo trên ảnh thật: cùng bộ ô đó, cắt từ bản
 * đã hạ xuống 1800×2400 là trượt sạch, chỉ bản gốc 1920×2560 mới đọc ra. Mã QR
 * trên thẻ nhỏ, hạ cỡ dù chỉ 6% là mất.
 *
 * Đi từ giữa ra vì thẻ hầu như luôn nằm giữa khung: ảnh thật đọc ra ở ô thứ 5
 * trong 49 ô (430ms) thay vì phải duyệt hết.
 */
function scanTiles(bitmap: ImageBitmap): string | null {
  const tw = Math.round(bitmap.width * TILE_FRACTION);
  const th = Math.round(bitmap.height * TILE_FRACTION);
  if (tw < 80 || th < 80) return null; // ảnh quá nhỏ, cắt ra không còn gì để đọc

  const stepX = Math.max(1, Math.round(tw / 2));
  const stepY = Math.max(1, Math.round(th / 2));

  const xs: number[] = [];
  for (let x = 0; x + tw <= bitmap.width; x += stepX) xs.push(x);
  if (xs[xs.length - 1] !== bitmap.width - tw) xs.push(bitmap.width - tw);

  const ys: number[] = [];
  for (let y = 0; y + th <= bitmap.height; y += stepY) ys.push(y);
  if (ys[ys.length - 1] !== bitmap.height - th) ys.push(bitmap.height - th);

  const cx = (bitmap.width - tw) / 2;
  const cy = (bitmap.height - th) / 2;
  const cells: Array<[number, number]> = [];
  for (const y of ys) for (const x of xs) cells.push([x, y]);
  cells.sort(
    (a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy),
  );

  const deadline = Date.now() + TILE_BUDGET_MS;
  for (const [x, y] of cells) {
    if (Date.now() > deadline) return null;
    const img = readRegion(bitmap, x, y, tw, th, tw, th);
    if (!img) return null;
    const raw = decode(img);
    if (raw) return raw;
  }
  return null;
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
    // Lượt 1–2: toàn khung. Ảnh chụp cận thẻ đọc ra ngay ở đây, rất nhanh.
    for (const edge of [MAX_EDGE, RETRY_EDGE]) {
      const img = readWhole(bitmap, edge);
      if (!img) return null;
      const raw = decode(img);
      if (raw) return raw;
    }
    // Lượt 3: thẻ chiếm phần nhỏ trong khung — cắt ô ở độ phân giải gốc.
    return scanTiles(bitmap);
  } finally {
    bitmap.close?.();
  }
}

/**
 * Kiểm nhanh chuỗi có đúng khuôn QR của CCCD không.
 *
 * ⚠️ `>= 7` chứ không phải `=== 7`: thẻ thật đo được trả về **11 trường** —
 * 7 trường có nội dung rồi 4 dấu `|` rỗng ở đuôi. Bắt đúng 7 là loại nhầm thẻ
 * hợp lệ. Backend (`core/cccd.py`) cũng nới cùng kiểu, hai bên phải khớp.
 */
export function looksLikeCccdQr(raw: string | null): boolean {
  if (!raw) return false;
  const parts = raw.split('|');
  return parts.length >= 7 && /^\d{12}$/.test(parts[0].trim());
}
