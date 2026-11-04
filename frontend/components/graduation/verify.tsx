'use client';

import { useState } from 'react';
import { AlertCircle, ArrowLeft, GraduationCap, Loader2, LockKeyhole, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ui } from '@/lib/ui';
import { GRAD_PATH, GradError, MS_PURPOSE_KEY, gradApi, type Audience, type GradMember } from '@/lib/graduation';

function MicrosoftLogo() {
  return (
    <svg width="16" height="16" viewBox="0 0 21 21" aria-hidden="true">
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

const AUDIENCES: Array<{ key: Audience; title: string; desc: string; icon: typeof UserRound }> = [
  { key: 'student', title: 'Sinh viên', desc: 'Đại học, CTLK UWE, CTLK Andrews — xác minh bằng tài khoản sinh viên.', icon: GraduationCap },
  { key: 'graduate', title: 'Học viên cao học', desc: 'Thạc sĩ, Tiến sĩ — xác minh bằng mã học viên và thông tin cá nhân.', icon: UserRound },
];

export default function Verify({ msEnabled, onVerified }: {
  msEnabled: boolean;
  onVerified: (m: GradMember) => void;
}) {
  const [audience, setAudience] = useState<Audience | null>(null);

  if (!audience) {
    return (
      <div>
        <p className="text-sm text-muted mb-4">Chọn đối tượng đăng ký tham dự:</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {AUDIENCES.map(({ key, title, desc, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setAudience(key)}
              className="group text-left rounded-lg border border-line bg-white p-4 hover:border-primary hover:bg-primary-soft/40
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <span className="w-9 h-9 rounded-lg border border-line flex items-center justify-center text-[#a07d1c] group-hover:border-primary-line">
                  <Icon size={18} />
                </span>
                <span className="font-semibold text-ink">{title}</span>
              </div>
              <p className="mt-2 text-sm text-muted">{desc}</p>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <button type="button" onClick={() => setAudience(null)} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink mb-4">
        <ArrowLeft size={14} /> Chọn lại đối tượng
      </button>
      {audience === 'student'
        ? <StudentVerify msEnabled={msEnabled} onVerified={onVerified} />
        : <GraduateVerify onVerified={onVerified} />}
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
      // Trang callback đọc 2 khóa này để biết đổi code lấy phiên TỐT NGHIỆP, không phải phiên Hub.
      sessionStorage.setItem(MS_PURPOSE_KEY, 'graduation');
      sessionStorage.setItem('hub_ms_next', GRAD_PATH + '#dang-ky');
      window.location.href = authorize_url;
    } catch {
      setError('Chưa mở được trang đăng nhập Microsoft. Vui lòng thử lại.');
      setMsBusy(false);
    }
  }

  return (
    <div className="max-w-md">
      <h3 className="font-semibold text-ink">Xác minh sinh viên</h3>
      <p className="text-sm text-muted mt-1 mb-4">Dùng tài khoản email sinh viên (Outlook) hoặc tài khoản mạng trường (LDAP).</p>

      {msEnabled && (
        <>
          <button type="button" onClick={microsoft} disabled={msBusy || busy} className={cn(ui.btnOutline, 'w-full h-11')}>
            {msBusy ? <Loader2 size={16} className="animate-spin" /> : <MicrosoftLogo />}
            Xác minh bằng Outlook (email sinh viên)
          </button>
          <div className="flex items-center gap-3 my-4 text-xs text-slate-400">
            <span className="h-px flex-1 bg-line" /> hoặc tài khoản LDAP <span className="h-px flex-1 bg-line" />
          </div>
        </>
      )}

      <form onSubmit={submit} className="space-y-3" noValidate>
        <div>
          <label htmlFor="grad-uid" className={ui.fieldLabel}>Mã số sinh viên</label>
          <input id="grad-uid" className={ui.input} value={uid} onChange={(e) => setUid(e.target.value)}
                 autoComplete="username" placeholder="VD: ITITIU21001" />
        </div>
        <div>
          <label htmlFor="grad-pw" className={ui.fieldLabel}>Mật khẩu</label>
          <input id="grad-pw" type="password" className={ui.input} value={password}
                 onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </div>
        <ErrorBox message={error} />
        <button type="submit" disabled={busy || msBusy} className={cn(ui.btnPrimary, 'w-full h-11')}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <LockKeyhole size={16} />}
          Xác minh
        </button>
      </form>
    </div>
  );
}

function GraduateVerify({ onVerified }: { onVerified: (m: GradMember) => void }) {
  const [form, setForm] = useState({ code: '', full_name: '', sex: '', date_of_birth: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!form.code.trim() || !form.full_name.trim() || !form.sex || !form.date_of_birth) {
      setError('Vui lòng nhập đủ mã học viên, họ tên, giới tính và ngày sinh.');
      return;
    }
    setBusy(true);
    try {
      onVerified(await gradApi.verifyInfo({ ...form, code: form.code.trim(), full_name: form.full_name.trim() }));
    } catch (err) {
      setError(err instanceof GradError ? err.message : 'Có lỗi xảy ra. Vui lòng thử lại.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-md">
      <h3 className="font-semibold text-ink">Xác minh học viên cao học</h3>
      <p className="text-sm text-muted mt-1 mb-4">Thông tin phải khớp hồ sơ học viên tại Trường.</p>
      <form onSubmit={submit} className="space-y-3" noValidate>
        <div>
          <label htmlFor="hv-code" className={ui.fieldLabel}>Mã học viên</label>
          <input id="hv-code" className={cn(ui.input, 'uppercase')} value={form.code} onChange={set('code')}
                 placeholder="VD: MBAIU23001" autoComplete="off" />
        </div>
        <div>
          <label htmlFor="hv-name" className={ui.fieldLabel}>Họ và tên</label>
          <input id="hv-name" className={ui.input} value={form.full_name} onChange={set('full_name')}
                 placeholder="Họ và tên có dấu" autoComplete="name" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="hv-sex" className={ui.fieldLabel}>Giới tính</label>
            <select id="hv-sex" className={ui.input} value={form.sex} onChange={set('sex')}>
              <option value="">Chọn</option>
              <option value="Nam">Nam</option>
              <option value="Nữ">Nữ</option>
            </select>
          </div>
          <div>
            <label htmlFor="hv-dob" className={ui.fieldLabel}>Ngày sinh</label>
            <input id="hv-dob" type="date" className={ui.input} value={form.date_of_birth} onChange={set('date_of_birth')}
                   max={new Date().toISOString().slice(0, 10)} />
          </div>
        </div>
        <ErrorBox message={error} />
        <button type="submit" disabled={busy} className={cn(ui.btnPrimary, 'w-full h-11')}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <LockKeyhole size={16} />}
          Xác minh
        </button>
      </form>
    </div>
  );
}
