import "server-only";

import {
  apiKeyForCalendarPocket1,
  apiKeyForCalendarWrite,
  fetchAppFields,
  fetchRecordsList,
} from "@/lib/atpocket";
import { escapePocketQueryValue } from "@/lib/atpocket-query-escape";
import { atPocketRecordIdFromCreateResult } from "@/lib/atpocket-record-id";
import { writePocketRecordWithImportKey } from "@/lib/atpocket-write-with-import-key";
import { recordAuditLog } from "@/lib/audit-log";
import { computeAuditChanges } from "@/lib/audit-log-changes";
import {
  ensureConstructionImportKeyOnRecord,
  readConstructionTNumberFromRecord,
  uniqueFieldsCsv,
} from "@/lib/calendar-construction-pocket-common";
import { invalidateAllCalendarPayloadCache } from "@/lib/calendar-response-cache";
import { optionalCalendarYmd } from "@/lib/calendar-optional-ymd";
import {
  resolveConfiguredFieldToSchemaUniqueId,
  resolveConstructionFieldIds,
  resolveConstructionImportKeyFieldId,
  resolveConstructionTNumberFieldId,
  resolveEmptyFillHousingStatusFieldId,
} from "@/lib/calendar-kojo";
import { fieldCaptionByUniqueId } from "@/lib/customer-info-record";

/**
 * お客様情報で施工予定日を入れたとき、工事登録アプリへレコードを載せる（第2段階）。
 *
 * 第1段階（b7f4169）で、施工予定日が未定の新規登録は工事登録アプリに
 * 作らないようにした。その案件の日程が決まったらここで工事側へ載せる。
 *
 * ■ 既存レコードの探し方
 * お客様情報の T番号 で工事登録アプリを検索する。第1段階で作られた
 * レコードには Aki番号 が無いため、Aki番号 では引けない。
 * T番号 はお客様情報側の自動採番で一意なので、完全一致で特定できる。
 *
 * ■ 見つからないときだけ作る
 * 検索が**失敗した**ときは作らない。「見つからなかった」と
 * 「探せなかった」を取り違えると、同じ案件の工事レコードが二重にできる。
 * 429 やタイムアウトのときは何もせず警告だけ返す。
 *
 * ■ 書き込む項目
 * 住宅ステータス・お客様名・施工予定日・施工会社・工事対応者の5つだけ。
 * ほかの列は @pocket の編集画面や別の連携が持ち主なので触らない。
 * 新規作成では取込キー（Aki番号）を空文字で載せ、T番号 を転記する。
 */

export type CustomerInfoConstructionLinkResult =
  /** 連携の対象外（設定不足・材料不足）。画面には出さない */
  | { kind: "skipped"; reason: string }
  | { kind: "created"; recordId: string; akiNumber: string }
  | { kind: "updated"; recordId: string }
  /** 失敗。お客様情報の保存は成功しているので警告として伝える */
  | { kind: "failed"; warning: string };

const LINK_FAILED_WARNING =
  "お客様情報は保存しましたが、工事カレンダーへの反映に失敗しました。時間をおいて施工予定日を保存し直すか、DX事業部へ連絡してください。";

type FoundConstructionRecord =
  | { kind: "found"; recordId: string; record: Record<string, unknown> }
  | { kind: "not-found" }
  /** 探せなかった。作成に進んではいけない */
  | { kind: "error" };

/**
 * 工事登録アプリを T番号 の完全一致で1件だけ探す。
 *
 * 絞り込みのクエリだけを使い、全件走査へは落とさない。
 * ここで大量ページを舐めると、保存のたびに @pocket の上限を圧迫する。
 * 2件以上ヒットしたら特定しない（どちらが正か決められない）。
 */
async function findConstructionRecordByTNumber(opts: {
  calAppId: string;
  tNumberFieldId: string;
  tNumber: string;
  fieldsCsv: string;
}): Promise<FoundConstructionRecord> {
  const want = opts.tNumber.trim();
  if (!want) return { kind: "not-found" };

  const query = `${opts.tNumberFieldId} = "${escapePocketQueryValue(want)}"`;

  let rows: Awaited<ReturnType<typeof fetchRecordsList>>["records"];
  try {
    const res = await fetchRecordsList(
      opts.calAppId,
      { limit: "50", page: "1", fields: opts.fieldsCsv, query },
      { apiKey: apiKeyForCalendarPocket1() },
      {
        operation: "customer-info:施工予定日入力時の工事レコード照合",
        appEnv: "CALENDAR_APP_ID",
      },
      { maxRetries: 0 },
    );
    rows = res.records ?? [];
  } catch (e) {
    // T番号 は個人情報ではないが、値そのものは残さない
    console.error(
      "[customer-info-construction-link] 工事レコードの照合に失敗しました",
      e instanceof Error ? e.message : String(e),
    );
    return { kind: "error" };
  }

  const matched: { recordId: string; record: Record<string, unknown> }[] = [];
  for (const row of rows) {
    const rec = row.record;
    if (!rec || typeof rec !== "object") continue;
    const recObj = rec as Record<string, unknown>;
    const cell = readConstructionTNumberFromRecord(recObj, opts.tNumberFieldId);
    if (!cell || cell.trim() !== want) continue;
    const id = row.recordId ?? row.id;
    const s = id == null ? "" : String(id).trim();
    if (s) matched.push({ recordId: s, record: recObj });
  }

  if (matched.length === 1) {
    return { kind: "found", ...matched[0]! };
  }
  if (matched.length > 1) {
    // 同じ T番号 の工事レコードが複数ある。掴み違えると実データを壊す
    console.error(
      "[customer-info-construction-link] 同じ T番号 の工事レコードが複数あるため特定しません",
      { count: matched.length },
    );
    return { kind: "error" };
  }
  return { kind: "not-found" };
}

export async function linkCustomerInfoToConstruction(opts: {
  /** お客様情報の T番号（工事レコードの突合キー） */
  tNumber: string;
  customerName: string;
  housingStatus: string;
  /** 施工予定日 YYYY-MM-DD */
  constructionDate: string;
  contractor: string;
  /** 工事対応者。お客様情報側の値をそのまま転記する */
  constructionHandler: string;
  lineUserId?: string;
}): Promise<CustomerInfoConstructionLinkResult> {
  const calAppId = process.env.CALENDAR_APP_ID?.trim();
  if (!calAppId) return { kind: "skipped", reason: "CALENDAR_APP_ID 未設定" };

  const tNumber = opts.tNumber.trim();
  if (!tNumber) {
    // T番号 が無いと工事レコードを突き合わせられない
    return { kind: "skipped", reason: "T番号なし" };
  }

  const startYmd = optionalCalendarYmd(opts.constructionDate);
  if (!startYmd) return { kind: "skipped", reason: "施工予定日が不正" };

  const readAuth = { apiKey: apiKeyForCalendarPocket1() };
  const writeAuth = { apiKey: apiKeyForCalendarWrite() };

  let constructionFields: Awaited<ReturnType<typeof fetchAppFields>>;
  try {
    constructionFields = await fetchAppFields(calAppId, readAuth, {
      operation: "customer-info:施工予定日入力時の工事列定義",
      appEnv: "CALENDAR_APP_ID",
    });
  } catch (e) {
    console.error(
      "[customer-info-construction-link] 工事アプリの列定義を取得できません",
      e instanceof Error ? e.message : String(e),
    );
    return { kind: "failed", warning: LINK_FAILED_WARNING };
  }

  const fids = resolveConstructionFieldIds(constructionFields);
  const tNumberFieldId = resolveConstructionTNumberFieldId(constructionFields);
  const importKeyFieldId =
    resolveConstructionImportKeyFieldId(constructionFields);
  const housingFieldId =
    resolveEmptyFillHousingStatusFieldId(constructionFields);
  const customerFieldEnv =
    process.env.CALENDAR_EMPTY_FILL_CUSTOMER_NAME_FIELD_ID?.trim() ||
    process.env.CALENDAR_EMPTY_FILL_TITLE_FIELD_ID?.trim() ||
    "";
  const customerFieldId = customerFieldEnv
    ? resolveConfiguredFieldToSchemaUniqueId(
        customerFieldEnv,
        constructionFields,
      )
    : fids.title?.trim() || null;
  const startDateFieldId = fids.startDate?.trim() || null;
  const contractorFieldId = fids.contractor?.trim() || null;
  const handlerFieldId = fids.constructionHandler?.trim() || null;

  if (!tNumberFieldId || !customerFieldId || !startDateFieldId) {
    console.error(
      "[customer-info-construction-link] 工事アプリの列を解決できません",
      {
        hasTNumber: Boolean(tNumberFieldId),
        hasCustomerName: Boolean(customerFieldId),
        hasStartDate: Boolean(startDateFieldId),
      },
    );
    return { kind: "failed", warning: LINK_FAILED_WARNING };
  }

  const fieldsCsv = uniqueFieldsCsv(
    tNumberFieldId,
    importKeyFieldId ?? undefined,
    customerFieldId,
    housingFieldId ?? undefined,
    startDateFieldId,
    contractorFieldId ?? undefined,
    handlerFieldId ?? undefined,
  );

  const found = await findConstructionRecordByTNumber({
    calAppId,
    tNumberFieldId,
    tNumber,
    fieldsCsv,
  });
  if (found.kind === "error") {
    // 探せなかった。作りにいくと二重になるので何もしない
    return { kind: "failed", warning: LINK_FAILED_WARNING };
  }

  /**
   * 書き込むのは5項目だけ。ほかの列はここが持ち主ではない。
   * 値が空のものは載せない（既に入っている値を消さないため）。
   *
   * 工事対応者は工事アプリ側が単一選択、お客様情報側がテキストで、
   * 値そのものはスタッフ名で揃っている（update-construction-handler が
   * 両アプリへ同じ名前を書いている）。そのまま転記してよい
   */
  const customerName = opts.customerName.trim();
  const housing = opts.housingStatus.trim();
  const contractor = opts.contractor.trim();
  const handler = opts.constructionHandler.trim();
  const patch: Record<string, unknown> = { [startDateFieldId]: startYmd };
  if (customerName) patch[customerFieldId] = customerName;
  if (housing && housingFieldId) patch[housingFieldId] = housing;
  if (contractor && contractorFieldId) patch[contractorFieldId] = contractor;
  if (handler && handlerFieldId) patch[handlerFieldId] = handler;

  try {
    if (found.kind === "found") {
      const existingAki = importKeyFieldId
        ? readConstructionTNumberFromRecord(found.record, importKeyFieldId)
        : null;
      if (importKeyFieldId && existingAki) {
        patch[importKeyFieldId] = existingAki;
      }

      await writePocketRecordWithImportKey({
        appId: calAppId,
        recordId: found.recordId,
        payload: patch,
        importKeyFieldId: importKeyFieldId ?? undefined,
        existingRecord: found.record,
        readAuth,
        writeAuth,
        allowMissingImportKey: true,
      });
      invalidateAllCalendarPayloadCache();

      await recordConstructionAuditLog({
        operation: "update",
        lineUserId: opts.lineUserId ?? "",
        calAppId,
        recordId: found.recordId,
        tNumber,
        before: found.record,
        payload: patch,
        constructionFields,
      });

      return { kind: "updated", recordId: found.recordId };
    }

    /**
     * 新規作成。取込キー（Aki番号）は空文字で載せる（@pocket が採番する）。
     * T番号 はテキスト列なので、お客様情報側の値を転記する
     */
    patch[tNumberFieldId] = tNumber;
    if (importKeyFieldId) patch[importKeyFieldId] = "";

    const created = await writePocketRecordWithImportKey({
      appId: calAppId,
      payload: patch,
      importKeyFieldId: importKeyFieldId ?? undefined,
      writeAuth,
    });
    invalidateAllCalendarPayloadCache();

    const recordId = created
      ? (atPocketRecordIdFromCreateResult(created) ?? "")
      : "";

    let akiNumber = "";
    if (recordId && importKeyFieldId) {
      akiNumber =
        (await ensureConstructionImportKeyOnRecord(
          calAppId,
          recordId,
          importKeyFieldId,
          readAuth,
          fieldsCsv,
        )) ?? "";
    }

    if (recordId) {
      await recordConstructionAuditLog({
        operation: "create",
        lineUserId: opts.lineUserId ?? "",
        calAppId,
        recordId,
        tNumber,
        before: null,
        payload: patch,
        constructionFields,
      });
    } else {
      // レコードは作られている。ID が取れないだけなので失敗にはしない
      console.error(
        "[customer-info-construction-link] 作成した工事レコードの ID を取得できませんでした",
        { calAppId },
      );
    }

    return { kind: "created", recordId, akiNumber };
  } catch (e) {
    console.error(
      "[customer-info-construction-link] 工事レコードの書き込みに失敗しました",
      e instanceof Error ? e.message : String(e),
    );
    return { kind: "failed", warning: LINK_FAILED_WARNING };
  }
}

/** ベストエフォート。記録に失敗しても連携は成功として扱う */
async function recordConstructionAuditLog(input: {
  operation: "create" | "update";
  lineUserId: string;
  calAppId: string;
  recordId: string;
  tNumber: string;
  before: Record<string, unknown> | null;
  payload: Record<string, unknown>;
  constructionFields: Awaited<ReturnType<typeof fetchAppFields>>;
}): Promise<void> {
  try {
    await recordAuditLog({
      lineUserId: input.lineUserId,
      operation: input.operation,
      targetAppId: input.calAppId,
      targetRecordId: input.recordId,
      targetTNumber: input.tNumber,
      changes: computeAuditChanges(input.before, input.payload, {
        labelOf: (fieldId) =>
          fieldCaptionByUniqueId(input.constructionFields, fieldId),
      }),
    });
  } catch (e) {
    console.warn(
      "[customer-info-construction-link] 監査ログの記録に失敗",
      e instanceof Error ? e.message : String(e),
    );
  }
}
