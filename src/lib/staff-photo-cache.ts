import "server-only";

/**
 * 顔写真のサーバ内キャッシュ。
 *
 * 上位3人ぶんとはいえ、**全員が同じ3人を見る**。キャッシュが無いと
 * 閲覧者の人数だけ @pocket への往復が起きる。
 * 単一化（inflight）の作りは sales-dashboard-response-cache と同じ。
 *
 * キーは正規化済みの担当者名。画像そのものは個人情報ではあるが、
 * 名簿に登録された業務用の写真で、閲覧できるのは認証済みの社員だけ。
 */

export type StaffPhotoPayload = {
  body: Buffer;
  mimeType: string;
};

type Entry = {
  expiresAt: number;
  /** null = この人には写真が無い（無い、を覚えて往復を減らす） */
  payload: StaffPhotoPayload | null;
};

const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<StaffPhotoPayload | null>>();

/** 名簿キャッシュ（既定30分）と同じ長さにそろえる */
const DEFAULT_TTL_MS = 30 * 60 * 1000;

function ttlMs(): number {
  const raw = process.env.STAFF_PHOTO_CACHE_MS?.trim();
  const n = raw ? Number(raw) : DEFAULT_TTL_MS;
  if (!Number.isFinite(n)) return DEFAULT_TTL_MS;
  return Math.min(60 * 60 * 1000, Math.max(60 * 1000, n));
}

export async function getOrLoadStaffPhoto(
  key: string,
  load: () => Promise<StaffPhotoPayload | null>,
): Promise<StaffPhotoPayload | null> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expiresAt > now) return hit.payload;

  const pending = inflight.get(key);
  if (pending) return pending;

  const p = (async () => {
    try {
      const payload = await load();
      store.set(key, { expiresAt: Date.now() + ttlMs(), payload });
      return payload;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, p);
  return p;
}

/** テスト用 */
export function resetStaffPhotoCache(): void {
  store.clear();
  inflight.clear();
}
