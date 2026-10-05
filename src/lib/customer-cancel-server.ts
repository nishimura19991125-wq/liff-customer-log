import "server-only";

import {
  apiKeyForCalendarPocket1,
  apiKeyForCalendarWrite,
  deleteRecord,
  fetchAppFields,
  fetchRecordById,
} from "@/lib/atpocket";
import type { AtPocketFetchAuth } from "@/lib/atpocket";
import { writePocketRecordWithImportKey } from "@/lib/atpocket-write-with-import-key";
import { recordAuditLog } from "@/lib/audit-log";
import {
  computeAuditChanges,
  formatDeletionContent,
} from "@/lib/audit-log-changes";
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
import {
  customerCancelDeletesConstructionRecordEnabled,
  decideCancelConstructionDeletion,
} from "@/lib/customer-cancel-delete-guard";
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
 * ■ 工事レコードは削除する
 * 以前は3項目（施工予定日・施工会社・工事対応者）を空にしてレコードを
 * 残していた。お客様名と T番号 が残るため空き枠にもならず、宙に浮いた
 * レコードになっていた。レコードごと削除する。
 *
 * **このリポジトリで4つ目の物理削除の呼び出し口。** 作法は他の3つ
 * （assign-case-to-slot・assign-customer-case・move-construction-case）と
 * 同じ（A-4）。削除直前に全項目を取り直し、削除ログを残せたときだけ消す。
 * 可否の判定は customer-cancel-delete-guard.ts に閉じてテストで固定している。
 *
 * CUSTOMER_CANCEL_DELETE_CONSTRUCTION_RECORD=false で止めている間は、
 * 従来どおり3項目を空にする更新に戻る。
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
  /** 削除を止めているときの従来動作。3項目を空にする更新が成立したか */
  constructionUpdated: boolean;
  /**
   * 工事レコードを削除したか。
   * true のときだけ、呼び出し側がお客様情報の Aki番号 を空にする
   * （レコードが消え、番号の指す先が無くなるため）
   */
  constructionDeleted: boolean;
};

const CONSTRUCTION_UPDATE_FAILED =
  "キャンセル処理は完了しましたが、工事登録アプリの更新に失敗しました。DX事業部へ連絡してください。";
const CONSTRUCTION_NOT_FOUND =
  "キャンセル処理は完了しましたが、工事登録アプリに該当レコードが見つかりませんでした。DX事業部へ連絡してください。";
/**
 * 削除を見送ったときの文言。
 *
 * ⚠ **再試行を促す言葉を入れない。** キャンセル済みの案件を保存し直しても
 *    この処理は走らないので、やり直しても直らない。
 */
const CONSTRUCTION_DELETE_AMBIGUOUS =
  "キャンセル処理は完了しましたが、工事登録アプリに同じ案件のレコードが複数あるため、削除を中止しました。DX事業部へ連絡してください。";
const CONSTRUCTION_DELETE_LOG_FAILED =
  "キャンセル処理は完了しましたが、削除の記録を残せなかったため、工事登録アプリのレコードを削除していません。DX事業部へ連絡してください。";
const CONSTRUCTION_DELETE_FAILED =
  "キャンセル処理は完了しましたが、工事登録アプリのレコードを削除できませんでした。DX事業部へ連絡してください。";

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
 * 削除は deleteConstructionRecordForCancel が deletionLog.ok を見て止めている
 * （こちらは通さない）。この関数を通るのは、削除を止めているときの更新だけ。
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
  /**
   * 照合に使う列の**どちらか**で一致した、別々のレコードの数。
   * found（優先順で最初に当たった1件）とは別に数える。削除してよいのは
   * これが 1 のときだけ
   */
  matchedRecordCount: number;
}> {
  const targets = keys
    .map((k) => ({
      fieldId: k.fieldId?.trim() ?? "",
      want: normApClStaffName(k.value),
    }))
    .filter((k) => k.fieldId && k.want);
  if (targets.length === 0) {
    return {
      found: null,
      rowsTotal: 0,
      rowsWithAkiKey: 0,
      matchedRecordCount: 0,
    };
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
  /**
   * 一致したレコードを数える。**下の照合（優先順で最初の1件）は変えない。**
   *
   * Aki番号 で1件に決まっても、同じ T番号 の別レコードがあれば2件と数える。
   * 同じ案件のレコードが2件ある状態（二重登録）で片方だけ消すと、
   * もう片方が残る。どちらが残るかを制御できないので、削除側で止める
   */
  const matchedIds = new Set<string>();
  for (const row of records) {
    const rec = row.record;
    if (!rec || typeof rec !== "object") continue;
    const id = row.recordId ?? row.id;
    const s = id == null ? "" : String(id).trim();
    if (!s) continue;
    const hit = targets.some(
      (target) =>
        normApClStaffName(
          coercePlainString(
            pickRecordValueByFieldAliases(
              rec as Record<string, unknown>,
              target.fieldId,
            ),
          ),
        ) === target.want,
    );
    if (hit) matchedIds.add(s);
  }
  const stats = {
    rowsTotal: records.length,
    rowsWithAkiKey,
    matchedRecordCount: matchedIds.size,
  };
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
    constructionDeleted: false,
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
  let matchedRecordCount = 0;
  try {
    const lookup = await findConstructionRecordIdForCancel(
      calAppId,
      csv,
      lookupKeys,
      importKeyFieldId,
    );
    found = lookup.found;
    matchedRecordCount = lookup.matchedRecordCount;
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

  const deleteEnabled = customerCancelDeletesConstructionRecordEnabled();
  // 一致した件数を残す（件数と真偽値だけ。照合内訳のログとは別の行）
  console.info(
    "[customer-cancel] 工事レコードの一致件数",
    JSON.stringify({ matchedRecords: matchedRecordCount, deleteEnabled }),
  );

  if (deleteEnabled) {
    return deleteConstructionRecordForCancel({
      calAppId,
      constructionRecordId,
      matchedRecordCount,
      lookupKeys,
      tNumber,
      constructionFields,
      readAuth,
      writeAuth,
      lineUserId: opts.lineUserId,
    });
  }

  /**
   * ここから下は、削除を止めているとき（
   * CUSTOMER_CANCEL_DELETE_CONSTRUCTION_RECORD=false）の従来動作。
   * **以前の挙動にそのまま戻す**ので、複数一致でも優先順で最初の1件を
   * 更新する（止めた状態で挙動が変わると切り分けができない）
   */
  const warnings: string[] = [];

  // ── 工事レコードの3項目を空にする（レコードは削除しない）
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

  return { warnings, constructionUpdated, constructionDeleted: false };
}

/**
 * 工事レコードを削除する。**判定 → 削除ログ → 削除**の順を崩さないこと（A-4）。
 *
 * ■ 削除直前に全項目を取り直す
 * 物理削除はログが唯一の復元手段なので、列を絞らずに取る。絞った列で
 * 記録すると、読めていないだけの列を「空欄」として残してしまう。
 * 照合は一覧のキャッシュで行っているので、取り直したレコードが今も
 * この案件のものかの確認にもそのまま使う。
 *
 * ■ ログを残せなかったら消さない
 * 更新のときの監査ログ（recordAuditLogBestEffort）とは逆。あちらは
 * 「失敗しても続行」、こちらは「失敗したら中止」。
 *
 * ■ 消せなかったら警告だけ返す
 * お客様情報のキャンセルは成立している。ここで投げても戻せない。
 */
async function deleteConstructionRecordForCancel(input: {
  calAppId: string;
  constructionRecordId: string;
  matchedRecordCount: number;
  lookupKeys: Array<{ fieldId: string | null; value: string }>;
  tNumber: string;
  constructionFields: Awaited<ReturnType<typeof fetchAppFields>>;
  readAuth: AtPocketFetchAuth;
  writeAuth: AtPocketFetchAuth;
  lineUserId: string;
}): Promise<CustomerCancelSideEffectResult> {
  const notDeleted = (warning: string): CustomerCancelSideEffectResult => ({
    warnings: [warning],
    constructionUpdated: false,
    constructionDeleted: false,
  });

  // 複数一致なら消さないと決まっているので、@pocket を触らない
  let freshRecord: Record<string, unknown> | null = null;
  if (input.matchedRecordCount === 1) {
    try {
      const row = await fetchRecordById(
        input.calAppId,
        input.constructionRecordId,
        input.readAuth,
      );
      if (row?.record && typeof row.record === "object") {
        freshRecord = row.record as Record<string, unknown>;
      }
    } catch (e) {
      // 読めなかった＝中身が分からない。判定側が not_found で止める
      console.error(
        "[customer-cancel] 削除前の工事レコードの再取得に失敗しました",
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  const decision = decideCancelConstructionDeletion({
    enabled: true,
    constructionRecordId: input.constructionRecordId,
    matchedRecordCount: input.matchedRecordCount,
    freshRecord,
    keys: input.lookupKeys,
  });
  if (!decision.ok || !freshRecord) {
    const reason = decision.ok ? "not_found" : decision.reason;
    console.error(
      "[customer-cancel] 工事レコードを削除しません",
      JSON.stringify({
        reason,
        matchedRecords: input.matchedRecordCount,
      }),
    );
    return notDeleted(
      reason === "ambiguous"
        ? CONSTRUCTION_DELETE_AMBIGUOUS
        : CONSTRUCTION_DELETE_FAILED,
    );
  }

  // A-4: 全項目を記録できたときだけ消す。await して ok を見る
  let deletionLog: Awaited<ReturnType<typeof recordAuditLog>>;
  try {
    deletionLog = await recordAuditLog({
      lineUserId: input.lineUserId,
      operation: "delete",
      targetAppId: input.calAppId,
      targetRecordId: input.constructionRecordId,
      targetTNumber: input.tNumber,
      deletionContent: formatDeletionContent(freshRecord, {
        labelOf: (fieldId) =>
          fieldCaptionByUniqueId(input.constructionFields, fieldId),
      }),
    });
  } catch (e) {
    // recordAuditLog は投げない設計だが、投げたなら記録できていない
    deletionLog = {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
  if (!deletionLog.ok) {
    console.error(
      "[customer-cancel] 削除ログを残せないため工事レコードを削除しません",
      JSON.stringify({
        calAppId: input.calAppId,
        recordId: input.constructionRecordId,
        error: deletionLog.error,
      }),
    );
    return notDeleted(CONSTRUCTION_DELETE_LOG_FAILED);
  }

  try {
    await deleteRecord(
      input.calAppId,
      input.constructionRecordId,
      input.writeAuth,
    );
  } catch (e) {
    /**
     * 削除ログを書いた直後で、レコードが実在するのに削除ログだけある
     * 状態になっている。名指しで残す
     */
    console.error(
      "[customer-cancel] 工事レコードの削除に失敗しました（削除ログは記録済み）",
      JSON.stringify({
        calAppId: input.calAppId,
        recordId: input.constructionRecordId,
      }),
      e instanceof Error ? e.message : String(e),
    );
    return notDeleted(CONSTRUCTION_DELETE_FAILED);
  }

  invalidateCalendarConstructionRecordsCache();
  invalidateAllCalendarPayloadCache();

  return { warnings: [], constructionUpdated: false, constructionDeleted: true };
}
