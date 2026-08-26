import "server-only";

import {
  apiKeyForSalesDashboardApoPocket,
  apiKeyForSalesDashboardApoWrite,
  createRecord,
  fetchAppFields,
  fetchRecordById,
  salesDashboardApoWriteConfigured,
  updateRecord,
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
  type ApoAcquisitionFormPayload,
} from "@/lib/apo-acquisition-types";
import { atPocketRecordIdFromCreateResult } from "@/lib/atpocket-record-id";
import {
  pickCreatedApoRecordId,
  snapshotApoRecordIds,
} from "@/lib/apo-record-lookup";
import type { AtPocketFieldRow } from "@/lib/atpocket";
import {
  customerInfoPutValue,
  readCustomerInfoImportKeyFromRecord,
} from "@/lib/customer-info-record";
import { postalCodeForPocket } from "@/lib/customer-info-form/postal-code";
import { checkboxGroupValueToPocketArray } from "@/lib/customer-info-form/checkbox-pocket";
import {
  formatApoDesiredManufacturers,
  hasApoDesiredManufacturerOther,
} from "@/lib/apo-desired-manufacturer";
import {
  filterCustomerInfoPutPayload,
  isWritableAtPocketField,
} from "@/lib/customer-info-form/pocket-writable-fields";
import { pocketFieldUniqueIdByCaption, resolveConfiguredFieldToSchemaUniqueId } from "@/lib/calendar-kojo";
import { dropboxApoConfigured } from "@/lib/dropbox";
import { salesDashboardApoAppId } from "@/lib/sales-dashboard-fields";
import {
  fetchApClStaffPickerPayload,
  resolveStaffRelationPocketValue,
} from "@/lib/staff-ap-cl-candidates";
import {
  apoImportKeyFieldIdsExcludedOnCreate,
  applyApoAutoNumberOnCreate,
  resolveMeetingScheduleImportKeyFieldId,
} from "@/lib/meeting-schedule-fields";

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
        : spec.kind === "select" ||
            spec.kind === "checkboxGroup" ||
            spec.kind === "checkboxGroupText"
          ? // fixedOptions の項目は @pocket 側に運用外の選択肢が残っていても
            // 画面に出さない（アポランクの C / D など）
            !spec.fixedOptions && r.pocketOptions && r.pocketOptions.length
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
        spec.kind === "file" ||
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
      attachmentEnabled: false,
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
      attachmentEnabled: dropboxApoConfigured(),
      configError:
        "アポ取得情報連携で必須列（お客様名・商談・資料送付予定日時）を特定できません。見出し名を確認してください。",
      defaults: emptyDefaults(boundStaffName),
      fields: buildFieldMeta(resolved, apStaff, clStaff),
    };
  }

  return {
    configured: true,
    writeEnabled: salesDashboardApoWriteConfigured(),
    attachmentEnabled: dropboxApoConfigured(),
    defaults: emptyDefaults(boundStaffName),
    fields: buildFieldMeta(resolved, apStaff, clStaff),
  };
}

function resolveWritableApoFieldId(
  fields: AtPocketFieldRow[],
  uniqueId: string | null,
): string | null {
  if (!uniqueId) return null;
  if (apoImportKeyFieldIdsExcludedOnCreate(fields).has(uniqueId)) return null;
  const matched = fields.find((f) => f.uniqueId?.trim() === uniqueId);
  if (matched && !isWritableAtPocketField(matched)) return null;
  return uniqueId;
}

function resolveEstimateStatusFieldId(
  fields: AtPocketFieldRow[],
): string | null {
  const env = process.env.MEETING_SCHEDULE_STATUS_FIELD_ID?.trim();
  if (env) {
    const id = resolveConfiguredFieldToSchemaUniqueId(env, fields);
    if (id) return resolveWritableApoFieldId(fields, id);
  }
  const id = pocketFieldUniqueIdByCaption(fields, "見積ステータス");
  if (!id) return null;
  return resolveWritableApoFieldId(fields, id);
}

/** 初回商談予定日（新規登録時に商談・資料送付予定日時から自動反映） */
function resolveFirstMeetingScheduledDateFieldId(
  fields: AtPocketFieldRow[],
): string | null {
  const env = process.env.APO_ACQUISITION_FIRST_MEETING_DATE_FIELD_ID?.trim();
  if (env) {
    const id = resolveConfiguredFieldToSchemaUniqueId(env, fields);
    if (id) return resolveWritableApoFieldId(fields, id);
  }
  for (const cap of ["初回商談予定日", "初回商談 予定日"]) {
    const id = pocketFieldUniqueIdByCaption(fields, cap);
    if (!id) continue;
    const resolved = resolveWritableApoFieldId(fields, id);
    if (resolved) return resolved;
  }
  return null;
}

function formatApoAcquisitionCreateError(msg: string): string {
  if (msg.includes("アポ通番") && msg.includes("取込設定")) {
    return [
      "アポ通番(仮)は自動採番ですが、@pocket の取込設定が未完了のため登録できません。",
      "アプリ管理 → アポ取得情報連携 → 取込 で「アポ通番(仮)」を取込項目に追加して保存してください。",
      "（番号の手入力は不要です）",
    ].join("");
  }
  return msg;
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

/** フォームで解決した列と自動セット列だけを登録ペイロードに残す */
function restrictApoAcquisitionCreatePayload(
  record: Record<string, unknown>,
  resolved: Record<ApoAcquisitionFieldKey, ApoAcquisitionResolvedField>,
  extraFieldIds: Array<string | null | undefined>,
): Record<string, unknown> {
  const allowed = new Set<string>();
  for (const key of APO_ACQUISITION_FIELD_KEYS) {
    const r = resolved[key];
    if (!r.uniqueId || !r.writable) continue;
    allowed.add(r.uniqueId.trim());
  }
  for (const id of extraFieldIds) {
    const t = id?.trim();
    if (t) allowed.add(t);
  }

  const out: Record<string, unknown> = {};
  for (const [fieldId, value] of Object.entries(record)) {
    if (!allowed.has(fieldId)) {
      console.warn(
        "[apo-acquisition:create] stripped unmapped field",
        fieldId,
      );
      continue;
    }
    out[fieldId] = value;
  }
  return out;
}

/** 連携項目（AP/CL担当者）を登録後に連携元キー（社員ID）で反映 */
async function applyApoRelationStaffFields(
  apoAppId: string,
  recordId: string,
  resolved: Record<ApoAcquisitionFieldKey, ApoAcquisitionResolvedField>,
  apoFields: AtPocketFieldRow[],
  staffValues: { apStaffName: string; clStaffName: string },
  writeAuth: { apiKey: string },
): Promise<void> {
  const relationUpdates: Record<string, string> = {};
  const clStaffName = nfkc(staffValues.clStaffName);
  if (
    resolved.apStaff.uniqueId &&
    !resolved.apStaff.writable &&
    staffValues.apStaffName
  ) {
    const ap = await resolveStaffRelationPocketValue(staffValues.apStaffName);
    if (ap.ok) relationUpdates[resolved.apStaff.uniqueId] = ap.value;
  }
  if (resolved.clStaff.uniqueId && !resolved.clStaff.writable && clStaffName) {
    const cl = await resolveStaffRelationPocketValue(clStaffName);
    if (cl.ok) relationUpdates[resolved.clStaff.uniqueId] = cl.value;
  }
  if (Object.keys(relationUpdates).length === 0) return;

  const importKeyFieldId = resolveMeetingScheduleImportKeyFieldId(apoFields);
  const wanted = [
    importKeyFieldId,
    ...Object.keys(relationUpdates),
  ]
    .filter(Boolean)
    .join(",");

  const recRow = await fetchRecordById(
    apoAppId,
    recordId,
    { apiKey: apiKeyForSalesDashboardApoPocket() },
    wanted || undefined,
  );
  const recObj = recRow?.record;
  if (!recObj || typeof recObj !== "object") {
    console.warn(
      "[apo-acquisition:create] relation staff skipped: record not found",
      recordId,
    );
    return;
  }

  const payload: Record<string, unknown> = { ...relationUpdates };
  if (importKeyFieldId) {
    const importKey = readCustomerInfoImportKeyFromRecord(
      recObj as Record<string, unknown>,
      importKeyFieldId,
    );
    if (importKey) {
      payload[importKeyFieldId] = importKey;
    }
  }

  try {
    await updateRecord(apoAppId, recordId, payload, writeAuth);
  } catch (e) {
    console.warn("[apo-acquisition:create] relation staff update failed", e);
  }
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
  const apStaffName = nfkc(
    values.apStaff ?? input.apStaffName ?? boundStaffName,
  );
  /**
   * 下の必須チェックでも同じ値を見ており、apStaff の required と
   * **二重管理**になっている。ここを先に置いているのは、以降の処理が
   * apStaffName（紐付け担当者への読み替え後の値）を前提にしているため。
   * apStaff を任意にする場合は、ここも同時に外すこと。
   */
  if (!apStaffName) {
    return { ok: false, status: 400, error: "AP担当者を選択してください" };
  }

  // 必須チェック
  for (const key of APO_ACQUISITION_FIELD_KEYS) {
    const spec = APO_ACQUISITION_FIELD_SPECS[key];
    if (!spec.required) continue;
    // 添付はレコードに載せない。必須にしない（現状 required: false）
    if (spec.kind === "file") continue;
    const raw = key === "apStaff" ? apStaffName : nfkc(values[key] ?? "");
    if (!raw) {
      return { ok: false, status: 400, error: `${spec.label}を入力してください` };
    }
  }

  /**
   * その他メーカーは「その他」が選ばれたときだけ必須。
   * spec.required では表せない条件なのでここで見る
   */
  const wantsOtherManufacturer = hasApoDesiredManufacturerOther(
    values.desiredManufacturer,
  );
  if (wantsOtherManufacturer && !nfkc(values.otherManufacturer ?? "")) {
    return {
      ok: false,
      status: 400,
      error: "その他メーカーを入力してください",
    };
  }

  /**
   * ここから下は**形式**だけを見る。空かどうかは上の spec.required が見る。
   *
   * 以前はここで「アポ取得日」「商談・資料送付予定日時」の必須も判定していた。
   * spec.required と二重管理になっていたため、定義側で商談・資料送付予定日時を
   * 任意にしても登録が弾かれ続ける不具合になった。
   * 必須の判定はこの関数に持たせず、APO_ACQUISITION_FIELD_SPECS を
   * 唯一の情報源にすること。
   */
  const apoAcquiredRaw = nfkc(values.apoAcquiredDate ?? "");
  if (apoAcquiredRaw && !normalizeYmd(apoAcquiredRaw)) {
    return { ok: false, status: 400, error: "アポ取得日を入力してください" };
  }

  // 空でもよい。読めたときだけ後段のログに使う
  const scheduledYmd = normalizeYmd(
    (values.scheduledDate ?? "").split(/[T\s]/)[0] ?? "",
  );

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

    const clStaffName = nfkc(values.clStaff ?? "");
    const apStaffRelation = await resolveStaffRelationPocketValue(apStaffName);
    if (!apStaffRelation.ok) {
      return { ok: false, status: 400, error: apStaffRelation.error };
    }
    const clStaffRelation = clStaffName
      ? await resolveStaffRelationPocketValue(clStaffName)
      : { ok: true as const, value: "" };
    if (!clStaffRelation.ok) {
      return { ok: false, status: 400, error: clStaffRelation.error };
    }

    const record: Record<string, unknown> = {};

    for (const key of APO_ACQUISITION_FIELD_KEYS) {
      const r = resolved[key];
      if (!r.uniqueId || !r.writable) continue;

      if (r.spec.kind === "file") {
        /**
         * 添付は @pocket の列に入れず Dropbox へ置く。
         * base64 をレコード本文に同梱すると 5MB×5件で 33MB ほどになり、
         * 本文サイズの上限に当たる。ファイルは別リクエストで1件ずつ送る
         */
        continue;
      }

      const raw =
        key === "apStaff"
          ? apStaffRelation.value
          : key === "clStaff"
            ? clStaffRelation.value
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
      } else if (key === "otherManufacturer" && !wantsOtherManufacturer) {
        /**
         * 「その他」が選ばれていないなら書き込まない。
         * 希望メーカーに「その他」が入っていないのに その他メーカー に値が
         * 残ると @pocket 上でデータが矛盾する。新規作成なので既存値を
         * 消す心配はなく、単に空のままになる。
         * 画面側は入力値を保持するので、選び直せばそのまま保存できる
         */
        continue;
      } else if (r.spec.kind === "checkboxGroupText") {
        // @pocket 側はテキスト型。定義順に並べて半角カンマで連結する
        const joined = formatApoDesiredManufacturers(raw);
        if (!joined) continue;
        value = joined;
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

    const restrictedRecord = restrictApoAcquisitionCreatePayload(
      record,
      resolved,
      [firstMeetingDateId, statusId],
    );

    const { payload: filteredRecord, dropped } = filterCustomerInfoPutPayload(
      restrictedRecord,
      apoFields,
    );
    for (const drop of dropped) {
      const key = findFieldKeyByUniqueId(resolved, drop.fieldId);
      const label =
        (key ? APO_ACQUISITION_FIELD_SPECS[key].label : null) ??
        drop.label ??
        drop.fieldId;
      const isRelationStaff =
        key != null &&
        (key === "apStaff" || key === "clStaff") &&
        resolved[key].uniqueId &&
        !resolved[key].writable;
      if (isRelationStaff) {
        console.warn("[apo-acquisition:create] relation staff deferred", drop);
        continue;
      }
      if (key && APO_ACQUISITION_FIELD_SPECS[key].required) {
        return {
          ok: false,
          status: 503,
          error: `${label}の列（${drop.fieldId}）は登録できません。${drop.reason}。@pocket の列設定または環境変数を確認してください。`,
        };
      }
      console.warn("[apo-acquisition:create] dropped field", drop);
    }

    const createPayload = applyApoAutoNumberOnCreate(filteredRecord, apoFields);

    // recordId を特定できなくても監査ログは残すので、先に用意しておく
    const labels: Record<string, string> = {};
    for (const f of apoFields) {
      const id = f.uniqueId?.trim();
      const caption = f.caption?.trim();
      if (id && caption) labels[id] = caption;
    }

    /**
     * 作成前の一覧を控えておく。
     *
     * このアプリの POST /records は ID を返さない（Location も本文も空）。
     * 作成後の一覧と突き合わせて「増えた1件」を採るため、作成の**前**に要る。
     * 取れなくても登録は続ける（recordId が空になるだけ）
     */
    const beforeSnapshot = await snapshotApoRecordIds({
      appId: apoAppId,
      customerNameFieldId: resolved.customerName.uniqueId,
      customerName: values.customerName ?? "",
      auth: readAuth,
    });

    const created = await createRecord(apoAppId, createPayload, writeAuth);

    /**
     * ここから先、レコードは**作成済み**である。
     * 何が起きても ok: false を返さないこと。失敗と伝えると利用者が押し直し、
     * 重複レコードが増える（実際に2件の重複が発生した）
     */
    let recordId = atPocketRecordIdFromCreateResult(created) ?? "";

    if (!recordId) {
      const afterSnapshot = await snapshotApoRecordIds({
        appId: apoAppId,
        customerNameFieldId: resolved.customerName.uniqueId,
        customerName: values.customerName ?? "",
        auth: readAuth,
      });
      recordId = pickCreatedApoRecordId(beforeSnapshot, afterSnapshot) ?? "";
    }

    if (!recordId) {
      // 後から @pocket 上で該当レコードを探せる情報を残す。
      // お客様名は個人情報なので出さない（担当者と日付で辿れる）
      console.error(
        "[apo-acquisition:create] 登録は完了しましたが recordId を特定できませんでした（添付・担当者更新は行われません）",
        {
          appsId: apoAppId,
          apStaffName,
          apoAcquiredDate: apoAcquiredRaw,
          scheduledYmd,
          location: created.location ?? null,
          hasRawBody: Boolean(created.rawBody),
          beforeReliable: beforeSnapshot?.reliable ?? null,
        },
      );
      return {
        ok: true,
        recordId: "",
        audit: { appId: apoAppId, record: createPayload, labels },
      };
    }

    /**
     * 担当者の関連付けはレコード作成後の追加更新。
     * ここで失敗しても**レコードは既にある**ので、全体を失敗にしない。
     * 502 を返すと利用者が押し直し、重複レコードが増える
     */
    try {
      await applyApoRelationStaffFields(
        apoAppId,
        recordId,
        resolved,
        apoFields,
        { apStaffName, clStaffName },
        writeAuth,
      );
    } catch (e) {
      console.error(
        "[apo-acquisition:create] 担当者の関連付けに失敗しました（登録は完了しています）",
        { appsId: apoAppId, recordId },
        e instanceof Error ? e.message : String(e),
      );
    }

    return {
      ok: true,
      recordId,
      audit: { appId: apoAppId, record: createPayload, labels },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[apo-acquisition:create]", e);
    return {
      ok: false,
      status: 502,
      error: formatApoAcquisitionCreateError(msg) || "アポ取得情報の登録に失敗しました",
    };
  }
}

