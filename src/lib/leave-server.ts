import "server-only";

import { randomUUID } from "node:crypto";

import {
  apiKeyForAppFields,
  fetchAllRecordsPages,
  fetchAppFields,
  isPocketHttpRateLimitError,
  type AtPocketFieldRow,
  type AtPocketRecordRow,
} from "@/lib/atpocket";
import { escapePocketQueryValue } from "@/lib/atpocket-query-escape";
import { atPocketRecordIdFromRow } from "@/lib/atpocket-record-id";
import {
  pickRecordValueByFieldAliases,
  resolveConfiguredFieldToSchemaUniqueId,
} from "@/lib/calendar-kojo";
import { normalizeDateForInput } from "@/lib/customer-info-form/resolve-fields";
import { normalizeDateTimeForPocketField } from "@/lib/jst-hm";

/**
 * 休暇アプリの読み取り（段階1）。
 *
 * どこにもつないでいない。勤怠カレンダーの API（段階2）から呼ぶ予定。
 * 書き込みは段階4で作る。
 */

const SCOPE = "leave";

// ─────────────────────────────────────────────────────────────
// 設定
// ─────────────────────────────────────────────────────────────

/**
 * ■ API キーは LEAVE_ATPOCKET_API_KEY（0番）の1本だけで動く。設定漏れではない
 *
 * ほかの機能は読取①（無印）・読取②（_1）・更新③（_2）の3本を使うが、
 * 休暇アプリには1本しか発行していない。atpocket.ts の requireAppApiKey は
 * 番号ごとに決まった環境変数しか読まず、_1 / _2 が無いと例外になる
 * （0番へは戻らない）。そこで読み取りは次の2つだけを使う。
 *   - レコード一覧: LEAVE_ATPOCKET_API_KEY をそのまま使う（requireAppApiKey の
 *     0番と同じ環境変数。requireAppApiKey は export されていない）
 *   - 列定義: apiKeyForAppFields("LEAVE")。_FIELDS が無ければ 0番に戻る
 * どちらも 0番の1本で足りるので、**_1 や _2 を足す必要はない。**
 *
 * ⚠ 書き込み（段階4）は別に判断が要る。既存の作法どおり requireAppApiKey の
 *   2番を使うと、1本だけの設定では例外になる。そのときにキーの扱いを決める。
 */
export type LeaveConfig =
  | { enabled: false }
  | { enabled: true; appId: string; apiKey: string };

export function resolveLeaveConfig(): LeaveConfig {
  const appId = process.env.LEAVE_APP_ID?.trim();
  const apiKey = process.env.LEAVE_ATPOCKET_API_KEY?.trim();
  // 未設定は「機能を使っていない」。エラーにしない
  if (!appId || !apiKey) return { enabled: false };
  return { enabled: true, appId, apiKey };
}

// ─────────────────────────────────────────────────────────────
// 列
// ─────────────────────────────────────────────────────────────

export type LeaveFieldIds = {
  staffName: string | null;
  leaveType: string | null;
  leaveDate: string | null;
  /** 取込キー（kyukaID・自動採番）。書き込み（段階4）で使う */
  importKey: string | null;
};

function nfkc(s: string): string {
  return s.normalize("NFKC").trim();
}

function pickByCaptions(
  fields: AtPocketFieldRow[],
  captions: string[],
): string | null {
  for (const caption of captions) {
    const target = nfkc(caption).toLowerCase();
    for (const f of fields) {
      const cap = f.caption ? nfkc(String(f.caption)).toLowerCase() : "";
      const id = f.uniqueId?.trim();
      if (cap && id && cap === target) return id;
    }
  }
  return null;
}

/** 環境変数があればそれ、無ければ見出しで探す（WORK_END_REPORT_* と同じ作法） */
function resolveFieldId(
  envKey: string,
  fields: AtPocketFieldRow[],
  captions: string[],
): string | null {
  const raw = process.env[envKey]?.trim();
  if (raw) {
    const resolved = resolveConfiguredFieldToSchemaUniqueId(raw, fields);
    if (resolved) return resolved;
  }
  const picked = pickByCaptions(fields, captions);
  if (!picked) return null;
  return resolveConfiguredFieldToSchemaUniqueId(picked, fields) ?? picked;
}

export function resolveLeaveFieldIds(fields: AtPocketFieldRow[]): LeaveFieldIds {
  let importKey = resolveFieldId("LEAVE_IMPORT_KEY_FIELD_ID", fields, ["kyukaID"]);
  if (!importKey) {
    const auto = fields.find(
      (f) => (f.fieldType ?? "").trim() === "AutoNumber" && f.uniqueId?.trim(),
    );
    importKey = auto?.uniqueId?.trim() ?? null;
  }
  return {
    staffName: resolveFieldId("LEAVE_STAFF_NAME_FIELD_ID", fields, ["従業員名"]),
    leaveType: resolveFieldId("LEAVE_TYPE_FIELD_ID", fields, ["休暇種別"]),
    leaveDate: resolveFieldId("LEAVE_DATE_FIELD_ID", fields, ["休暇予定日"]),
    importKey,
  };
}

// ─────────────────────────────────────────────────────────────
// 月ごとの取得とキャッシュ
// ─────────────────────────────────────────────────────────────

export type LeaveEntry = {
  recordId: string | null;
  /** @pocket の値そのまま。突き合わせる側で正規化する */
  staffName: string;
  leaveType: string;
  /** JST の YYYY-MM-DD */
  date: string;
};

/**
 * 呼び出し側は status で分ける。
 * error のときは entries を持たない。空の配列で「休みが無い」と
 * 読み違えられないようにするため。
 */
export type LeaveMonthResult =
  | { status: "disabled" }
  | { status: "ok"; entries: LeaveEntry[] }
  | { status: "error"; rateLimited: boolean; correlationId: string };

/** 5分。登録したときは invalidateLeaveCache で消す */
const LEAVE_CACHE_TTL_MS = 300_000;
/** 1ページ1000件。月の休みは多くても数百件の想定 */
const LEAVE_MAX_PAGES = 3;
const LEAVE_PAGE_LIMIT = 1000;

type CacheEntry = { expiresAt: number; entries: LeaveEntry[] };

/**
 * キーは「年月」だけ。**本人の名前で絞らない。**
 * 絞ると利用者ごとに別のキャッシュになり、@pocket への問い合わせが
 * 人数分に増える（上限は 100秒/100回 をサイト全体で共有している）。
 * 全員分を1回読み、本人の分は呼び出し側がメモリ上で絞る。
 */
const cache = new Map<string, CacheEntry>();
/**
 * 実行中の取得もキーごとに持つ（工事レコードのキャッシュと同じ作法）。
 * 1本だけ持つと、同時に来た別の月の要求に先の月の結果を返してしまう。
 */
const inflight = new Map<string, Promise<LeaveMonthResult>>();

export function leaveMonthCacheKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function monthBounds(year: number, month: number): { start: string; end: string } {
  const last = new Date(year, month, 0).getDate();
  const m = String(month).padStart(2, "0");
  return { start: `${year}-${m}-01`, end: `${year}-${m}-${String(last).padStart(2, "0")}` };
}

function readText(recObj: Record<string, unknown>, fieldId: string | null): string {
  if (!fieldId) return "";
  const raw = pickRecordValueByFieldAliases(recObj, fieldId);
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "object" && "value" in (raw as object)) {
    const v = (raw as { value?: unknown }).value;
    return v === null || v === undefined ? "" : String(v).trim();
  }
  return String(raw).trim();
}

function toEntries(
  rows: AtPocketRecordRow[],
  ids: LeaveFieldIds,
  start: string,
  end: string,
): LeaveEntry[] {
  const out: LeaveEntry[] = [];
  for (const row of rows) {
    const recObj = (row.record ?? {}) as Record<string, unknown>;
    const staffName = readText(recObj, ids.staffName);
    const date = normalizeDateForInput(
      normalizeDateTimeForPocketField(readText(recObj, ids.leaveDate), "Date"),
    );
    if (!staffName || !date) continue;
    // query が効かなかったときに備えて、月の外はここでも落とす
    if (date < start || date > end) continue;
    out.push({
      recordId: atPocketRecordIdFromRow(row) ?? null,
      staffName,
      leaveType: readText(recObj, ids.leaveType),
      date,
    });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

async function loadLeaveMonth(
  cfg: { appId: string; apiKey: string },
  year: number,
  month: number,
): Promise<LeaveMonthResult> {
  const key = leaveMonthCacheKey(year, month);
  try {
    const fields = await fetchAppFields(
      cfg.appId,
      { apiKey: apiKeyForAppFields("LEAVE") },
      { operation: "leave:fields", appEnv: "LEAVE_APP_ID" },
    );
    const ids = resolveLeaveFieldIds(fields);
    if (!ids.staffName || !ids.leaveDate) {
      // 設定はされているのに列が無い＝壊れている。無効扱いにはしない
      const correlationId = randomUUID().slice(0, 8);
      console.error(
        `[${SCOPE}] correlationId=${correlationId} month=${key} fields-missing`,
        JSON.stringify({ staffName: Boolean(ids.staffName), leaveDate: Boolean(ids.leaveDate) }),
      );
      return { status: "error", rateLimited: false, correlationId };
    }

    const { start, end } = monthBounds(year, month);
    const query = `${ids.leaveDate} >= "${escapePocketQueryValue(start)}" and ${ids.leaveDate} <= "${escapePocketQueryValue(end)}"`;
    const csv = [ids.staffName, ids.leaveType, ids.leaveDate, ids.importKey]
      .filter(Boolean)
      .join(",");
    const auth = { apiKey: cfg.apiKey };
    const rows = await fetchAllRecordsPages(
      cfg.appId,
      csv,
      auth,
      query,
      { operation: "leave:月一覧", appEnv: "LEAVE_APP_ID" },
      { maxPages: LEAVE_MAX_PAGES, maxRetries: 1, authKeys: [auth] },
    );

    if (rows.length >= LEAVE_MAX_PAGES * LEAVE_PAGE_LIMIT) {
      // 上限で打ち切られた。足りない結果を「全部」として返さない
      const correlationId = randomUUID().slice(0, 8);
      console.error(
        `[${SCOPE}] correlationId=${correlationId} month=${key} truncated rows=${rows.length}`,
      );
      return { status: "error", rateLimited: false, correlationId };
    }

    const entries = toEntries(rows, ids, start, end);
    // 件数だけ。氏名は出さない
    console.info(
      `[${SCOPE}] month=${key}`,
      JSON.stringify({ rows: rows.length, entries: entries.length }),
    );
    return { status: "ok", entries };
  } catch (e) {
    const correlationId = randomUUID().slice(0, 8);
    const rateLimited = isPocketHttpRateLimitError(e);
    // 問い合わせは日付だけで氏名を含まない。生メッセージはここにだけ残す
    console.error(
      `[${SCOPE}] correlationId=${correlationId} month=${key} rateLimited=${rateLimited}: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return { status: "error", rateLimited, correlationId };
  }
}

/**
 * その月の休みを**全員分**返す。利用者は受け取らない（キャッシュを共有するため）。
 * 失敗はキャッシュしない。次の要求で取り直す。
 */
export async function fetchLeaveMonth(
  year: number,
  month: number,
): Promise<LeaveMonthResult> {
  const cfg = resolveLeaveConfig();
  if (!cfg.enabled) return { status: "disabled" };

  const key = leaveMonthCacheKey(year, month);
  const hit = cache.get(key);
  if (hit && Date.now() < hit.expiresAt) {
    return { status: "ok", entries: hit.entries };
  }

  const running = inflight.get(key);
  if (running) return running;

  const p = loadLeaveMonth(cfg, year, month).then((res) => {
    // 取得中に invalidate されていたら、古い結果で埋め戻さない
    if (res.status === "ok" && inflight.get(key) === p) {
      cache.set(key, { expiresAt: Date.now() + LEAVE_CACHE_TTL_MS, entries: res.entries });
    }
    return res;
  });
  inflight.set(key, p);
  // 終わったら自分の分だけ外す。途中で invalidate されて同じキーの新しい
  // 取得が入っていたら、それは消さない
  const release = () => {
    if (inflight.get(key) === p) inflight.delete(key);
  };
  p.then(release, release);
  return p;
}

/** 月を指定するとその月だけ、省略すると全部消す（登録のあとに呼ぶ） */
export function invalidateLeaveCache(year?: number, month?: number): void {
  if (year !== undefined && month !== undefined) {
    const key = leaveMonthCacheKey(year, month);
    cache.delete(key);
    inflight.delete(key);
    return;
  }
  cache.clear();
  inflight.clear();
}
