import "server-only";

import {
  atPocketRecordIdFromCreateResult,
  pollConstructionTNumberByRecordId,
  SYNC_TNUMBER_POLL_DELAYS_MS,
} from "@/lib/atpocket-record-id";
import type { AtPocketFieldRow, AtPocketFetchAuth } from "@/lib/atpocket";
import {
  apiKeyForCustomerInfoWrite,
  createRecord,
  fetchAppFields,
  fetchRecordById,
  updateRecord,
} from "@/lib/atpocket";
import { auditLogEnabled, recordAuditLog } from "@/lib/audit-log";
import { computeAuditChanges } from "@/lib/audit-log-changes";
import {
  DROPBOX_FOLDER_WARNING,
  ensureCustomerFolderLink,
  resolveCustomerInfoDropboxLinkFieldId,
} from "@/lib/customer-info-dropbox-link";
import { dropboxConfigured } from "@/lib/dropbox";
import {
  pickRecordValueByFieldAliases,
  pocketFieldUniqueIdByCaption,
  resolveConfiguredFieldToSchemaUniqueId,
  resolveConstructionFieldIds,
  resolveConstructionTNumberFieldId,
  resolveEmptyFillHousingStatusFieldId,
} from "@/lib/calendar-kojo";
import {
  resolveConstructionRegistrationNumberFieldIds,
  resolveCustomerInfoRegistrationNumberFieldIds,
} from "@/lib/construction-customer-info-sync-fields";
import { INPUT_STATUS_PENDING } from "@/lib/customer-info-form/options";
import { applyCreatorNameToCustomerRecord } from "@/lib/customer-info-creator-field";
import {
  findCustomerInfoRecordIdByUniqueKeyCached,
  refetchCustomerInfoRecordIdByUniqueKey,
} from "@/lib/customer-info-key-lookup-cache";
import { defaultApClStaffNamesForLineUser } from "@/lib/staff-ap-cl-candidates";
import { staffBranchValueToWrite } from "@/lib/customer-info-form/staff-branch-write";
import {
  boundStaffFromRosterRows,
  fetchStaffRosterRowsCached,
} from "@/lib/staff-roster-cache";
import { dateValueForPocket } from "@/lib/customer-info-form/date-pocket";
import {
  normalizeDateForInput,
  resolveCustomerInfoFormFieldId,
} from "@/lib/customer-info-form/resolve-fields";
import {
  customerInfoPutValue,
  fieldCaptionByUniqueId,
  readCustomerInfoFieldValue,
} from "@/lib/customer-info-record";
import {
  lookupStaffWorkplaceByStaffName,
  resolveStaffWorkplaceLookupConfig,
} from "@/lib/staff-workplace-lookup";

export type CustomerInfoSyncResult =
  | { kind: "skipped" }
  | {
      kind: "synced";
      customerInfoRecordId?: string;
      /** Dropbox フォルダを用意できなかったときの画面向け警告（E-5） */
      dropboxWarning?: string;
    }
  | { kind: "failed"; error: string };

function customerInfoAppConfigured(): boolean {
  return Boolean(process.env.CUSTOMER_INFO_APP_ID?.trim());
}

function pocketSyncErrorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  if (raw.includes("403")) {
    return (
      "お客様情報アプリのフィールド一覧を取得できません（403 Forbidden）。" +
      "CUSTOMER_INFO_ATPOCKET_API_KEY_2 が CUSTOMER_INFO_APP_ID のお客様情報アプリに対して「登録・更新」権限を持っているか確認してください。"
    );
  }
  if (raw.includes("401")) {
    return (
      "お客様情報アプリへの認証に失敗しました（401）。" +
      "CUSTOMER_INFO_ATPOCKET_API_KEY_2（お客様情報アプリの登録権限のあるキー）を確認してください。"
    );
  }
  if (raw.includes("list fields failed")) {
    return `お客様情報アプリのフィールド定義を取得できません。${raw}`;
  }
  if (raw.includes("create record failed")) {
    return `お客様情報アプリへのレコード登録に失敗しました。${raw}`;
  }
  if (raw.includes("update record failed")) {
    return `お客様情報アプリへのレコード更新に失敗しました。${raw}`;
  }
  if (raw.includes("キー項目が重複")) {
    return (
      "お客様情報アプリに同じキー項目（T番号）のレコードが既にありますが、照合で見つけられませんでした。" +
      "CUSTOMER_INFO_CONSTRUCTION_UNIQUE_KEY_FIELD_ID が T番号列の uniqueId と一致しているか確認してください。"
    );
  }
  return raw || "お客様情報アプリへの連携に失敗しました。";
}

function coercePocketPlainString(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "string") return raw.trim();
  if (typeof raw === "number" || typeof raw === "boolean") {
    return String(raw).trim();
  }
  if (Array.isArray(raw)) {
    return raw.map(coercePocketPlainString).filter(Boolean).join(" ");
  }
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    for (const k of ["value", "displayValue", "label", "name", "text"]) {
      const v = o[k];
      if (v != null && (typeof v === "string" || typeof v === "number")) {
        return String(v).trim();
      }
    }
  }
  return String(raw).trim();
}

/**
 * 工事アプリへ書き込み済みのレコードを GET し、ユニークキー（T番号等）を取り出して
 * お客様情報アプリに登録する。同一キーが既にあれば更新（PUT）、なければ新規（POST）。
 * CUSTOMER_INFO_APP_ID 未設定時は何もしない（skipped）。
 */
export async function syncConstructionRecordToCustomerInfoApp(opts: {
  calAppId: string;
  /** 工事レコード ID（空枠更新時は必須。新規で取れないときは constructionUniqueKey と併用） */
  constructionRecordId?: string;
  /** 工事 T番号（recordId 未取得時に空枠登録と同様の連携を行う） */
  constructionUniqueKey?: string;
  customerName: string;
  /** LIFF で選択した住宅ステータス（工事レコード再取得より優先） */
  housingStatus?: string;
  constructionFields: AtPocketFieldRow[];
  calendarAuth: AtPocketFetchAuth;
  /** LIFF ログイン者の LINE ID（sub）。AP/CL担当者の自動転記に使用 */
  lineUserId?: string;
}): Promise<CustomerInfoSyncResult> {
  try {
    return await syncConstructionRecordToCustomerInfoAppInner(opts);
  } catch (e) {
    console.error("[sync-construction-to-customer-info]", e);
    return { kind: "failed", error: pocketSyncErrorMessage(e) };
  }
}

async function applyApClStaffFromLineUserToCustomerRecord(
  customerRecord: Record<string, unknown>,
  customerFields: AtPocketFieldRow[],
  lineUserId: string,
  precomputed?: { apStaff: string | null; clStaff: string | null },
): Promise<void> {
  const want = lineUserId.trim();
  if (!want) return;

  const { apStaff, clStaff } =
    precomputed ?? (await defaultApClStaffNamesForLineUser(want));
  const apStaffFieldId = resolveCustomerInfoFormFieldId(
    "apStaff",
    "AP担当者",
    customerFields,
  );
  const clStaffFieldId = resolveCustomerInfoFormFieldId(
    "clStaff",
    "CL担当者",
    customerFields,
  );
  if (apStaff && apStaffFieldId) {
    customerRecord[apStaffFieldId] = apStaff;
  }
  if (clStaff && clStaffFieldId) {
    customerRecord[clStaffFieldId] = clStaff;
  }

  const staffCfg = await resolveStaffWorkplaceLookupConfig();
  if (!staffCfg) return;

  const apBranchFieldId = resolveCustomerInfoFormFieldId(
    "apBranch",
    "AP所属支店",
    customerFields,
  );
  const clBranchFieldId = resolveCustomerInfoFormFieldId(
    "clBranch",
    "CL所属支店",
    customerFields,
  );
  // 名簿から引けなければ書かない（タスクM-2）。以前は "-" を入れていたため、
  // 勤務場所が引けない担当者では新規作成の時点で支店が "-" になっていた。
  // 「引けない」ことと「支店が無い」ことは別。put-payload 側と考え方を揃える
  if (apStaff && apBranchFieldId) {
    const workplace = staffBranchValueToWrite(
      await lookupStaffWorkplaceByStaffName(apStaff, staffCfg),
    );
    if (workplace !== null) customerRecord[apBranchFieldId] = workplace;
  }
  if (clStaff && clBranchFieldId) {
    const workplace = staffBranchValueToWrite(
      await lookupStaffWorkplaceByStaffName(clStaff, staffCfg),
    );
    if (workplace !== null) customerRecord[clBranchFieldId] = workplace;
  }
}

/**
 * お客様情報アプリに同じ T番号のレコードが既にあるか。
 *
 * キャッシュが null を返したときは、キャッシュを外して1回だけ引き直す（修正2）。
 * 「見つからない」を取り違えると createRecord まで進んでしまい、同じ顧客の
 * レコードが二重にできる。読み取り1回で防げるなら安いほうを選ぶ。
 */
async function resolveExistingCustomerInfoRecordId(
  keyFieldSchemaId: string,
  uniqueKey: string,
): Promise<string | null> {
  const cached = await findCustomerInfoRecordIdByUniqueKeyCached(
    keyFieldSchemaId,
    uniqueKey,
  );
  if (cached) return cached;
  return refetchCustomerInfoRecordIdByUniqueKey(keyFieldSchemaId, uniqueKey);
}

/**
 * 監査ログの「変更前」に使うレコード。
 * 取得に失敗しても連携は止めない（ログの精度より業務を優先する）。
 * null のときは全項目が「（空） → 値」として記録される点に注意。
 */
async function readCustomerInfoRecordForAudit(
  customerAppId: string,
  recordId: string,
  customerAuth: AtPocketFetchAuth,
): Promise<Record<string, unknown> | null> {
  if (!auditLogEnabled()) return null;
  try {
    const row = await fetchRecordById(customerAppId, recordId, customerAuth);
    if (row?.record && typeof row.record === "object") {
      return row.record as Record<string, unknown>;
    }
  } catch (e) {
    console.warn(
      "[sync-construction-to-customer-info] 監査ログ用の更新前レコード取得に失敗",
      e,
    );
  }
  return null;
}

/**
 * 工事カレンダー連携によるお客様情報アプリへの書き込みを監査ログに残す（修正4）。
 *
 * 従来この経路は1行も記録しておらず、担当者が書き換わったときに
 * 「/customer-info の保存が書いたのか、この連携が書いたのか」を
 * 更新履歴から判別できなかった。対象アプリIDはお客様情報アプリを入れる
 * （カレンダー側ルートの監査ログは工事アプリが対象で、別物）。
 *
 * ベストエフォート。記録に失敗しても連携は成功として扱う。
 */
async function recordCustomerInfoSyncAuditLog(input: {
  operation: "create" | "update";
  lineUserId: string;
  customerAppId: string;
  recordId: string;
  tNumber: string;
  before: Record<string, unknown> | null;
  payload: Record<string, unknown>;
  customerFields: AtPocketFieldRow[];
}): Promise<void> {
  if (!auditLogEnabled()) return;
  try {
    await recordAuditLog({
      lineUserId: input.lineUserId,
      operation: input.operation,
      targetAppId: input.customerAppId,
      targetRecordId: input.recordId,
      targetTNumber: input.tNumber,
      changes: computeAuditChanges(input.before, input.payload, {
        labelOf: (fieldId) =>
          fieldCaptionByUniqueId(input.customerFields, fieldId),
      }),
    });
  } catch (e) {
    // recordAuditLog は作成・更新では throw しない約束だが、
    // ここで連携を落とさないことを呼び出し側から見て自明にしておく
    console.warn(
      "[sync-construction-to-customer-info] 監査ログの記録に失敗",
      e,
    );
  }
}

async function syncConstructionRecordToCustomerInfoAppInner(opts: {
  calAppId: string;
  constructionRecordId?: string;
  constructionUniqueKey?: string;
  customerName: string;
  housingStatus?: string;
  constructionFields: AtPocketFieldRow[];
  calendarAuth: AtPocketFetchAuth;
  lineUserId?: string;
}): Promise<CustomerInfoSyncResult> {
  const customerAppId = process.env.CUSTOMER_INFO_APP_ID?.trim();
  if (!customerAppId) {
    return { kind: "skipped" };
  }

  const constructionRecordId = opts.constructionRecordId?.trim() || "";
  const keyFromOpts = opts.constructionUniqueKey?.trim() || "";
  if (!constructionRecordId && !keyFromOpts) {
    return {
      kind: "failed",
      error:
        "工事レコードを特定できませんでした。お客様情報アプリへの連携に必要な T番号またはレコード ID が取得できません。",
    };
  }

  const customerUniqueKeyFieldEnv =
    process.env.CUSTOMER_INFO_CONSTRUCTION_UNIQUE_KEY_FIELD_ID?.trim();
  if (!customerUniqueKeyFieldEnv) {
    return {
      kind: "failed",
      error:
        "お客様情報アプリ連携の書き込み先が未設定です。CUSTOMER_INFO_CONSTRUCTION_UNIQUE_KEY_FIELD_ID（@pocket の uniqueId）を設定してください。",
    };
  }

  const constructionKeyField = resolveConstructionTNumberFieldId(
    opts.constructionFields,
  );
  if (!constructionKeyField) {
    return {
      kind: "failed",
      error:
        "工事アプリからユニークキー（T番号）のフィールドを特定できません。CALENDAR_EMPTY_FILL_TNUMBER_FIELD_ID または CALENDAR_CONSTRUCTION_UNIQUE_KEY_FIELD_ID を設定してください。",
    };
  }

  const customerAuth: AtPocketFetchAuth = {
    apiKey: apiKeyForCustomerInfoWrite(),
  };

  const customerFields = await fetchAppFields(customerAppId, customerAuth);
  const resolvedCustomerKey = resolveConfiguredFieldToSchemaUniqueId(
    customerUniqueKeyFieldEnv,
    customerFields,
  );
  if (!resolvedCustomerKey) {
    return {
      kind: "failed",
      error: `お客様情報アプリの連携先フィールド「${customerUniqueKeyFieldEnv}」がフィールド定義と一致しません。`,
    };
  }

  const customerNameFieldEnv =
    process.env.CUSTOMER_INFO_CUSTOMER_NAME_FIELD_ID?.trim();
  let resolvedCustomerName: string | null = null;
  if (customerNameFieldEnv) {
    resolvedCustomerName = resolveConfiguredFieldToSchemaUniqueId(
      customerNameFieldEnv,
      customerFields,
    );
    if (!resolvedCustomerName) {
      return {
        kind: "failed",
        error: `お客様情報アプリのお客様名フィールド「${customerNameFieldEnv}」がフィールド定義と一致しません。`,
      };
    }
  }

  const constructionRegFields =
    resolveConstructionRegistrationNumberFieldIds(opts.constructionFields);
  const customerRegFields =
    resolveCustomerInfoRegistrationNumberFieldIds(customerFields);

  const registrationPairs: Array<{
    constructionFieldId: string;
    customerFieldId: string;
    label: string;
  }> = [];
  if (
    constructionRegFields.apptRegistrationNumber &&
    customerRegFields.apptRegistrationNumber
  ) {
    registrationPairs.push({
      constructionFieldId: constructionRegFields.apptRegistrationNumber,
      customerFieldId: customerRegFields.apptRegistrationNumber,
      label: "APPT登録番号",
    });
  }
  if (
    constructionRegFields.clptRegistrationNumber &&
    customerRegFields.clptRegistrationNumber
  ) {
    registrationPairs.push({
      constructionFieldId: constructionRegFields.clptRegistrationNumber,
      customerFieldId: customerRegFields.clptRegistrationNumber,
      label: "CLPT登録番号",
    });
  }

  const constructionFids = resolveConstructionFieldIds(opts.constructionFields);
  const constructionHousingFieldId =
    resolveEmptyFillHousingStatusFieldId(opts.constructionFields);
  const customerHousingFieldId = (() => {
    const fromEnv =
      process.env.CUSTOMER_INFO_HOUSING_STATUS_FIELD_ID?.trim() || "";
    if (fromEnv) {
      return resolveConfiguredFieldToSchemaUniqueId(fromEnv, customerFields);
    }
    return (
      pocketFieldUniqueIdByCaption(customerFields, "住宅ステータス") ||
      pocketFieldUniqueIdByCaption(customerFields, "住宅 ステータス")
    );
  })();
  const customerContractorFieldId = resolveCustomerInfoFormFieldId(
    "constructionContractor",
    "施工業者",
    customerFields,
  );
  const customerConstructionDateFieldId = resolveCustomerInfoFormFieldId(
    "constructionDate",
    "施工予定日",
    customerFields,
  );
  const customerFirstConstructionDateFieldId = resolveCustomerInfoFormFieldId(
    "firstConstructionDate",
    "初回施工予定日",
    customerFields,
  );

  const fieldsCsv = [
    constructionKeyField,
    ...(constructionHousingFieldId ? [constructionHousingFieldId] : []),
    ...(constructionFids.contractor ? [constructionFids.contractor] : []),
    ...(constructionFids.startDate ? [constructionFids.startDate] : []),
    resolvedCustomerKey,
    ...registrationPairs.map((p) => p.constructionFieldId),
    ...(resolvedCustomerName ? [resolvedCustomerName] : []),
  ]
    .filter((id, i, arr) => id && arr.indexOf(id) === i)
    .join(",");

  let recObj: Record<string, unknown> | null = null;
  let uniqueKey = keyFromOpts;

  if (constructionRecordId) {
    let recRow = await fetchRecordById(
      opts.calAppId,
      constructionRecordId,
      opts.calendarAuth,
      fieldsCsv,
    );
    if (!recRow?.record) {
      recRow = await fetchRecordById(
        opts.calAppId,
        constructionRecordId,
        opts.calendarAuth,
      );
    }

    if (!recRow?.record || typeof recRow.record !== "object") {
      return {
        kind: "failed",
        error: "工事アプリのレコードを再取得できませんでした。",
      };
    }

    recObj = recRow.record as Record<string, unknown>;
    if (!uniqueKey) {
      uniqueKey = coercePocketPlainString(
        pickRecordValueByFieldAliases(recObj, constructionKeyField),
      );
    }
  }

  if (!uniqueKey && constructionRecordId) {
    const polledKey = await pollConstructionTNumberByRecordId(
      opts.calAppId,
      constructionRecordId,
      constructionKeyField,
      opts.calendarAuth,
      fieldsCsv,
      SYNC_TNUMBER_POLL_DELAYS_MS,
    );
    if (polledKey) uniqueKey = polledKey;
    if (uniqueKey && !recObj) {
      let recRow = await fetchRecordById(
        opts.calAppId,
        constructionRecordId,
        opts.calendarAuth,
        fieldsCsv,
      );
      if (!recRow?.record) {
        recRow = await fetchRecordById(
          opts.calAppId,
          constructionRecordId,
          opts.calendarAuth,
        );
      }
      if (recRow?.record && typeof recRow.record === "object") {
        recObj = recRow.record as Record<string, unknown>;
      }
    }
  }

  if (!uniqueKey) {
    return {
      kind: "failed",
      error:
        "工事レコードからユニークキー（T番号）を取得できませんでした。@pocket で採番・反映されているか確認してください。",
    };
  }

  /**
   * 既存レコードかどうかを、payload を組み立てる**前**に確定させる（修正1／案A）。
   *
   * AP担当者・CL担当者・AP所属支店・CL所属支店・案件作成者は
   * 「この連携を呼んだ人自身」の名前を入れる項目で、新規登録の初期値としては
   * 妥当だが、既存レコードに流すと他人が担当している案件の担当者が
   * カレンダーを操作した人へ書き換わる。
   *
   * 以前は「payload に載せてから、@pocket を読み直して値があれば消す」方式で
   * 防いでいたが、読み直しが1回でも空を返すと消し損ねて上書きが通ってしまう。
   * 判定を先に済ませ、既存レコードでは**そもそも payload に載せない**。
   */
  const existingId = await resolveExistingCustomerInfoRecordId(
    resolvedCustomerKey,
    uniqueKey,
  );

  const customerRecord: Record<string, unknown> = {
    [resolvedCustomerKey]: uniqueKey,
  };
  if (resolvedCustomerName) {
    customerRecord[resolvedCustomerName] = opts.customerName.trim();
  }

  if (customerHousingFieldId) {
    let housingValue = (opts.housingStatus ?? "").trim();
    if (!housingValue && recObj && constructionHousingFieldId) {
      housingValue = coercePocketPlainString(
        pickRecordValueByFieldAliases(recObj, constructionHousingFieldId),
      );
    }
    if (housingValue) {
      customerRecord[customerHousingFieldId] = housingValue;
    }
  }

  if (recObj) {
    for (const pair of registrationPairs) {
      const regValue = coercePocketPlainString(
        pickRecordValueByFieldAliases(recObj, pair.constructionFieldId),
      );
      if (regValue) {
        customerRecord[pair.customerFieldId] = regValue;
      }
    }

    if (constructionFids.contractor && customerContractorFieldId) {
      const contractorValue = coercePocketPlainString(
        pickRecordValueByFieldAliases(recObj, constructionFids.contractor),
      );
      if (contractorValue) {
        customerRecord[customerContractorFieldId] = contractorValue;
      }
    }

    if (
      constructionFids.startDate &&
      (customerConstructionDateFieldId || customerFirstConstructionDateFieldId)
    ) {
      const dateRaw = coercePocketPlainString(
        pickRecordValueByFieldAliases(recObj, constructionFids.startDate),
      );
      const normalized = normalizeDateForInput(dateRaw);
      const pocketDate = dateValueForPocket(normalized || dateRaw);
      if (pocketDate) {
        if (customerConstructionDateFieldId) {
          customerRecord[customerConstructionDateFieldId] = pocketDate;
        }
        if (customerFirstConstructionDateFieldId) {
          customerRecord[customerFirstConstructionDateFieldId] = pocketDate;
        }
      }
    }
  }

  /**
   * 担当者・所属支店・案件作成者の初期値は**新規作成のときだけ**入れる。
   *
   * 既存レコードでは、AP/CL担当者が空欄であっても操作者の名前を入れない。
   * 「空欄なら初期値として補う」挙動はここで意図的に捨てている。
   * 空欄を埋める利便より、他人の担当案件を書き換えない確実性を優先する。
   * 担当者の設定・修正は /customer-info の編集画面で行う。
   */
  if (!existingId && opts.lineUserId?.trim()) {
    const lineUserId = opts.lineUserId.trim();
    const [{ apStaff, clStaff }, rosterRows] = await Promise.all([
      defaultApClStaffNamesForLineUser(lineUserId),
      fetchStaffRosterRowsCached(),
    ]);
    await applyApClStaffFromLineUserToCustomerRecord(
      customerRecord,
      customerFields,
      lineUserId,
      { apStaff, clStaff },
    );
    const bound = boundStaffFromRosterRows(rosterRows, lineUserId);
    const creatorName = bound?.name ?? apStaff ?? clStaff ?? null;
    if (creatorName) {
      applyCreatorNameToCustomerRecord(
        customerRecord,
        customerFields,
        creatorName,
      );
    }
  }

  const inputStatusFieldId = resolveCustomerInfoFormFieldId(
    "inputStatus",
    "入力ステータス",
    customerFields,
  );
  if (inputStatusFieldId) {
    customerRecord[inputStatusFieldId] = INPUT_STATUS_PENDING;
  }

  // ── E-2/E-3: Dropbox 顧客フォルダを用意し、共有リンクを同じ payload に載せる ──
  // ここは「保存 → T番号を再取得」が終わって uniqueKey が確定した後。
  // 採番ロジックには触れていない。失敗しても連携そのものは止めない。
  let dropboxWarning: string | undefined;
  if (dropboxConfigured()) {
    const linkFieldId = resolveCustomerInfoDropboxLinkFieldId(customerFields);
    const folder = await ensureCustomerFolderLink({
      tNumber: uniqueKey,
      customerName: opts.customerName,
      scope: "sync-construction-to-customer-info",
    });
    if (folder.url && linkFieldId) {
      customerRecord[linkFieldId] = folder.url;
    } else if (folder.url && !linkFieldId) {
      // フォルダは作れたがリンクの保存先が分からない。
      // フォルダ作成は冪等なので、列を直せば次回の保存で書き込まれる。
      console.error(
        "[sync-construction-to-customer-info] 「Dropboxリンク」列を解決できません。CUSTOMER_INFO_DROPBOX_LINK_FIELD_ID か列見出しを確認してください",
      );
      dropboxWarning = DROPBOX_FOLDER_WARNING;
    }
    dropboxWarning = dropboxWarning ?? folder.warning ?? undefined;
  }

  const pocketPayload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(customerRecord)) {
    pocketPayload[k] = customerInfoPutValue(v);
  }

  if (existingId) {
    /**
     * 入力ステータスは「空欄なら未入力を入れる、値があれば触らない」。
     *
     * 担当者・所属支店・案件作成者は payload に載せていない（修正1）ので、
     * 読み直しの対象はこの1列だけになった。読み直しが失敗したときに
     * 上書きが通ってしまう弱点は残るが、入力ステータスは
     * /customer-info の保存で入り直る運用項目なので影響が限定される。
     */
    if (inputStatusFieldId && inputStatusFieldId in pocketPayload) {
      let existingRow = await fetchRecordById(
        customerAppId,
        existingId,
        customerAuth,
        inputStatusFieldId,
      );
      if (!existingRow?.record) {
        existingRow = await fetchRecordById(
          customerAppId,
          existingId,
          customerAuth,
        );
      }
      const existingRec = existingRow?.record;
      if (existingRec && typeof existingRec === "object") {
        const current = readCustomerInfoFieldValue(
          existingRec as Record<string, unknown>,
          inputStatusFieldId,
        );
        // 空欄なら初期値として入れる。値があれば触らない
        if (current.trim()) delete pocketPayload[inputStatusFieldId];
      }
    }

    const before = await readCustomerInfoRecordForAudit(
      customerAppId,
      existingId,
      customerAuth,
    );
    await updateRecord(
      customerAppId,
      existingId,
      pocketPayload,
      customerAuth,
    );
    await recordCustomerInfoSyncAuditLog({
      operation: "update",
      lineUserId: opts.lineUserId ?? "",
      customerAppId,
      recordId: existingId,
      tNumber: uniqueKey,
      before,
      payload: pocketPayload,
      customerFields,
    });
    return {
      kind: "synced",
      customerInfoRecordId: existingId,
      ...(dropboxWarning ? { dropboxWarning } : {}),
    };
  }

  const created = await createRecord(
    customerAppId,
    pocketPayload,
    customerAuth,
  );
  const customerInfoRecordId =
    atPocketRecordIdFromCreateResult(created) ?? undefined;

  await recordCustomerInfoSyncAuditLog({
    operation: "create",
    lineUserId: opts.lineUserId ?? "",
    customerAppId,
    recordId: customerInfoRecordId ?? "",
    tNumber: uniqueKey,
    before: null,
    payload: pocketPayload,
    customerFields,
  });

  return {
    kind: "synced",
    customerInfoRecordId,
    ...(dropboxWarning ? { dropboxWarning } : {}),
  };
}
