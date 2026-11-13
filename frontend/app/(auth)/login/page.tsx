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
      {/* Ảnh bìa trường (19/10/2026) thay nền xanh đặc. Lớp phủ navy giữ màu thương hiệu và
          là scrim cho chữ trắng: đậm ở đỉnh (logo) và đáy (lời giới thiệu), nhạt ở giữa để
          thấy sân trong. Không quầng sáng / lưới chấm. */}
      <div className="hidden lg:flex lg:w-[46%] relative flex-col justify-between p-10 overflow-hidden
                      bg-[#0f2a5c] border-r border-[#0b2149]">
        <picture>
          <source srcSet="/img/login-cover.webp" type="image/webp" />
          <img
            src="/img/login-cover.jpg"
            alt=""
            aria-hidden="true"
            fetchPriority="high"
            className="absolute inset-0 h-full w-full object-cover object-[center_40%]"
          />
        </picture>
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[linear-gradient(180deg,rgba(15,42,92,.85)_0%,rgba(15,42,92,.55)_16%,rgba(15,42,92,.25)_34%,rgba(15,42,92,.35)_55%,rgba(15,42,92,.92)_100%)]"
        />

        {/* Logo */}
        <div className="relative z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-white/10 border border-white/20 flex items-center justify-center">
              <GraduationCap size={20} className="text-white" />
            </div>
            <div>
              <div className="text-white font-bold text-lg tracking-tight">IUOSS Hub</div>
              <div className="text-blue-200/80 text-xs">hub.iuoss.com</div>
            </div>
          </div>
        </div>

        {/* Main copy — dồn xuống đáy, trên phần phủ đậm */}
        <div className="relative z-10 mt-auto mb-8 space-y-6">
          <div>
            <h1 className="text-white text-3xl font-bold leading-tight tracking-tight">
              Cổng thông tin Sinh viên<br />
              <span className="text-blue-300">IUOSS HUB</span>
            </h1>
            <p className="mt-3 text-blue-100/80 text-sm leading-relaxed">
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
          <p className="text-blue-200/60 text-xs">
            © {new Date().getFullYear()} Phòng Công tác Sinh viên — HCMIU
          </p>
        </div>
      </div>

      {/* ── Right panel: Login form ── */}
      <div className="flex-1 flex items-center justify-center bg-slate-50 p-6 sm:p-12">
        <div className="w-full max-w-[400px]">

          {/* Mobile: dải ảnh bìa thay cho logo trần */}
          <div className="relative mb-8 h-36 overflow-hidden rounded-lg border border-line lg:hidden">
            <picture>
              <source srcSet="/img/login-cover.webp" type="image/webp" />
              <img
                src="/img/login-cover.jpg"
                alt=""
                aria-hidden="true"
                className="absolute inset-0 h-full w-full object-cover object-[center_45%]"
              />
            </picture>
            <div
              aria-hidden="true"
              className="absolute inset-0 bg-[linear-gradient(180deg,rgba(15,42,92,.15)_0%,rgba(15,42,92,.85)_100%)]"
            />
            <div className="absolute bottom-3 left-3 flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-white/10 border border-white/25 flex items-center justify-center">
                <GraduationCap size={16} className="text-white" />
              </div>
              <span className="font-bold text-white">IUOSS Hub</span>
            </div>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
              Đăng nhập
            </h2>
            <p className="mt-1.5 text-sm text-slate-500">
              Dùng tài khoản mạng nội bộ trường (MSSV + mật khẩu IU)
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">

            {/* Error banner */}
            {error && (
              <div className="flex items-start gap-2.5 p-3.5 rounded-lg bg-red-50
                              border border-red-200 text-red-700 text-sm">
                <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                {error}
              </div>
            )}

            {/* MSSV */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700">
                Tài khoản (MSSV)
              </label>
              <input
                type="text"
                autoComplete="username"
                autoFocus
                value={uid}
                onChange={(e) => setUid(e.target.value)}
                placeholder="vd: BABAWE21603"
                className={cn(
                  'w-full px-3.5 py-2.5 rounded-lg border text-sm bg-white',
                  'text-slate-900 placeholder:text-slate-400',
                  'focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500',
                  'transition-colors duration-150',
                  error ? 'border-red-300' : 'border-slate-300 hover:border-slate-400',
                )}
              />
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700">
                Mật khẩu
              </label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mật khẩu LDAP"
                  className={cn(
                    'w-full px-3.5 py-2.5 pr-11 rounded-lg border text-sm bg-white',
                    'text-slate-900 placeholder:text-slate-400',
                    'focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500',
                    'transition-colors duration-150',
                    error ? 'border-red-300' : 'border-slate-300 hover:border-slate-400',
                  )}
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2
                             text-slate-400 hover:text-slate-600 transition-colors"
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
                'bg-blue-600 hover:bg-blue-700 active:bg-blue-800',
                'text-white shadow-sm shadow-blue-600/30',
                'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2',
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
                <span className="h-px flex-1 bg-slate-200" />
                <span className="text-xs text-slate-400">hoặc</span>
                <span className="h-px flex-1 bg-slate-200" />
              </div>

              <button
                type="button"
                onClick={handleMicrosoft}
                disabled={msLoading || loading}
                className={cn(
                  'w-full flex items-center justify-center gap-2.5',
                  'px-4 py-2.5 rounded-lg text-sm font-semibold',
                  'bg-white border border-slate-300 hover:border-slate-400 hover:bg-slate-50',
                  'text-slate-700',
                  'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2',
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
              <p className="mt-2 text-center text-xs text-slate-400">
                Sinh viên dùng email @student.hcmiu.edu.vn · Học viên cao học dùng email @mp.hcmiu.edu.vn
              </p>
            </>
          )}

          {/* Forgot password */}
          <p className="mt-5 text-center text-sm text-slate-500">
            Quên mật khẩu LDAP?{' '}
            <a
              href="https://ldap.hcmiu.edu.vn/iupwd/?action=sendtoken"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-700 font-medium hover:underline"
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
