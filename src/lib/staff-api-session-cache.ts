/** ブラウザ sessionStorage 上の /api/staff 応答キャッシュ（429 連打防止） */

export const STAFF_API_SESSION_CACHE_KEY = "liff_staff_api_cache_v2";
/** サーバー名簿 TTL（既定 30 分）に合わせ、429 連打を抑える */
const STAFF_API_SESSION_CACHE_TTL_MS = 30 * 60 * 1000;

export type StaffApiSessionCachePayload = {
  savedAt: number;
  staff: { id: string; name: string; importKey?: string }[];
  boundStaff: {
    id: string;
    name: string;
    department?: string;
    staffRole?: "ap" | "cl";
  } | null;
  bindingEnabled: boolean;
  bindingConfigError?: string;
};

export function readStaffApiSessionCache(
  allowExpired = false,
): StaffApiSessionCachePayload | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STAFF_API_SESSION_CACHE_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as StaffApiSessionCachePayload;
    if (!j.savedAt || !Array.isArray(j.staff)) return null;
    if (
      !allowExpired &&
      Date.now() - j.savedAt > STAFF_API_SESSION_CACHE_TTL_MS
    ) {
      return null;
    }
    return j;
  } catch {
    return null;
  }
}

export function writeStaffApiSessionCache(
  payload: Omit<StaffApiSessionCachePayload, "savedAt">,
): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(
      STAFF_API_SESSION_CACHE_KEY,
      JSON.stringify({ ...payload, savedAt: Date.now() } satisfies StaffApiSessionCachePayload),
    );
  } catch {
    /* ignore quota */
  }
}

/**
 * キャッシュを破棄する。次の取得で必ず /api/staff を呼び直す。
 *
 * ■ なぜ「更新」ではなく「破棄」か
 * 紐づけ（POST /api/staff/bind）の応答は boundStaff: {id, name} だけで、
 * department / staffRole を含まない。応答の値でキャッシュを書き換えると、
 * **部署と AP/CL 役割が欠けたまま 30 分保持される**。
 * 破棄して取り直せば、/api/staff が揃った値を返す。
 *
 * ■ 呼ぶ場所
 * 紐づけ成功の直後（use-liff-account-strip.ts）と、再ログイン時
 * （liff-session.ts の clearLiffProfileCache）。
 * 破棄しないと、紐づけ前に保存された boundStaff: null が最大 30 分残り、
 * ページ遷移のたびに紐づけ画面が再表示される。
 */
export function clearStaffApiSessionCache(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(STAFF_API_SESSION_CACHE_KEY);
  } catch {
    /* プライベートブラウジング等。消せなくても致命的ではない */
  }
}

export async function fetchStaffApiWithSessionCache(
  idToken: string,
): Promise<{
  res: Response;
  data: StaffApiSessionCachePayload & {
    lineUserId?: string;
    rosterStale?: boolean;
    rateLimited?: boolean;
    rosterMessage?: string;
    error?: string;
  };
  fromCache: boolean;
}> {
  const cached = readStaffApiSessionCache();
  if (cached) {
    return {
      res: new Response(null, { status: 200 }),
      data: {
        ...cached,
        rosterStale: true,
      },
      fromCache: true,
    };
  }

  const res = await fetch("/api/staff", {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  const data = (await res.json()) as StaffApiSessionCachePayload & {
    lineUserId?: string;
    rosterStale?: boolean;
    rateLimited?: boolean;
    rosterMessage?: string;
    error?: string;
  };

  if (res.status === 429) {
    const stale = readStaffApiSessionCache(true);
    if (stale) {
      return {
        res: new Response(null, { status: 200 }),
        data: { ...stale, rosterStale: true, rateLimited: true },
        fromCache: true,
      };
    }
  }

  if (
    res.ok &&
    Array.isArray(data.staff) &&
    data.staff.length === 0 &&
    data.rateLimited
  ) {
    const stale = readStaffApiSessionCache(true);
    if (stale?.staff.length) {
      return {
        res: new Response(null, { status: 200 }),
        data: { ...stale, rosterStale: true, rateLimited: true },
        fromCache: true,
      };
    }
  }

  if (res.ok && Array.isArray(data.staff)) {
    writeStaffApiSessionCache({
      staff: data.staff,
      boundStaff: data.boundStaff ?? null,
      bindingEnabled: Boolean(data.bindingEnabled),
      bindingConfigError: data.bindingConfigError,
    });
  }

  return { res, data, fromCache: false };
}
