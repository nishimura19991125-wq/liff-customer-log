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
 * ⚠ **現在この連携は既定で動かない。**
 *    施工予定日の割り当ては工事カレンダーからのみ行う方針に変わったため、
 *    お客様情報の保存からは呼ばないようにしている。
 *    処理そのものは第3段階（未定案件の抽出元の変更）で一部を再利用する
 *    見込みがあるので消さずに残してある。
 *    動かすときは customerInfoConstructionLinkOnSaveEnabled() を参照。
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
  /** 失敗。warning は画面へそのまま出してよい文言 */
  | {
      kind: "failed";
      reason: ConstructionLinkFailureReason;
      warning: string;
    };

/**
 * 失敗地点。**文言を地点ごとに分けるための区分**で、どの条件で失敗に
 * なるか（判定）は変えていない。
 *
 * 以前は全地点で同じ文言（「時間をおいて保存し直す」）を返していた。
 * 同じ T番号 の工事レコードが2件あるとき（lookup-ambiguous）は再試行しても
 * 永久に直らないのに再試行を促しており、実際に二重登録の事故が起きた。
 *
 *   fields-fetch-failed  列定義の取得が例外（一過性のことが多い）
 *   fields-unresolved    列を解決できない（設定の問題。再試行では直らない）
 *   lookup-failed        照合が例外（429・タイムアウトなど）
 *   lookup-ambiguous     同じ T番号 の工事レコードが複数ある
 *   write-failed         書き込みが例外。工事レコードは作っていない
 *   post-create-failed   **作成は成功した**あとの後処理が例外
 */
export type ConstructionLinkFailureReason =
  | "fields-fetch-failed"
  | "fields-unresolved"
  | "lookup-failed"
  | "lookup-ambiguous"
  | "write-failed"
  | "post-create-failed";

/**
 * お客様情報の保存から工事登録アプリへ連携するか。
 *
 * 既定は **false**。施工予定日の割り当ては工事カレンダーから行う方針で、
 * お客様情報側からの連携は要らなくなった。
 * コメントアウトではなくこの入口で止めているのは、処理を型チェックと
 * テストの対象に残したままにするため（動かないコードは腐る）。
 *
 * 方針が戻ったときは CUSTOMER_INFO_CONSTRUCTION_LINK_ON_SAVE=true を設定する。
 * そのときは保存前レコードから施工予定日・お客様名・住宅ステータス・
 * 工事対応者を読む必要がある（呼び出し側で同じ条件で分岐している）。
 */
export function customerInfoConstructionLinkOnSaveEnabled(): boolean {
  return (
    process.env.CUSTOMER_INFO_CONSTRUCTION_LINK_ON_SAVE?.trim() === "true"
  );
}

/**
 * 失敗地点ごとの文言。
 *
 * ⚠ fields-unresolved・lookup-ambiguous・post-create-failed には
 *    **再試行を促す言葉を入れない**（「時間をおいて」「もう一度」など）。
 *    再試行しても直らず、post-create-failed は二重登録になる。
 *    否定形（「繰り返さず」）でも再試行に触れる語は避けている。
 *
 * 書き出しを「お客様情報は保存しましたが」にしないのは、いま動いている
 * 呼び出し元が工事カレンダーの割り当てで、そこではお客様情報を
 * 保存していないため。
 */
export const CONSTRUCTION_LINK_FAILURE_MESSAGES: Record<
  ConstructionLinkFailureReason,
  string
> = {
  "fields-fetch-failed":
    "工事カレンダーの設定を読み込めず、反映できませんでした。時間をおいてもう一度お試しください。解消しない場合はDX事業部へ連絡してください。",
  "fields-unresolved":
    "工事カレンダーの項目設定に問題があり、反映できませんでした。DX事業部へ連絡してください。",
  "lookup-failed":
    "工事レコードの照合ができず、反映を中止しました。時間をおいてもう一度お試しください。",
  "lookup-ambiguous":
    "同じT番号の工事レコードが複数あるため、反映を中止しました。DX事業部へ連絡してください。",
  "write-failed":
    "工事レコードの書き込みに失敗しました。時間をおいてもう一度お試しください。解消しない場合はDX事業部へ連絡してください。",
  "post-create-failed":
    "工事レコードは作成されましたが、後続の処理に失敗しました。再度の登録はせず、DX事業部へ連絡してください。",
};

/**
 * 失敗地点から画面向けの文言を作る。
 *
 * 割り当て API（assign-customer-case）の事前照合も同じ文言を返すので
 * export している。文言を書き分けると、片方だけ再試行を促す表現が残る。
 */
export function describeConstructionLinkFailure(
  reason: ConstructionLinkFailureReason,
): { reason: ConstructionLinkFailureReason; warning: string } {
  return { reason, warning: CONSTRUCTION_LINK_FAILURE_MESSAGES[reason] };
}

export type FoundConstructionRecord =
  | { kind: "found"; recordId: string; record: Record<string, unknown> }
  | { kind: "not-found" }
  /**
   * 探せなかった。作成に進んではいけない。
   * reason は文言の出し分け用（照合の例外か、複数一致か）
   */
  | { kind: "error"; reason: "lookup-failed" | "lookup-ambiguous" };

/**
 * 工事登録アプリを T番号 の完全一致で1件だけ探す。
 *
 * 絞り込みのクエリだけを使い、全件走査へは落とさない。
 * ここで大量ページを舐めると、保存のたびに @pocket の上限を圧迫する。
 * 2件以上ヒットしたら特定しない（どちらが正か決められない）。
 *
 * 第3段階 3-2 の割り当て API（assign-customer-case）も、空き枠を使う前に
 * これを呼ぶ。既存の工事レコードがあるのに空き枠へ書くと、同じ T番号 の
 * 工事レコードが2件になり、以降この検索が「複数一致」で error を返して
 * その顧客が自動照合できなくなるため。判定を1本に保つので export している。
 */
export async function findConstructionRecordByTNumber(opts: {
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
    return { kind: "error", reason: "lookup-failed" };
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
    return { kind: "error", reason: "lookup-ambiguous" };
  }
  return { kind: "not-found" };
}

/**
 * 作成直後の再照合の待ち時間（ms）。
 *
 * @pocket は作成の応答にレコード ID を返さないので、書いた T番号 で
 * 引き直すしかない。一覧に載るまで一瞬かかることがあるため少しだけ待つ。
 * 作成のときにしか通らない経路なので、この呼び出し回数は許容する。
 */
const CREATE_LOOKUP_DELAYS_MS = [0, 400, 1200] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 作成したレコードを T番号 で引き直す。
 *
 * **作成の前に同じ検索で 0 件だったこと**が前提になっている。
 * その状態で1件見つかったなら、それは今作ったレコードに他ならない。
 * 掴み違えようがないので、アポ取得時入力のような作成前後の差分は要らない。
 *
 * 複数一致・例外のときは待っても解決しないので、その場で打ち切る。
 */
async function findCreatedConstructionRecord(opts: {
  calAppId: string;
  tNumberFieldId: string;
  tNumber: string;
  fieldsCsv: string;
}): Promise<FoundConstructionRecord> {
  for (const delay of CREATE_LOOKUP_DELAYS_MS) {
    if (delay > 0) await sleep(delay);
    const found = await findConstructionRecordByTNumber(opts);
    if (found.kind !== "not-found") return found;
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
    return {
      kind: "failed",
      ...describeConstructionLinkFailure("fields-fetch-failed"),
    };
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
    return {
      kind: "failed",
      ...describeConstructionLinkFailure("fields-unresolved"),
    };
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
    return { kind: "failed", ...describeConstructionLinkFailure(found.reason) };
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

  /**
   * 新規作成の書き込みが成功したか。
   * 成功したあとの例外は「作っていない」失敗と分けて伝える。同じ文言で
   * 再試行を促すと、同じ案件の工事レコードが二重にできる
   */
  let createdOnPocket = false;

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
    createdOnPocket = true;
    invalidateAllCalendarPayloadCache();

    let recordId = created
      ? (atPocketRecordIdFromCreateResult(created) ?? "")
      : "";

    /**
     * @pocket は作成の応答に ID を返さないことがある（実機で確認済み）。
     * 書き込んだ T番号 で引き直す。作成の前に同じ検索で 0 件だったので、
     * 1件見つかればそれが今作ったレコードになる
     */
    let createdRecord: Record<string, unknown> | null = null;
    if (!recordId) {
      const relocated = await findCreatedConstructionRecord({
        calAppId,
        tNumberFieldId,
        tNumber,
        fieldsCsv,
      });
      if (relocated.kind === "found") {
        recordId = relocated.recordId;
        createdRecord = relocated.record;
      }
    }

    let akiNumber = "";
    if (importKeyFieldId) {
      // 引き直した行に Aki番号 が載っていればそれを使う（GET を1回減らす）
      if (createdRecord) {
        akiNumber =
          readConstructionTNumberFromRecord(createdRecord, importKeyFieldId) ??
          "";
      }
      if (!akiNumber && recordId) {
        akiNumber =
          (await ensureConstructionImportKeyOnRecord(
            calAppId,
            recordId,
            importKeyFieldId,
            readAuth,
            fieldsCsv,
          )) ?? "";
      }
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
      /**
       * レコードは作られている。ID が取れないだけなので失敗にはしない。
       * Aki番号 の書き戻しだけ諦める。
       *
       * 次に施工予定日を変えて保存すると、作成前の照合が今回のレコードを
       * 拾って更新に回るので、二重には作られない
       */
      console.error(
        "[customer-info-construction-link] 作成した工事レコードの ID を特定できませんでした（Aki番号の書き戻しは行いません）",
        { calAppId },
      );
    }

    return { kind: "created", recordId, akiNumber };
  } catch (e) {
    if (createdOnPocket) {
      // レコードは出来ている。再登録されると二重になるので、ログにも残す
      console.error(
        "[customer-info-construction-link] 工事レコードは作成済みですが、後続の処理に失敗しました（再登録すると二重になります）",
        e instanceof Error ? e.message : String(e),
      );
      return {
        kind: "failed",
        ...describeConstructionLinkFailure("post-create-failed"),
      };
    }
    console.error(
      "[customer-info-construction-link] 工事レコードの書き込みに失敗しました",
      e instanceof Error ? e.message : String(e),
    );
    return {
      kind: "failed",
      ...describeConstructionLinkFailure("write-failed"),
    };
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
