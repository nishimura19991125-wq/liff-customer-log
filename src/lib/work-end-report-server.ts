import "server-only";

import {
  apiKeyForWorkEndReportPocket,
  apiKeyForWorkEndReportPocket1,
  apiKeyForWorkEndReportWrite,
  createRecord,
  fetchAppFields,
  fetchRecordsList,
  type AtPocketFieldRow,
  type AtPocketRecordRow,
} from "@/lib/atpocket";
import { atPocketRecordIdFromRow } from "@/lib/atpocket-record-id";
import { pickRecordValueByFieldAliases, ymdKey } from "@/lib/calendar-kojo";
import { resolveBoundStaffNameForLineUser } from "@/lib/staff-bound-lookup";
import { punchAttendanceForLineUser } from "@/lib/attendance-server";
import { lookupStaffDepartmentByStaffName } from "@/lib/staff-department-lookup";
import {
  getWorkEndReportRowsCached,
  invalidateWorkEndReportRowsCache,
  workEndReportRowsCacheKey,
} from "@/lib/work-end-report-cache";
import { resolveWorkEndReportAppId } from "@/lib/work-end-report-config";
import {
  applyWorkEndReportAutoNumberOnCreate,
  resolveWorkEndReportFieldIds,
  workEndReportFieldsConfigured,
  workEndReportFieldsCsv,
  workEndReportMissingFieldEnvKeys,
  type WorkEndReportFieldIds,
} from "@/lib/work-end-report-fields";
import {
  WORK_END_REPORT_APO_ACTIVITY_OPTIONS,
  isWorkEndApoActivityImplemented,
  type WorkEndReportFormValues,
  type WorkEndReportRecordSnapshot,
  type WorkEndReportStatus,
} from "@/lib/work-end-report-types";

export type { WorkEndReportStatus } from "@/lib/work-end-report-types";

const FIELDS_CACHE_MS = 3_600_000;
let fieldsCache: {
  appId: string;
  ids: WorkEndReportFieldIds;
  appFields: AtPocketFieldRow[];
  expiresAt: number;
} | null = null;

function todayYmdJst(): string {
  const d = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" }),
  );
  return ymdKey(d);
}

function nfkcName(s: string): string {
  return s.normalize("NFKC").trim();
}

function readFieldText(
  recObj: Record<string, unknown>,
  fieldId: string | null,
): string {
  if (!fieldId) return "";
  const raw = pickRecordValueByFieldAliases(recObj, fieldId);
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "object" && raw !== null && "value" in raw) {
    const v = (raw as { value?: unknown }).value;
    return v === null || v === undefined ? "" : nfkcName(String(v));
  }
  return nfkcName(String(raw));
}

function parseWorkDateYmd(raw: string): string | null {
  const s = raw.replace(/\//g, "-").trim();
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (!m) return null;
  const y = m[1];
  const mo = String(Number(m[2])).padStart(2, "0");
  const d = String(Number(m[3])).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

function recordAppliesToToday(
  recObj: Record<string, unknown>,
  ids: WorkEndReportFieldIds,
  today: string,
): boolean {
  const dateYmd = parseWorkDateYmd(readFieldText(recObj, ids.reportDate));
  return dateYmd === today;
}

function snapshotFromRecord(
  recObj: Record<string, unknown>,
  ids: WorkEndReportFieldIds,
): WorkEndReportRecordSnapshot {
  return {
    pinponCount: readFieldText(recObj, ids.pinponCount) || undefined,
    meetingCount: readFieldText(recObj, ids.meetingCount) || undefined,
    apoCount: readFieldText(recObj, ids.apoCount) || undefined,
    apoActivity: readFieldText(recObj, ids.apoActivity) || undefined,
    workArea: readFieldText(recObj, ids.workArea) || undefined,
  };
}

function apoActivityOptions(): readonly string[] {
  return WORK_END_REPORT_APO_ACTIVITY_OPTIONS;
}

function workEndReportMaxPages(): number {
  const raw = process.env.WORK_END_REPORT_MAX_PAGES?.trim();
  const n = raw ? Number(raw) : 2;
  if (!Number.isFinite(n) || n < 1) return 2;
  return Math.min(10, Math.floor(n));
}

function parseNonNegativeCount(
  label: string,
  raw: string | undefined,
  required: boolean,
): { ok: true; value: string | null } | { ok: false; error: string } {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) {
    if (required) {
      return { ok: false, error: `${label}を入力してください` };
    }
    return { ok: true, value: null };
  }
  if (!/^\d+$/.test(trimmed)) {
    return { ok: false, error: `${label}は0以上の整数で入力してください` };
  }
  return { ok: true, value: String(Number(trimmed)) };
}

function formatWorkEndReportCreateError(msg: string): string {
  if (
    (msg.includes("案件番号") || msg.includes("管理番号")) &&
    msg.includes("取込設定")
  ) {
    return [
      "案件番号（管理番号）は登録時に自動採番されますが、@pocket の取込設定が未完了のため登録できません。",
      "アプリ管理 → 稼働終了報告 → 取込 で「案件番号」を取込項目に追加して保存してください。",
      "（番号の手入力は不要です）",
    ].join("");
  }
  return msg;
}

async function loadWorkEndReportFieldIds(): Promise<
  | { ok: true; appId: string; ids: WorkEndReportFieldIds; appFields: AtPocketFieldRow[] }
  | { ok: false; status: number; error: string }
> {
  const resolved = await resolveWorkEndReportAppId();
  if (!resolved.appId) {
    return {
      ok: false,
      status: 503,
      error: resolved.error ?? "稼働終了報告アプリが未設定です",
    };
  }

  const appId = resolved.appId;

  if (
    fieldsCache &&
    fieldsCache.appId === appId &&
    fieldsCache.expiresAt > Date.now()
  ) {
    return { ok: true, appId, ids: fieldsCache.ids, appFields: fieldsCache.appFields };
  }

  const appFields = await fetchAppFields(
    appId,
    { apiKey: apiKeyForWorkEndReportPocket1() },
    { operation: "work-end:fields", appEnv: "WORK_END_REPORT_APP_ID" },
  );

  const ids = resolveWorkEndReportFieldIds(appFields);
  if (!workEndReportFieldsConfigured(ids)) {
    const missing = workEndReportMissingFieldEnvKeys(ids);
    return {
      ok: false,
      status: 503,
      error:
        missing.length > 0
          ? `稼働終了報告の列を解決できません。Netlify の環境変数（${missing.join(", ")}）を設定するか、@pocket の列見出しを確認してください。`
          : "稼働終了報告アプリの列設定を確認してください。",
    };
  }

  fieldsCache = {
    appId,
    ids,
    appFields,
    expiresAt: Date.now() + FIELDS_CACHE_MS,
  };

  return { ok: true, appId, ids, appFields };
}

/**
 * 1ページの取得件数。**打ち切り判定と必ず同じ値を使うこと。**
 *
 * 以前は limit を指定せず（＝@pocket 既定の 1000 件が返る）、打ち切りだけ
 * `recs.length < 100` で見ていた。1000 件返ってくるのに 100 件で判定して
 * いたので、レコードが 100 件を超えた時点から**毎回必ず2ページ目まで**
 * 取りに行っていた。取得回数が常に倍になっていたのがこれ。
 */
const WORK_END_REPORT_PAGE_LIMIT = 1000;

async function fetchTodayReportRowsFromPocket(
  appId: string,
  ids: WorkEndReportFieldIds,
): Promise<AtPocketRecordRow[]> {
  const csv = workEndReportFieldsCsv(ids);
  const readAuth = { apiKey: apiKeyForWorkEndReportPocket() };
  const pageCap = workEndReportMaxPages();
  const all: AtPocketRecordRow[] = [];

  for (let page = 1; page <= pageCap; page++) {
    const res = await fetchRecordsList(
      appId,
      {
        limit: String(WORK_END_REPORT_PAGE_LIMIT),
        page: String(page),
        fields: csv,
      },
      readAuth,
      { operation: "work-end:一覧", appEnv: "WORK_END_REPORT_APP_ID" },
    );
    const recs = res.records ?? [];
    all.push(...recs);
    if (recs.length < WORK_END_REPORT_PAGE_LIMIT) break;
  }

  return all;
}

/**
 * 当日分の突合に使う一覧。**全員で共有するキャッシュ越しに取る。**
 *
 * 絞り込みの無い全件取得で、中身は誰が見ても同じ。打刻画面を開くたびに
 * 利用者ごとに取り直すと、出勤が集中する時間帯だけで @pocket の上限
 * （100秒あたり100回・サイト単位）の一角を占める。
 *
 * `bypassCache` は二重提出の判定だけが渡す（古い一覧で「未提出」と
 * 判断してはならないため）。
 */
async function fetchTodayReportRows(
  appId: string,
  ids: WorkEndReportFieldIds,
  bypassCache?: boolean,
): Promise<AtPocketRecordRow[]> {
  return getWorkEndReportRowsCached(
    workEndReportRowsCacheKey(appId, workEndReportFieldsCsv(ids)),
    () => fetchTodayReportRowsFromPocket(appId, ids),
    bypassCache,
  );
}

function matchTodayReport(
  rows: AtPocketRecordRow[],
  staffName: string,
  ids: WorkEndReportFieldIds,
  today: string,
): AtPocketRecordRow | null {
  const target = nfkcName(staffName);

  for (const row of rows) {
    const recObj = row.record ?? {};
    const name = readFieldText(recObj, ids.reporter);
    if (!name || nfkcName(name) !== target) continue;
    if (!recordAppliesToToday(recObj as Record<string, unknown>, ids, today)) {
      continue;
    }
    return row;
  }

  return null;
}

async function lookupStaffDepartment(
  staffName: string,
): Promise<string | null> {
  return lookupStaffDepartmentByStaffName(staffName);
}

export async function getWorkEndReportStatusForLineUser(
  lineUserId: string,
): Promise<WorkEndReportStatus> {
  const today = todayYmdJst();
  const staffName = await resolveBoundStaffNameForLineUser(lineUserId);
  if (!staffName) {
    return {
      configured: true,
      needsStaffBind: true,
      reportDate: today,
      canReport: false,
    };
  }

  const loaded = await loadWorkEndReportFieldIds();
  if (!loaded.ok) {
    return {
      configured: false,
      configError: loaded.error,
      staffName,
      reportDate: today,
      canReport: false,
    };
  }

  const department = await lookupStaffDepartment(staffName);

  const { appId, ids, appFields } = loaded;
  let existing: AtPocketRecordRow | null = null;

  try {
    const rows = await fetchTodayReportRows(appId, ids);
    existing = matchTodayReport(rows, staffName, ids, today);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      configured: true,
      configError: `稼働終了報告の取得に失敗しました: ${msg}`,
      staffName,
      reportDate: today,
      canReport: false,
    };
  }

  const recObj = (existing?.record ?? {}) as Record<string, unknown>;
  const existingReport = existing ? snapshotFromRecord(recObj, ids) : null;

  return {
    configured: true,
    staffName,
    reportDate: today,
    reportedAt: existing ? today : null,
    recordId: existing ? atPocketRecordIdFromRow(existing) : null,
    canReport: !existing,
    department,
    existingReport,
  };
}

/** 打刻の失敗を画面へ伝える文言。手動で復旧できることを必ず添える */
export const WORK_END_REPORT_CLOCK_OUT_WARNING =
  "稼働終了報告は提出されましたが、退勤打刻に失敗しました。勤怠画面から打刻してください。";

/** 打刻が応答しないと報告の応答まで返らなくなるため既定6秒で打ち切る */
const CLOCK_OUT_TIMEOUT_MS = 6_000;

function clockOutTimeoutMs(): number {
  const raw = process.env.WORK_END_REPORT_CLOCK_OUT_TIMEOUT_MS?.trim();
  const n = raw ? Number(raw) : CLOCK_OUT_TIMEOUT_MS;
  if (!Number.isFinite(n) || n <= 0) return CLOCK_OUT_TIMEOUT_MS;
  return Math.min(15_000, Math.floor(n));
}

/**
 * 稼働終了報告に続けて退勤を打刻する（タスクX）。
 *
 * ■ 既存の打刻経路をそのまま使う
 * 新しい書き込み口は作らず punchAttendanceForLineUser を呼ぶ。
 * 既に退勤打刻があっても上書きする（後から操作したほうが勝つ）。
 *
 * ■ 報告の提出は止めない
 * 失敗・タイムアウト・例外のいずれでも投げ返さず、warning を返すだけ。
 * 利用者は勤怠画面から手動で打刻すれば復旧できる。
 */
async function clockOutAfterWorkEndReport(
  lineUserId: string,
): Promise<string | undefined> {
  try {
    const timeout = new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), clockOutTimeoutMs()),
    );
    const result = await Promise.race([
      punchAttendanceForLineUser(lineUserId, "out", {
        overwriteClockOut: true,
      }),
      timeout,
    ]);

    if (result === "timeout") {
      console.error(
        "[work-end-report] 退勤打刻がタイムアウトしました",
        JSON.stringify({ timeoutMs: clockOutTimeoutMs() }),
      );
      return WORK_END_REPORT_CLOCK_OUT_WARNING;
    }
    if (result.ok) return undefined;

    // 出してよいのは HTTP ステータスまで。氏名などの個人情報は出さない
    console.error(
      "[work-end-report] 退勤打刻に失敗しました",
      JSON.stringify({ status: result.status }),
    );
    return WORK_END_REPORT_CLOCK_OUT_WARNING;
  } catch (e) {
    console.error(
      "[work-end-report] 退勤打刻で想定外の例外",
      JSON.stringify({ name: e instanceof Error ? e.name : "unknown" }),
    );
    return WORK_END_REPORT_CLOCK_OUT_WARNING;
  }
}

export async function submitWorkEndReportForLineUser(
  lineUserId: string,
  input: WorkEndReportFormValues,
): Promise<
  | { ok: true; status: WorkEndReportStatus; warning?: string }
  | { ok: false; status: number; error: string; needsStaffBind?: boolean }
> {
  const today = todayYmdJst();
  const staffName = await resolveBoundStaffNameForLineUser(lineUserId);
  if (!staffName) {
    return {
      ok: false,
      status: 403,
      error: "担当者の紐付けが必要です",
      needsStaffBind: true,
    };
  }

  const apoActivityOptionsList = apoActivityOptions();
  const apoActivity = input.apoActivity?.trim() ?? "";
  if (!apoActivity) {
    return { ok: false, status: 400, error: "アポ活動実施を選択してください" };
  }
  if (!apoActivityOptionsList.includes(apoActivity)) {
    return {
      ok: false,
      status: 400,
      error: `アポ活動実施は「実施」または「未実施」を選んでください`,
    };
  }

  const apoActivityRequired = isWorkEndApoActivityImplemented(apoActivity);

  const workArea = input.workArea?.trim() ?? "";
  if (apoActivityRequired && !workArea) {
    return { ok: false, status: 400, error: "稼働エリアを入力してください" };
  }

  const pinpon = parseNonNegativeCount(
    "ピンポン数",
    input.pinponCount,
    apoActivityRequired,
  );
  if (!pinpon.ok) return { ok: false, status: 400, error: pinpon.error };
  const meeting = parseNonNegativeCount(
    "面談数",
    input.meetingCount,
    apoActivityRequired,
  );
  if (!meeting.ok) return { ok: false, status: 400, error: meeting.error };
  const apo = parseNonNegativeCount(
    "アポ獲得数",
    input.apoCount,
    apoActivityRequired,
  );
  if (!apo.ok) return { ok: false, status: 400, error: apo.error };

  const loaded = await loadWorkEndReportFieldIds();
  if (!loaded.ok) {
    return { ok: false, status: loaded.status, error: loaded.error };
  }

  const { appId, ids, appFields } = loaded;

  /**
   * 二重提出の判定。**ここだけ共有キャッシュを外して取り直す。**
   *
   * 60 秒前の一覧で「まだ報告していない」と判断すると、同じ日の報告が
   * 2件できる。読み取り1回の節約より、重複を作らないほうが重い。
   */
  const rows = await fetchTodayReportRows(appId, ids, true);
  const existing = matchTodayReport(rows, staffName, ids, today);
  if (existing) {
    return {
      ok: false,
      status: 409,
      error: "本日はすでに稼働終了報告済みです",
    };
  }

  const payload: Record<string, string | number> = {
    [ids.reporter!]: staffName,
    [ids.reportDate!]: today,
    [ids.apoActivity!]: apoActivity,
  };
  if (pinpon.value != null) {
    payload[ids.pinponCount!] = Number(pinpon.value);
  }
  if (meeting.value != null) {
    payload[ids.meetingCount!] = Number(meeting.value);
  }
  if (apo.value != null) {
    payload[ids.apoCount!] = Number(apo.value);
  }
  if (workArea) payload[ids.workArea!] = workArea;

  const writeAuth = { apiKey: apiKeyForWorkEndReportWrite() };
  const createPayload = applyWorkEndReportAutoNumberOnCreate(payload, appFields);
  try {
    await createRecord(appId, createPayload, writeAuth);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      status: 502,
      error: formatWorkEndReportCreateError(msg),
    };
  }

  /**
   * 書けたので共有キャッシュを捨てる。**必ずここで捨てること。**
   *
   * 捨てないと、下で読み直す状況（`getWorkEndReportStatusForLineUser`）が
   * 書き込み前の一覧を拾い、提出した本人の画面が最大 TTL の間
   * 「未提出」のまま＝もう一度提出できるように見える。
   */
  invalidateWorkEndReportRowsCache();

  // X-3: 報告の保存が成功してから打刻する。
  // 失敗しても報告は成功のままで、warning だけ画面へ返す
  const clockOutWarning = await clockOutAfterWorkEndReport(lineUserId);

  const status = await getWorkEndReportStatusForLineUser(lineUserId);

  return {
    ok: true,
    status: {
      ...status,
      reported: true,
      reportedAt: today,
      canReport: false,
    },
    ...(clockOutWarning ? { warning: clockOutWarning } : {}),
  };
}
