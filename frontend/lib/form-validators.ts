/**
 * Validator dùng chung cho các form yêu cầu giấy tờ.
 *
 * Mỗi hàm ở đây SOI GƯƠNG một hàm cùng tên bên `backend/core/documents.py`
 * (`validate_dob`, `validate_citizen_id`, `validate_issue_date`). Sửa một bên thì
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

export function validateCccd(v: string, original: string): string | null {
  const s = v.trim();
  if (/^\d{12}$/.test(s)) return null;
  if (!s) return 'Vui lòng nhập số CCCD (12 chữ số).';
  if (!/^\d{12}$/.test((original || '').trim()))
    return 'Hồ sơ chưa có CCCD hợp lệ (đang trống hoặc CMND cũ) — vui lòng nhập số CCCD mới gồm 12 chữ số.';
  return 'Số CCCD phải gồm 12 chữ số.';
}

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
