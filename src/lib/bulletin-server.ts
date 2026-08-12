import "server-only";

import {
  createRecord,
  fetchAppFields,
  fetchRecordById,
  fetchRecordsList,
  updateRecord,
  type AtPocketRecordRow,
} from "@/lib/atpocket";
import {
  atPocketRecordIdFromCreateResult,
  atPocketRecordIdFromRow,
} from "@/lib/atpocket-record-id";
import {
  bulletinConfigReady,
  bulletinFieldAuth,
  bulletinListAuths,
  bulletinWriteAuth,
} from "@/lib/bulletin-config";
import {
  bulletinFieldsConfigured,
  bulletinFieldsCsv,
  resolveBulletinFieldIds,
  type BulletinFieldIds,
} from "@/lib/bulletin-fields";
import type { BulletinListResponse, BulletinPost } from "@/lib/bulletin-types";
import { pickRecordValueByFieldAliases } from "@/lib/calendar-kojo";
import { checkboxGroupValueFromPocket } from "@/lib/customer-info-form/checkbox-pocket";
import { coerceCustomerInfoDisplayString } from "@/lib/customer-info-record";

/** 監査ログ用に、書き込んだ内容と（更新時は）更新前の値を呼び出し元へ返す */
export type BulletinWriteAudit = {
  appId: string;
  recordId: string;
  /** 更新前の値。新規作成時は null */
  before: Record<string, unknown> | null;
  /** 書き込んだ内容 */
  after: Record<string, unknown>;
  /** fieldId → 表示ラベル */
  labels: Record<string, string>;
};

export type BulletinWriteResult =
  | { ok: true; audit: BulletinWriteAudit }
  | { ok: false; status: number; error: string };

const FIELDS_CACHE_MS = 3_600_000;
let fieldsCache: {
  appId: string;
  ids: BulletinFieldIds;
  expiresAt: number;
} | null = null;

async function loadFieldIds(): Promise<
  | { ok: true; appId: string; ids: BulletinFieldIds }
  | { ok: false; error: string }
> {
  const ready = bulletinConfigReady();
  if (!ready.ok) return { ok: false, error: ready.error };
  const appId = ready.appId;

  if (
    fieldsCache &&
    fieldsCache.appId === appId &&
    fieldsCache.expiresAt > Date.now()
  ) {
    return { ok: true, appId, ids: fieldsCache.ids };
  }

  const appFields = await fetchAppFields(appId, bulletinFieldAuth(), {
    operation: "bulletin:fields",
    appEnv: "BULLETIN_APP_ID",
  });

  const ids = resolveBulletinFieldIds(appFields);
  if (!bulletinFieldsConfigured(ids)) {
    return {
      ok: false,
      error:
        "掲示板アプリの列（タイトル・詳細）を解決できません。@pocket の列見出し、または BULLETIN_TITLE_FIELD_ID / BULLETIN_BODY_FIELD_ID を確認してください。",
    };
  }

  fieldsCache = { appId, ids, expiresAt: Date.now() + FIELDS_CACHE_MS };
  return { ok: true, appId, ids };
}

function bulletinFieldLabels(ids: BulletinFieldIds): Record<string, string> {
  const labels: Record<string, string> = {};
  if (ids.title) labels[ids.title] = "タイトル";
  if (ids.body) labels[ids.body] = "詳細";
  if (ids.category) labels[ids.category] = "カテゴリー";
  if (ids.tags) labels[ids.tags] = "タグ";
  return labels;
}

function readText(
  recObj: Record<string, unknown>,
  fieldId: string | null,
): string {
  if (!fieldId) return "";
  return coerceCustomerInfoDisplayString(
    pickRecordValueByFieldAliases(recObj, fieldId),
  );
}

/** チェックボックス列 → 選択肢の配列（タグ） */
function readTags(
  recObj: Record<string, unknown>,
  fieldId: string | null,
): string[] {
  if (!fieldId) return [];
  const joined = checkboxGroupValueFromPocket(
    pickRecordValueByFieldAliases(recObj, fieldId),
  );
  return joined
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 投稿日：列の値 → なければ一覧 API の updatedAt / createdAt */
function readPostDate(
  row: AtPocketRecordRow,
  recObj: Record<string, unknown>,
  dateFieldId: string | null,
): string {
  const fromField = dateFieldId ? readText(recObj, dateFieldId) : "";
  if (fromField) return formatDate(fromField);
  for (const raw of [row.updatedAt, row.createdAt]) {
    if (!raw) continue;
    const s = String(raw).trim();
    if (s) return formatDate(s);
  }
  return "";
}

/** "2026-07-16 15:30" / ISO などを "2026.07.16" に整形 */
function formatDate(raw: string): string {
  const m = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(raw);
  if (!m) return raw;
  return `${m[1]}.${m[2].padStart(2, "0")}.${m[3].padStart(2, "0")}`;
}

/**
 * 一覧のサーバキャッシュ（タスクO-4）。
 *
 * @pocket の利用制限は **サイト単位で100秒あたり100回**（API キー単位ではない）。
 * 掲示板は全社共通の内容で、ホームからも掲示板画面からも読まれるため、
 * ユーザー非依存キーで丸ごと持つ。**利用者ごとの出し分けは無い**ので
 * Phase 0 §6（personalize 済みを非依存キーで保存しない）には抵触しない。
 *
 * 投稿・編集の直後は最新を見せたいので、書き込み側で破棄する。
 */
const BULLETIN_LIST_DEFAULT_TTL_SECONDS = 600;

function bulletinListTtlMs(): number {
  const raw = process.env.BULLETIN_LIST_CACHE_SECONDS?.trim();
  const sec = raw ? Number(raw) : BULLETIN_LIST_DEFAULT_TTL_SECONDS;
  if (!Number.isFinite(sec)) return BULLETIN_LIST_DEFAULT_TTL_SECONDS * 1000;
  // 0 を許すと毎回取りに行って上限に当たるので下限を設ける
  return Math.min(3600, Math.max(30, sec)) * 1000;
}

let bulletinListCache: {
  expiresAt: number;
  payload: BulletinListResponse;
} | null = null;
let bulletinListInflight: Promise<BulletinListResponse> | null = null;

/** 投稿・編集の後に呼ぶ。次の取得で @pocket を読み直す */
export function invalidateBulletinListCache(): void {
  bulletinListCache = null;
}

export async function buildBulletinList(): Promise<BulletinListResponse> {
  const now = Date.now();
  if (bulletinListCache && bulletinListCache.expiresAt > now) {
    return bulletinListCache.payload;
  }
  if (bulletinListInflight) return bulletinListInflight;

  bulletinListInflight = (async () => {
    try {
      const payload = await buildBulletinListFromPocket();
      // 設定不備のときはキャッシュしない（直したらすぐ反映させる）
      if (payload.configured !== false) {
        bulletinListCache = {
          expiresAt: Date.now() + bulletinListTtlMs(),
          payload,
        };
      }
      return payload;
    } finally {
      bulletinListInflight = null;
    }
  })();
  return bulletinListInflight;
}

async function buildBulletinListFromPocket(): Promise<BulletinListResponse> {
  const loaded = await loadFieldIds();
  if (!loaded.ok) {
    return { configured: false, configError: loaded.error };
  }

  const { appId, ids } = loaded;
  const csv = bulletinFieldsCsv(ids);
  const auths = bulletinListAuths();

  const res = await fetchRecordsList(
    appId,
    { fields: csv, limit: "200" },
    auths[0],
    { operation: "bulletin:list", appEnv: "BULLETIN_APP_ID" },
    { authKeys: auths.length >= 2 ? auths : undefined },
  );

  const rows = res.records ?? [];
  const posts: BulletinPost[] = [];
  for (const row of rows) {
    const recObj = (row.record ?? {}) as Record<string, unknown>;
    const title = readText(recObj, ids.title);
    const body = readText(recObj, ids.body);
    if (!title && !body) continue;
    const dateRaw = readPostDate(row, recObj, ids.date);
    posts.push({
      id: atPocketRecordIdFromRow(row) ?? String(posts.length),
      category: readText(recObj, ids.category),
      tags: readTags(recObj, ids.tags),
      date: dateRaw,
      title,
      body,
    });
  }

  posts.sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0));

  return { configured: true, posts };
}

export async function createBulletinPost(input: {
  category: string;
  tags: string[];
  title: string;
  body: string;
}): Promise<BulletinWriteResult> {
  const loaded = await loadFieldIds();
  if (!loaded.ok) {
    return { ok: false, status: 503, error: loaded.error };
  }

  const { appId, ids } = loaded;
  const writeAuth = bulletinWriteAuth();
  if (!writeAuth.apiKey) {
    return {
      ok: false,
      status: 503,
      error: "投稿用の BULLETIN_ATPOCKET_API_KEY_2（書き込みキー）が未設定です",
    };
  }

  const record: Record<string, unknown> = {};
  if (ids.title) record[ids.title] = input.title;
  if (ids.body) record[ids.body] = input.body;
  // カテゴリーはテキスト列
  if (ids.category && input.category) record[ids.category] = input.category;
  // タグはチェックボックス列なので配列で送る
  if (ids.tags && input.tags.length > 0) record[ids.tags] = input.tags;

  let recordId = "";
  try {
    const created = await createRecord(appId, record, writeAuth);
    // 投稿直後は最新を見せる（タスクO-4）
    invalidateBulletinListCache();
    // Location ヘッダ・records[]・accessUrl まで見る正規のヘルパーを使う。
    // atPocketRecordIdFromRow 単体だと @pocket が本文に id を返さない場合に取り逃す。
    recordId = atPocketRecordIdFromCreateResult(created) ?? "";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 502, error: formatBulletinCreateError(msg) };
  }

  if (!recordId) {
    // 掲示板には T番号が無いため、recordId が無いと監査ログから投稿を特定できない
    console.error(
      "[bulletin] 投稿は成功しましたが recordId を取得できませんでした（監査ログの対象レコードIDが空になります）",
    );
  }

  return {
    ok: true,
    audit: {
      appId,
      recordId,
      before: null,
      after: record,
      labels: bulletinFieldLabels(ids),
    },
  };
}

export async function updateBulletinPost(
  recordId: string,
  input: {
    category: string;
    tags: string[];
    title: string;
    body: string;
  },
): Promise<BulletinWriteResult> {
  const loaded = await loadFieldIds();
  if (!loaded.ok) {
    return { ok: false, status: 503, error: loaded.error };
  }

  const { appId, ids } = loaded;
  const writeAuth = bulletinWriteAuth();
  if (!writeAuth.apiKey) {
    return {
      ok: false,
      status: 503,
      error: "更新用の BULLETIN_ATPOCKET_API_KEY_2（書き込みキー）が未設定です",
    };
  }

  const record: Record<string, unknown> = {};
  if (ids.title) record[ids.title] = input.title;
  if (ids.body) record[ids.body] = input.body;
  // カテゴリーはテキスト列
  if (ids.category) record[ids.category] = input.category;
  // タグはチェックボックス列（空配列で全解除できるよう常に送る）
  if (ids.tags) record[ids.tags] = input.tags;

  // 監査ログ用の更新前の値。取得に失敗しても更新は続行する（A-5 ベストエフォート）
  let before: Record<string, unknown> | null = null;
  try {
    const row = await fetchRecordById(appId, recordId, bulletinFieldAuth());
    if (row?.record && typeof row.record === "object") {
      before = row.record as Record<string, unknown>;
    }
  } catch (e) {
    console.warn("[bulletin] 監査ログ用の更新前レコード取得に失敗", e);
  }

  try {
    await updateRecord(appId, recordId, record, writeAuth);
    // 編集直後は最新を見せる（タスクO-4）
    invalidateBulletinListCache();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 502, error: formatBulletinUpdateError(msg) };
  }

  return {
    ok: true,
    audit: {
      appId,
      recordId,
      before,
      after: record,
      labels: bulletinFieldLabels(ids),
    },
  };
}

/** @pocket 更新失敗メッセージをユーザー向けに整形 */
function formatBulletinUpdateError(detail: string): string {
  return `更新に失敗しました: ${detail}`;
}

/** @pocket 登録失敗メッセージをユーザー向けに整形 */
function formatBulletinCreateError(detail: string): string {
  if (detail.includes("取込設定") && detail.includes("キー項目")) {
    return (
      "投稿に失敗しました。@pocket の掲示板アプリで、キー項目（自動採番）が「取込」設定に登録されていません。" +
      "アプリ管理 > 掲示板 > 取込 で、自動採番の列をキー項目として取込形式に追加してください（自動採番のままで番号入力は不要です）。"
    );
  }
  return `投稿に失敗しました: ${detail}`;
}
