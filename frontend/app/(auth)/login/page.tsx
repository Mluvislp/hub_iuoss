'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff, GraduationCap, Loader2, ArrowRight } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { setToken, getToken } from '@/lib/auth';
import { cn } from '@/lib/utils';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || '/dashboard';

  const [uid, setUid] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (getToken()) router.replace('/dashboard');
  }, [router]);

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
            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center
                            shadow-lg shadow-blue-600/40">
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
              Cổng thông tin<br />
              <span className="text-blue-400">sinh viên</span>
            </h1>
            <p className="mt-3 text-slate-400 text-sm leading-relaxed">
              Tra cứu hồ sơ, theo dõi yêu cầu và quản lý thông tin học vụ của bạn tại Trường Đại học Quốc tế HCMIU.
            </p>
          </div>

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
        </div>

        {/* Footer */}
        <div className="relative z-10">
          <p className="text-slate-600 text-xs">
            © {new Date().getFullYear()} Phòng Công tác Sinh viên — HCMIU
          </p>
        </div>
      </div>

      {/* ── Right panel: Login form ── */}
      <div className="flex-1 flex items-center justify-center bg-slate-50 p-6 sm:p-12">
        <div className="w-full max-w-[400px]">

          {/* Mobile logo */}
          <div className="flex items-center gap-2 mb-8 lg:hidden">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <GraduationCap size={16} className="text-white" />
            </div>
            <span className="font-bold text-slate-900">IUOSS Hub</span>
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
                  placeholder="Mật khẩu mạng IU"
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

          {/* Forgot password */}
          <p className="mt-5 text-center text-sm text-slate-500">
            Quên mật khẩu?{' '}
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
