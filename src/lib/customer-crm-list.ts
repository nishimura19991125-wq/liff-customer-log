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
import { pickRecordValueByFieldAliases } from "@/lib/calendar-kojo";
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
/**
 * 既定10分。
 *
 * 以前は担当者ごとにキャッシュしており、10人使えば10回の全件走査になっていた。
 * @pocket の利用制限は **サイト単位で100秒あたり100回**なので、人数ぶん
 * 増えるのは致命的。全件を1回だけ取ってキャッシュし、絞り込みは取り出した
 * 後に行う形へ変えたうえで、TTL も伸ばしている。
 */
const DEFAULT_CACHE_TTL_MS = 600_000;
const DEFAULT_PAGE_DELAY_MS = 400;

/**
 * キャッシュに載せる1件（タスクO-3）。
 *
 * audience は AP担当者・CL担当者・案件作成者の**生の値**だけを、@pocket と
 * 同じ fieldId をキーにして持つ。matchCustomerInfoPendingAudience はこの3列しか
 * 読まないので、これを渡せば**判定ロジックを一切変えずに**絞り込める。
 */
type CrmCandidate = CustomerCrmListItem & {
  sortKey: number;
  audience: Record<string, unknown>;
};

/** 担当者で絞る前の全件。ユーザー非依存なのでキーに氏名を含めない */
type CrmCacheEntry = {
  expiresAt: number;
  items: CrmCandidate[];
  apFieldId: string | null;
  clFieldId: string | null;
  creatorFieldId: string | null;
};

export type CrmSnapshot = Omit<CrmCacheEntry, "expiresAt">;

/**
 * ★ ユーザー非依存キー。**絞り込み前の全件だけ**を入れる。
 * 担当者で絞った結果をここへ入れてはならない（Phase 0 §6）。
 */
const CRM_ALL_CACHE_KEY = "all";

const crmListStore = new Map<string, CrmCacheEntry>();
const crmListInflight = new Map<string, Promise<CrmSnapshot>>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

/**
 * 絞り込み**前**の全件を取る（タスクO-3）。
 * 担当者名は受け取らない。誰が呼んでも同じ結果になる＝キャッシュを共有できる。
 */
async function fetchAllCustomerCrmCandidatesFromPocket(): Promise<CrmSnapshot> {
  const empty: CrmSnapshot = {
    items: [],
    apFieldId: null,
    clFieldId: null,
    creatorFieldId: null,
  };
  const cfg = customerInfoConfigReady();
  if (!cfg.ok) return empty;

  const appId = customerInfoAppId();
  if (!appId) return empty;

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
  if (appFields.length === 0) return empty;
  const ctx = buildCrmFieldContext(appFields);
  if (!ctx) return empty;

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

      // 担当者での絞り込みはここでは行わない。キャッシュから取り出した後に
      // 同じ matchCustomerInfoPendingAudience で判定する（タスクO-3）
      const audience: Record<string, unknown> = {};
      for (const id of [ctx.apFieldId, ctx.clFieldId, ctx.creatorFieldId]) {
        if (!id) continue;
        audience[id] = pickRecordValueByFieldAliases(recObj, id);
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
        audience,
      });
    }

    if (rows.length < PAGE_LIMIT) break;
  }

  candidates.sort((a, b) => b.sortKey - a.sortKey);
  return {
    items: candidates,
    apFieldId: ctx.apFieldId,
    clFieldId: ctx.clFieldId,
    creatorFieldId: ctx.creatorFieldId,
  };
}

/** sortKey と audience は内部用。画面へは出さない */
function toCustomerCrmListItem(c: CrmCandidate): CustomerCrmListItem {
  return {
    recordId: c.recordId,
    customerName: c.customerName,
    subtitle: c.subtitle,
    tNumber: c.tNumber,
    isDocumentMissing: c.isDocumentMissing,
    isSubsidyTarget: c.isSubsidyTarget,
    combinedSubsidyName: c.combinedSubsidyName,
    isConstructionDateUnset: c.isConstructionDateUnset,
    isCancelled: c.isCancelled,
  };
}

/** 絞り込み前の全件を、ユーザー非依存キーで共有する（タスクO-3） */
async function getCachedCustomerCrmSnapshot(): Promise<CrmSnapshot> {
  const ttl = crmCacheTtlMs();
  if (ttl <= 0) {
    return fetchAllCustomerCrmCandidatesFromPocket();
  }

  const now = Date.now();
  const hit = crmListStore.get(CRM_ALL_CACHE_KEY);
  if (hit && hit.expiresAt > now) {
    return {
      items: hit.items,
      apFieldId: hit.apFieldId,
      clFieldId: hit.clFieldId,
      creatorFieldId: hit.creatorFieldId,
    };
  }

  const pending = crmListInflight.get(CRM_ALL_CACHE_KEY);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const snapshot = await fetchAllCustomerCrmCandidatesFromPocket();
      crmListStore.set(CRM_ALL_CACHE_KEY, {
        expiresAt: Date.now() + ttl,
        ...snapshot,
      });
      return snapshot;
    } finally {
      crmListInflight.delete(CRM_ALL_CACHE_KEY);
    }
  })();

  crmListInflight.set(CRM_ALL_CACHE_KEY, promise);
  return promise;
}

/**
 * 担当者で絞る。**キャッシュから取り出した後**に行うのが要点で、
 * 絞り込み済みの結果をキャッシュへ戻さない（Phase 0 §6）。
 * 判定は既存の matchCustomerInfoPendingAudience をそのまま使う。
 */
export function filterCrmCandidatesForStaff(
  snapshot: CrmSnapshot,
  boundStaffName: string,
): CrmCandidate[] {
  const bound = boundStaffName.normalize("NFKC").trim();
  if (!bound) return [];
  return snapshot.items.filter(
    (item) =>
      matchCustomerInfoPendingAudience(
        item.audience,
        bound,
        snapshot.apFieldId,
        snapshot.clFieldId,
        snapshot.creatorFieldId,
      ) != null,
  );
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
  const snapshot = await getCachedCustomerCrmSnapshot();
  const mine = filterCrmCandidatesForStaff(snapshot, boundStaffName);
  const filtered = mine.filter((item) => passesCrmFilter(item, filter));
  const sliced =
    maxResults == null ? filtered : filtered.slice(0, maxResults);
  return sliced.map(toCustomerCrmListItem);
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

  const snapshot = await getCachedCustomerCrmSnapshot();
  const cached = filterCrmCandidatesForStaff(snapshot, bound);
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
