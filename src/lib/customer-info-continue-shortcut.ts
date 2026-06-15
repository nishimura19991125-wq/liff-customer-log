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
import { resolveConfiguredFieldToSchemaUniqueId } from "@/lib/calendar-kojo";

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
 * 入力ステータスが未入力（空欄は未入力扱い）のレコード一覧。
 * 作成日による絞り込みは行わない。AP/CL 担当者一致、または担当者未設定で作成者がログイン担当者のとき表示。
 */
export async function findCustomerInfoPendingRecords(
  boundStaffName: string,
): Promise<CustomerInfoContinueShortcutHit[]> {
  const cfg = customerInfoConfigReady();
  if (!cfg.ok) return [];

  const appId = customerInfoAppId();
  if (!appId) return [];

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
  if (!nameField) return [];

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

  const hits: CustomerInfoContinueShortcutHit[] = [];
  const maxPages = continueMaxPages();
  const maxResults = continueMaxResults();

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

      const audienceReason = matchCustomerInfoPendingAudience(
        recObj,
        boundStaffName,
        apFieldId,
        clFieldId,
        creatorFieldId,
      );
      if (!audienceReason) {
        continue;
      }

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

      const subtitle = pendingHitSubtitle(
        subtitleField
          ? readCustomerInfoFieldValue(recObj, subtitleField)
          : "",
        audienceReason,
      );

      hits.push({
        recordId,
        customerName,
        subtitle,
        creatorOnly: audienceReason === "creator",
        audienceReason,
      });
      if (hits.length >= maxResults) break;
    }

    if (hits.length >= maxResults) break;
    if (rows.length < PAGE_LIMIT) break;
  }

  if (hits.length === 0) return [];

  hits.sort((a, b) =>
    a.customerName.localeCompare(b.customerName, "ja"),
  );
  return hits;
}

/** 未入力レコード（トップの続き入力ショートカット用。お客様情報の未入力一覧と同条件） */
export async function findCustomerInfoContinueShortcuts(
  boundStaffName: string,
): Promise<CustomerInfoContinueShortcutHit[]> {
  return findCustomerInfoPendingRecords(boundStaffName);
}
