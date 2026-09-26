/**
 * Validator dùng chung cho các form yêu cầu giấy tờ.
 *
 * Mỗi hàm ở đây SOI GƯƠNG một hàm cùng tên bên `backend/core/documents.py`
 * (`validate_dob`, `validate_citizen_id`, `validate_issue_date`) — riêng luật CCCD
 * soi gương `core/cccd_rules.py`. Sửa một bên thì
 * phải sửa cả hai — frontend chỉ để báo lỗi sớm, backend mới là nơi chặn thật.
 *
 * Dữ liệu năm học / đào tạo thuộc NHÓM CỨNG nên không có validator ở đây.
 */

export function validateDob(v: string): string | null {
  const s = v.trim();
  if (!s) return 'Vui lòng nhập ngày sinh.';
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (!m) return 'Ngày sinh phải theo định dạng dd/mm/yyyy.';
  const day = +m[1], mon = +m[2], year = +m[3];
  const dt = new Date(year, mon - 1, day);
  if (dt.getFullYear() !== year || dt.getMonth() !== mon - 1 || dt.getDate() !== day) return 'Ngày sinh không hợp lệ.';
  if (dt.getTime() > Date.now()) return 'Ngày sinh không được ở tương lai.';
  if (year < 1940) return 'Năm sinh không hợp lệ.';
  return null;
}

// ── CCCD ──────────────────────────────────────────────────────────────────────
// ⚠️ BẢN SONG SINH của `backend/core/cccd_rules.py` (Hub) và
// `students/cccd_rules.py` (Dashboard) — sửa một nơi phải sửa cả ba. Cố ý chỉ
// kiểm cơ bản: số đúng 12 chữ số, ngày cấp là ngày thật và không ở tương lai.
// Không soi mã tỉnh / năm sinh — dữ liệu gốc lệch nhiều, soi chặt là chặn nhầm.

/** Số CCCD. Giữ nguyên số trong hồ sơ (đã đủ 12 số) ⇒ qua. */
export function validateCccd(v: string, original: string): string | null {
  const s = v.trim();
  const orig = (original || '').trim();
  if (s && s === orig && /^\d{12}$/.test(s)) return null;
  if (!s) {
    return /^\d{12}$/.test(orig)
      ? 'Vui lòng nhập số CCCD (12 chữ số).'
      : 'Hồ sơ chưa có CCCD hợp lệ (đang trống hoặc CMND cũ) — vui lòng nhập số CCCD mới gồm 12 chữ số.';
  }
  if (!/^\d{12}$/.test(s)) return 'Số CCCD phải gồm đúng 12 chữ số.';
  return null;
}

/** Ngày cấp CCCD nhập mới: ngày thật, không ở tương lai. */
export function validateIssueDate(v: string): string | null {
  const s = v.trim();
  if (!s) return 'Vui lòng nhập ngày cấp CCCD.';
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (!m) return 'Ngày cấp CCCD phải theo định dạng dd/mm/yyyy.';
  const day = +m[1], mon = +m[2], year = +m[3];
  const dt = new Date(year, mon - 1, day);
  if (dt.getFullYear() !== year || dt.getMonth() !== mon - 1 || dt.getDate() !== day) return 'Ngày cấp CCCD không hợp lệ.';
  if (dt.getTime() > Date.now()) return 'Ngày cấp CCCD không được ở tương lai.';
  return null;
}

// ── Giá trị lấy từ hồ sơ có dùng được không ──────────────────────────────────
// Không dùng được (trống / sai luật ở trên) ⇒ form MỞ SẴN ô đó để SV nhập lại,
// không khóa và không có nút "Hủy chỉnh sửa" (quay về giá trị sai là vô ích).
// Cùng định nghĩa với validator nên ô mở sẵn đúng bằng ô sẽ bị báo lỗi khi gửi.

export const isValidDob = (v: string): boolean => validateDob(v) === null;
export const isValidCccd = (v: string): boolean => /^\d{12}$/.test((v || '').trim());
export const isValidIssueDate = (v: string): boolean => validateIssueDate(v) === null;
