'use client';

import { useEffect, useLayoutEffect, useState } from 'react';
import { ClipboardList, FileText } from 'lucide-react';
import { api } from './api';
import type { FeatureFlags } from './types';

// ── Cờ tính năng ─────────────────────────────────────────────────────────────
// Nguồn sự thật DUY NHẤT là backend (`settings.FEATURE_*`, mặc định tắt trên
// production). Cờ tắt KHÔNG có nghĩa là ẩn khỏi menu: mục vẫn hiện, bấm vào thì
// ra trang "đang phát triển" (<ComingSoon />). Backend vẫn chặn endpoint thật,
// nên tính năng chưa mở thì không ai gọi được, dù có sửa localStorage.
//
// Thêm một tính năng đang chờ phát triển = thêm 1 dòng vào FEATURE_META +
// FEATURE_ROUTES ở dưới, và 1 cờ FEATURE_* bên backend. Không cần sửa gì khác.

export type FeatureKey = keyof FeatureFlags;

export interface FeatureMeta {
  /** Tên hiển thị ở menu và tiêu đề trang chờ. */
  label: string;
  /** Route gốc của tính năng — dùng cho cả menu lẫn nhận diện trang. */
  href: string;
  icon: React.ElementType;
}

export const FEATURE_META: Record<FeatureKey, FeatureMeta> = {
  document_requests: {
    label: 'Yêu cầu giấy tờ',
    href: '/dashboard/requests/new',
    icon: FileText,
  },
  civic_activities: {
    label: 'Sinh hoạt công dân',
    href: '/dashboard/sinh-hoat-cong-dan',
    icon: ClipboardList,
  },
};

/** Tiền tố URL → tính năng chi phối nó. Khớp theo tiền tố nên bao cả route con. */
const FEATURE_ROUTES: { prefix: string; feature: FeatureKey }[] = [
  { prefix: '/dashboard/requests', feature: 'document_requests' },
  { prefix: '/dashboard/sinh-hoat-cong-dan', feature: 'civic_activities' },
];

/** Tính năng chi phối route này (null nếu route không bị cờ nào chi phối). */
export function featureForRoute(pathname: string): FeatureKey | null {
  return FEATURE_ROUTES.find((r) => pathname.startsWith(r.prefix))?.feature ?? null;
}

const ALL_OFF: FeatureFlags = {
  document_requests: false,
  civic_activities: false,
};

const CACHE_KEY = 'hub_features';

function normalize(raw: Partial<FeatureFlags>): FeatureFlags {
  return {
    document_requests: raw.document_requests === true,
    civic_activities: raw.civic_activities === true,
  };
}

function readCache(): FeatureFlags | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    return raw ? normalize(JSON.parse(raw) as Partial<FeatureFlags>) : null;
  } catch {
    return null;
  }
}

function writeCache(flags: FeatureFlags) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(flags));
  } catch {
    /* sessionStorage bị chặn (private mode) — chấp nhận fetch lại mỗi lần load */
  }
}

/** Xoá cache cờ — gọi khi đăng xuất để phiên sau đọc lại từ server. */
export function clearFeatureCache() {
  try {
    sessionStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
}

export interface UseFeatures {
  features: FeatureFlags;
  /**
   * false cho tới khi biết chắc cờ (từ cache hoặc API). Dùng để hoãn việc đổi
   * giao diện: chưa biết thì đừng vội kết luận tính năng đang đóng.
   */
  ready: boolean;
}

// useLayoutEffect cảnh báo khi chạy trên server → đổi sang useEffect lúc SSR.
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function useFeatures(): UseFeatures {
  // ⚠️ KHÔNG đọc sessionStorage trong initializer của useState. Server không có
  // sessionStorage nên HTML dựng ra luôn là ALL_OFF; nếu client lần render đầu
  // lại đọc được cache thì hai bên lệch nhau → "Hydration failed".
  // Luôn khởi tạo bằng ALL_OFF cho khớp server, rồi áp cache ở effect.
  const [features, setFeatures] = useState<FeatureFlags>(ALL_OFF);
  const [ready, setReady] = useState(false);

  // Áp cache TRƯỚC khi trình duyệt vẽ khung hình đầu → không thấy chớp.
  useIsomorphicLayoutEffect(() => {
    const cached = readCache();
    if (cached) {
      setFeatures(cached);
      setReady(true);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    api.features
      .get()
      .then((flags) => {
        if (!alive) return;
        const next = normalize(flags);
        setFeatures(next);
        writeCache(next);
      })
      .catch(() => {
        // Không gọi được API → giữ ALL_OFF: hiện trang "đang phát triển" thay vì
        // form hỏng. Báo sai còn hơn để SV điền xong rồi gửi thất bại.
      })
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  return { features, ready };
}
