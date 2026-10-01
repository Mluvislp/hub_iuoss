'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, GraduationCap, Loader2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { setToken } from '@/lib/auth';

// Trang Microsoft chuyển hướng về sau khi sinh viên đăng nhập. Nhiệm vụ duy nhất:
// chuyển tiếp `code` + `state` cho backend đổi lấy phiên của Hub. Trang này KHÔNG
// tự đọc/giải mã gì từ Microsoft — client secret và toàn bộ việc kiểm tra nằm ở
// Django (core/microsoft_auth.py).

function CallbackHandler() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState('');
  // React 18 StrictMode gọi effect hai lần khi dev. Authorization code chỉ đổi
  // được ĐÚNG MỘT LẦN — lần thứ hai Microsoft trả invalid_grant và sinh viên thấy
  // lỗi dù đăng nhập thành công. Chốt lại bằng ref.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    // Microsoft báo lỗi ngay trên URL (SV bấm huỷ, admin chưa consent…)
    const oauthError = params.get('error');
    if (oauthError) {
      setError(
        params.get('error_description') ||
          'Đăng nhập Microsoft không hoàn tất. Vui lòng thử lại.',
      );
      return;
    }

    const code = params.get('code');
    const state = params.get('state');
    if (!code || !state) {
      setError('Thiếu thông tin trả về từ Microsoft. Vui lòng đăng nhập lại.');
      return;
    }

    api.auth
      .microsoftCallback(code, state)
      .then((res) => {
        setToken(res.access);
        const next = sessionStorage.getItem('hub_ms_next') || '/dashboard';
        sessionStorage.removeItem('hub_ms_next');
        router.replace(next.startsWith('/') ? next : '/dashboard');
      })
      .catch((err) => {
        setError(
          err instanceof ApiError
            ? err.message
            : 'Không kết nối được máy chủ. Vui lòng thử lại.',
        );
      });
  }, [params, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-subtle p-6">
      <div className="w-full max-w-[420px] text-center">
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <GraduationCap size={16} className="text-white" />
          </div>
          <span className="font-bold text-ink">IUOSS Hub</span>
        </div>

        {error ? (
          <>
            <div
              className="flex items-start gap-2.5 p-3.5 rounded-lg bg-danger-soft
                         border border-danger-line text-danger-text text-sm text-left"
            >
              <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
            <Link
              href="/login"
              className="inline-block mt-5 px-4 py-2.5 rounded-lg text-sm font-semibold
                         bg-white border border-line-strong hover:border-line-hover
                         hover:bg-surface-subtle text-ink-2 transition-colors"
            >
              Quay lại trang đăng nhập
            </Link>
          </>
        ) : (
          <div className="flex items-center justify-center gap-2.5 text-sm text-muted">
            <Loader2 size={16} className="animate-spin" />
            Đang xác thực tài khoản Microsoft…
          </div>
        )}
      </div>
    </div>
  );
}

export default function MicrosoftCallbackPage() {
  return (
    <Suspense>
      <CallbackHandler />
    </Suspense>
  );
}
