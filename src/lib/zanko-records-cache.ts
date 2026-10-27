import "server-only";

import {
  fetchAllRecordsPages,
  fetchAppFields,
  isPocketHttpRateLimitError,
  type AtPocketFetchAuth,
} from "@/lib/atpocket";
import {
  pocketFieldUniqueIdByCaption,
  resolveConfiguredFieldToSchemaUniqueId,
} from "@/lib/calendar-kojo";
import {
  buildZankoIndex,
  emptyZankoIndex,
  type ZankoIndex,
} from "@/lib/zanko-index";

/**
 * 残工案件アプリ（186）の全件を読み、T番号 → 残工日[] にしてキャッシュする
 * （残工 段階1）。
 *
 * ■ 環境変数
 *   ZANKO_APP_ID            アプリID（無ければ「無し」＝disabled）
 *   ZANKO_ATPOCKET_API_KEY  読み取り専用キー（無ければ disabled）
 *   ZANKO_TNUMBER_FIELD_ID  T番号の列（無ければ見出し「T番号」）
 *   ZANKO_DATE_FIELD_ID     残工日の列（無ければ見出し「残工日」）
 *   ZANKO_CACHE_SECONDS     キャッシュ（既定600秒・60〜7200秒）
 *
 * ■ 失敗しても投げない
 * 取得に失敗したら「残工なし」（status: "error"）を返す。カレンダー全体は
 * 表示させる。429 のときは、古い値があれば最大6時間それを返す（stale）。
 *
 * ■ 保存時には破棄しない
 * 186 は LIFF から書き込まない（@pocket 上で登録される）。カレンダーの
 * 保存で破棄しても中身は新しくならず、呼び出しが増えるだけなので、
 * invalidateAllCalendarPayloadCache からは呼ばない。TTL で更新する。
 *
 * ■ @pocket の呼び出し
 * 列定義1回（fetchAppFields のキャッシュ・30分）＋ 一覧 1000件ごとに1回。
 * 【延期】は残工日の無い行でも付くため、月で絞らず全件を読む。
 */

export type ZankoReadErrorReason =
  | "field_unresolved"
  | "rate_limited"
  | "fetch_failed";

export type ZankoReadResult =
  | { status: "disabled"; index: ZankoIndex }
  | { status: "ok"; index: ZankoIndex; stale?: boolean }
  | { status: "error"; reason: ZankoReadErrorReason; index: ZankoIndex };

const DEFAULT_TTL_SECONDS = 600;
const STALE_SERVE_MS = 6 * 60 * 60 * 1000;
/** 残工は1ページ（1000件）に収まる想定。万一超えても10ページで打ち切る */
const MAX_PAGES = 10;

export function zankoCacheTtlMs(): number {
  const raw = process.env.ZANKO_CACHE_SECONDS?.trim();
  const sec = raw ? Number(raw) : DEFAULT_TTL_SECONDS;
  if (!Number.isFinite(sec)) return DEFAULT_TTL_SECONDS * 1000;
  return Math.min(7_200, Math.max(60, sec)) * 1000;
}

type Config = {
  appId: string;
  auth: AtPocketFetchAuth;
  tNumberEnv: string;
  dateEnv: string;
};

function readConfig(): Config | null {
  const appId = process.env.ZANKO_APP_ID?.trim() ?? "";
  const apiKey = process.env.ZANKO_ATPOCKET_API_KEY?.trim() ?? "";
  if (!appId || !apiKey) return null;
  return {
    appId,
    auth: { apiKey },
    tNumberEnv: process.env.ZANKO_TNUMBER_FIELD_ID?.trim() ?? "",
    dateEnv: process.env.ZANKO_DATE_FIELD_ID?.trim() ?? "",
  };
}

type Entry = {
  key: string;
  freshUntil: number;
  staleUntil: number;
  index: ZankoIndex;
};

let cache: Entry | null = null;
const inflight = new Map<string, Promise<ZankoReadResult>>();

function cacheKey(cfg: Config): string {
  // キーそのものは入れない（値をメモリに残す箇所を増やさない）
  return JSON.stringify([cfg.appId, cfg.tNumberEnv, cfg.dateEnv]);
}

class FieldUnresolvedError extends Error {}

async function fetchIndex(cfg: Config): Promise<ZankoIndex> {
  const ctx = { operation: "zanko:残工案件一覧", appEnv: "ZANKO_APP_ID" };
  const fields = await fetchAppFields(cfg.appId, cfg.auth, ctx);

  const tNumberFieldId = cfg.tNumberEnv
    ? resolveConfiguredFieldToSchemaUniqueId(cfg.tNumberEnv, fields)
    : pocketFieldUniqueIdByCaption(fields, "T番号");
  const dateFieldId = cfg.dateEnv
    ? resolveConfiguredFieldToSchemaUniqueId(cfg.dateEnv, fields)
    : pocketFieldUniqueIdByCaption(fields, "残工日");
  if (!tNumberFieldId || !dateFieldId) {
    throw new FieldUnresolvedError("残工案件アプリの列が見つかりません");
  }

  const rows = await fetchAllRecordsPages(
    cfg.appId,
    [tNumberFieldId, dateFieldId].join(","),
    cfg.auth,
    null,
    ctx,
    { maxPages: MAX_PAGES, maxRetries: 1, authKeys: [cfg.auth] },
  );
  return buildZankoIndex(rows, { tNumberFieldId, dateFieldId });
}

export async function readZankoIndexCached(): Promise<ZankoReadResult> {
  const cfg = readConfig();
  if (!cfg) return { status: "disabled", index: emptyZankoIndex() };

  const key = cacheKey(cfg);
  const now = Date.now();
  if (cache && cache.key === key && now < cache.freshUntil) {
    return { status: "ok", index: cache.index };
  }

  const running = inflight.get(key);
  if (running) return running;

  const p = (async (): Promise<ZankoReadResult> => {
    try {
      const index = await fetchIndex(cfg);
      const ttl = zankoCacheTtlMs();
      const at = Date.now();
      cache = {
        key,
        freshUntil: at + ttl,
        staleUntil: at + ttl + STALE_SERVE_MS,
        index,
      };
      return { status: "ok", index };
    } catch (e) {
      if (e instanceof FieldUnresolvedError) {
        console.warn("[zanko-records-cache]", e.message);
        return {
          status: "error",
          reason: "field_unresolved",
          index: emptyZankoIndex(),
        };
      }
      const rateLimited = isPocketHttpRateLimitError(e);
      if (
        rateLimited &&
        cache &&
        cache.key === key &&
        Date.now() < cache.staleUntil
      ) {
        console.warn("[zanko-records-cache] 429 のため古い残工案件を返します");
        return { status: "ok", index: cache.index, stale: true };
      }
      console.error("[zanko-records-cache] 残工案件を読めませんでした", e);
      return {
        status: "error",
        reason: rateLimited ? "rate_limited" : "fetch_failed",
        index: emptyZankoIndex(),
      };
    }
  })();

  inflight.set(key, p);
  const release = () => {
    if (inflight.get(key) === p) inflight.delete(key);
  };
  p.then(release, release);
  return p;
}

/** テスト用・設定を変えたとき用 */
export function invalidateZankoRecordsCache(): void {
  cache = null;
  inflight.clear();
}
