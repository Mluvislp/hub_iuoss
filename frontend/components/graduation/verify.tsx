'use client';

import { useMemo, useState } from 'react';
import {
  AlertCircle, ArrowLeft, ChevronDown, GraduationCap, Loader2, LockKeyhole, QrCode, ShieldCheck, UserRound,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { GRAD_PATH, GradError, MS_PURPOSE_KEY, gradApi, type Audience, type GradMember } from '@/lib/graduation';

// Ô nhập riêng của trang tốt nghiệp: cao 44px đồng đều cho input / select, viền mảnh, focus vàng-navy.
const field =
  'block w-full h-11 rounded-lg border border-slate-300 bg-white px-3.5 text-[0.95rem] text-ink ' +
  'placeholder:text-slate-400 transition-colors hover:border-slate-400 ' +
  'focus:outline-none focus:border-[#0f2a5c] focus:ring-4 focus:ring-[#0f2a5c]/10';
const labelCls = 'block text-[0.83rem] font-semibold text-slate-700 mb-1.5';
const btnPrimary =
  'inline-flex w-full items-center justify-center gap-2 h-12 rounded-lg bg-[#0f2a5c] hover:bg-[#163a7a] ' +
  'text-white font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed ' +
  'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0f2a5c]/25';

function MicrosoftLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

function ErrorBox({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div role="alert" className="flex items-start gap-2.5 p-3 rounded-lg bg-danger-soft border border-danger-line text-danger-text text-sm">
      <AlertCircle size={16} className="shrink-0 mt-0.5" />
      <span>{message}</span>
    </div>
  );
}

function Select({ id, value, onChange, children, className }: {
  id?: string; value: string; onChange: (v: string) => void; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn('relative', className)}>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}
              className={cn(field, 'appearance-none pr-9 cursor-pointer', !value && 'text-slate-400')}>
        {children}
      </select>
      <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
    </div>
  );
}

/** Panel trái: giới thiệu 3 bước — cố định chiều cao theo form bên phải. */
function Aside({ audience }: { audience: Audience | null }) {
  const steps = [
    { icon: UserRound, title: 'Chọn đối tượng', text: 'Sinh viên hoặc học viên cao học.' },
    { icon: ShieldCheck, title: 'Xác minh thông tin', text: 'Đối chiếu với danh sách tốt nghiệp của Trường.' },
    { icon: QrCode, title: 'Đăng ký & nhận mã QR', text: 'Tải ảnh trình chiếu (nếu có), nhận mã QR check-in.' },
  ];
  const active = audience ? 1 : 0;
  return (
    <aside className="relative overflow-hidden bg-[#0f2a5c] text-white p-7 sm:p-8 md:rounded-l-xl">
      <div aria-hidden className="absolute -right-16 -top-16 h-48 w-48 rounded-full border border-white/10" />
      <div aria-hidden className="absolute -right-6 -top-6 h-28 w-28 rounded-full border border-[#f5d27a]/25" />
      <p className="text-[0.7rem] font-semibold tracking-[0.25em] uppercase text-[#f5d27a]">Các bước đăng ký</p>
      <h3 className="mt-2 font-display text-[1.9rem] leading-tight font-semibold">Ghi danh tham dự</h3>
      <ol className="mt-6 space-y-5">
        {steps.map((s, i) => {
          const Icon = s.icon;
          const state = i < active ? 'done' : i === active ? 'now' : 'next';
          return (
            <li key={s.title} className="flex gap-3.5">
              <span className={cn(
                'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-semibold',
                state === 'now' && 'border-[#f5d27a] bg-[#f5d27a] text-[#0f2a5c]',
                state === 'done' && 'border-[#f5d27a]/60 text-[#f5d27a]',
                state === 'next' && 'border-white/25 text-white/60',
              )}>
                <Icon size={16} />
              </span>
              <div>
                <div className={cn('font-semibold', state === 'next' && 'text-white/70')}>{i + 1}. {s.title}</div>
                <div className="text-sm text-white/65 leading-snug mt-0.5">{s.text}</div>
              </div>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

const AUDIENCES: Array<{ key: Audience; title: string; desc: string; icon: typeof UserRound }> = [
  { key: 'student', title: 'Sinh viên', desc: 'Đại học, CTLK UWE, CTLK Andrews — xác minh bằng tài khoản sinh viên.', icon: GraduationCap },
  { key: 'graduate', title: 'Học viên cao học', desc: 'Thạc sĩ, Tiến sĩ — xác minh bằng mã học viên và thông tin cá nhân.', icon: UserRound },
];

export default function Verify({ msEnabled, onVerified, notice }: {
  msEnabled: boolean;
  onVerified: (m: GradMember) => void;
  notice?: React.ReactNode;
}) {
  const [audience, setAudience] = useState<Audience | null>(null);

  return (
    <div className="grid overflow-hidden rounded-xl border border-line bg-white shadow-[0_10px_40px_-18px_rgba(15,42,92,0.35)] md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <Aside audience={audience} />
      <div className="p-6 sm:p-8">
        {notice}
        {!audience ? (
          <div>
            <h3 className="text-lg font-semibold text-ink">Đối tượng đăng ký</h3>
            <p className="text-sm text-muted mt-1 mb-5">Chọn đúng đối tượng để dùng cách xác minh phù hợp.</p>
            <div className="grid gap-3">
              {AUDIENCES.map(({ key, title, desc, icon: Icon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setAudience(key)}
                  className="group flex items-center gap-4 text-left rounded-lg border border-slate-200 bg-white px-4 py-4
                             hover:border-[#d4a72c] hover:bg-[#fffbf0] transition-colors
                             focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#d4a72c]/25"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[#ecd9a0] bg-[#fdf6e3] text-[#a07d1c]">
                    <Icon size={20} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-ink">{title}</span>
                    <span className="block text-sm text-muted mt-0.5">{desc}</span>
                  </span>
                  <ChevronDown size={18} className="-rotate-90 text-slate-300 group-hover:text-[#a07d1c] transition-colors" />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <button type="button" onClick={() => setAudience(null)}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink mb-5">
              <ArrowLeft size={15} /> Chọn lại đối tượng
            </button>
            {audience === 'student'
              ? <StudentVerify msEnabled={msEnabled} onVerified={onVerified} />
              : <GraduateVerify onVerified={onVerified} />}
          </div>
        )}
      </div>
    </div>
  );
}

function StudentVerify({ msEnabled, onVerified }: { msEnabled: boolean; onVerified: (m: GradMember) => void }) {
  const [uid, setUid] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msBusy, setMsBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!uid.trim() || !password) { setError('Vui lòng nhập MSSV và mật khẩu.'); return; }
    setBusy(true);
    try {
      onVerified(await gradApi.verifyLdap(uid.trim(), password));
    } catch (err) {
      setError(err instanceof GradError ? err.message : 'Có lỗi xảy ra. Vui lòng thử lại.');
    } finally {
      setBusy(false);
    }
  }

  async function microsoft() {
    setError('');
    setMsBusy(true);
    try {
      const { authorize_url } = await gradApi.microsoftStart();
      // Trang callback đọc khóa này để đổi code lấy phiên TỐT NGHIỆP, không phải phiên Hub.
      sessionStorage.setItem(MS_PURPOSE_KEY, 'graduation');
      sessionStorage.setItem('hub_ms_next', GRAD_PATH + '#dang-ky');
      window.location.href = authorize_url;
    } catch {
      setError('Chưa mở được trang đăng nhập Microsoft. Vui lòng thử lại.');
      setMsBusy(false);
    }
  }

  return (
    <div>
      <h3 className="text-lg font-semibold text-ink">Xác minh sinh viên</h3>
      <p className="text-sm text-muted mt-1 mb-5">Dùng email sinh viên (Outlook) hoặc tài khoản mạng trường (LDAP).</p>

      {msEnabled && (
        <>
          <button type="button" onClick={microsoft} disabled={msBusy || busy}
                  className="inline-flex w-full items-center justify-center gap-2.5 h-12 rounded-lg border border-slate-300 bg-white
                             font-semibold text-ink hover:bg-slate-50 hover:border-slate-400 transition-colors disabled:opacity-60">
            {msBusy ? <Loader2 size={18} className="animate-spin" /> : <MicrosoftLogo />}
            Xác minh bằng Outlook
          </button>
          <div className="flex items-center gap-3 my-5 text-xs font-medium uppercase tracking-wider text-slate-400">
            <span className="h-px flex-1 bg-line" /> hoặc tài khoản LDAP <span className="h-px flex-1 bg-line" />
          </div>
        </>
      )}

      <form onSubmit={submit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="grad-uid" className={labelCls}>Mã số sinh viên</label>
          <input id="grad-uid" className={cn(field, 'uppercase placeholder:normal-case')} value={uid}
                 onChange={(e) => setUid(e.target.value)} autoComplete="username" placeholder="VD: ITITIU21001" />
        </div>
        <div>
          <label htmlFor="grad-pw" className={labelCls}>Mật khẩu</label>
          <input id="grad-pw" type="password" className={field} value={password}
                 onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" placeholder="Mật khẩu tài khoản mạng trường" />
        </div>
        <ErrorBox message={error} />
        <button type="submit" disabled={busy || msBusy} className={btnPrimary}>
          {busy ? <Loader2 size={17} className="animate-spin" /> : <LockKeyhole size={17} />}
          Xác minh
        </button>
      </form>
    </div>
  );
}

const pad = (n: number) => String(n).padStart(2, '0');

function GraduateVerify({ onVerified }: { onVerified: (m: GradMember) => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [sex, setSex] = useState('');
  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const years = useMemo(() => {
    const top = new Date().getFullYear() - 18;
    return Array.from({ length: top - 1940 + 1 }, (_, i) => top - i);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!code.trim() || !name.trim() || !sex || !day || !month || !year) {
      setError('Vui lòng nhập đủ mã học viên, họ tên, giới tính và ngày sinh.');
      return;
    }
    const d = new Date(Number(year), Number(month) - 1, Number(day));
    if (d.getDate() !== Number(day)) { setError('Ngày sinh không hợp lệ.'); return; }
    setBusy(true);
    try {
      onVerified(await gradApi.verifyInfo({
        code: code.trim(), full_name: name.trim(), sex, date_of_birth: `${year}-${pad(+month)}-${pad(+day)}`,
      }));
    } catch (err) {
      setError(err instanceof GradError ? err.message : 'Có lỗi xảy ra. Vui lòng thử lại.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h3 className="text-lg font-semibold text-ink">Xác minh học viên cao học</h3>
      <p className="text-sm text-muted mt-1 mb-5">Thông tin phải khớp hồ sơ học viên tại Trường.</p>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="hv-code" className={labelCls}>Mã học viên</label>
            <input id="hv-code" className={cn(field, 'uppercase placeholder:normal-case')} value={code}
                   onChange={(e) => setCode(e.target.value)} placeholder="VD: MBAIU23001" autoComplete="off" />
          </div>
          <div>
            <label htmlFor="hv-sex" className={labelCls}>Giới tính</label>
            <Select id="hv-sex" value={sex} onChange={setSex}>
              <option value="">Chọn giới tính</option>
              <option value="Nam">Nam</option>
              <option value="Nữ">Nữ</option>
            </Select>
          </div>
        </div>
        <div>
          <label htmlFor="hv-name" className={labelCls}>Họ và tên</label>
          <input id="hv-name" className={field} value={name} onChange={(e) => setName(e.target.value)}
                 placeholder="Họ và tên có dấu, đúng như trên hồ sơ" autoComplete="name" />
        </div>
        <fieldset>
          <legend className={labelCls}>Ngày sinh</legend>
          <div className="grid grid-cols-3 gap-3">
            <Select value={day} onChange={setDay}>
              <option value="">Ngày</option>
              {Array.from({ length: 31 }, (_, i) => <option key={i} value={i + 1}>{pad(i + 1)}</option>)}
            </Select>
            <Select value={month} onChange={setMonth}>
              <option value="">Tháng</option>
              {Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>Tháng {pad(i + 1)}</option>)}
            </Select>
            <Select value={year} onChange={setYear}>
              <option value="">Năm</option>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </Select>
          </div>
        </fieldset>
        <ErrorBox message={error} />
        <button type="submit" disabled={busy} className={btnPrimary}>
          {busy ? <Loader2 size={17} className="animate-spin" /> : <LockKeyhole size={17} />}
          Xác minh
        </button>
      </form>
    </div>
  );
}
