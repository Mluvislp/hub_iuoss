'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff, GraduationCap, Loader2, ArrowRight } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { setToken, getToken } from '@/lib/auth';
import { cn } from '@/lib/utils';

/** Logo 4 ô của Microsoft — inline để không phải tải ảnh ngoài. */
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

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || '/dashboard';

  const [uid, setUid] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [msEnabled, setMsEnabled] = useState(false);
  const [msLoading, setMsLoading] = useState(false);

  useEffect(() => {
    if (getToken()) router.replace('/dashboard');
  }, [router]);

  // Chỉ hiện nút Microsoft khi backend đã cấu hình app registration — tránh dẫn
  // người dùng tới một endpoint trả 404.
  useEffect(() => {
    let alive = true;
    api.features
      .get()
      .then((f) => alive && setMsEnabled(f.microsoft_login === true))
      .catch(() => {
        /* không gọi được /features/ → ẩn nút, form LDAP vẫn dùng được */
      });
    return () => {
      alive = false;
    };
  }, []);

  async function handleMicrosoft() {
    setError('');
    setMsLoading(true);
    try {
      const { authorize_url } = await api.auth.microsoftStart();
      // Nhớ 'next' để sau khi quay về còn biết đưa sinh viên tới đâu. Không nhét
      // vào state gửi đi Microsoft: state là gói đã ký của backend, không sửa được.
      sessionStorage.setItem('hub_ms_next', next);
      window.location.href = authorize_url;
    } catch {
      setError('Chưa mở được trang đăng nhập Microsoft. Vui lòng thử lại.');
      setMsLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!uid.trim() || !password) {
      setError('Vui lòng nhập đầy đủ tài khoản và mật khẩu.');
      return;
    }

    setLoading(true);
    try {
      const res = await api.auth.login(uid.trim(), password);
      setToken(res.access);  // session tự decode từ JWT qua getSession()
      router.replace(next.startsWith('/') ? next : '/dashboard');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message || 'Tài khoản hoặc mật khẩu không đúng.');
      } else {
        setError('Không thể kết nối máy chủ. Vui lòng thử lại.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex">

      {/* ── Left panel: Branding ── */}
      <div className="hidden lg:flex lg:w-[42%] relative flex-col justify-between p-10 overflow-hidden
                      bg-[#0a0f1e]">

        {/* Gradient glow blobs */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full
                          bg-blue-600/20 blur-[100px]" />
          <div className="absolute top-1/2 -right-20 w-80 h-80 rounded-full
                          bg-indigo-500/15 blur-[90px]" />
          <div className="absolute -bottom-20 left-1/3 w-72 h-72 rounded-full
                          bg-blue-800/20 blur-[80px]" />
        </div>

        {/* Dot-grid pattern */}
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage: 'radial-gradient(circle, #fff 1px, transparent 1px)',
            backgroundSize: '28px 28px',
          }}
        />

        {/* Logo */}
        <div className="relative z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center
                            shadow-lg shadow-primary/40">
              <GraduationCap size={20} className="text-white" />
            </div>
            <div>
              <div className="text-white font-bold text-lg tracking-tight">IUOSS Hub</div>
              <div className="text-slate-400 text-xs">hub.iuoss.com</div>
            </div>
          </div>
        </div>

        {/* Main copy */}
        <div className="relative z-10 space-y-6">
          <div>
            <h1 className="text-white text-3xl font-bold leading-tight tracking-tight">
              Cổng thông tin Sinh viên<br />
              <span className="text-blue-400">IUOSS HUB</span>
            </h1>
            <p className="mt-3 text-slate-400 text-sm leading-relaxed">
              Tra cứu hồ sơ, theo dõi yêu cầu và quản lý thông tin học vụ của Sinh viên
              Trường Đại học Quốc tế, ĐHQG-HCM.
            </p>
          </div>

          {/* Tạm ẩn feature list theo yêu cầu — bật lại khi cần
          <ul className="space-y-3">
            {[
              'Xem hồ sơ sinh viên & bảo hiểm y tế',
              'Theo dõi sinh hoạt công dân',
              'Gửi & tra cứu yêu cầu giấy tờ',
              'Thông báo từ Phòng CTSV (sắp ra mắt)',
            ].map((f) => (
              <li key={f} className="flex items-center gap-3 text-sm text-slate-300">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-600/20
                                 border border-blue-500/30 flex items-center justify-center">
                  <svg className="w-2.5 h-2.5 text-blue-400" fill="currentColor" viewBox="0 0 12 12">
                    <path d="M10 3L5 8.5 2 5.5l-1 1L5 10.5l6-7-1-0.5z" />
                  </svg>
                </span>
                {f}
              </li>
            ))}
          </ul>
          */}
        </div>

        {/* Footer */}
        <div className="relative z-10">
          <p className="text-slate-600 text-xs">
            © {new Date().getFullYear()} Phòng Công tác Sinh viên — HCMIU
          </p>
        </div>
      </div>

      {/* ── Right panel: Login form ── */}
      <div className="flex-1 flex items-center justify-center bg-surface-subtle p-6 sm:p-12">
        <div className="w-full max-w-[400px]">

          {/* Mobile logo */}
          <div className="flex items-center gap-2 mb-8 lg:hidden">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <GraduationCap size={16} className="text-white" />
            </div>
            <span className="font-bold text-ink">IUOSS Hub</span>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-bold text-ink tracking-tight">
              Đăng nhập
            </h2>
            <p className="mt-1.5 text-sm text-muted">
              Dùng tài khoản mạng nội bộ trường (MSSV + mật khẩu IU)
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">

            {/* Error banner */}
            {error && (
              <div id="login-error" role="alert"
                   className="flex items-start gap-2.5 p-3.5 rounded-lg bg-danger-soft
                              border border-danger-line text-danger-text text-sm">
                <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                {error}
              </div>
            )}

            {/* MSSV */}
            <div className="space-y-1.5">
              <label htmlFor="login-uid" className="block text-sm font-medium text-ink-2">
                Tài khoản (MSSV)
              </label>
              <input
                id="login-uid"
                aria-invalid={!!error}
                aria-describedby={error ? 'login-error' : undefined}
                type="text"
                autoComplete="username"
                autoFocus
                value={uid}
                onChange={(e) => setUid(e.target.value)}
                placeholder="vd: BABAWE21603"
                className={cn(
                  'w-full px-3.5 py-2.5 rounded-lg border text-sm bg-white',
                  'text-ink placeholder:text-muted',
                  'focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary',
                  'transition-colors duration-150',
                  error ? 'border-danger' : 'border-line-strong hover:border-line-hover',
                )}
              />
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label htmlFor="login-password" className="block text-sm font-medium text-ink-2">
                Mật khẩu
              </label>
              <div className="relative">
                <input
                  id="login-password"
                  aria-invalid={!!error}
                  aria-describedby={error ? 'login-error' : undefined}
                  type={showPw ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mật khẩu LDAP"
                  className={cn(
                    'w-full px-3.5 py-2.5 pr-11 rounded-lg border text-sm bg-white',
                    'text-ink placeholder:text-muted',
                    'focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary',
                    'transition-colors duration-150',
                    error ? 'border-danger' : 'border-line-strong hover:border-line-hover',
                  )}
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="touch-target absolute right-3 top-1/2 -translate-y-1/2
                             text-muted hover:text-ink-2 transition-colors"
                  tabIndex={-1}
                >
                  {showPw ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className={cn(
                'w-full flex items-center justify-center gap-2',
                'px-4 py-2.5 rounded-lg text-sm font-semibold',
                'bg-primary hover:bg-primary-hover active:bg-primary-active',
                'text-white shadow-sm shadow-primary/30',
                'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2',
                'transition-all duration-150 mt-2',
                'disabled:opacity-70 disabled:cursor-not-allowed',
              )}
            >
              {loading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <>
                  Đăng nhập
                  <ArrowRight size={15} />
                </>
              )}
            </button>
          </form>

          {/* ── Đăng nhập bằng tài khoản Microsoft ── */}
          {msEnabled && (
            <>
              <div className="flex items-center gap-3 my-5">
                <span className="h-px flex-1 bg-line" />
                <span className="text-xs text-muted">hoặc</span>
                <span className="h-px flex-1 bg-line" />
              </div>

              <button
                type="button"
                onClick={handleMicrosoft}
                disabled={msLoading || loading}
                className={cn(
                  'w-full flex items-center justify-center gap-2.5',
                  'px-4 py-2.5 rounded-lg text-sm font-semibold',
                  'bg-white border border-line-strong hover:border-line-hover hover:bg-surface-subtle',
                  'text-ink-2',
                  'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2',
                  'transition-all duration-150',
                  'disabled:opacity-70 disabled:cursor-not-allowed',
                )}
              >
                {msLoading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <>
                    <MicrosoftLogo />
                    Đăng nhập bằng tài khoản Microsoft
                  </>
                )}
              </button>
              <p className="mt-2 text-center text-xs text-faint">
                Sinh viên dùng email @student.hcmiu.edu.vn · Học viên cao học dùng email @mp.hcmiu.edu.vn
              </p>
            </>
          )}

          {/* Forgot password */}
          <p className="mt-5 text-center text-sm text-muted">
            Quên mật khẩu LDAP?{' '}
            <a
              href="https://ldap.hcmiu.edu.vn/iupwd/?action=sendtoken"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:text-primary-text font-medium hover:underline"
            >
              Đặt lại tại đây
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
