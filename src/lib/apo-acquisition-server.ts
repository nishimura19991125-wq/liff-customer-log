import "server-only";

import {
  apiKeyForSalesDashboardApoPocket,
  apiKeyForSalesDashboardApoWrite,
  createRecord,
  fetchAppFields,
  salesDashboardApoWriteConfigured,
} from "@/lib/atpocket";
import {
  APO_ACQUISITION_FIELD_SPECS,
  apoAcquisitionDefaultEstimateStatus,
  resolveApoAcquisitionFields,
  type ApoAcquisitionResolvedField,
} from "@/lib/apo-acquisition-fields";
import {
  APO_ACQUISITION_FIELD_KEYS,
  type ApoAcquisitionCreateInput,
  type ApoAcquisitionCreateResult,
  type ApoAcquisitionFieldKey,
  type ApoAcquisitionFieldMeta,
  type ApoAcquisitionFileAttachment,
  type ApoAcquisitionFormPayload,
} from "@/lib/apo-acquisition-types";
import { atPocketRecordIdFromCreateResult } from "@/lib/atpocket-record-id";
import type { AtPocketFieldRow } from "@/lib/atpocket";
import { buildAtPocketFilePutPayload } from "@/lib/at-pocket-file-field";
import { customerInfoPutValue } from "@/lib/customer-info-record";
import { postalCodeForPocket } from "@/lib/customer-info-form/postal-code";
import { checkboxGroupValueToPocketArray } from "@/lib/customer-info-form/checkbox-pocket";
import {
  filterCustomerInfoPutPayload,
  isWritableAtPocketField,
} from "@/lib/customer-info-form/pocket-writable-fields";
import { pocketFieldUniqueIdByCaption, resolveConfiguredFieldToSchemaUniqueId } from "@/lib/calendar-kojo";
import { salesDashboardApoAppId } from "@/lib/sales-dashboard-fields";
import { fetchApClStaffPickerPayload } from "@/lib/staff-ap-cl-candidates";

function jstDateKey(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(d);
}

function nfkc(s: string): string {
  return s.normalize("NFKC").trim();
}

function normalizeYmd(raw: string): string {
  const s = nfkc(raw);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const digits = s.replace(/[^\d]/g, "");
  if (digits.length >= 8) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  }
  return "";
}

/** "2026-07-04" or "2026-07-04T13:30" → @pocket 日付/日時文字列 */
function dateValueForPocket(raw: string, withTime: boolean): string {
  const s = nfkc(raw);
  const [datePart, timePart] = s.split(/[T\s]/);
  const ymd = normalizeYmd(datePart ?? "");
  if (!ymd) return "";
  const [y, mo, d] = ymd.split("-");
  const slash = `${y}/${mo}/${d}`;
  if (!withTime) return slash;
  const time = (timePart ?? "").trim();
  const m = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!m) return slash;
  const hh = String(Number(m[1])).padStart(2, "0");
  return `${slash} ${hh}:${m[2]}`;
}

const APO_ACQUISITION_MAX_FILE_BYTES = 5 * 1024 * 1024;
const APO_ACQUISITION_MAX_FILES_PER_FIELD = 5;

function validateFileAttachments(
  label: string,
  files: ApoAcquisitionFileAttachment[],
): string | null {
  if (files.length > APO_ACQUISITION_MAX_FILES_PER_FIELD) {
    return `${label}の添付は${APO_ACQUISITION_MAX_FILES_PER_FIELD}件までです`;
  }
  for (const file of files) {
    const bytes = Buffer.byteLength(file.contentBase64, "base64");
    if (bytes > APO_ACQUISITION_MAX_FILE_BYTES) {
      return `${file.name}が大きすぎます（5MBまで）`;
    }
  }
  return null;
}

function apStaffOptionsWithDefault(
  options: string[],
  boundStaffName: string,
): string[] {
  const bound = nfkc(boundStaffName);
  if (!bound) return options;
  if (options.includes(bound)) return options;
  return [bound, ...options];
}

function buildFieldMeta(
  resolved: Record<ApoAcquisitionFieldKey, ApoAcquisitionResolvedField>,
  apStaffOptions: string[],
  clStaffOptions: string[],
): ApoAcquisitionFieldMeta[] {
  return APO_ACQUISITION_FIELD_KEYS.map((key) => {
    const r = resolved[key];
    const spec = r.spec;
    const options =
      spec.kind === "staffSelect"
        ? key === "apStaff"
          ? apStaffOptions
          : clStaffOptions
        : spec.kind === "select" || spec.kind === "checkboxGroup"
          ? r.pocketOptions && r.pocketOptions.length
            ? r.pocketOptions
            : spec.options ?? []
          : undefined;
    return {
      key,
      label: spec.label,
      kind: spec.kind,
      required: spec.required,
      present:
        Boolean(r.uniqueId) ||
        spec.kind === "staffSelect" ||
        key === "apStaff",
      ...(options ? { options } : {}),
      ...(spec.placeholder ? { placeholder: spec.placeholder } : {}),
      ...(spec.hint ? { hint: spec.hint } : {}),
      ...(spec.kind === "file"
        ? { accept: "image/*,.pdf,application/pdf" }
        : {}),
    };
  });
}

function emptyDefaults(boundStaffName: string) {
  return {
    apStaffName: boundStaffName,
    apoAcquiredYmd: jstDateKey(),
    estimateStatus: apoAcquisitionDefaultEstimateStatus(),
  };
}

export async function buildApoAcquisitionFormPayload(
  lineUserId: string,
  boundStaffName: string,
): Promise<ApoAcquisitionFormPayload> {
  const apoAppId = salesDashboardApoAppId();
  if (!apoAppId) {
    return {
      configured: false,
      writeEnabled: false,
      configError: "SALES_DASHBOARD_APO_APP_ID が未設定です",
      defaults: emptyDefaults(boundStaffName),
      fields: [],
    };
  }

  const readAuth = { apiKey: apiKeyForSalesDashboardApoPocket() };
  const apoFields = await fetchAppFields(apoAppId, readAuth, {
    operation: "apo-acquisition:fields",
    appEnv: "SALES_DASHBOARD_APO_APP_ID",
  });

  const resolved = resolveApoAcquisitionFields(apoFields);

  const apCl = await fetchApClStaffPickerPayload(lineUserId);
  const apStaff = apStaffOptionsWithDefault(
    apCl.ap.options,
    boundStaffName,
  );
  const clStaff = apCl.cl.options;

  const scheduledOk = Boolean(resolved.scheduledDate.uniqueId);
  const customerOk = Boolean(resolved.customerName.uniqueId);
  if (!scheduledOk || !customerOk) {
    return {
      configured: false,
      writeEnabled: salesDashboardApoWriteConfigured(),
      configError:
        "アポ取得情報連携で必須列（お客様名・商談・資料送付予定日時）を特定できません。見出し名を確認してください。",
      defaults: emptyDefaults(boundStaffName),
      fields: buildFieldMeta(resolved, apStaff, clStaff),
    };
  }

  return {
    configured: true,
    writeEnabled: salesDashboardApoWriteConfigured(),
    defaults: emptyDefaults(boundStaffName),
    fields: buildFieldMeta(resolved, apStaff, clStaff),
  };
}

function resolveEstimateStatusFieldId(
  fields: AtPocketFieldRow[],
): string | null {
  const env = process.env.MEETING_SCHEDULE_STATUS_FIELD_ID?.trim();
  if (env) {
    const id = resolveConfiguredFieldToSchemaUniqueId(env, fields);
    if (id) {
      const matched = fields.find((f) => f.uniqueId?.trim() === id);
      if (matched && isWritableAtPocketField(matched)) return id;
    }
  }
  const id = pocketFieldUniqueIdByCaption(fields, "見積ステータス");
  if (!id) return null;
  const matched = fields.find((f) => f.uniqueId?.trim() === id);
  if (matched && isWritableAtPocketField(matched)) return id;
  return null;
}

/** 初回商談予定日（新規登録時に商談・資料送付予定日時から自動反映） */
function resolveFirstMeetingScheduledDateFieldId(
  fields: AtPocketFieldRow[],
): string | null {
  const env = process.env.APO_ACQUISITION_FIRST_MEETING_DATE_FIELD_ID?.trim();
  if (env) {
    const id = resolveConfiguredFieldToSchemaUniqueId(env, fields);
    if (id) {
      const matched = fields.find((f) => f.uniqueId?.trim() === id);
      if (matched && isWritableAtPocketField(matched)) return id;
    }
  }
  for (const cap of ["初回商談予定日", "初回商談 予定日"]) {
    const id = pocketFieldUniqueIdByCaption(fields, cap);
    if (!id) continue;
    const matched = fields.find((f) => f.uniqueId?.trim() === id);
    if (matched && isWritableAtPocketField(matched)) return id;
  }
  return null;
}

function findFieldKeyByUniqueId(
  resolved: Record<ApoAcquisitionFieldKey, ApoAcquisitionResolvedField>,
  uniqueId: string,
): ApoAcquisitionFieldKey | null {
  for (const key of APO_ACQUISITION_FIELD_KEYS) {
    if (resolved[key].uniqueId === uniqueId) return key;
  }
  return null;
}

export async function createApoAcquisitionRecord(
  boundStaffName: string,
  input: ApoAcquisitionCreateInput,
): Promise<ApoAcquisitionCreateResult> {
  const bound = nfkc(boundStaffName);
  if (!bound) {
    return { ok: false, status: 403, error: "担当者の紐付けが必要です" };
  }

  if (!salesDashboardApoWriteConfigured()) {
    return {
      ok: false,
      status: 503,
      error:
        "登録用 API キー（SALES_DASHBOARD_APO_ATPOCKET_API_KEY_2）が未設定です",
    };
  }

  const apoAppId = salesDashboardApoAppId();
  if (!apoAppId) {
    return {
      ok: false,
      status: 503,
      error: "SALES_DASHBOARD_APO_APP_ID が未設定です",
    };
  }

  const values = input.values ?? {};
  const files = input.files ?? {};
  const apStaffName = nfkc(
    values.apStaff ?? input.apStaffName ?? boundStaffName,
  );
  if (!apStaffName) {
    return { ok: false, status: 400, error: "AP担当者を選択してください" };
  }

  // 必須チェック
  for (const key of APO_ACQUISITION_FIELD_KEYS) {
    const spec = APO_ACQUISITION_FIELD_SPECS[key];
    if (!spec.required) continue;
    if (spec.kind === "file") {
      if (!(files[key]?.length ?? 0)) {
        return { ok: false, status: 400, error: `${spec.label}を添付してください` };
      }
      continue;
    }
    const raw = key === "apStaff" ? apStaffName : nfkc(values[key] ?? "");
    if (!raw) {
      return { ok: false, status: 400, error: `${spec.label}を入力してください` };
    }
  }

  for (const key of APO_ACQUISITION_FIELD_KEYS) {
    const spec = APO_ACQUISITION_FIELD_SPECS[key];
    if (spec.kind !== "file") continue;
    const fieldFiles = files[key] ?? [];
    const err = validateFileAttachments(spec.label, fieldFiles);
    if (err) return { ok: false, status: 400, error: err };
  }

  const apoAcquiredYmd = normalizeYmd(values.apoAcquiredDate ?? "");
  if (!apoAcquiredYmd) {
    return { ok: false, status: 400, error: "アポ取得日を入力してください" };
  }
  const scheduledYmd = normalizeYmd(
    (values.scheduledDate ?? "").split(/[T\s]/)[0] ?? "",
  );
  if (!scheduledYmd) {
    return {
      ok: false,
      status: 400,
      error: "商談・資料送付予定日時を入力してください",
    };
  }

  try {
    const readAuth = { apiKey: apiKeyForSalesDashboardApoPocket() };
    const writeAuth = { apiKey: apiKeyForSalesDashboardApoWrite() };
    const apoFields = await fetchAppFields(apoAppId, readAuth, {
      operation: "apo-acquisition:create-fields",
      appEnv: "SALES_DASHBOARD_APO_APP_ID",
    });

    const resolved = resolveApoAcquisitionFields(apoFields);
    if (!resolved.scheduledDate.uniqueId || !resolved.customerName.uniqueId) {
      return {
        ok: false,
        status: 503,
        error: "アポ取得情報連携の必須列を特定できません",
      };
    }

    const record: Record<string, unknown> = {};

    for (const key of APO_ACQUISITION_FIELD_KEYS) {
      const r = resolved[key];
      if (!r.uniqueId) continue;

      if (r.spec.kind === "file") {
        const payload = buildAtPocketFilePutPayload(files[key] ?? []);
        if (payload.length > 0) {
          record[r.uniqueId] = payload;
        }
        continue;
      }

      const raw =
        key === "apStaff"
          ? apStaffName
          : nfkc(values[key] ?? "");
      if (!raw) continue;

      let value: unknown = raw;
      if (r.spec.kind === "date") {
        value = dateValueForPocket(raw, false);
      } else if (r.spec.kind === "datetime") {
        value = dateValueForPocket(raw, true);
      } else if (key === "postalCode") {
        const pocket = postalCodeForPocket(raw);
        if (!pocket) continue;
        value = pocket;
      } else if (r.spec.kind === "checkboxGroup") {
        const selected = checkboxGroupValueToPocketArray(
          raw,
          r.pocketOptions?.length ? r.pocketOptions : r.spec.options,
        );
        if (selected.length === 0) continue;
        value = selected;
      }
      if (value === "") continue;
      record[r.uniqueId] = customerInfoPutValue(value);
    }

    // 初回商談予定日は新規登録時のみ、商談・資料送付予定日時と同じ値を自動セット
    const scheduledRaw = nfkc(values.scheduledDate ?? "");
    const scheduledForPocket = dateValueForPocket(scheduledRaw, true);
    const firstMeetingDateId = resolveFirstMeetingScheduledDateFieldId(apoFields);
    const scheduledDateId = resolved.scheduledDate.uniqueId;
    if (
      firstMeetingDateId &&
      scheduledForPocket &&
      firstMeetingDateId !== scheduledDateId &&
      record[firstMeetingDateId] === undefined
    ) {
      record[firstMeetingDateId] = customerInfoPutValue(scheduledForPocket);
    }

    // 見積ステータスは既定値で自動セット
    const statusId = resolveEstimateStatusFieldId(apoFields);
    if (statusId && record[statusId] === undefined) {
      record[statusId] = customerInfoPutValue(
        apoAcquisitionDefaultEstimateStatus(),
      );
    }

    const { payload: filteredRecord, dropped } = filterCustomerInfoPutPayload(
      record,
      apoFields,
    );
    for (const drop of dropped) {
      const key = findFieldKeyByUniqueId(resolved, drop.fieldId);
      const label =
        (key ? APO_ACQUISITION_FIELD_SPECS[key].label : null) ??
        drop.label ??
        drop.fieldId;
      if (key && APO_ACQUISITION_FIELD_SPECS[key].required) {
        return {
          ok: false,
          status: 503,
          error: `${label}の列（${drop.fieldId}）は登録できません。${drop.reason}。@pocket の列設定または環境変数を確認してください。`,
        };
      }
      console.warn("[apo-acquisition:create] dropped field", drop);
    }

    const created = await createRecord(apoAppId, filteredRecord, writeAuth);
    const recordId = atPocketRecordIdFromCreateResult(created);
    if (!recordId) {
      return {
        ok: false,
        status: 502,
        error: "登録は完了しましたが、レコード ID を取得できませんでした",
      };
    }

    return { ok: true, recordId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[apo-acquisition:create]", e);
    return {
      ok: false,
      status: 502,
      error: msg || "アポ取得情報の登録に失敗しました",
    };
  }
}
