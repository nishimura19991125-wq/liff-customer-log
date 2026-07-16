/** 掲示板の既読状態（端末の localStorage・LINEユーザーごと） */

const STORAGE_PREFIX = "bulletin-read-v1";

export const BULLETIN_READ_CHANGED_EVENT = "bulletin-read-changed";

function storageKey(userKey: string): string {
  return `${STORAGE_PREFIX}:${userKey.normalize("NFKC").trim()}`;
}

export function readBulletinPostIds(userKey: string): Set<string> {
  if (!userKey.trim() || typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(storageKey(userKey));
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((id): id is string => typeof id === "string"));
  } catch {
    return new Set();
  }
}

export function markBulletinPostRead(
  userKey: string,
  postId: string,
): Set<string> {
  const key = userKey.trim();
  const id = postId.trim();
  if (!key || !id || typeof window === "undefined") return new Set();
  const next = readBulletinPostIds(key);
  if (next.has(id)) return next;
  next.add(id);
  try {
    localStorage.setItem(storageKey(key), JSON.stringify([...next]));
    window.dispatchEvent(new Event(BULLETIN_READ_CHANGED_EVENT));
  } catch {
    /* ignore */
  }
  return next;
}
