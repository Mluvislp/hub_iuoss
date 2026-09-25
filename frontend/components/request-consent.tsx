'use client';

/**
 * Ô cam đoan dùng chung cho MỌI form yêu cầu giấy xác nhận.
 *
 * Câu cam đoan chỉ viết ở đây — các form khác nhau không được tự chế lời văn,
 * vì đây là nội dung sinh viên chịu trách nhiệm pháp lý. Chưa tích thì nút gửi
 * bị làm mờ và khoá (xem `ConsentGate`).
 */
export function RequestConsent({
  checked,
  onChange,
  editCount = 0,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  /** Số thông tin SV yêu cầu chỉnh sửa so với hồ sơ — 0 thì không hiện dòng nhắc. */
  editCount?: number;
}) {
  return (
    <div className="rounded-lg border border-line bg-slate-50 px-4 py-3.5">
      <label className="flex items-start gap-2.5 cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 flex-shrink-0 cursor-pointer rounded border-line text-primary focus:ring-2 focus:ring-primary/30"
        />
        <span className="text-[0.85rem] leading-relaxed text-slate-700">
          Tôi cam đoan đã kiểm tra kỹ toàn bộ thông tin trong đơn này và xác nhận các thông tin
          là đúng sự thật, kể cả những nội dung tôi yêu cầu chỉnh sửa. Tôi hoàn toàn chịu trách
          nhiệm trước Nhà trường và trước pháp luật về tính chính xác của các thông tin đã khai;
          nếu khai không đúng, tôi chấp nhận việc giấy xác nhận đã cấp không còn giá trị và chịu
          xử lý theo quy định của Nhà trường.
        </span>
      </label>
      {editCount > 0 && (
        <p className="mt-2 pl-[26px] text-[0.78rem] text-amber-700">
          Đơn này có {editCount} thông tin được yêu cầu chỉnh sửa so với hồ sơ.
        </p>
      )}
    </div>
  );
}

/**
 * Chỗ của nút gửi: chưa cam đoan thì nút vẫn hiện nhưng mờ và không bấm được.
 * `<fieldset disabled>` vô hiệu hoá mọi nút bên trong theo chuẩn HTML — không
 * phải truyền `disabled` vào từng nút ở 5 form. Độ mờ lấy từ `disabled:` của
 * chính nút (`ui.btnPrimary`), fieldset không tự làm mờ để khỏi mờ chồng hai lần.
 */
export function ConsentGate({ checked, children }: { checked: boolean; children: React.ReactNode }) {
  return (
    <fieldset disabled={!checked} className="inline-flex">
      {children}
    </fieldset>
  );
}

/** Thông báo lỗi chuẩn khi submit mà chưa tích cam đoan (chặn phím Enter). */
export const CONSENT_REQUIRED_MSG = 'Vui lòng tích vào ô cam đoan trước khi gửi yêu cầu.';
