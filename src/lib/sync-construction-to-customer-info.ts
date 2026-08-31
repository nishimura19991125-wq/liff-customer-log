import "server-only";

import {
  atPocketRecordIdFromCreateResult,
  pollConstructionTNumberByRecordId,
  SYNC_TNUMBER_POLL_DELAYS_MS,
} from "@/lib/atpocket-record-id";
import {
  pickCreatedRecordId,
  snapshotRecordIdsByFieldValue,
} from "@/lib/atpocket-created-record-lookup";
import type { AtPocketFieldRow, AtPocketFetchAuth } from "@/lib/atpocket";
import {
  apiKeyForCustomerInfoWrite,
  createRecord,
  fetchAppFields,
  fetchRecordById,
  updateRecord,
} from "@/lib/atpocket";
import { writePocketRecordWithImportKey } from "@/lib/atpocket-write-with-import-key";
import { auditLogEnabled, recordAuditLog } from "@/lib/audit-log";
import { computeAuditChanges } from "@/lib/audit-log-changes";
import {
  DROPBOX_FOLDER_WARNING,
  ensureCustomerFolderLink,
  resolveCustomerInfoDropboxLinkFieldId,
} from "@/lib/customer-info-dropbox-link";
import { dropboxConfigured } from "@/lib/dropbox";
import { safeHttpsUrl } from "@/lib/safe-external-url";
import type { ServerTimingLog } from "@/lib/server-timing-log";
import { startServerTimingLog } from "@/lib/server-timing-log";
import {
  pickRecordValueByFieldAliases,
  pocketFieldUniqueIdByCaption,
  resolveConfiguredFieldToSchemaUniqueId,
  resolveConstructionFieldIds,
  resolveConstructionImportKeyFieldId,
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
      /**
       * お客様情報アプリが採番した T番号。
       * 呼び出し側はこれを工事アプリへ書き戻す（採番元が入れ替わったため）。
       * 読めなかったときは undefined
       */
      tNumber?: string;
      /** Dropbox フォルダを用意できなかったときの画面向け警告（E-5） */
      dropboxWarning?: string;
      /**
       * まだ書き終えていない監査ログ。**呼び出し側は必ず await すること。**
       *
       * 監査ログの書き込み（実測 1.2 秒）と、呼び出し側が続けてやる
       * T番号 の書き戻し（実測 0.28 秒）は、別のアプリの別のレコードを
       * 触るだけで順序に意味が無い。直列に待つ理由が無いので、走らせた
       * まま返して呼び出し側で合流させる。
       *
       * ⚠ recordCustomerInfoSyncAuditLog は中で catch していて reject
       *    しないが、**await を省いてよいという意味ではない**。返す前に
       *    待たないと、実行環境が凍結して記録が落ちる。
       */
      pendingAudit?: Promise<void>;
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
 * 工事アプリへ書き込み済みのレコードを GET し、お客様情報アプリに登録する。
 * 同一キーが既にあれば更新（PUT）、なければ新規（POST）。
 * CUSTOMER_INFO_APP_ID 未設定時は何もしない（skipped）。
 *
 * ■ 突合キーは Aki番号
 * 以前は T番号 で突き合わせていたが、T番号 を採番するのが
 * **お客様情報アプリ側**に変わったため、作成する時点では T番号 が存在しない。
 * 工事アプリが採番する Aki番号 を突合キーにする。
 * 既存レコードには Aki番号 が入っていないので、T番号 でも探す（後方互換）。
 *
 * ■ T番号 は書かない・読んで返す
 * お客様情報側で自動採番される列なので、値を送るのは不正。
 * 書き込みのあとに読み取り、戻り値で返す。呼び出し側がそれを工事アプリへ
 * 書き戻すことで、両アプリの T番号 がそろう。
 *
 * ■ 工事レコードが無い場合（customerInfoOnly）
 * 施工予定日が未定の案件は工事アプリに作らない。工事レコードを読む処理を
 * すべて飛ばし、お客様情報にだけ作る。突合キーが無いので必ず新規作成になる。
 */
export async function syncConstructionRecordToCustomerInfoApp(opts: {
  calAppId: string;
  /** 工事レコード ID（空枠更新時は必須。新規で取れないときはキーと併用） */
  constructionRecordId?: string;
  /** 工事 T番号（既存レコードの後方互換の突合に使う） */
  constructionUniqueKey?: string;
  /** 工事アプリの取込キー（Aki番号）。突合の主キー */
  constructionImportKey?: string;
  customerName: string;
  /** LIFF で選択した住宅ステータス（工事レコード再取得より優先） */
  housingStatus?: string;
  /**
   * 工事アプリを使わず、お客様情報にだけ作る。
   *
   * 施工予定日が未定の案件で使う。**必ず新規作成になる**ので、
   * 「工事レコードを特定できなかった」ときのフォールバックとして
   * 自動的にこの経路へ落とさないこと（顧客が二重にできる）。
   * 呼び出し側が意図して立てる指定にしている
   */
  customerInfoOnly?: boolean;
  /** customerInfoOnly のときの施工会社。工事レコードから読めないため */
  contractor?: string;
  constructionFields?: AtPocketFieldRow[];
  calendarAuth?: AtPocketFetchAuth;
  /** LIFF ログイン者の LINE ID（sub）。AP/CL担当者の自動転記に使用 */
  lineUserId?: string;
  /**
   * 段階ごとの所要時間を積む先（任意）。
   * 呼び出し側が1行にまとめたいときに渡す。渡されなければ自前で作る
   * （CALENDAR_TIMING_LOG が無効なら何もしない no-op）
   */
  timing?: ServerTimingLog;
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
 * お客様情報アプリに同じキーのレコードが既にあるか。
 *
 * キャッシュが null を返したときは、キャッシュを外して1回だけ引き直す（修正2）。
 * 「見つからない」を取り違えると createRecord まで進んでしまい、同じ顧客の
 * レコードが二重にできる。読み取り1回で防げるなら安いほうを選ぶ。
 */
/**
 * キャッシュ越しに1回だけ引く。**空振りしてもここでは引き直さない。**
 *
 * 引き直しは findExistingCustomerInfoRecord が、探すキーを全部使い切って
 * から行う（下の説明を参照）。
 */
async function lookupCustomerInfoRecordIdCached(
  keyFieldSchemaId: string,
  uniqueKey: string,
): Promise<string | null> {
  return findCustomerInfoRecordIdByUniqueKeyCached(
    keyFieldSchemaId,
    uniqueKey,
  );
}

/**
 * 既存レコードを Aki番号 → T番号 の順に探す。
 *
 * 突合キーが T番号 から Aki番号 へ移ったが、**それ以前に作られた
 * お客様情報レコードには Aki番号 が入っていない**（新設のテキスト列で、
 * これまで誰も書き込んでいない）。Aki番号 だけで探すと既存顧客が
 * 「見つからない」と判定され、同じ顧客のレコードが二重にできる。
 *
 * そこで見つからなければ T番号 でも探す。見つけたレコードには
 * Aki番号 を書き込むので、一度連携すればその顧客は Aki番号 で引けるようになる。
 * 探す軸を増やすだけなので、取りこぼしは減っても増えない。
 *
 * ── キャッシュ由来の null を信じない防御を、どこに置くか ──────────
 * 「見つからない」の取り違えは新規レコードを増やし、取り返しがつかない。
 * だからキャッシュが null を返したら、キャッシュ無しで引き直す。この防御は
 * 外せない。**外せないのは置き場所ではなく、返す前に引き直すこと。**
 *
 * 以前は Aki番号 が空振りした時点で引き直していた。だが二重作成が起きるのは
 * **Aki番号 も T番号 も両方外れて新規作成へ進むとき**だけで、Aki が外れても
 * T番号 で見つかるなら null を信じたことによる害は起きない。移行前の顧客は
 * Aki番号 を持たないので、この空振り＋引き直しが毎回1往復ぶん乗っていた
 * （実測 lookup-aki 961ms ≒ 480ms × 2回）。
 *
 * そこで順序を変える。
 *   1. Aki番号（キャッシュ越し）
 *   2. T番号（キャッシュ越し）
 *   3. どちらも外れたときだけ、両方をキャッシュ無しで引き直す
 * null を返す直前には必ず全キーを引き直しているので、防御は同じ強さのまま
 * 「T番号 で当たる」経路から1往復が消える。
 *
 * ⚠ matchedBy の優先順位は変わる（Aki のキャッシュが古い null を持ち、
 *    かつ Aki と T番号 が**別のレコード**を指す場合のみ）。呼び出し側は
 *    recordId しか見ておらず、そもそも別レコードを指すのはデータ側の
 *    不整合なので、実害は無いと判断した。
 */
async function findExistingCustomerInfoRecord(opts: {
  akiFieldId: string | null;
  akiValue: string;
  tNumberFieldId: string | null;
  tNumberValue: string;
  timing: ServerTimingLog;
}): Promise<{ recordId: string; matchedBy: "aki" | "tNumber" } | null> {
  const hasAki = Boolean(opts.akiFieldId && opts.akiValue);
  const hasT = Boolean(opts.tNumberFieldId && opts.tNumberValue);

  // 1) Aki番号（キャッシュ越しに1回だけ）
  if (hasAki) {
    const byAki = await lookupCustomerInfoRecordIdCached(
      opts.akiFieldId as string,
      opts.akiValue,
    );
    opts.timing.mark("lookup-aki");
    if (byAki) return { recordId: byAki, matchedBy: "aki" };
  }

  // 2) T番号（キャッシュ越しに1回だけ）
  if (hasT) {
    const byT = await lookupCustomerInfoRecordIdCached(
      opts.tNumberFieldId as string,
      opts.tNumberValue,
    );
    opts.timing.mark("lookup-tnumber");
    if (byT) return { recordId: byT, matchedBy: "tNumber" };
  }

  /**
   * 3) ここまで来た＝新規作成へ進む。**返す前に必ず引き直す。**
   * キャッシュ由来の null を信じて createRecord すると顧客が二重になる。
   */
  if (hasAki) {
    const byAki = await refetchCustomerInfoRecordIdByUniqueKey(
      opts.akiFieldId as string,
      opts.akiValue,
    );
    opts.timing.mark("refetch-aki");
    if (byAki) return { recordId: byAki, matchedBy: "aki" };
  }
  if (hasT) {
    const byT = await refetchCustomerInfoRecordIdByUniqueKey(
      opts.tNumberFieldId as string,
      opts.tNumberValue,
    );
    opts.timing.mark("refetch-tnumber");
    if (byT) return { recordId: byT, matchedBy: "tNumber" };
  }
  return null;
}

/**
 * お客様情報アプリの T番号 を読む。
 *
 * 採番元がこちらへ移ったので、書き込んだあとに読み取って
 * 工事アプリへ返すのが連携の要になる。読めなければ空文字。
 */
/** 採番待ちの間隔。@pocket の反映を待つ用途にしか使わない */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readCustomerInfoExistingValues(
  customerAppId: string,
  recordId: string,
  tNumberFieldId: string,
  dropboxLinkFieldId: string | null,
  customerAuth: AtPocketFetchAuth,
  /**
   * T番号 が空だったときに待ち直す間隔。
   *
   * **作成直後だけ渡す。** お客様情報アプリの自動採番は反映に一瞬かかり、
   * 作成応答の直後に読むと空で返ることがある。ここが空のままだと、
   * 新規案件通知も工事アプリへの T番号 書き戻しも丸ごと落ちる。
   * 既存レコードを読むときは既に採番済みなので渡さない（空振りの往復になる）。
   */
  pollDelaysMs: readonly number[] = [0],
): Promise<{ tNumber: string; dropboxLink: string }> {
  const empty = { tNumber: "", dropboxLink: "" };
  const fieldsCsv = [tNumberFieldId, dropboxLinkFieldId]
    .map((id) => id?.trim())
    .filter((id): id is string => Boolean(id))
    .join(",");

  // T番号 が取れた時点で抜ける。取れなければ最後の結果を返す
  let last = empty;
  for (const [attempt, delay] of pollDelaysMs.entries()) {
    if (delay > 0) await sleep(delay);
    try {
      let row = await fetchRecordById(
        customerAppId,
        recordId,
        customerAuth,
        fieldsCsv,
      );
      if (!row?.record) {
        row = await fetchRecordById(customerAppId, recordId, customerAuth);
      }
      if (!row?.record || typeof row.record !== "object") continue;
      const recObj = row.record as Record<string, unknown>;
      last = {
        tNumber: coercePocketPlainString(
          pickRecordValueByFieldAliases(recObj, tNumberFieldId),
        ),
        dropboxLink: dropboxLinkFieldId
          ? coercePocketPlainString(
              pickRecordValueByFieldAliases(recObj, dropboxLinkFieldId),
            )
          : "",
      };
      if (last.tNumber) {
        if (attempt > 0) {
          // 何回目で出たかが分かると、待ち時間が足りているか判断できる
          console.info(
            "[sync-construction-to-customer-info] T番号 の採番を待って取得しました",
            JSON.stringify({ attempt: attempt + 1, recordId }),
          );
        }
        return last;
      }
    } catch (e) {
      console.warn(
        "[sync-construction-to-customer-info] T番号・Dropboxリンクの読み取りに失敗",
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  if (!last.tNumber && pollDelaysMs.length > 1) {
    // 待っても出なかった。通知も書き戻しもここで落ちる
    console.error(
      "[sync-construction-to-customer-info] T番号 を採番待ちしても読めませんでした",
      JSON.stringify({ recordId, attempts: pollDelaysMs.length }),
    );
  }
  return last;
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
  /**
   * 比較する列だけを取る。computeAuditChanges は payload のキーしか見ないので、
   * 全項目を運ぶ必要が無い（回数は同じだが転送量が減る）。
   * 空を渡したときと、この CSV で読めなかったときは全項目に落とす
   */
  fieldIds?: readonly string[],
): Promise<Record<string, unknown> | null> {
  if (!auditLogEnabled()) return null;
  const csv = (fieldIds ?? [])
    .map((id) => id?.trim())
    .filter((id): id is string => Boolean(id))
    .join(",");
  try {
    let row = csv
      ? await fetchRecordById(customerAppId, recordId, customerAuth, csv)
      : null;
    if (!row?.record) {
      // CSV が拒否された・読めなかったときは全項目で取り直す。
      // ここで null のまま進むと「全項目が新規入力」として記録される
      row = await fetchRecordById(customerAppId, recordId, customerAuth);
    }
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
  /** 工事アプリの取込キー（Aki番号）。お客様情報の突合に使う */
  constructionImportKey?: string;
  customerName: string;
  housingStatus?: string;
  customerInfoOnly?: boolean;
  contractor?: string;
  constructionFields?: AtPocketFieldRow[];
  calendarAuth?: AtPocketFetchAuth;
  lineUserId?: string;
  timing?: ServerTimingLog;
}): Promise<CustomerInfoSyncResult> {
  const timing =
    opts.timing ?? startServerTimingLog("sync-construction-to-customer-info");
  const customerAppId = process.env.CUSTOMER_INFO_APP_ID?.trim();
  if (!customerAppId) {
    return { kind: "skipped" };
  }

  const customerInfoOnly = opts.customerInfoOnly === true;
  const constructionFields: AtPocketFieldRow[] = opts.constructionFields ?? [];
  /** 工事アプリを読む経路でだけ使う。customerInfoOnly では触らない */
  const calendarAuth: AtPocketFetchAuth = opts.calendarAuth ?? { apiKey: "" };
  const constructionRecordId = customerInfoOnly
    ? ""
    : opts.constructionRecordId?.trim() || "";
  const keyFromOpts = customerInfoOnly
    ? ""
    : opts.constructionUniqueKey?.trim() || "";
  const akiFromOpts = customerInfoOnly
    ? ""
    : opts.constructionImportKey?.trim() || "";
  if (
    !customerInfoOnly &&
    !constructionRecordId &&
    !keyFromOpts &&
    !akiFromOpts
  ) {
    return {
      kind: "failed",
      error:
        "工事レコードを特定できませんでした。お客様情報アプリへの連携に必要な Aki番号・T番号・レコード ID のいずれも取得できません。",
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
    constructionFields,
  );
  // customerInfoOnly では工事アプリを一切読まないので、この列は要らない
  if (!constructionKeyField && !customerInfoOnly) {
    return {
      kind: "failed",
      error:
        "工事アプリから T番号 のフィールドを特定できません。CALENDAR_EMPTY_FILL_TNUMBER_FIELD_ID または CALENDAR_CONSTRUCTION_UNIQUE_KEY_FIELD_ID を設定してください。",
    };
  }
  /** 工事アプリの取込キー（Aki番号）。突合の主キー */
  const constructionAkiField = resolveConstructionImportKeyFieldId(
    constructionFields,
  );

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
    resolveConstructionRegistrationNumberFieldIds(constructionFields);
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

  /**
   * お客様情報アプリの Aki番号 列（テキスト）。
   * 未設定・未解決でも連携は続ける（T番号 での突合に落ちるだけ）
   */
  const customerAkiFieldId = (() => {
    const fromEnv = process.env.CUSTOMER_INFO_AKI_NUMBER_FIELD_ID?.trim();
    if (fromEnv) {
      return resolveConfiguredFieldToSchemaUniqueId(fromEnv, customerFields);
    }
    for (const caption of ["Aki番号", "アキ番号", "AKI番号"]) {
      const id = pocketFieldUniqueIdByCaption(customerFields, caption);
      if (id) return id;
    }
    return null;
  })();

  const constructionFids = resolveConstructionFieldIds(constructionFields);
  const constructionHousingFieldId =
    resolveEmptyFillHousingStatusFieldId(constructionFields);
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
  /** 工事アプリに入っている T番号（既存レコードのみ。新規では空） */
  let uniqueKey = keyFromOpts;
  /** 工事アプリの取込キー（Aki番号） */
  let akiKey = akiFromOpts;

  if (constructionRecordId) {
    let recRow = await fetchRecordById(
      opts.calAppId,
      constructionRecordId,
      calendarAuth,
      fieldsCsv,
    );
    if (!recRow?.record) {
      recRow = await fetchRecordById(
        opts.calAppId,
        constructionRecordId,
        calendarAuth,
      );
    }

    if (!recRow?.record || typeof recRow.record !== "object") {
      return {
        kind: "failed",
        error: "工事アプリのレコードを再取得できませんでした。",
      };
    }

    recObj = recRow.record as Record<string, unknown>;
    if (!uniqueKey && constructionKeyField) {
      uniqueKey = coercePocketPlainString(
        pickRecordValueByFieldAliases(recObj, constructionKeyField),
      );
    }
    if (!akiKey && constructionAkiField) {
      akiKey = coercePocketPlainString(
        pickRecordValueByFieldAliases(recObj, constructionAkiField),
      );
    }
    timing.mark("construction-get");
  }

  /**
   * Aki番号 は工事アプリの自動採番。作成直後は反映に一瞬かかることがあるので、
   * 以前 T番号 でやっていたのと同じ短いポーリングで待つ。
   *
   * ただし T番号 が既に入っているレコードは移行前からある案件で、
   * Aki番号 が付いていないことがある。待っても出てこないので待たない
   * （毎回1秒以上の空振りになる）。その場合は T番号 で突合する
   */
  if (!akiKey && !uniqueKey && constructionAkiField && constructionRecordId) {
    const polled = await pollConstructionTNumberByRecordId(
      opts.calAppId,
      constructionRecordId,
      constructionAkiField,
      calendarAuth,
      fieldsCsv,
      SYNC_TNUMBER_POLL_DELAYS_MS,
    );
    if (polled) akiKey = polled;
  }

  /**
   * customerInfoOnly は突合キーを持たない（工事レコードが無いため）。
   * 常に新規作成になる。ここで失敗にしない
   */
  if (!customerInfoOnly && !akiKey && !uniqueKey) {
    return {
      kind: "failed",
      error:
        "工事レコードから突合キー（Aki番号）を取得できませんでした。@pocket で採番・反映されているか確認してください。",
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
  /**
   * customerInfoOnly は Aki番号 も T番号 も持たないので照合できない。
   * 引くキーが無いまま探すと、条件なしで最初の1件を掴みかねないので引かない
   */
  const existing = customerInfoOnly
    ? null
    : await findExistingCustomerInfoRecord({
        akiFieldId: customerAkiFieldId,
        akiValue: akiKey,
        tNumberFieldId: resolvedCustomerKey,
        tNumberValue: uniqueKey,
        timing,
      });
  const existingId = existing?.recordId ?? null;

  const customerRecord: Record<string, unknown> = {};

  /**
   * 取込キー（T番号）の列を、**新規作成のときだけ空文字で載せる**。
   *
   * @pocket の作成APIは、取込キーの列がレコード本文に無いと
   * 「キー項目「T番号」が取込設定に存在しないため登録できません」で 400 を返す。
   * 値は空でよく、空ならこのアプリ側で自動採番される。
   * 他の新規作成も同じことをしている:
   *   - buildEmptySlotPayload（キャンセル時の空き枠）… 取込キー列に "" を入れる
   *   - applyApoAutoNumberOnCreate（アポ取得）… 同上
   *   - buildConstructionFillPatch（工事登録）… 同上
   *
   * 更新のときは載せない。空文字を送ると既に採番されている T番号 を消しかねない。
   * 更新に取込キーが要る経路（作成直後の Dropboxリンク PUT・
   * /customer-info の保存）では、読み取った実際の値を載せている。
   *
   * ⚠「値を送らない」と「列を載せない」は別物。列ごと外すと 400 になる。
   */
  if (!existingId) {
    customerRecord[resolvedCustomerKey] = "";
  }

  // 突合キーは Aki番号。工事アプリが採番した値をここへ書く
  if (customerAkiFieldId && akiKey) {
    customerRecord[customerAkiFieldId] = akiKey;
  }
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

  /**
   * 施工会社。工事レコードがあればそこから、無ければ画面の入力から。
   * 施工予定日は customerInfoOnly では未定なので載せない
   */
  if (!recObj && customerContractorFieldId) {
    const contractor = (opts.contractor ?? "").trim();
    if (contractor) {
      customerRecord[customerContractorFieldId] = contractor;
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

  /**
   * E-2/E-3: Dropbox 顧客フォルダを用意し、共有リンクを payload に載せる。
   *
   * フォルダ名に T番号 が要る。既存レコードならこの時点で分かっているが、
   * **新規作成では作られるまで分からない**（お客様情報側の自動採番のため）。
   * そこで作成後にもう一度呼べるよう切り出してある。失敗しても連携は止めない。
   */
  let dropboxWarning: string | undefined;
  /** 既存リンクがあって Dropbox を叩かなかったか（ログ用） */
  let dropboxSkipped = false;
  const dropboxLinkFieldId =
    resolveCustomerInfoDropboxLinkFieldId(customerFields);
  const applyDropboxLink = async (
    target: Record<string, unknown>,
    tNumber: string,
  ): Promise<void> => {
    if (!dropboxConfigured() || !tNumber) return;
    const linkFieldId = dropboxLinkFieldId;
    const folder = await ensureCustomerFolderLink({
      tNumber,
      customerName: opts.customerName,
      scope: "sync-construction-to-customer-info",
    });
    if (folder.url && linkFieldId) {
      target[linkFieldId] = folder.url;
    } else if (folder.url && !linkFieldId) {
      // フォルダは作れたがリンクの保存先が分からない。
      // フォルダ作成は冪等なので、列を直せば次回の保存で書き込まれる。
      console.error(
        "[sync-construction-to-customer-info] 「Dropboxリンク」列を解決できません。CUSTOMER_INFO_DROPBOX_LINK_FIELD_ID か列見出しを確認してください",
      );
      dropboxWarning = DROPBOX_FOLDER_WARNING;
    }
    dropboxWarning = dropboxWarning ?? folder.warning ?? undefined;
  };

  /**
   * お客様情報側の T番号。既存レコードなら先に読める。
   * 新規作成のときは空で、作成後に読み直す
   */
  let customerTNumber = "";
  if (existingId) {
    /**
     * T番号 と Dropboxリンク を**1回の GET でまとめて読む**。
     * リンクの有無で Dropbox を叩くかが決まるので、追加の往復は要らない
     */
    const existingValues = await readCustomerInfoExistingValues(
      customerAppId,
      existingId,
      resolvedCustomerKey,
      dropboxLinkFieldId,
      customerAuth,
    );
    timing.mark("customer-values-get");
    customerTNumber = existingValues.tNumber;
    // 工事アプリ側にしか無い旧データでも、フォルダ名は作れるようにする
    if (!customerTNumber) customerTNumber = uniqueKey;

    /**
     * ■ 既にリンクが入っていれば Dropbox を叩かない
     *
     * ensureCustomerFolderLink は毎回 3往復する
     * （create_folder_v2 → create_shared_link_with_settings →
     *   list_shared_links。既存フォルダでは前2つが必ず衝突エラーになる）。
     * フォルダ名は T番号＋お客様名で決まり、更新のたびに変わるものではない。
     * リンクが既にあるなら作り直す理由が無い。
     *
     * 判定は safeHttpsUrl。空文字・"-"・https でない値は「未設定」として
     * 従来どおり作りにいく（壊れた値でフォルダ作成が永久に止まらないように）。
     * お客様名の変更に追随するリネームは renameCustomerFolderLink が別に持つ。
     */
    if (safeHttpsUrl(existingValues.dropboxLink)) {
      dropboxSkipped = true;
    } else {
      await applyDropboxLink(customerRecord, customerTNumber);
    }
    timing.mark("dropbox");

    /**
     * 取込キー（T番号）の列を**更新の payload にも載せる**。
     *
     * @pocket は「キー項目「T番号」が取込設定に存在しないため登録できません」で
     * 400 を返す。これは作成だけでなく更新でも同じで、5c50070 で作成側に
     * 空文字を載せたときに更新側が漏れていた。
     *
     * ⚠ 更新で空文字を送ってはならない。採番済みの T番号 を消しかねない。
     *    ここで載せるのは**読み取った実際の値**だけにする。
     *    値が読めなかったときは載せず、下の writePocketRecordWithImportKey が
     *    レコードから引き直す（それも駄目なら @pocket の 400 がそのまま出る）。
     */
    if (customerTNumber) {
      customerRecord[resolvedCustomerKey] = customerTNumber;
    }
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
      timing.mark("input-status-get");
    }

    const before = await readCustomerInfoRecordForAudit(
      customerAppId,
      existingId,
      customerAuth,
      Object.keys(pocketPayload),
    );
    timing.mark("audit-before-get");
    /**
     * 更新も取込キー経由で書く。上で値を載せてあるので追加の GET は起きない。
     * 載っていなかったときだけ、この中でレコードから引き直してくれる
     * （この経路の 400 を1箇所で防ぐため、他の更新経路と同じ部品にそろえた）。
     */
    await writePocketRecordWithImportKey({
      appId: customerAppId,
      recordId: existingId,
      payload: pocketPayload,
      importKeyFieldId: resolvedCustomerKey,
      readAuth: customerAuth,
      writeAuth: customerAuth,
    });
    timing.mark("customer-write");
    if (dropboxSkipped) {
      // 既存リンクがあり Dropbox を叩かなかった（3往復ぶん省いた）
      console.info(
        "[sync-construction-to-customer-info] Dropboxリンクが既にあるためフォルダ確認を省略しました",
      );
    }

    // 走らせたまま返す。合流は呼び出し側（finalize）が行う
    const pendingAudit = recordCustomerInfoSyncAuditLog({
      operation: "update",
      lineUserId: opts.lineUserId ?? "",
      customerAppId,
      recordId: existingId,
      tNumber: customerTNumber || uniqueKey,
      before,
      payload: pocketPayload,
      customerFields,
    });
    return {
      kind: "synced",
      customerInfoRecordId: existingId,
      pendingAudit,
      ...(customerTNumber ? { tNumber: customerTNumber } : {}),
      ...(dropboxWarning ? { dropboxWarning } : {}),
    };
  }

  /**
   * Aki番号 で引き直せるか。
   *
   * 施工予定日ありは工事アプリが Aki番号 を採番済みなので引き直せる。
   * **施工予定日なし（customerInfoOnly）は工事レコードを作らないため
   * Aki番号 が無く、この手が使えない。** 実機で T番号 が取れなかったのは
   * ここに手がかりが1つも無いのが効いている。
   */
  const canRefetchByAki = Boolean(customerAkiFieldId && akiKey);

  /**
   * 引き直す手が無いときだけ、作成**前**の一覧を控えておく。
   *
   * 作成後の一覧と突き合わせて「増えた1件」を採る。お客様名で絞って
   * 一番新しい行を採る当て方は、同姓同名や再登録で既存の別レコードを
   * 掴むので使わない（アポ取得で同じ判断をしている）。
   *
   * @pocket の呼び出しは1回増える。作成応答から ID が取れれば作成後の
   * 一覧は取らないので、増えるのは基本この1回だけ。
   * 取れなくても登録は続ける（recordId が空になるだけ）。
   */
  const beforeSnapshot =
    !canRefetchByAki && resolvedCustomerName
      ? await snapshotRecordIdsByFieldValue({
        appId: customerAppId,
        fieldId: resolvedCustomerName,
        value: opts.customerName,
        auth: customerAuth,
        ctx: {
          operation: "sync-construction:登録直後のrecordId照合",
          appEnv: "CUSTOMER_INFO_APP_ID",
        },
        logPrefix: "[sync-construction-to-customer-info]",
      })
      : null;

  const created = await createRecord(
    customerAppId,
    pocketPayload,
    customerAuth,
  );
  timing.mark("customer-write");
  /**
   * 作成応答から ID が取れないことがある。
   * その場合は今書いた Aki番号 で引き直す（この時点なら必ず1件ある）
   */
  let customerInfoRecordId = atPocketRecordIdFromCreateResult(created) ?? "";
  if (!customerInfoRecordId && canRefetchByAki) {
    customerInfoRecordId =
      (await refetchCustomerInfoRecordIdByUniqueKey(
        customerAkiFieldId as string,
        akiKey,
      )) ?? "";
  }
  /**
   * Aki番号 が無い経路の最後の手。増えた1件がはっきりしているときだけ採る。
   *
   * ここで取れないと T番号 を読む先が無くなり、新規案件通知も
   * 工事アプリへの書き戻しも落ちる。
   */
  if (!customerInfoRecordId && beforeSnapshot) {
    const afterSnapshot = await snapshotRecordIdsByFieldValue({
      appId: customerAppId,
      fieldId: resolvedCustomerName as string,
      value: opts.customerName,
      auth: customerAuth,
      ctx: {
        operation: "sync-construction:登録直後のrecordId照合",
        appEnv: "CUSTOMER_INFO_APP_ID",
      },
      logPrefix: "[sync-construction-to-customer-info]",
    });
    customerInfoRecordId =
      pickCreatedRecordId(beforeSnapshot, afterSnapshot) ?? "";
    console.info(
      "[sync-construction-to-customer-info] 作成前後の差分で recordId を照合しました",
      JSON.stringify({ found: Boolean(customerInfoRecordId) }),
    );
  }

  if (!customerInfoRecordId) {
    /**
     * ここまで来ると T番号 を読む先が無い。登録自体は済んでいるので
     * 失敗にはしないが、通知も書き戻しも落ちることを記録しておく。
     * お客様名は出さない（後から Aki番号・作成時刻で辿れる）
     */
    console.error(
      "[sync-construction-to-customer-info] 作成した recordId を特定できず、T番号 を読めません",
      JSON.stringify({
        customerInfoOnly,
        triedAki: canRefetchByAki,
        triedDiff: Boolean(beforeSnapshot),
      }),
    );
  }

  /**
   * ここで初めて T番号 が分かる（お客様情報アプリの自動採番）。
   * Dropbox のフォルダ名に要るので、作成後に用意してリンクだけ書き足す
   */
  if (customerInfoRecordId) {
    customerTNumber = (
      await readCustomerInfoExistingValues(
        customerAppId,
        customerInfoRecordId,
        resolvedCustomerKey,
        null,
        customerAuth,
        // 作成直後は採番が間に合わないことがある。短く待ち直す
        SYNC_TNUMBER_POLL_DELAYS_MS,
      )
    ).tNumber;
    if (customerTNumber) {
      const linkRecord: Record<string, unknown> = {};
      await applyDropboxLink(linkRecord, customerTNumber);
      if (Object.keys(linkRecord).length > 0) {
        const linkPayload: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(linkRecord)) {
          linkPayload[k] = customerInfoPutValue(v);
        }
        // 取込キー（T番号）の同送が要る。ここでは値が分かっている
        linkPayload[resolvedCustomerKey] =
          customerInfoPutValue(customerTNumber);
        try {
          await updateRecord(
            customerAppId,
            customerInfoRecordId,
            linkPayload,
            customerAuth,
          );
        } catch (e) {
          // 登録は済んでいる。リンクだけ入らなくても連携は成功として扱う
          console.error(
            "[sync-construction-to-customer-info] Dropboxリンクの保存に失敗",
            e instanceof Error ? e.message : String(e),
          );
          dropboxWarning = dropboxWarning ?? DROPBOX_FOLDER_WARNING;
        }
      }
    }
  }

  // 走らせたまま返す。合流は呼び出し側（finalize）が行う
  const pendingAudit = recordCustomerInfoSyncAuditLog({
    operation: "create",
    lineUserId: opts.lineUserId ?? "",
    customerAppId,
    recordId: customerInfoRecordId,
    tNumber: customerTNumber || akiKey,
    before: null,
    payload: pocketPayload,
    customerFields,
  });

  return {
    kind: "synced",
    pendingAudit,
    ...(customerInfoRecordId ? { customerInfoRecordId } : {}),
    ...(customerTNumber ? { tNumber: customerTNumber } : {}),
    ...(dropboxWarning ? { dropboxWarning } : {}),
  };
}
