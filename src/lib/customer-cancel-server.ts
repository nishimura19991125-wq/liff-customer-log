import "server-only";

import {
  apiKeyForCalendarPocket1,
  apiKeyForCalendarWrite,
  createRecord,
  fetchAppFields,
} from "@/lib/atpocket";
import { writePocketRecordWithImportKey } from "@/lib/atpocket-write-with-import-key";
import { recordAuditLog } from "@/lib/audit-log";
import { computeAuditChanges } from "@/lib/audit-log-changes";
import { fetchCalendarConstructionRecordsCached } from "@/lib/calendar-construction-records-cache";
import { invalidateCalendarConstructionRecordsCache } from "@/lib/calendar-construction-records-cache";
import {
  collectConstructionFieldsCsv,
  pickRecordValueByFieldAliases,
  pocketFieldUniqueIdByCaption,
  resolveConfiguredFieldToSchemaUniqueId,
  resolveConstructionFieldIds,
  resolveConstructionImportKeyFieldId,
  resolveConstructionTNumberFieldId,
} from "@/lib/calendar-kojo";
import { fetchJapanHolidayKeysForRange } from "@/lib/japan-holidays-api";
import { CUSTOMER_STATUS_DEFAULT } from "@/lib/customer-info-form/options";
import { invalidateAllCalendarPayloadCache } from "@/lib/calendar-response-cache";
import { buildCustomerCancelPlan } from "@/lib/customer-cancel-plan";
import type { CustomerCancelPlan } from "@/lib/customer-cancel-plan";
import { resolveCustomerInfoConstructionHandlerFieldId } from "@/lib/customer-info-construction-handler";
import { fieldCaptionByUniqueId } from "@/lib/customer-info-record";
import { resolveCustomerInfoPtTransferFields } from "@/lib/customer-info-form/resolve-fields";
import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";

/**
 * 顧客ステータスを「キャンセル」にしたときの、お客様情報アプリ**以外**の処理（タスクV）。
 *
 * 順序は route 側で固定している。ここへ来るのはお客様情報の更新が
 * 成功したあとだけ。ここでの失敗は業務を止めず、warning として返す。
 *
 * ■ 空き枠の削除は行わない
 * 削除は assign-case-to-slot の対象枠のみという約束を守る。ここは
 * 「工事レコードの3項目を空にする」「空き枠を新規作成する」だけ。
 */

/** 工事登録アプリで空にする項目。初回施工予定日は工事アプリに列が無い */
export type ConstructionClearedField =
  | "startDate"
  | "contractor"
  | "constructionHandler";

export type CustomerCancelSideEffectResult = {
  /** 画面に出す警告。空なら全部成功 */
  warnings: string[];
  constructionUpdated: boolean;
  emptySlotCreated: boolean;
  emptySlotRecordId: string | null;
  /** 実際に使った判定（ログ・レスポンス用） */
  plan: CustomerCancelPlan;
};

const CONSTRUCTION_UPDATE_FAILED =
  "キャンセル処理は完了しましたが、工事登録アプリの更新に失敗しました。DX事業部へ連絡してください。";
const CONSTRUCTION_NOT_FOUND =
  "キャンセル処理は完了しましたが、工事登録アプリに該当レコードが見つかりませんでした。DX事業部へ連絡してください。";
const EMPTY_SLOT_FAILED =
  "キャンセル処理は完了しましたが、空き枠の作成に失敗しました。DX事業部へ連絡してください。";

function coercePlainString(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "string") return raw.trim();
  if (typeof raw === "number" || typeof raw === "boolean") {
    return String(raw).trim();
  }
  if (Array.isArray(raw)) {
    return raw.map(coercePlainString).filter(Boolean).join(" ");
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
 * 空き枠に入れる顧客ステータス。
 * @pocket の既存の空き枠が「工事待ち」なので、作る枠もそれに合わせる。
 */
const EMPTY_SLOT_CUSTOMER_STATUS = CUSTOMER_STATUS_DEFAULT;

/**
 * 監査ログはベストエフォート（A-5）。**書き込みの成否に影響させない。**
 *
 * 以前は書き込みと同じ try に入れていたため、記録に失敗しただけで
 * 「空き枠の作成に失敗しました」と表示されていた（実際には作成済み）。
 * 記録は書き込みが済んでから行い、失敗はサーバログに留める。
 *
 * ここを「失敗したら止める」に変えないこと。止めてよいのは削除だけで、
 * それは assign-case-to-slot 側で deletionLog.ok を見る形で担保している。
 */
async function recordAuditLogBestEffort(
  entry: Parameters<typeof recordAuditLog>[0],
  scope: string,
): Promise<void> {
  try {
    const logged = await recordAuditLog(entry);
    if (!logged.ok) {
      console.error(
        `[customer-cancel] ${scope}は成功しましたが、監査ログを残せませんでした`,
        JSON.stringify({
          targetRecordId: entry.targetRecordId,
          targetTNumber: entry.targetTNumber,
          error: logged.error,
        }),
      );
    }
  } catch (e) {
    // recordAuditLog は投げない設計だが、想定外でも業務処理は止めない
    console.error(
      `[customer-cancel] ${scope}の監査ログで想定外の例外`,
      e,
    );
  }
}

/**
 * 空き枠レコードの中身を組み立てる。
 *
 * ■ 取込キー（Aki番号）の列を**空文字で載せる**理由
 * @pocket の作成APIは、取込キーの列がレコード本文に無いと
 * 「取込設定にキー項目を追加してください」で 400 を返す。値は空でよく、
 * 空なら自動採番される。他の新規作成も同じことをしている:
 *   - buildConstructionFillPatch（create-record）… 取込キー列に "" を載せる
 *   - applyAttendanceAutoNumberOnCreate（勤怠）… 取込キー列に "" を入れる
 *
 * ⚠ 以前はここに T番号 を載せていた。工事アプリが T番号 を自動採番し、
 *   取込キーも兼ねていたため。採番元がお客様情報アプリへ移り、
 *   工事アプリの取込キーは Aki番号 になったので載せる列を変えている。
 *   T番号 は載せない（採番されないので空文字を入れても意味が無い）。
 *
 * ■ お客様名は載せない
 * 空のままにすることで空き枠として扱われる（constructionTitleFieldIsEmpty）。
 */
export function buildEmptySlotPayload(input: {
  /** 工事登録アプリの取込キー（Aki番号）列 */
  importKeyFieldId: string;
  startDateFieldId: string;
  contractorFieldId: string;
  /** 解決できないときは null。その場合ステータス無しで作る */
  customerStatusFieldId: string | null;
  dayKey: string;
  contractor: string;
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    // 値は入れない。@pocket が自動採番する
    [input.importKeyFieldId]: "",
    [input.startDateFieldId]: input.dayKey,
    [input.contractorFieldId]: input.contractor,
  };
  if (input.customerStatusFieldId) {
    payload[input.customerStatusFieldId] = EMPTY_SLOT_CUSTOMER_STATUS;
  }
  return payload;
}

/** 工事登録アプリの顧客ステータス列。環境変数優先・未設定なら見出し完全一致 */
export function resolveConstructionCustomerStatusFieldId(
  constructionFields: Awaited<ReturnType<typeof fetchAppFields>>,
): string | null {
  const env = process.env.CALENDAR_CUSTOMER_STATUS_FIELD_ID?.trim();
  if (env) {
    return resolveConfiguredFieldToSchemaUniqueId(env, constructionFields);
  }
  return pocketFieldUniqueIdByCaption(constructionFields, "顧客ステータス");
}

/**
 * 空き枠の判定に使う祝日。外部APIから取り、失敗したら**土日のみ**に落ちる。
 * 外部依存で保存そのものが止まらないようにする。
 */
export async function resolveCancelPlanWithHolidays(input: {
  todayDayKey: string;
  constructionDate: string;
  contractor: string;
}): Promise<CustomerCancelPlan> {
  const target = (input.constructionDate ?? "").trim();
  let holidayKeys: ReadonlySet<string> = new Set<string>();
  let degraded = false;
  if (target) {
    const lookup = await fetchJapanHolidayKeysForRange(
      input.todayDayKey,
      target,
    );
    holidayKeys = lookup.keys;
    degraded = lookup.degraded;
  }
  if (degraded) {
    console.warn(
      "[customer-cancel] 祝日を取得できなかったため土日のみで営業日を数えます",
      JSON.stringify({ todayDayKey: input.todayDayKey, target }),
    );
  }
  return buildCustomerCancelPlan({
    todayDayKey: input.todayDayKey,
    constructionDate: input.constructionDate,
    contractor: input.contractor,
    holidayKeys,
    holidaysDegraded: degraded,
  });
}

/** 工事レコードを T番号 で引く。既存の一覧キャッシュに相乗りする */
async function findConstructionRecordIdByTNumber(
  calAppId: string,
  fieldsCsv: string,
  tNumberFieldId: string,
  tNumber: string,
): Promise<string | null> {
  const want = normApClStaffName(tNumber);
  if (!want) return null;

  const records = await fetchCalendarConstructionRecordsCached(
    calAppId,
    fieldsCsv,
    null,
  );
  for (const row of records) {
    const rec = row.record;
    if (!rec || typeof rec !== "object") continue;
    const cell = coercePlainString(
      pickRecordValueByFieldAliases(rec as Record<string, unknown>, tNumberFieldId),
    );
    if (normApClStaffName(cell) !== want) continue;
    const id = row.recordId ?? row.id;
    if (id == null) continue;
    const s = String(id).trim();
    if (s) return s;
  }
  return null;
}

/**
 * お客様情報アプリ側の payload にキャンセル分を上書きする。
 *
 * PT は values.pt = "0" で computePtTransfer が 0 を返すが、V-2 のとおり
 * 計算結果に依存せず **APPT・CLPT を明示的に 0** で上書きする。
 * 工事対応者はフォームスキーマに無い列なので、ここで直接消す。
 */
export function applyCustomerCancelToPayload(
  payload: Record<string, unknown>,
  appFields: Awaited<ReturnType<typeof fetchAppFields>>,
): { clearedHandler: boolean; zeroedPt: string[] } {
  const zeroedPt: string[] = [];
  for (const field of resolveCustomerInfoPtTransferFields(appFields).resolved) {
    if (field.key === "appt" || field.key === "clpt") {
      payload[field.fieldId] = "0";
      zeroedPt.push(field.key);
    }
  }

  const handlerFieldId =
    resolveCustomerInfoConstructionHandlerFieldId(appFields);
  if (handlerFieldId) {
    payload[handlerFieldId] = "";
    return { clearedHandler: true, zeroedPt };
  }
  return { clearedHandler: false, zeroedPt };
}

export async function runCustomerCancelSideEffects(opts: {
  /** キャンセルする案件の T番号（工事アプリの取込キー） */
  tNumber: string;
  /** キャンセル前の施工予定日（空き枠の判定と作成に使う） */
  constructionDate: string;
  /** キャンセル前の施工会社（空き枠の判定と作成に使う） */
  contractor: string;
  /** 操作した日（YYYY-MM-DD） */
  todayDayKey: string;
  lineUserId: string;
}): Promise<CustomerCancelSideEffectResult> {
  const plan = await resolveCancelPlanWithHolidays({
    todayDayKey: opts.todayDayKey,
    constructionDate: opts.constructionDate,
    contractor: opts.contractor,
  });

  const base: CustomerCancelSideEffectResult = {
    warnings: [],
    constructionUpdated: false,
    emptySlotCreated: false,
    emptySlotRecordId: null,
    plan,
  };

  const calAppId = process.env.CALENDAR_APP_ID?.trim();
  if (!calAppId) {
    return { ...base, warnings: [CONSTRUCTION_NOT_FOUND] };
  }

  const tNumber = opts.tNumber.trim();
  if (!tNumber) {
    return { ...base, warnings: [CONSTRUCTION_NOT_FOUND] };
  }

  const readAuth = { apiKey: apiKeyForCalendarPocket1() };
  // 書き込みキーは create-record ルートと同じ（工事登録アプリへの書き込み権限）
  const writeAuth = { apiKey: apiKeyForCalendarWrite() };

  let constructionFields: Awaited<ReturnType<typeof fetchAppFields>>;
  try {
    constructionFields = await fetchAppFields(calAppId, readAuth, {
      operation: "calendar:キャンセル処理fields",
      appEnv: "CALENDAR_APP_ID",
    });
  } catch (e) {
    console.error("[customer-cancel] 工事アプリの列定義を取得できません", e);
    return { ...base, warnings: [CONSTRUCTION_UPDATE_FAILED] };
  }

  const fids = resolveConstructionFieldIds(constructionFields);
  const tNumberFieldId = resolveConstructionTNumberFieldId(constructionFields);
  if (!tNumberFieldId) {
    console.error("[customer-cancel] 工事アプリの T番号 列を解決できません");
    return { ...base, warnings: [CONSTRUCTION_NOT_FOUND] };
  }
  /** 空き枠の作成に要る取込キー（Aki番号）。無ければ空き枠は作らない */
  const importKeyFieldId =
    resolveConstructionImportKeyFieldId(constructionFields);

  const csv = collectConstructionFieldsCsv(fids);
  let constructionRecordId: string | null = null;
  try {
    constructionRecordId = await findConstructionRecordIdByTNumber(
      calAppId,
      csv,
      tNumberFieldId,
      tNumber,
    );
  } catch (e) {
    console.error("[customer-cancel] 工事レコードの照合に失敗", e);
    return { ...base, warnings: [CONSTRUCTION_UPDATE_FAILED] };
  }

  if (!constructionRecordId) {
    // 工事レコードが無い＝カレンダー上でその日を押さえていない。
    // 空き枠を作ると存在しなかった空きを増やすことになるので作らない。
    console.warn(
      "[customer-cancel] 工事アプリに該当レコードが無いため、更新と空き枠作成をスキップ",
      JSON.stringify({ tNumber }),
    );
    return { ...base, warnings: [CONSTRUCTION_NOT_FOUND] };
  }

  const warnings: string[] = [];

  // ── 1) 工事レコードの3項目を空にする（レコードは削除しない）
  const clearPatch: Record<string, unknown> = {};
  const clearTargets: Array<[ConstructionClearedField, string | undefined]> = [
    ["startDate", fids.startDate],
    ["contractor", fids.contractor],
    ["constructionHandler", fids.constructionHandler],
  ];
  for (const [, fieldId] of clearTargets) {
    const id = fieldId?.trim();
    if (id) clearPatch[id] = "";
  }

  let constructionUpdated = false;
  if (Object.keys(clearPatch).length > 0) {
    try {
      await writePocketRecordWithImportKey({
        appId: calAppId,
        recordId: constructionRecordId,
        payload: clearPatch,
        importKeyFieldId: tNumberFieldId,
        readAuth,
        writeAuth,
      });
      constructionUpdated = true;
    } catch (e) {
      console.error("[customer-cancel] 工事レコードの更新に失敗", e);
      warnings.push(CONSTRUCTION_UPDATE_FAILED);
    }

    // 記録は書き込みが済んでから。失敗しても更新は成功のまま
    if (constructionUpdated) {
      await recordAuditLogBestEffort(
        {
          lineUserId: opts.lineUserId,
          operation: "update",
          targetAppId: calAppId,
          targetRecordId: constructionRecordId,
          targetTNumber: tNumber,
          changes: computeAuditChanges(null, clearPatch, {
            labelOf: (fieldId) =>
              fieldCaptionByUniqueId(constructionFields, fieldId),
          }),
        },
        "工事レコードの更新",
      );
    }
  }

  // ── 2) 空き枠の作成（条件を満たすときだけ）
  let emptySlotCreated = false;
  let emptySlotRecordId: string | null = null;
  if (constructionUpdated && plan.createsEmptySlot) {
    const startId = fids.startDate?.trim();
    const contractorId = fids.contractor?.trim();
    if (!startId || !contractorId || !importKeyFieldId) {
      // 取込キーの列が無いと @pocket が作成を拒むので、ここで諦める
      console.error(
        "[customer-cancel] 施工予定日／施工会社／取込キー（Aki番号）の列を解決できず、空き枠を作成できません",
        {
          hasStartDate: Boolean(startId),
          hasContractor: Boolean(contractorId),
          hasImportKey: Boolean(importKeyFieldId),
        },
      );
      warnings.push(EMPTY_SLOT_FAILED);
    } else {
      const slotStatusId =
        resolveConstructionCustomerStatusFieldId(constructionFields);
      if (!slotStatusId) {
        console.warn(
          "[customer-cancel] 工事アプリの顧客ステータス列を解決できません。空き枠はステータス無しで作成します",
        );
      }
      const slotPayload = buildEmptySlotPayload({
        importKeyFieldId,
        startDateFieldId: startId,
        contractorFieldId: contractorId,
        customerStatusFieldId: slotStatusId,
        dayKey: plan.emptySlotDayKey,
        contractor: plan.emptySlotContractor,
      });
      try {
        // 新規作成なので取込キーで既存を探す必要が無い。
        // create-record ルート・勤怠の打刻と同じく createRecord を直接使う
        const created = await createRecord(calAppId, slotPayload, writeAuth);
        emptySlotCreated = true;
        emptySlotRecordId =
          created.recordIdHint?.trim() ||
          (created.row?.recordId != null
            ? String(created.row.recordId)
            : null);
      } catch (e) {
        console.error("[customer-cancel] 空き枠の作成に失敗", e);
        warnings.push(EMPTY_SLOT_FAILED);
      }

      // V-8: 「なぜこの空き枠ができたか」を後から追えるようにする。
      // 作成が済んでから記録し、記録の失敗は作成の成否に影響させない
      if (emptySlotCreated) {
        await recordAuditLogBestEffort(
          {
            lineUserId: opts.lineUserId,
            operation: "create",
            targetAppId: calAppId,
            targetRecordId: emptySlotRecordId ?? "",
            targetTNumber: tNumber,
            changes: [
              {
                fieldId: "__cancel_empty_slot__",
                label: "空き枠の自動作成",
                before: "",
                after: `T番号 ${tNumber} のキャンセルにより作成（${plan.emptySlotDayKey} / ${plan.emptySlotContractor} / ${plan.businessDays}営業日先）`,
              },
              {
                fieldId: startId,
                label: fieldCaptionByUniqueId(constructionFields, startId),
                before: "",
                after: plan.emptySlotDayKey,
              },
              {
                fieldId: contractorId,
                label: fieldCaptionByUniqueId(constructionFields, contractorId),
                before: "",
                after: plan.emptySlotContractor,
              },
            ],
          },
          "空き枠の作成",
        );
      }
    }
  }

  if (constructionUpdated || emptySlotCreated) {
    invalidateCalendarConstructionRecordsCache();
    invalidateAllCalendarPayloadCache();
  }

  return {
    warnings,
    constructionUpdated,
    emptySlotCreated,
    emptySlotRecordId,
    plan,
  };
}
