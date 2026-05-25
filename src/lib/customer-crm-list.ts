import "server-only";

import {
  customerInfoAppId,
  customerInfoConfigReady,
  customerInfoNameFieldId,
  customerInfoPocketAuth,
  customerInfoSubtitleFieldId,
} from "@/lib/customer-info-config";
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
import type { AtPocketFieldRow } from "@/lib/atpocket";
import { fetchAppFields, fetchRecordsList } from "@/lib/atpocket";
import { resolveConfiguredFieldToSchemaUniqueId } from "@/lib/calendar-kojo";

export type CustomerCrmFilter =
  | "all"
  | "missing_docs"
  | "no_construction_date"
  | "subsidy";

export type CustomerCrmListItem = {
  recordId: string;
  customerName: string;
  subtitle: string;
  isDocumentMissing: boolean;
  isSubsidyTarget: boolean;
  combinedSubsidyName: string | null;
  isConstructionDateUnset: boolean;
};

const PAGE_LIMIT = 1000;
const DEFAULT_MAX_PAGES = 25;
const DEFAULT_MAX_RESULTS = 80;

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
      return item.isDocumentMissing;
    case "no_construction_date":
      return item.isConstructionDateUnset;
    case "subsidy":
      return item.isSubsidyTarget;
    default:
      return true;
  }
}

type CrmFieldContext = {
  nameField: string;
  subtitleField: string | null;
  apFieldId: string | null;
  clFieldId: string | null;
  creatorFieldId: string | null;
  constructionDateFieldId: string | null;
  subsidyFieldIds: CrmSubsidyFieldIds;
  sortFieldId: string | null;
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

  const fieldIdSet = new Set<string>([nameField]);
  if (subtitleField) fieldIdSet.add(subtitleField);
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
  for (const d of docFields) fieldIdSet.add(d.fieldId);

  return {
    nameField,
    subtitleField,
    apFieldId,
    clFieldId,
    creatorFieldId,
    constructionDateFieldId,
    subsidyFieldIds,
    sortFieldId,
    docFields,
    fieldsCsv: [...fieldIdSet].join(","),
  };
}

/**
 * ログイン担当者（AP/CL/案件作成者）の顧客を @pocket から取得し、最新順で返す。
 */
export async function listCustomerCrmRecords(
  boundStaffName: string,
  filter: CustomerCrmFilter = "all",
): Promise<CustomerCrmListItem[]> {
  const cfg = customerInfoConfigReady();
  if (!cfg.ok) return [];

  const appId = customerInfoAppId();
  if (!appId) return [];

  const auth = customerInfoPocketAuth();
  const pocketCtx = {
    operation: "customer-crm:担当顧客一覧",
    appEnv: "CUSTOMER_INFO_APP_ID",
  } as const;

  const appFields = await fetchAppFields(appId, auth, pocketCtx);
  const ctx = buildCrmFieldContext(appFields);
  if (!ctx) return [];

  const candidates: Array<CustomerCrmListItem & { sortKey: number }> = [];
  const maxPages = crmMaxPages();
  const maxResults = crmMaxResults();

  for (let page = 1; page <= maxPages; page++) {
    const data = await fetchRecordsList(
      appId,
      {
        limit: String(PAGE_LIMIT),
        page: String(page),
        fields: ctx.fieldsCsv,
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

      const { isDocumentMissing } = evaluateCrmDocuments(recObj, ctx.docFields);
      const { isSubsidyTarget, combinedSubsidyName } = buildCrmSubsidyInfo(
        recObj,
        ctx.subsidyFieldIds,
      );
      const isConstructionDateUnset = isCrmConstructionDateUnset(
        recObj,
        ctx.constructionDateFieldId,
      );

      const item: CustomerCrmListItem & { sortKey: number } = {
        recordId,
        customerName,
        subtitle: ctx.subtitleField
          ? readCustomerInfoFieldValue(recObj, ctx.subtitleField)
          : "",
        isDocumentMissing,
        isSubsidyTarget,
        combinedSubsidyName,
        isConstructionDateUnset,
        sortKey: crmSortKeyFromRecord(recObj, recordId, ctx.sortFieldId),
      };

      if (passesCrmFilter(item, filter)) {
        candidates.push(item);
      }
    }

    if (rows.length < PAGE_LIMIT) break;
  }

  candidates.sort((a, b) => b.sortKey - a.sortKey);

  return candidates.slice(0, maxResults).map(({ sortKey: _s, ...item }) => item);
}
