import "server-only";

import {
  apiKeyForCalendarPocket1,
  apiKeyForCalendarWrite,
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
  resolveConstructionFieldIds,
  resolveConstructionImportKeyFieldId,
  resolveConstructionTNumberFieldId,
} from "@/lib/calendar-kojo";
import { invalidateAllCalendarPayloadCache } from "@/lib/calendar-response-cache";
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
 * ■ 空き枠は作らない
 * 以前は、施工予定日が7営業日より先のとき同じ日・同じ施工会社の空き枠を
 * 新規作成していた。この自動作成は廃止した（営業日の判定・祝日の取得・
 * 空き枠の payload 組み立てもあわせて外してある）。
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
};

const CONSTRUCTION_UPDATE_FAILED =
  "キャンセル処理は完了しましたが、工事登録アプリの更新に失敗しました。DX事業部へ連絡してください。";
const CONSTRUCTION_NOT_FOUND =
  "キャンセル処理は完了しましたが、工事登録アプリに該当レコードが見つかりませんでした。DX事業部へ連絡してください。";

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
 * 監査ログはベストエフォート（A-5）。**書き込みの成否に影響させない。**
 *
 * 書き込みと同じ try に入れると、記録に失敗しただけで「更新に失敗しました」と
 * 表示されてしまう（実際には更新済み）。
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
 * 工事レコードを Aki番号 → T番号 の順で引く。既存の一覧キャッシュに相乗りする。
 *
 * ■ Aki番号 を先に見る理由
 * 工事アプリ側で確実に入っているのは Aki番号（あちらの自動採番）。
 * T番号 はお客様情報が採番して**転記されてくる**値なので、転記が
 * 済んでいない案件では空のことがある。T番号 だけで引くと、その案件は
 * 「工事アプリに無い」と誤判定され、キャンセルしても工事レコードが
 * 手つかずで残る（カレンダーに案件が残る）。
 *
 * ■ T番号 も残す理由
 * 移行前からある案件には Aki番号 が入っていない。あちらは T番号 で引ける。
 */
async function findConstructionRecordIdForCancel(
  calAppId: string,
  fieldsCsv: string,
  keys: Array<{ fieldId: string | null; value: string }>,
  /** 診断用。この列のキーを持つ行を数える（照合には使わない） */
  importKeyFieldId: string | null,
): Promise<{
  found: { recordId: string; matchedBy: string } | null;
  rowsTotal: number;
  rowsWithAkiKey: number;
}> {
  const targets = keys
    .map((k) => ({
      fieldId: k.fieldId?.trim() ?? "",
      want: normApClStaffName(k.value),
    }))
    .filter((k) => k.fieldId && k.want);
  if (targets.length === 0) {
    return { found: null, rowsTotal: 0, rowsWithAkiKey: 0 };
  }

  const records = await fetchCalendarConstructionRecordsCached(
    calAppId,
    fieldsCsv,
    null,
  );
  const akiKey = importKeyFieldId?.trim() ?? "";
  let rowsWithAkiKey = 0;
  if (akiKey) {
    for (const row of records) {
      const rec = row.record;
      if (!rec || typeof rec !== "object") continue;
      if (recordHasFieldKey(rec as Record<string, unknown>, akiKey)) {
        rowsWithAkiKey += 1;
      }
    }
  }
  const stats = { rowsTotal: records.length, rowsWithAkiKey };
  // キーの優先順に全件を見る。先に Aki番号 で一巡してから T番号 へ落とす
  for (const target of targets) {
    for (const row of records) {
      const rec = row.record;
      if (!rec || typeof rec !== "object") continue;
      const cell = coercePlainString(
        pickRecordValueByFieldAliases(
          rec as Record<string, unknown>,
          target.fieldId,
        ),
      );
      if (normApClStaffName(cell) !== target.want) continue;
      const id = row.recordId ?? row.id;
      if (id == null) continue;
      const s = String(id).trim();
      if (s) {
        return { found: { recordId: s, matchedBy: target.fieldId }, ...stats };
      }
    }
  }
  return { found: null, ...stats };
}

/**
 * 行がその列のキーを持つか（値が空でも、キーがあれば true）。
 * キーの表記ゆれ（field-N / field_N）は pickRecordValueByFieldAliases と同じ。
 */
function recordHasFieldKey(
  rec: Record<string, unknown>,
  fieldId: string,
): boolean {
  const m = /^field[-_](\d+)$/i.exec(fieldId);
  const keys = m ? [fieldId, `field-${m[1]}`, `field_${m[1]}`] : [fieldId];
  return keys.some((k) => Object.prototype.hasOwnProperty.call(rec, k));
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
  /** キャンセルする案件の T番号（お客様情報の採番値。工事側へ転記されている） */
  tNumber: string;
  /**
   * 工事アプリの取込キー（Aki番号）。お客様情報に控えてあれば渡す。
   * 工事レコードを引く主キーで、T番号 が転記されていない案件でも当たる
   */
  akiNumber?: string;
  lineUserId: string;
}): Promise<CustomerCancelSideEffectResult> {
  const base: CustomerCancelSideEffectResult = {
    warnings: [],
    constructionUpdated: false,
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
  /** 工事アプリの取込キー（Aki番号）。照合と更新の両方で使う */
  const importKeyFieldId =
    resolveConstructionImportKeyFieldId(constructionFields);

  const lookupKeys = [
    // 工事アプリ側の主キー。転記待ちに左右されない
    { fieldId: importKeyFieldId, value: opts.akiNumber ?? "" },
    // 移行前からある案件はこちらで引ける
    { fieldId: tNumberFieldId, value: tNumber },
  ];
  /**
   * 取得列は**照合に使う列から作る**。別々に解決すると、照合する列が
   * 取得列に入らないことがある。
   *
   * 以前は fids だけで取得していた。fids に Aki番号 は無く、T番号 も
   * 見出しから解決した列で、照合側（環境変数を優先）と一致する保証が
   * 無かった。@pocket が指定列だけを返すなら、その列での照合は一度も
   * 成立しない。他の経路（customer-info-construction-link など）は
   * 読む列を取得列へ明示的に足しており、それに揃えている。
   * 解決できなかった列（null）は足されず、照合の対象からも外れる
   */
  const csv = collectConstructionFieldsCsv(
    fids,
    undefined,
    lookupKeys.map((k) => k.fieldId),
  );
  let found: { recordId: string; matchedBy: string } | null = null;
  try {
    const lookup = await findConstructionRecordIdForCancel(
      calAppId,
      csv,
      lookupKeys,
      importKeyFieldId,
    );
    found = lookup.found;
    /**
     * どちらの列で一致したかを残す。**件数と真偽値だけ**（氏名・T番号・
     * Aki番号 の値は出さない）。
     *
     * rowsWithAkiKey が 0 のまま rowsTotal だけ増えていれば、Aki番号 の列が
     * 応答に載っていない＝Aki番号 での照合は成立していない。
     */
    console.info(
      "[customer-cancel] 工事レコードの照合内訳",
      JSON.stringify({
        matchedBy: !found
          ? "none"
          : found.matchedBy === importKeyFieldId?.trim()
            ? "aki"
            : "tNumber",
        akiProvided: Boolean(opts.akiNumber?.trim()),
        rowsWithAkiKey: lookup.rowsWithAkiKey,
        rowsTotal: lookup.rowsTotal,
        tNumberInFields: csv.split(",").includes(tNumberFieldId),
      }),
    );
  } catch (e) {
    console.error("[customer-cancel] 工事レコードの照合に失敗", e);
    return { ...base, warnings: [CONSTRUCTION_UPDATE_FAILED] };
  }
  const constructionRecordId = found?.recordId ?? null;

  if (!constructionRecordId) {
    // 工事レコードが無い＝カレンダー上でその日を押さえていない
    console.warn(
      "[customer-cancel] 工事アプリに該当レコードが無いため、更新をスキップ",
      JSON.stringify({
        // 値そのものは出さない（真偽値のみ）
        hasTNumber: Boolean(tNumber),
        // どちらのキーで探せたのかを残す。Aki番号 を渡せていないだけの
        // ことがあり、その場合は工事レコードはある
        hasAkiNumber: Boolean(opts.akiNumber?.trim()),
        hasImportKeyField: Boolean(importKeyFieldId),
      }),
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
      /**
       * 取込キーは **Aki番号**。T番号 ではない。
       *
       * db2ee62 で空き枠の**作成**だけ Aki番号 へ移し、ここ（更新）が
       * T番号 のまま残っていた。@pocket は取込キーの列が本文に無いと
       * 更新を 400 で返すので、キャンセルしても工事レコードの
       * 施工予定日が消えず、案件がカレンダーに残っていた。
       *
       * allowMissingImportKey は他の工事アプリ更新（fill-empty-slot・
       * assign-case-to-slot・schedule-undated-case）と同じ扱い。
       * 移行前からある案件には Aki番号 が入っていないことがあり、
       * ここで例外にすると**その案件はキャンセルできなくなる**
       */
      await writePocketRecordWithImportKey({
        appId: calAppId,
        recordId: constructionRecordId,
        payload: clearPatch,
        importKeyFieldId: importKeyFieldId ?? undefined,
        readAuth,
        writeAuth,
        allowMissingImportKey: true,
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

  if (constructionUpdated) {
    invalidateCalendarConstructionRecordsCache();
    invalidateAllCalendarPayloadCache();
  }

  return { warnings, constructionUpdated };
}
