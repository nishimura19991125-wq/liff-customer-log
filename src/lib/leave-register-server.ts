import "server-only";

import {
  isPocketRateLimitMessage,
  safePocketErrorTextWithId,
} from "@/lib/api-error-response";
import {
  fetchAllRecordsPages,
  fetchAppFields,
  isPocketHttpRateLimitError,
  pocketRetryAfterMsFromError,
  type AtPocketRecordRow,
} from "@/lib/atpocket";
import { writePocketRecordWithImportKey } from "@/lib/atpocket-write-with-import-key";
import { escapePocketQueryValue } from "@/lib/atpocket-query-escape";
import { pickRecordValueByFieldAliases } from "@/lib/calendar-kojo";
import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";
import { normalizeDateForInput } from "@/lib/customer-info-form/resolve-fields";
import { jstYmd, normalizeDateTimeForPocketField } from "@/lib/jst-hm";
import {
  invalidateLeaveCache,
  resolveLeaveConfig,
  resolveLeaveFieldIds,
} from "@/lib/leave-server";
import {
  formatLeaveDayLabel,
  LEAVE_MAX_DAYS_PER_WEEK,
  leaveWeekKey,
} from "@/lib/leave-registration-view";
import { applyImportKeyForWrite } from "@/lib/pocket-import-key-payload";
import { resolveBoundStaffNameForLineUser } from "@/lib/staff-bound-lookup";

/**
 * 休みの登録（休暇・段階4）。画面は段階5。
 *
 * 仕様
 *   - 登録できるのは JST の「来週の月曜」から2週間（14日）。過去は不可
 *     （週は月曜始まり。日曜に開いたら翌日の月曜から）
 *   - 休暇種別は「休み」固定。従業員名はサーバが名簿の紐付けから決める
 *   - 1回に14日まで。取り消しは作らない
 */

const SCOPE = "api/attendance/leave";

export const LEAVE_TYPE_FIXED = "休み";
export const LEAVE_MAX_DAYS_PER_REQUEST = 14;
/** 来週の月曜から何日分を登録できるか */
const LEAVE_WINDOW_DAYS = 14;

// ─────────────────────────────────────────────────────────────
// API キー
// ─────────────────────────────────────────────────────────────

/**
 * 休暇アプリの API キー。**LEAVE_ATPOCKET_API_KEY の1本で、読み取りも書き込みも行う。**
 *
 * ほかの機能は読取①（無印）・読取②（_1）・更新③（_2）の3本を使うが、
 * 休暇アプリは1本で運用する方針。atpocket.ts の requireAppApiKey は
 * 書き込みに2番（_2）を要求し、無いと例外になるので使わない。
 * _1 / _2 が無いのは設定漏れではない。
 *
 * 将来キーを分けたくなったら、この関数を直す（書き込みだけ _2 を読むなど）。
 * 呼び出し側はこの関数だけを通しているので、ここを変えれば足りる。
 */
export function leaveApiKey(): string | null {
  return process.env.LEAVE_ATPOCKET_API_KEY?.trim() || null;
}

// ─────────────────────────────────────────────────────────────
// 入力の検証
// ─────────────────────────────────────────────────────────────

/** YYYY-MM-DD に日数を足す（暦の上の計算だけ。タイムゾーンは関係しない） */
function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

function weekdayOfYmd(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
}

/** 登録できる期間（JST の来週の月曜〜その13日後） */
export function leaveRegistrationWindow(now: Date = new Date()): {
  start: string;
  end: string;
} {
  const today = jstYmd(now);
  const dow = weekdayOfYmd(today); // 0=日
  // 週は月曜始まり。日曜→翌日、月曜→7日後、火曜→6日後 …
  const untilNextMonday = (8 - dow) % 7 || 7;
  const start = addDaysYmd(today, untilNextMonday);
  return { start, end: addDaysYmd(start, LEAVE_WINDOW_DAYS - 1) };
}

function isValidYmd(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  // 2026-02-30 のような存在しない日を弾く
  return addDaysYmd(s, 0) === s;
}

export type LeaveDatesValidation =
  | { ok: true; dates: string[] }
  | { ok: false; error: string };

export function validateLeaveDates(
  raw: unknown,
  now: Date = new Date(),
): LeaveDatesValidation {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: "登録する日付を選んでください" };
  }
  if (raw.length > LEAVE_MAX_DAYS_PER_REQUEST) {
    return {
      ok: false,
      error: `1回に登録できるのは${LEAVE_MAX_DAYS_PER_REQUEST}日までです`,
    };
  }
  const dates: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string" || !isValidYmd(v)) {
      return { ok: false, error: "日付の形式が正しくありません" };
    }
    dates.push(v);
  }
  if (new Set(dates).size !== dates.length) {
    return { ok: false, error: "同じ日付が重複しています" };
  }
  const { start, end } = leaveRegistrationWindow(now);
  if (dates.some((d) => d < start || d > end)) {
    return {
      ok: false,
      error: "登録できるのは来週の月曜から2週間の日付です",
    };
  }
  return { ok: true, dates: [...dates].sort() };
}

// ─────────────────────────────────────────────────────────────
// 書き込み
// ─────────────────────────────────────────────────────────────

/** 書き込みが 429 で落ちたか。status が分かるときは status で判定する（打刻と同じ） */
function isLeaveWriteRateLimited(error: unknown): boolean {
  const status =
    error && typeof error === "object"
      ? (error as { status?: unknown }).status
      : undefined;
  if (typeof status === "number") return status === 429;
  return isPocketHttpRateLimitError(error);
}

const RETRY_DEFAULT_WAIT_MS = 1_000;
const RETRY_MAX_WAIT_MS = 5_000;
const RETRY_JITTER_MS = 220;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 429 のときだけ1回入れ直す（打刻の writeAttendancePunchWithRetryOn429 と同じ作法）。
 * あちらは勤怠アプリの中にあって外から呼べないので、同じ判断をここに置いている。
 * 429 以外（400・403・500）は入れ直しても結果が変わらないので入れ直さない。
 */
async function writeWithRetryOn429<T>(
  run: () => Promise<T>,
  sleep: (ms: number) => Promise<void>,
): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (!isLeaveWriteRateLimited(e)) throw e;
    const wait = Math.min(
      pocketRetryAfterMsFromError(e) ?? RETRY_DEFAULT_WAIT_MS,
      RETRY_MAX_WAIT_MS,
    );
    console.warn(`[${SCOPE}] 書き込みが 429 のため1回だけ入れ直します`, JSON.stringify({ waitMs: wait }));
    await sleep(wait + Math.floor(Math.random() * RETRY_JITTER_MS));
    return run();
  }
}

/**
 * 週（月曜〜日曜）ごとに「登録済み＋今回」が上限を超えていないかを見る。
 * 同じ日は1回だけ数える（登録済みの日をもう一度送っても二重に数えない）。
 * 超えている週があれば、どの週かが分かる文言を返す。無ければ null。
 *
 * 画面でも同じ制限をかけているが、API を直接呼べば超えられるので
 * ここでも見る。数え方は画面と同じ leaveWeekKey / LEAVE_MAX_DAYS_PER_WEEK。
 */
function findWeekOverLimit(
  dates: readonly string[],
  registered: ReadonlySet<string>,
  windowStart: string,
): string | null {
  const weeks = [...new Set(dates.map(leaveWeekKey))].sort();
  for (const monday of weeks) {
    const sunday = addDaysYmd(monday, 6);
    const days = new Set<string>();
    for (const d of registered) if (d >= monday && d <= sunday) days.add(d);
    const fresh = dates.filter((d) => leaveWeekKey(d) === monday && !registered.has(d));
    for (const d of fresh) days.add(d);
    if (days.size > LEAVE_MAX_DAYS_PER_WEEK) {
      const already = days.size - fresh.length;
      const diffDays = Math.round(
        (Date.parse(`${monday}T00:00:00Z`) - Date.parse(`${windowStart}T00:00:00Z`)) /
          86_400_000,
      );
      const label = diffDays >= 0 ? `第${Math.floor(diffDays / 7) + 1}週` : "この週";
      return `${label}（${formatLeaveDayLabel(monday)}〜${formatLeaveDayLabel(sunday)}）は週${LEAVE_MAX_DAYS_PER_WEEK}日までです（登録済み${already}日・今回${fresh.length}日）。選ぶ日を減らしてください。`;
    }
  }
  return null;
}

function readText(recObj: Record<string, unknown>, fieldId: string): string {
  const raw = pickRecordValueByFieldAliases(recObj, fieldId);
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "object" && "value" in (raw as object)) {
    const v = (raw as { value?: unknown }).value;
    return v === null || v === undefined ? "" : String(v).trim();
  }
  return String(raw).trim();
}

export type LeaveRegisterBreakdown = {
  /** 今回作った日 */
  created: string[];
  /** もともと登録されていたので飛ばした日 */
  alreadyRegistered: string[];
};

export type LeaveRegisterResult =
  | ({ ok: true } & LeaveRegisterBreakdown)
  /** 書き込む前に止まった（検証・紐付け・設定・読み取りの失敗）。何も書いていない */
  | { ok: false; status: number; error: string; correlationId?: string }
  /** 途中で書き込みが失敗した。そこで止めた。作った分は消さない */
  | ({
      ok: false;
      status: number;
      error: string;
      correlationId: string;
      /** 失敗した日（ここで止めた） */
      failed: string;
      /** 失敗したので試していない日 */
      notAttempted: string[];
    } & LeaveRegisterBreakdown);

export type RegisterLeavesOptions = {
  now?: Date;
  /** テスト用（429 の入れ直しの待ち） */
  sleep?: (ms: number) => Promise<void>;
};

/**
 * 休みを登録する。
 *
 *   1. その期間の休暇を**その場で1回**読む（段階1のキャッシュは最大5分古い
 *      ので使わない）。本人の登録済みの日は飛ばす → やり直しても二重にならない
 *   2. 1日ずつ順に作る。429 は1回だけ入れ直す。それでも失敗したらそこで止める
 *   3. 作った日・失敗した日・試していない日を分けて返す
 *
 * 失敗しても作った分は消さない（消す処理も失敗しうる）。残りは次の登録で
 * 1 が登録済みとして拾う。
 */
export async function registerLeavesForLineUser(
  lineUserId: string,
  rawDates: unknown,
  options: RegisterLeavesOptions = {},
): Promise<LeaveRegisterResult> {
  const now = options.now ?? new Date();
  const sleep = options.sleep ?? defaultSleep;

  const validation = validateLeaveDates(rawDates, now);
  if (!validation.ok) {
    return { ok: false, status: 400, error: validation.error };
  }
  const dates = validation.dates;

  const cfg = resolveLeaveConfig();
  const apiKey = leaveApiKey();
  if (!cfg.enabled || !apiKey) {
    return { ok: false, status: 503, error: "休みの登録は現在利用できません" };
  }

  const staffName = await resolveBoundStaffNameForLineUser(lineUserId);
  if (!staffName) {
    return { ok: false, status: 403, error: "担当者の紐付けが必要です" };
  }

  const auth = { apiKey };
  const appId = cfg.appId;

  // ── 1) 列と、その期間の休暇（その場で1回） ──
  let ids: ReturnType<typeof resolveLeaveFieldIds>;
  const registered = new Set<string>();
  try {
    const fields = await fetchAppFields(appId, auth, {
      operation: "leave:fields",
      appEnv: "LEAVE_APP_ID",
    });
    ids = resolveLeaveFieldIds(fields);
    if (!ids.staffName || !ids.leaveDate || !ids.leaveType || !ids.importKey) {
      throw new Error(
        `休暇アプリの列が見つかりません staffName=${Boolean(ids.staffName)} leaveDate=${Boolean(ids.leaveDate)} leaveType=${Boolean(ids.leaveType)} importKey=${Boolean(ids.importKey)}`,
      );
    }

    // 氏名では絞らない。@pocket の一致は表記ゆれに弱いので、期間で取ってから
    // 正規化した氏名で突き合わせる（2週間分なので件数は小さい）。
    // 週2日の制限で登録済みの日を数えるため、選んだ日を含む週の月曜〜日曜を読む
    const from = leaveWeekKey(dates[0]!);
    const to = addDaysYmd(leaveWeekKey(dates[dates.length - 1]!), 6);
    const query = `${ids.leaveDate} >= "${escapePocketQueryValue(from)}" and ${ids.leaveDate} <= "${escapePocketQueryValue(to)}"`;
    const csv = [ids.staffName, ids.leaveType, ids.leaveDate, ids.importKey].join(",");
    const rows: AtPocketRecordRow[] = await fetchAllRecordsPages(
      appId,
      csv,
      auth,
      query,
      { operation: "leave:登録前の確認", appEnv: "LEAVE_APP_ID" },
      { maxPages: 1, maxRetries: 1, authKeys: [auth] },
    );
    if (rows.length >= 1000) {
      // 取り切れていない。登録済みを見落として二重に作るおそれがある
      throw new Error(`登録前の確認で取得の上限に達しました rows=${rows.length}`);
    }
    const me = normApClStaffName(staffName);
    for (const row of rows) {
      const rec = (row.record ?? {}) as Record<string, unknown>;
      if (normApClStaffName(readText(rec, ids.staffName)) !== me) continue;
      const d = normalizeDateForInput(
        normalizeDateTimeForPocketField(readText(rec, ids.leaveDate), "Date"),
      );
      if (d) registered.add(d);
    }
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    const { text, correlationId } = safePocketErrorTextWithId(e, {
      scope: SCOPE,
      message: "休みの登録に失敗しました。しばらくしてから再度お試しください。",
    });
    return {
      ok: false,
      status: isPocketRateLimitMessage(raw) || isLeaveWriteRateLimited(e) ? 429 : 502,
      error: text,
      correlationId,
    };
  }

  // ── 週2日までの制限（登録済みも数える）。超えていたら1日も書かない ──
  const over = findWeekOverLimit(dates, registered, leaveRegistrationWindow(now).start);
  if (over) {
    return { ok: false, status: 400, error: over };
  }

  // ── 2) 1日ずつ作る ──
  const alreadyRegistered = dates.filter((d) => registered.has(d));
  const toCreate = dates.filter((d) => !registered.has(d));
  const created: string[] = [];
  const touchedMonths = new Set<string>();

  const finish = () => {
    // 書きにいった月（作れた日・失敗した日）のキャッシュを捨てる。
    // 失敗した書き込みも @pocket 側では通っている可能性があるので含める
    for (const ym of touchedMonths) {
      const [y, m] = ym.split("-").map(Number);
      invalidateLeaveCache(y, m);
    }
  };

  for (let i = 0; i < toCreate.length; i++) {
    const date = toCreate[i]!;
    touchedMonths.add(date.slice(0, 7));
    const payload = applyImportKeyForWrite(
      {
        [ids.staffName!]: staffName,
        [ids.leaveType!]: LEAVE_TYPE_FIXED,
        [ids.leaveDate!]: normalizeDateTimeForPocketField(date, "Date"),
      },
      { importKeyFieldId: ids.importKey, mode: "create" },
    );
    try {
      await writeWithRetryOn429(
        () =>
          writePocketRecordWithImportKey({
            appId,
            payload,
            importKeyFieldId: ids.importKey ?? undefined,
            writeAuth: auth,
          }),
        sleep,
      );
      created.push(date);
    } catch (e) {
      finish();
      const rateLimited = isLeaveWriteRateLimited(e);
      const { text, correlationId } = safePocketErrorTextWithId(e, {
        scope: SCOPE,
        message: "休みの登録が途中で失敗しました。もう一度送ると、残りの日だけを登録します。",
        rateLimitedMessage:
          "休みの登録が途中で止まりました。時間をおいてもう一度送ると、残りの日だけを登録します。",
      });
      const notAttempted = toCreate.slice(i + 1);
      // 件数だけ。氏名・日付の中身は出さない
      console.warn(
        `[${SCOPE}] correlationId=${correlationId} partial`,
        JSON.stringify({
          created: created.length,
          alreadyRegistered: alreadyRegistered.length,
          notAttempted: notAttempted.length,
          rateLimited,
        }),
      );
      return {
        ok: false,
        status: rateLimited ? 429 : 502,
        error: text,
        correlationId,
        created,
        alreadyRegistered,
        failed: date,
        notAttempted,
      };
    }
  }

  finish();
  console.info(
    `[${SCOPE}] registered`,
    JSON.stringify({ created: created.length, alreadyRegistered: alreadyRegistered.length }),
  );
  return { ok: true, created, alreadyRegistered };
}
