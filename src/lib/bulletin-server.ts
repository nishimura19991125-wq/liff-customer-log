import "server-only";

import {
  createRecord,
  fetchAppFields,
  fetchRecordsList,
  updateRecord,
} from "@/lib/atpocket";
import { atPocketRecordIdFromRow } from "@/lib/atpocket-record-id";
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

/** "2026-07-16 15:30" / ISO などを "2026.07.16" に整形 */
function formatDate(raw: string): string {
  const m = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(raw);
  if (!m) return raw;
  return `${m[1]}.${m[2].padStart(2, "0")}.${m[3].padStart(2, "0")}`;
}

export async function buildBulletinList(): Promise<BulletinListResponse> {
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
    const dateRaw = readText(recObj, ids.date);
    posts.push({
      id: atPocketRecordIdFromRow(row) ?? String(posts.length),
      category: readText(recObj, ids.category),
      tags: readTags(recObj, ids.tags),
      date: dateRaw ? formatDate(dateRaw) : "",
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
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
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

  try {
    await createRecord(appId, record, writeAuth);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 502, error: formatBulletinCreateError(msg) };
  }

  return { ok: true };
}

export async function updateBulletinPost(
  recordId: string,
  input: {
    category: string;
    tags: string[];
    title: string;
    body: string;
  },
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
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

  try {
    await updateRecord(appId, recordId, record, writeAuth);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 502, error: formatBulletinUpdateError(msg) };
  }

  return { ok: true };
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
