import "server-only";

import {
  customerInfoAppId,
  customerInfoConfigReady,
  customerInfoNameFieldId,
  customerInfoPocketAuth1,
  customerInfoSubtitleFieldId,
} from "@/lib/customer-info-config";
import {
  customerInfoRecordIdFromRow,
  readCustomerInfoFieldValue,
} from "@/lib/customer-info-record";
import {
  customerInfoFormFieldsCsv,
  readCustomerInfoFormValuesFromRecord,
  resolveCustomerInfoFormFields,
  resolveCustomerInfoFormFieldId,
  resolveCustomerInfoPtTransferFields,
} from "@/lib/customer-info-form/resolve-fields";
import {
  findMissingRequiredCustomerInfoFields,
  type CustomerInfoFormFieldForValidate,
} from "@/lib/customer-info-form/validate";
import {
  matchCustomerInfoPendingAudience,
  resolveCustomerInfoCreatorFieldId,
  type CustomerInfoPendingAudienceReason,
} from "@/lib/customer-info-creator-field";
import type { AtPocketFieldRow } from "@/lib/atpocket";
import { fetchAppFields, fetchRecordsList } from "@/lib/atpocket";
import {
  pickRecordValueByFieldAliases,
  resolveConfiguredFieldToSchemaUniqueId,
} from "@/lib/calendar-kojo";

export type CustomerInfoContinueShortcutHit = {
  recordId: string;
  customerName: string;
  /** T番号など（同名が複数あるときの識別用） */
  subtitle: string;
  /** 担当者未設定で作成者向けに出しているとき */
  creatorOnly?: boolean;
  audienceReason?: CustomerInfoPendingAudienceReason;
};

const PAGE_LIMIT = 1000;
const DEFAULT_MAX_PAGES = 12;
const DEFAULT_MAX_RESULTS = 8;

function nfkc(s: string): string {
  return s.normalize("NFKC").trim();
}

function normStatusToken(raw: string): string {
  return nfkc(raw).toLowerCase();
}

function pickFieldUniqueIdByExactCaption(
  fields: AtPocketFieldRow[],
  caption: string,
): string | null {
  const target = nfkc(caption).toLowerCase();
  for (const f of fields) {
    const cap = f.caption ? nfkc(String(f.caption)).toLowerCase() : "";
    if (cap && cap === target) {
      const id = f.uniqueId?.trim();
      return id || null;
    }
  }
  return null;
}

function resolveFieldIdFromEnvOrCaptions(
  envKey: string,
  captions: readonly string[],
  appFields: AtPocketFieldRow[],
): string | null {
  const env = process.env[envKey]?.trim();
  if (env) {
    return resolveConfiguredFieldToSchemaUniqueId(env, appFields);
  }
  for (const cap of captions) {
    const id = pickFieldUniqueIdByExactCaption(appFields, cap);
    if (id) return id;
  }
  return null;
}

function continueMaxPages(): number {
  const raw = process.env.CUSTOMER_INFO_CONTINUE_MAX_PAGES?.trim();
  const n = raw ? Number(raw) : DEFAULT_MAX_PAGES;
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_PAGES;
  return Math.min(30, Math.floor(n));
}

function continueMaxResults(): number {
  const raw = process.env.CUSTOMER_INFO_CONTINUE_MAX_RESULTS?.trim();
  const n = raw ? Number(raw) : DEFAULT_MAX_RESULTS;
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_RESULTS;
  return Math.min(20, Math.floor(n));
}

function continueStatusValues(): Set<string> {
  const raw = process.env.CUSTOMER_INFO_CONTINUE_STATUS_VALUES?.trim();
  const parts = raw
    ? raw.split(",").map((s) => normStatusToken(s)).filter(Boolean)
    : [normStatusToken("未入力")];
  return new Set(parts);
}

function recordMatchesContinueStatus(
  recObj: Record<string, unknown>,
  statusFieldId: string,
  allowed: Set<string>,
): boolean {
  const raw = readCustomerInfoFieldValue(recObj, statusFieldId);
  const token = raw
    ? normStatusToken(raw)
    : normStatusToken("未入力");
  return allowed.has(token);
}

function pendingHitSubtitle(
  baseSubtitle: string,
  reason: CustomerInfoPendingAudienceReason | null,
): string {
  const base = baseSubtitle.trim();
  if (reason === "creator") {
    const tag = "担当者未設定";
    return base ? `${base} · ${tag}` : tag;
  }
  return base;
}

function recordHasIncompleteRequiredForm(
  recObj: Record<string, unknown>,
  validateFields: readonly CustomerInfoFormFieldForValidate[],
  resolved: ReturnType<typeof resolveCustomerInfoFormFields>["resolved"],
  transferResolved: ReturnType<
    typeof resolveCustomerInfoPtTransferFields
  >["resolved"],
): boolean {
  const values = readCustomerInfoFormValuesFromRecord(
    recObj,
    resolved,
    transferResolved,
  );
  return (
    findMissingRequiredCustomerInfoFields(validateFields, values).length > 0
  );
}

/**
 * キャッシュに載せる1件（絞り込み前）。
 *
 * audience は AP担当者・CL担当者・案件作成者の**生の値**だけを、@pocket と
 * 同じ fieldId をキーにして持つ。matchCustomerInfoPendingAudience はこの3列しか
 * 読まないので、これを渡せば**判定ロジックを一切変えずに**絞り込める。
 * 担当顧客一覧（タスクO-3）と同じ作りに揃えている。
 */
export type CustomerInfoPendingCandidate = {
  recordId: string;
  customerName: string;
  /** 絞り込み後に pendingHitSubtitle へ渡す元の値（「担当者未設定」の付与は取り出し後） */
  subtitleRaw: string;
  audience: Record<string, unknown>;
};

/** 担当者で絞る前の全件。ユーザー非依存なのでキーに氏名を含めない */
export type CustomerInfoPendingSnapshot = {
  candidates: CustomerInfoPendingCandidate[];
  apFieldId: string | null;
  clFieldId: string | null;
  creatorFieldId: string | null;
};

const EMPTY_SNAPSHOT: CustomerInfoPendingSnapshot = {
  candidates: [],
  apFieldId: null,
  clFieldId: null,
  creatorFieldId: null,
};

/**
 * 入力ステータスが未入力（空欄は未入力扱い）のレコードを**担当者で絞る前**に集める。
 *
 * 以前は担当者ごとにこの走査を行っていたため、10人使えば10回の全件走査になり、
 * @pocket の「サイト単位で100秒あたり100回」をホーム画面だけで削っていた。
 * 走査は全社で1回に集約し、担当者での絞り込みは
 * filterCustomerInfoPendingForStaff で取り出した後に行う（Phase 0 §6）。
 *
 * ここで適用してよいのは**担当者に依存しない条件だけ**。
 *   - お客様名が入っていること
 *   - 入力ステータスが未入力（または必須項目が未充足）
 * 担当者一致（matchCustomerInfoPendingAudience）はここでは呼ばない。
 */
export async function fetchCustomerInfoPendingSnapshot(): Promise<CustomerInfoPendingSnapshot> {
  const cfg = customerInfoConfigReady();
  if (!cfg.ok) return EMPTY_SNAPSHOT;

  const appId = customerInfoAppId();
  if (!appId) return EMPTY_SNAPSHOT;

  const auth = customerInfoPocketAuth1();
  const pocketCtx = {
    operation: "customer-info:続き入力ショートカット",
    appEnv: "CUSTOMER_INFO_APP_ID",
  } as const;

  const appFields = await fetchAppFields(appId, auth, pocketCtx);
  const nameField = resolveConfiguredFieldToSchemaUniqueId(
    customerInfoNameFieldId()!,
    appFields,
  );
  if (!nameField) return EMPTY_SNAPSHOT;

  const subtitleEnv = customerInfoSubtitleFieldId();
  let subtitleField: string | null = null;
  if (subtitleEnv) {
    subtitleField = resolveConfiguredFieldToSchemaUniqueId(
      subtitleEnv,
      appFields,
    );
  }

  const statusFieldId =
    resolveFieldIdFromEnvOrCaptions(
      "CUSTOMER_INFO_CONTINUE_STATUS_FIELD_ID",
      ["入力ステータス"],
      appFields,
    ) ??
    resolveCustomerInfoFormFieldId("inputStatus", "入力ステータス", appFields);

  const apFieldId = resolveCustomerInfoFormFieldId(
    "apStaff",
    "AP担当者",
    appFields,
  );
  const clFieldId = resolveCustomerInfoFormFieldId(
    "clStaff",
    "CL担当者",
    appFields,
  );
  const creatorFieldId = resolveCustomerInfoCreatorFieldId(appFields);

  const { resolved } = resolveCustomerInfoFormFields(appFields);
  const { resolved: transferResolved } =
    resolveCustomerInfoPtTransferFields(appFields);
  const validateFields: CustomerInfoFormFieldForValidate[] = resolved
    .filter((f) => !f.liffOnly && f.fieldId)
    .map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      required: f.required,
    }));

  const statusValues = continueStatusValues();
  const useStatusFilter = Boolean(statusFieldId);

  const fieldIdSet = new Set<string>([
    nameField,
    ...(apFieldId ? [apFieldId] : []),
    ...(clFieldId ? [clFieldId] : []),
    ...(statusFieldId ? [statusFieldId] : []),
    ...(subtitleField ? [subtitleField] : []),
    ...(creatorFieldId ? [creatorFieldId] : []),
  ]);
  if (!useStatusFilter) {
    for (const id of customerInfoFormFieldsCsv(resolved).split(",")) {
      const t = id.trim();
      if (t) fieldIdSet.add(t);
    }
    for (const id of customerInfoFormFieldsCsv(transferResolved).split(",")) {
      const t = id.trim();
      if (t) fieldIdSet.add(t);
    }
  }
  const fieldsCsv = [...fieldIdSet].join(",");

  const candidates: CustomerInfoPendingCandidate[] = [];
  const maxPages = continueMaxPages();

  for (let page = 1; page <= maxPages; page++) {
    const data = await fetchRecordsList(
      appId,
      {
        limit: String(PAGE_LIMIT),
        page: String(page),
        fields: fieldsCsv,
      },
      auth,
      pocketCtx,
    );
    const rows = data.records ?? [];
    if (rows.length === 0) break;

    for (const row of rows) {
      const recordId = customerInfoRecordIdFromRow(row);
      const rec = row.record;
      if (!recordId || !rec || typeof rec !== "object") continue;

      const recObj = rec as Record<string, unknown>;
      const customerName = readCustomerInfoFieldValue(recObj, nameField);
      if (!customerName) continue;

      // 担当者に依存しない条件だけをここで適用する
      if (useStatusFilter && statusFieldId) {
        if (!recordMatchesContinueStatus(recObj, statusFieldId, statusValues)) {
          continue;
        }
      } else if (
        !recordHasIncompleteRequiredForm(
          recObj,
          validateFields,
          resolved,
          transferResolved,
        )
      ) {
        continue;
      }

      // 担当者での絞り込みは取り出した後に同じ判定関数で行う
      const audience: Record<string, unknown> = {};
      for (const id of [apFieldId, clFieldId, creatorFieldId]) {
        if (!id) continue;
        audience[id] = pickRecordValueByFieldAliases(recObj, id);
      }

      candidates.push({
        recordId,
        customerName,
        subtitleRaw: subtitleField
          ? readCustomerInfoFieldValue(recObj, subtitleField)
          : "",
        audience,
      });
    }

    if (rows.length < PAGE_LIMIT) break;
  }

  return { candidates, apFieldId, clFieldId, creatorFieldId };
}

/**
 * 担当者で絞る。**キャッシュから取り出した後**に行うのが要点で、
 * 絞り込み済みの結果をキャッシュへ戻さない（Phase 0 §6）。
 * 判定は既存の matchCustomerInfoPendingAudience をそのまま使う。
 */
export function filterCustomerInfoPendingForStaff(
  snapshot: CustomerInfoPendingSnapshot,
  boundStaffName: string,
): CustomerInfoContinueShortcutHit[] {
  const hits: CustomerInfoContinueShortcutHit[] = [];
  const maxResults = continueMaxResults();

  for (const c of snapshot.candidates) {
    const audienceReason = matchCustomerInfoPendingAudience(
      c.audience,
      boundStaffName,
      snapshot.apFieldId,
      snapshot.clFieldId,
      snapshot.creatorFieldId,
    );
    if (!audienceReason) continue;

    hits.push({
      recordId: c.recordId,
      customerName: c.customerName,
      subtitle: pendingHitSubtitle(c.subtitleRaw, audienceReason),
      creatorOnly: audienceReason === "creator",
      audienceReason,
    });
  }

  if (hits.length === 0) return [];

  // 並べ替えてから件数を絞る。以前は走査の途中で打ち切っていたため、
  // 五十音順の後ろにいる顧客が候補から漏れることがあった
  hits.sort((a, b) => a.customerName.localeCompare(b.customerName, "ja"));
  return hits.slice(0, maxResults);
}

/**
 * 入力ステータスが未入力のレコードのうち、ログイン担当者に出すもの。
 * 走査（全社共通）と絞り込み（担当者別）を分けただけで、条件は従来と同じ。
 */
export async function findCustomerInfoPendingRecords(
  boundStaffName: string,
): Promise<CustomerInfoContinueShortcutHit[]> {
  const snapshot = await fetchCustomerInfoPendingSnapshot();
  return filterCustomerInfoPendingForStaff(snapshot, boundStaffName);
}

/** 未入力レコード（トップの続き入力ショートカット用。お客様情報の未入力一覧と同条件） */
export async function findCustomerInfoContinueShortcuts(
  boundStaffName: string,
): Promise<CustomerInfoContinueShortcutHit[]> {
  return findCustomerInfoPendingRecords(boundStaffName);
}
