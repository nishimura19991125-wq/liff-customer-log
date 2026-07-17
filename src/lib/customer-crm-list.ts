import "server-only";

import {
  customerInfoAppId,
  customerInfoConfigReady,
  customerInfoImportKeyFieldId,
  customerInfoListAuths,
  customerInfoNameFieldId,
  customerInfoPocketAuth,
  customerInfoSubtitleFieldId,
} from "@/lib/customer-info-config";
import { findCustomerInfoRecordIdByUniqueKeyCached } from "@/lib/customer-info-key-lookup-cache";
import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";
import {
  crmSortKeyFromRecord,
  evaluateCrmDocuments,
  isCrmConstructionDateUnset,
  buildCrmSubsidyInfo,
  resolveCrmConstructionDateFieldId,
  resolveCrmDocumentFields,
  resolveCrmSortDateFieldId,
  resolveCrmSubsidyFieldIds,
} from "@/lib/customer-crm-documents";
import type { CrmSubsidyFieldIds } from "@/lib/customer-crm-documents";
import {
  customerInfoRecordIdFromRow,
  readCustomerInfoFieldValue,
} from "@/lib/customer-info-record";
import {
  matchCustomerInfoPendingAudience,
  resolveCustomerInfoCreatorFieldId,
} from "@/lib/customer-info-creator-field";
import { resolveCustomerInfoFormFieldId } from "@/lib/customer-info-form/resolve-fields";
import {
  crmEffectiveDocumentMissing,
  recordIsCustomerStatusCancelled,
  resolveCrmCustomerStatusFieldId,
} from "@/lib/customer-crm-status";
import { customerInfoCustomerStatusFieldId } from "@/lib/customer-info-config";
import type { AtPocketFieldRow } from "@/lib/atpocket";
import {
  fetchAppFieldsTryKeys,
  fetchRecordById,
  fetchRecordsList,
  readAuthsForApp,
} from "@/lib/atpocket";
import { resolveConfiguredFieldToSchemaUniqueId } from "@/lib/calendar-kojo";

export type CustomerCrmFilter =
  | "all"
  | "missing_docs"
  | "no_construction_date"
  | "subsidy"
  | "cancelled";

export type CustomerCrmListItem = {
  recordId: string;
  customerName: string;
  subtitle: string;
  /** 工事連携キー（T番号） */
  tNumber: string;
  isDocumentMissing: boolean;
  isSubsidyTarget: boolean;
  combinedSubsidyName: string | null;
  isConstructionDateUnset: boolean;
  isCancelled: boolean;
};

const PAGE_LIMIT = 1000;
const DEFAULT_MAX_PAGES = 25;
const DEFAULT_MAX_RESULTS = 80;
const DEFAULT_CACHE_TTL_MS = 120_000;
const DEFAULT_PAGE_DELAY_MS = 400;

type CrmCandidate = CustomerCrmListItem & { sortKey: number };

const crmListStore = new Map<string, { expiresAt: number; items: CrmCandidate[] }>();
const crmListInflight = new Map<string, Promise<CrmCandidate[]>>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function crmCacheKey(boundStaffName: string): string {
  return boundStaffName.normalize("NFKC").trim();
}

function crmCacheTtlMs(): number {
  const raw = process.env.CUSTOMER_CRM_CACHE_TTL_MS?.trim();
  const n = raw ? Number(raw) : DEFAULT_CACHE_TTL_MS;
  if (!Number.isFinite(n) || n < 0) return DEFAULT_CACHE_TTL_MS;
  return Math.min(600_000, Math.floor(n));
}

function crmPageDelayMs(): number {
  const raw = process.env.CUSTOMER_CRM_PAGE_DELAY_MS?.trim();
  const n = raw ? Number(raw) : DEFAULT_PAGE_DELAY_MS;
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(2000, Math.floor(n));
}

/** 顧客一覧の再取得が必要なとき（将来の PUT 連携用） */
export function invalidateCustomerCrmListCache(): void {
  crmListStore.clear();
  crmListInflight.clear();
}

function crmMaxPages(): number {
  const raw = process.env.CUSTOMER_CRM_MAX_PAGES?.trim();
  const n = raw ? Number(raw) : DEFAULT_MAX_PAGES;
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_PAGES;
  return Math.min(50, Math.floor(n));
}

function crmMaxResults(): number {
  const raw = process.env.CUSTOMER_CRM_MAX_RESULTS?.trim();
  const n = raw ? Number(raw) : DEFAULT_MAX_RESULTS;
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_RESULTS;
  return Math.min(200, Math.floor(n));
}

function passesCrmFilter(
  item: CustomerCrmListItem,
  filter: CustomerCrmFilter,
): boolean {
  switch (filter) {
    case "missing_docs":
      return item.isDocumentMissing && !item.isCancelled;
    case "no_construction_date":
      return item.isConstructionDateUnset;
    case "subsidy":
      return item.isSubsidyTarget;
    case "cancelled":
      return item.isCancelled;
    default:
      return true;
  }
}

type CrmFieldContext = {
  nameField: string;
  subtitleField: string | null;
  tNumberFieldId: string | null;
  apFieldId: string | null;
  clFieldId: string | null;
  creatorFieldId: string | null;
  constructionDateFieldId: string | null;
  subsidyFieldIds: CrmSubsidyFieldIds;
  sortFieldId: string | null;
  customerStatusFieldId: string | null;
  docFields: ReturnType<typeof resolveCrmDocumentFields>;
  fieldsCsv: string;
};

function buildCrmFieldContext(appFields: AtPocketFieldRow[]): CrmFieldContext | null {
  const nameField = resolveConfiguredFieldToSchemaUniqueId(
    customerInfoNameFieldId()!,
    appFields,
  );
  if (!nameField) return null;

  const subtitleEnv = customerInfoSubtitleFieldId();
  const subtitleField = subtitleEnv
    ? resolveConfiguredFieldToSchemaUniqueId(subtitleEnv, appFields)
    : null;

  const docFields = resolveCrmDocumentFields(appFields);
  const constructionDateFieldId = resolveCrmConstructionDateFieldId(appFields);
  const subsidyFieldIds = resolveCrmSubsidyFieldIds(appFields);
  const sortFieldId = resolveCrmSortDateFieldId(appFields);
  const customerStatusFieldId = resolveCrmCustomerStatusFieldId(appFields);
  if (customerInfoCustomerStatusFieldId() && !customerStatusFieldId) {
    console.warn(
      "[customer-crm] CUSTOMER_INFO_CUSTOMER_STATUS_FIELD_ID がアプリ定義と一致しません",
    );
    return null;
  }

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
  const tNumberEnv = customerInfoImportKeyFieldId();
  const tNumberFieldId = tNumberEnv
    ? resolveConfiguredFieldToSchemaUniqueId(tNumberEnv, appFields)
    : null;

  const fieldIdSet = new Set<string>([nameField]);
  if (subtitleField) fieldIdSet.add(subtitleField);
  if (tNumberFieldId) fieldIdSet.add(tNumberFieldId);
  if (constructionDateFieldId) fieldIdSet.add(constructionDateFieldId);
  if (subsidyFieldIds.subsidyPresenceId) {
    fieldIdSet.add(subsidyFieldIds.subsidyPresenceId);
  }
  if (subsidyFieldIds.prefectureSubsidyId) {
    fieldIdSet.add(subsidyFieldIds.prefectureSubsidyId);
  }
  if (subsidyFieldIds.citySubsidyId) {
    fieldIdSet.add(subsidyFieldIds.citySubsidyId);
  }
  if (subsidyFieldIds.otherSubsidyId) {
    fieldIdSet.add(subsidyFieldIds.otherSubsidyId);
  }
  if (sortFieldId) fieldIdSet.add(sortFieldId);
  if (apFieldId) fieldIdSet.add(apFieldId);
  if (clFieldId) fieldIdSet.add(clFieldId);
  if (creatorFieldId) fieldIdSet.add(creatorFieldId);
  if (customerStatusFieldId) fieldIdSet.add(customerStatusFieldId);
  for (const d of docFields) fieldIdSet.add(d.fieldId);

  return {
    nameField,
    subtitleField,
    tNumberFieldId,
    apFieldId,
    clFieldId,
    creatorFieldId,
    constructionDateFieldId,
    subsidyFieldIds,
    sortFieldId,
    customerStatusFieldId,
    docFields,
    fieldsCsv: [...fieldIdSet].join(","),
  };
}

async function fetchCustomerCrmCandidatesFromPocket(
  boundStaffName: string,
): Promise<CrmCandidate[]> {
  const cfg = customerInfoConfigReady();
  if (!cfg.ok) return [];

  const appId = customerInfoAppId();
  if (!appId) return [];

  const listAuths = customerInfoListAuths();
  const readAuths = readAuthsForApp("CUSTOMER_INFO");
  const pocketCtx = {
    operation: "customer-crm:担当顧客一覧",
    appEnv: "CUSTOMER_INFO_APP_ID",
  } as const;

  const appFields =
    (await fetchAppFieldsTryKeys(
      appId,
      readAuths.map((a) => a.apiKey ?? ""),
    )) ?? [];
  if (appFields.length === 0) return [];
  const ctx = buildCrmFieldContext(appFields);
  if (!ctx) return [];

  const candidates: CrmCandidate[] = [];
  const maxPages = crmMaxPages();
  const pageDelayMs = crmPageDelayMs();

  for (let page = 1; page <= maxPages; page++) {
    if (page > 1 && pageDelayMs > 0) {
      await sleep(pageDelayMs);
    }
    const pageStart =
      listAuths.length > 0 ? (page - 1) % listAuths.length : 0;
    const data = await fetchRecordsList(
      appId,
      {
        limit: String(PAGE_LIMIT),
        page: String(page),
        fields: ctx.fieldsCsv,
      },
      listAuths[pageStart] ?? listAuths[0],
      pocketCtx,
      {
        authKeys: listAuths.length >= 2 ? listAuths : undefined,
        authStartIndex: listAuths.length >= 2 ? pageStart : undefined,
      },
    );
    const rows = data.records ?? [];
    if (rows.length === 0) break;

    for (const row of rows) {
      const recordId = customerInfoRecordIdFromRow(row);
      const rec = row.record;
      if (!recordId || !rec || typeof rec !== "object") continue;

      const recObj = rec as Record<string, unknown>;
      const customerName = readCustomerInfoFieldValue(recObj, ctx.nameField);
      if (!customerName) continue;

      if (
        !matchCustomerInfoPendingAudience(
          recObj,
          boundStaffName,
          ctx.apFieldId,
          ctx.clFieldId,
          ctx.creatorFieldId,
        )
      ) {
        continue;
      }

      const isCancelled = recordIsCustomerStatusCancelled(
        recObj,
        ctx.customerStatusFieldId,
      );
      const { isDocumentMissing: rawDocumentMissing } = evaluateCrmDocuments(
        recObj,
        ctx.docFields,
      );
      const isDocumentMissing = crmEffectiveDocumentMissing(
        rawDocumentMissing,
        isCancelled,
      );
      const { isSubsidyTarget, combinedSubsidyName } = buildCrmSubsidyInfo(
        recObj,
        ctx.subsidyFieldIds,
      );
      const isConstructionDateUnset = isCrmConstructionDateUnset(
        recObj,
        ctx.constructionDateFieldId,
      );

      candidates.push({
        recordId,
        customerName,
        subtitle: ctx.subtitleField
          ? readCustomerInfoFieldValue(recObj, ctx.subtitleField)
          : "",
        tNumber: ctx.tNumberFieldId
          ? readCustomerInfoFieldValue(recObj, ctx.tNumberFieldId)
          : "",
        isDocumentMissing,
        isSubsidyTarget,
        combinedSubsidyName,
        isConstructionDateUnset,
        isCancelled,
        sortKey: crmSortKeyFromRecord(recObj, recordId, ctx.sortFieldId),
      });
    }

    if (rows.length < PAGE_LIMIT) break;
  }

  candidates.sort((a, b) => b.sortKey - a.sortKey);
  return candidates;
}

async function getCachedCustomerCrmCandidates(
  boundStaffName: string,
): Promise<CrmCandidate[]> {
  const ttl = crmCacheTtlMs();
  if (ttl <= 0) {
    return fetchCustomerCrmCandidatesFromPocket(boundStaffName);
  }

  const key = crmCacheKey(boundStaffName);
  const now = Date.now();
  const hit = crmListStore.get(key);
  if (hit && hit.expiresAt > now) {
    return hit.items.map((item) => ({ ...item }));
  }

  const pending = crmListInflight.get(key);
  if (pending) {
    return pending.then((items) => items.map((item) => ({ ...item })));
  }

  const promise = (async () => {
    try {
      const items = await fetchCustomerCrmCandidatesFromPocket(boundStaffName);
      crmListStore.set(key, { expiresAt: Date.now() + ttl, items });
      return items;
    } finally {
      crmListInflight.delete(key);
    }
  })();

  crmListInflight.set(key, promise);
  return promise;
}

/**
 * ログイン担当者（AP/CL/案件作成者）の顧客を @pocket から取得し、最新順で返す。
 */
export async function listCustomerCrmRecords(
  boundStaffName: string,
  filter: CustomerCrmFilter = "all",
  options?: { maxResults?: number | null },
): Promise<CustomerCrmListItem[]> {
  const maxResults =
    options?.maxResults === null ? null : (options?.maxResults ?? crmMaxResults());
  const all = await getCachedCustomerCrmCandidates(boundStaffName);
  const filtered = all.filter((item) => passesCrmFilter(item, filter));
  const sliced =
    maxResults == null ? filtered : filtered.slice(0, maxResults);
  return sliced.map(({ sortKey: _s, ...item }) => item);
}

/**
 * 担当顧客一覧と同じ AP/CL/作成者判定で、T番号の案件がログイン担当のものか確認する。
 * 一覧キャッシュを優先し、未掲載時のみ単体照合する。
 */
export async function staffOwnsCustomerByTNumber(
  boundStaffName: string,
  tNumber: string,
): Promise<boolean> {
  const normT = normApClStaffName(tNumber);
  const bound = normApClStaffName(boundStaffName);
  if (!normT || !bound) return false;

  const cached = await getCachedCustomerCrmCandidates(bound);
  if (cached.some((c) => normApClStaffName(c.tNumber ?? "") === normT)) {
    return true;
  }

  const cfg = customerInfoConfigReady();
  if (!cfg.ok) return false;

  const appId = customerInfoAppId();
  const keyEnv = customerInfoImportKeyFieldId();
  if (!appId || !keyEnv) return false;

  const readAuths = readAuthsForApp("CUSTOMER_INFO");
  const appFields =
    (await fetchAppFieldsTryKeys(
      appId,
      readAuths.map((a) => a.apiKey ?? ""),
    )) ?? [];
  const ctx = buildCrmFieldContext(appFields);
  if (!ctx?.tNumberFieldId) return false;

  const recordId = await findCustomerInfoRecordIdByUniqueKeyCached(
    ctx.tNumberFieldId,
    normT,
  );
  if (!recordId) return false;

  const fieldsCsv = [
    ctx.tNumberFieldId,
    ctx.apFieldId,
    ctx.clFieldId,
    ctx.creatorFieldId,
  ]
    .filter((id): id is string => Boolean(id?.trim()))
    .join(",");
  let row = await fetchRecordById(
    appId,
    recordId,
    customerInfoPocketAuth(),
    fieldsCsv,
  );
  if (!row?.record) {
    row = await fetchRecordById(appId, recordId, customerInfoPocketAuth());
  }
  if (!row?.record || typeof row.record !== "object") return false;

  return (
    matchCustomerInfoPendingAudience(
      row.record as Record<string, unknown>,
      bound,
      ctx.apFieldId,
      ctx.clFieldId,
      ctx.creatorFieldId,
    ) != null
  );
}
