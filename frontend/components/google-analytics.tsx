'use client';

import { useEffect, useState } from 'react';
import Script from 'next/script';

// Google Analytics 4 — chỉ chạy trên tên miền live, để sandbox/local không làm sai số liệu.
// Lọc theo hostname lúc chạy (không dùng biến NEXT_PUBLIC_*) vì sandbox build từ cùng mã nguồn.
// Chuyển trang client-side đã được GA4 tự đếm (Enhanced measurement → history events).
const GA_ID = 'G-KZ54N0MHJC';
const LIVE_HOSTS = new Set(['hub.iuoss.com', 'graduation.iuoss.com']);

export default function GoogleAnalytics() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    setEnabled(LIVE_HOSTS.has(window.location.hostname));
  }, []);

  if (!enabled) return null;

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
        strategy="afterInteractive"
      />
      <Script id="ga4-init" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GA_ID}');`}
      </Script>
    </>
  );
}
