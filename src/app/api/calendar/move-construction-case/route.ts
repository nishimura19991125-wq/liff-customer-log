import { NextResponse } from "next/server";

import {
  apiKeyForCalendarPocket1,
  apiKeyForCalendarWrite,
  fetchAppFields,
  fetchRecordById,
} from "@/lib/atpocket";
import { writePocketRecordWithImportKey } from "@/lib/atpocket-write-with-import-key";
import { recordAuditLog } from "@/lib/audit-log";
import { computeAuditChanges } from "@/lib/audit-log-changes";
import { finalizeConstructionCalendarSave } from "@/lib/calendar-after-construction-save";
import { calendarConstructionHandlerFieldIdFromEnv } from "@/lib/calendar-construction-handler-env";
import { formatConstructionCreateRecordError } from "@/lib/calendar-construction-create-error";
import {
  buildConstructionFillPatch,
  fetchConstructionRecordRow,
  ensureConstructionImportKeyOnRecord,
  readConstructionTNumberFromRecord,
  resolveConstructionRecordAfterCreate,
  uniqueFieldsCsv,
} from "@/lib/calendar-construction-pocket-common";
import { invalidateCalendarConstructionRecordsCache } from "@/lib/calendar-construction-records-cache";
import {
  buildConstructionEmptySlotResetPatch,
  buildConstructionSlotKeepFieldIds,
} from "@/lib/calendar-empty-slot-reset";
import {
  constructionTitleFieldIsEmpty,
  pickRecordValueByFieldAliases,
  resolveConfiguredFieldToSchemaUniqueId,
  resolveConstructionFieldIds,
  resolveConstructionImportKeyFieldId,
  resolveConstructionTNumberFieldId,
  resolveEmptyFillHousingStatusFieldId,
} from "@/lib/calendar-kojo";
import { buildMoveSourceResetFailedMessage } from "@/lib/calendar-move-case-messages";
import { optionalCalendarYmd } from "@/lib/calendar-optional-ymd";
import { invalidateAllCalendarPayloadCache } from "@/lib/calendar-response-cache";
import { calendarSlotConflictResponse } from "@/lib/calendar-slot-reservation";
import { dayKeyFromConstructionRecord } from "@/lib/calendar-consume-empty-slot";
import { isCustomerTNumberCancelled } from "@/lib/customer-cancelled-t-numbers";
import { fieldCaptionByUniqueId } from "@/lib/customer-info-record";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";
import { startServerTimingLog } from "@/lib/server-timing-log";
import {
  constructionHandlerStaffConfigReady,
  resolveConstructionHandlerNameForActiveStaff,
} from "@/lib/staff-construction-handler-candidates";

export const dynamic = "force-dynamic";
export const maxDuration = 26;

/**
 * 案件の工事日を別の日へ移す（工事日変更 M-2）。
 *
 * ⚠ **M-2 の時点ではどの画面からも呼ばれない。** 配線は M-3。
 *
 * 3-3 で「空き枠を削除せず、枠のレコードを案件に変える」形にしたため、
 * 工事日だけを書き換えると枠の対応が崩れる（元の日の枠が消えたまま、
 * 移動先には枠と案件が並ぶ）。レコードを移し替えて辻褄を合わせる。
 *
 * ■ assign-customer-case と分けてある理由
 * あちらは案A（同じ T番号 の工事レコードが既にあれば、空き枠を使わず
 * そこへ書く）。移動は**既存レコードがあることが前提で、別の枠へ移す**。
 * 前提が正反対なので、同じルートにフラグで同居させると「どちらの意図で
 * 呼ばれたか」が body 次第になり、誤爆したときに顧客情報を消す側へ倒れる。
 *
 * ■ 順序は「書いてから消す」（W1 → W2）
 *   W1 成功・W2 失敗 → 案件が2件。すぐ気づき、データは失われていない。
 *                      案Aのガードが「複数一致」で他の操作を止めるので
 *                      傷口が広がらない
 *   W2 成功・W1 失敗 → 案件が消える。お客様情報の施工予定日は旧日付の
 *                      ままなので未定案件一覧にも出ず、165cf10 で
 *                      画面からも直せない＝アプリ内に復旧手段が無い
 * 後者を避ける。
 *
 * ■ 削除しない
 * deleteRecord を import していない。移動元は列を空にして空き枠へ戻す。
 */

type Body = {
  /** 移動する案件の工事レコードID */
  sourceRecordId?: string;
  /** 移動先の日付 YYYY-MM-DD。月をまたいでよい */
  targetDayKey?: string;
  /** 移動先の空き枠。省略・空なら新規レコードを作る */
  slotRecordId?: string;
  /**
   * 移動先の施工会社。省略時は「空き枠の施工会社 → 移動元の施工会社」の順。
   * 違う施工会社の枠へ移すと、施工会社も書き換わる
   */
  contractor?: string;
  constructionHandlerStaffRecordId?: string;
  /** 後方互換（工事登録者API名） */
  constructionRegistrantStaffRecordId?: string;
  /**
   * 画面が見ていた案件の T番号（任意）。
   * 渡されたら移動元の T番号 と一致するか確かめる。カレンダーは
   * キャッシュ越しなので、その間に別の案件へ変わっている場合を弾く
   */
  expectedTNumber?: string;
  viewYear?: number;
  viewMonth?: number;
};

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 移動元を空き枠へ戻す書き込みの再試行（ms）。
 *
 * 空にするだけの冪等な更新なので、同じ内容を何度送っても害が無い。
 * ここで諦めると案件が2件のまま残るので、短く粘る。
 */
const SOURCE_RESET_RETRY_DELAYS_MS = [0, 400, 1200] as const;

export async function POST(request: Request) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  const calAppId = process.env.CALENDAR_APP_ID?.trim();
  if (!calAppId) {
    return NextResponse.json(
      { error: "CALENDAR_APP_ID が未設定です", disabled: true },
      { status: 503 },
    );
  }

  const customerField =
    process.env.CALENDAR_EMPTY_FILL_CUSTOMER_NAME_FIELD_ID?.trim() ||
    process.env.CALENDAR_EMPTY_FILL_TITLE_FIELD_ID?.trim();
  if (!customerField) {
    return NextResponse.json(
      {
        error:
          "工事空枠の入力先フィールドが未設定です。.env に CALENDAR_EMPTY_FILL_CUSTOMER_NAME_FIELD_ID（@pocket の uniqueId）を設定してください。",
      },
      { status: 500 },
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const sourceRecordId = body.sourceRecordId?.trim() ?? "";
  const targetDayKey = optionalCalendarYmd(body.targetDayKey);
  const slotRecordId = body.slotRecordId?.trim() ?? "";
  const expectedTNumber = body.expectedTNumber?.trim() ?? "";
  const handlerStaffRecordId =
    body.constructionHandlerStaffRecordId?.trim() ||
    body.constructionRegistrantStaffRecordId?.trim() ||
    "";

  if (!sourceRecordId || !targetDayKey) {
    return NextResponse.json(
      { error: "sourceRecordId と targetDayKey（YYYY-MM-DD）は必須です" },
      { status: 400 },
    );
  }
  if (slotRecordId && slotRecordId === sourceRecordId) {
    return NextResponse.json(
      { error: "移動元と移動先に同じレコードは指定できません" },
      { status: 400 },
    );
  }

  const readAuth = { apiKey: apiKeyForCalendarPocket1() };
  const writeAuth = { apiKey: apiKeyForCalendarWrite() };

  const timing = startServerTimingLog("move-construction-case");

  /** W1 が済んだか。ここから先の失敗は「案件は消えていない」で返す */
  let movedWritten = false;

  /**
   * 監査ログは後続処理と並走させる。
   *
   * recordAuditLog は変更1列につき1レコードを直列 POST するので、
   * 移動1回で 10 件を超える往復になる。順序に意味は無く
   * （同一操作は executedAt で束ねている）、recordMoveAuditLog は
   * 例外を握るので、走らせておいて最後にまとめて待つ。
   *
   * ⚠ **await せずにレスポンスを返してはいけない。** Lambda は
   *    レスポンス後に実行環境を凍結するので、投げっぱなしにすると
   *    監査ログが書かれないまま消える。返す直前に必ず flushAudits()。
   */
  const auditTasks: Promise<void>[] = [];
  const flushAudits = async () => {
    if (auditTasks.length === 0) return;
    await Promise.allSettled(auditTasks);
    timing.mark("audit-flush");
  };

  try {
    const constructionFields = await fetchAppFields(calAppId, readAuth, {
      operation: "calendar:工事日変更fields",
      appEnv: "CALENDAR_APP_ID",
    });

    const resolvedCustomer = resolveConfiguredFieldToSchemaUniqueId(
      customerField,
      constructionFields,
    );
    if (!resolvedCustomer) {
      return NextResponse.json(
        {
          error: `お客様名フィールド「${customerField}」が工事アプリのフィールド定義と一致しません。`,
        },
        { status: 500 },
      );
    }

    const fids = resolveConstructionFieldIds(constructionFields);
    if (!fids.startDate?.trim()) {
      return NextResponse.json(
        {
          error:
            "施工予定日フィールドを特定できません。工事アプリに「施工予定日」列があるか確認してください。",
        },
        { status: 500 },
      );
    }

    const resolvedTNumber =
      resolveConstructionTNumberFieldId(constructionFields);
    const resolvedImportKey =
      resolveConstructionImportKeyFieldId(constructionFields);
    const resolvedHousing =
      resolveEmptyFillHousingStatusFieldId(constructionFields) ||
      fids.housingStatus?.trim() ||
      "";
    if (!resolvedTNumber || !resolvedImportKey || !resolvedHousing) {
      return NextResponse.json(
        {
          error:
            "T番号・取込キー（Aki番号）・住宅ステータスのいずれかの列を特定できません。CALENDAR_EMPTY_FILL_TNUMBER_FIELD_ID・CALENDAR_CONSTRUCTION_IMPORT_KEY_FIELD_ID・CALENDAR_EMPTY_FILL_HOUSING_STATUS_FIELD_ID を確認してください。",
        },
        { status: 500 },
      );
    }

    // ── 0) 事前検証。ここでは何も書かない ──────────────────
    const recordFieldsCsv = uniqueFieldsCsv(
      resolvedCustomer,
      fids.title,
      resolvedHousing,
      resolvedTNumber,
      resolvedImportKey,
      fids.startDate,
      fids.contractor,
      fids.constructionHandler,
    );

    timing.mark("fields");

    /**
     * 移動元の取得と、工事対応者・キャンセル判定の材料を**並列**で取る。
     * 互いに依存せず、どれも読み取りしかしない
     */
    const [sourceRow, handlerResolved] = await Promise.all([
      fetchConstructionRecordRow(
        calAppId,
        sourceRecordId,
        readAuth,
        recordFieldsCsv,
      ),
      handlerStaffRecordId
        ? resolveConstructionHandlerNameForActiveStaff(handlerStaffRecordId)
        : Promise.resolve(null),
    ]);
    timing.mark("source-get");

    if (!sourceRow?.record || typeof sourceRow.record !== "object") {
      return NextResponse.json(
        { error: "移動元の案件レコードが見つかりません" },
        { status: 404 },
      );
    }
    const sourceRec = sourceRow.record as Record<string, unknown>;

    // 空き枠を「移動」させない。お客様名が空＝案件ではない
    if (constructionTitleFieldIsEmpty(sourceRec, resolvedCustomer)) {
      return NextResponse.json(
        {
          error:
            "移動元が案件ではありません（お客様名が空）。カレンダーを更新して選び直してください。",
        },
        { status: 409 },
      );
    }

    const titleId = fids.title?.trim() || resolvedCustomer;
    const customerName = coercePlainString(
      pickRecordValueByFieldAliases(sourceRec, titleId),
    );
    if (!customerName) {
      return NextResponse.json(
        { error: "移動元のお客様名を取得できませんでした" },
        { status: 400 },
      );
    }

    const tNumber =
      readConstructionTNumberFromRecord(sourceRec, resolvedTNumber) ?? "";
    if (!tNumber) {
      /**
       * T番号 が無いと、移動先レコードをお客様情報と突合できない。
       * そのまま作ると連携が既存のお客様情報を引き当てられず、
       * 同じ顧客のレコードをもう1件作ってしまう（3-2 と同じ理由）
       */
      return NextResponse.json(
        {
          error:
            "この案件にはT番号が入っていません。先に割り当てをやり直してT番号を揃えてから移動してください。",
        },
        { status: 400 },
      );
    }
    if (expectedTNumber && expectedTNumber !== tNumber) {
      return NextResponse.json(
        {
          error:
            "移動元のレコードが画面の表示と変わっています。カレンダーを更新して選び直してください。",
        },
        { status: 409 },
      );
    }

    if (await isCustomerTNumberCancelled(tNumber)) {
      return NextResponse.json(
        {
          error:
            "顧客ステータスが「キャンセル」の案件は移動できません。カレンダーを更新して確認してください。",
        },
        { status: 400 },
      );
    }

    const sourceDayKey =
      dayKeyFromConstructionRecord(sourceRec, constructionFields) ?? "";
    if (sourceDayKey && sourceDayKey === targetDayKey) {
      /**
       * 同じ日への移動は何も変わらないのに、移動元を空き枠へ戻す処理だけ
       * 走って案件が消える。押し間違いとして弾く
       */
      return NextResponse.json(
        { error: "移動先が現在の施工予定日と同じです" },
        { status: 400 },
      );
    }

    const sourceHousing = coercePlainString(
      pickRecordValueByFieldAliases(sourceRec, resolvedHousing),
    );
    const sourceContractor = fids.contractor?.trim()
      ? coercePlainString(
          pickRecordValueByFieldAliases(sourceRec, fids.contractor),
        )
      : "";
    const sourceHandler = fids.constructionHandler?.trim()
      ? coercePlainString(
          pickRecordValueByFieldAliases(sourceRec, fids.constructionHandler),
        )
      : "";

    /**
     * 工事対応者。扱いは fill-empty-slot に揃える（環境変数が設定されて
     * いるときだけ必須）。未設定の環境では**移動元の値を引き継ぐ**。
     * 移動で工事対応者が消えるのは事故なので、書かない側には倒さない
     */
    const handlerFieldEnv = calendarConstructionHandlerFieldIdFromEnv();
    let handlerFieldId = fids.constructionHandler?.trim() || "";
    let handlerValue = sourceHandler;

    if (handlerFieldEnv) {
      if (!constructionHandlerStaffConfigReady()) {
        return NextResponse.json(
          {
            error:
              "工事対応者はスタッフ名簿と連携する必要があります。STAFF_APP_ID・STAFF_NAME_FIELD_ID・STAFF_CONSTRUCTION_AVAILABILITY_FIELD_ID を設定してください。",
          },
          { status: 503 },
        );
      }
      const resolved = resolveConfiguredFieldToSchemaUniqueId(
        handlerFieldEnv,
        constructionFields,
      );
      if (!resolved) {
        return NextResponse.json(
          {
            error: `工事対応者フィールド「${handlerFieldEnv}」が工事アプリのフィールド定義と一致しません。`,
          },
          { status: 500 },
        );
      }
      handlerFieldId = resolved;
      if (!handlerStaffRecordId) {
        return NextResponse.json(
          { error: "工事対応者を選択してください" },
          { status: 400 },
        );
      }
      // 上の Promise.all で解決済み（名簿はキャッシュだが冷えると1往復）
      const resolvedName = handlerResolved ?? {
        ok: false as const,
        reason: "not_found" as const,
      };
      if (!resolvedName.ok) {
        const msg =
          resolvedName.reason === "not_found"
            ? "選択したスタッフが見つかりません。"
            : resolvedName.reason === "not_active"
              ? "選択した社員は工事対応が「稼働」ではありません。一覧を更新して選び直してください。"
              : resolvedName.reason === "no_name"
                ? "スタッフ名簿に氏名が入っていません。"
                : "工事対応者を検証できませんでした。";
        return NextResponse.json({ error: msg }, { status: 400 });
      }
      handlerValue = resolvedName.name;
    }

    /**
     * 移動先の空き枠は**W1 の直前に1回だけ**読む。
     *
     * 以前は「枠 GET →（検証）→ 鮮度確認 → PUT」で 2回読んでいた。
     * 読む位置を書き込みの直前へ寄せれば、空き枠かどうかの判定・
     * Aki番号・施工会社をその1回でまかなえる。窓は今までより狭い
     */
    let slotRec: Record<string, unknown> | null = null;
    let slotAki = "";
    let slotContractor = "";
    if (slotRecordId) {
      let slotRow = await fetchRecordById(
        calAppId,
        slotRecordId,
        readAuth,
        recordFieldsCsv,
      );
      if (!slotRow?.record) {
        slotRow = await fetchRecordById(calAppId, slotRecordId, readAuth);
      }
      timing.mark("slot-get");
      if (!slotRow?.record || typeof slotRow.record !== "object") {
        return NextResponse.json(
          { error: "移動先の空き枠レコードが見つかりません" },
          { status: 404 },
        );
      }
      slotRec = slotRow.record as Record<string, unknown>;
      if (!constructionTitleFieldIsEmpty(slotRec, resolvedCustomer)) {
        const { status, body: conflictBody } = calendarSlotConflictResponse();
        return NextResponse.json(conflictBody, { status });
      }
      slotAki =
        readConstructionTNumberFromRecord(slotRec, resolvedImportKey) ?? "";
      slotContractor = fids.contractor?.trim()
        ? coercePlainString(
            pickRecordValueByFieldAliases(slotRec, fids.contractor),
          )
        : "";
    }

    /** 施工会社。枠の値を正とし、無ければ画面の指定、最後に移動元の値 */
    const contractor =
      slotContractor || body.contractor?.trim() || sourceContractor;

    const movePatch = buildConstructionFillPatch({
      resolvedCustomer,
      resolvedHousing,
      resolvedImportKey,
      // 空き枠のときは枠の Aki番号 を引き継ぐ。新規は空文字で採番させる
      importKeyValue: slotRecordId ? slotAki : "",
      resolvedTNumber,
      tNumberValue: tNumber,
      customerName,
      housingRaw: sourceHousing,
      ...(handlerFieldId && handlerValue
        ? { resolvedHandlerField: handlerFieldId, handlerValue }
        : {}),
      fids,
      scheduledStartDate: targetDayKey,
      contractor: contractor || undefined,
    });
    // 住宅ステータスが空なら列ごと外す（移動先の値を空で潰さない）
    if (!sourceHousing) delete movePatch[resolvedHousing];

    // ── 1) W1: 移動先へ書く ────────────────────────────────
    let movedRecordId = "";
    let movedAki = "";
    let movedTo: "slot" | "new";

    if (slotRecordId && slotRec) {
      // 空きかどうかは直前の slot-get で見ている（読み直さない）
      await writePocketRecordWithImportKey({
        appId: calAppId,
        recordId: slotRecordId,
        payload: movePatch,
        importKeyFieldId: resolvedImportKey,
        allowMissingImportKey: true,
        existingRecord: slotRec,
        readAuth,
        writeAuth,
      });
      timing.mark("w1-write");
      movedWritten = true;
      movedRecordId = slotRecordId;
      movedAki = slotAki;
      movedTo = "slot";

      auditTasks.push(
        recordMoveAuditLog({
        lineUserId: auth.lineUserId,
        operation: "update",
        calAppId,
        recordId: slotRecordId,
        tNumber,
        before: slotRec,
        payload: movePatch,
        constructionFields,
        note: `${sourceDayKey || "不明"} のレコード（ID ${sourceRecordId}）から工事日を移動`,
      }));
    } else {
      const created = await writePocketRecordWithImportKey({
        appId: calAppId,
        payload: movePatch,
        importKeyFieldId: resolvedImportKey,
        writeAuth,
      });
      if (!created) {
        throw new Error("移動先の工事レコードを作成できませんでした");
      }
      movedWritten = true;
      movedTo = "new";

      const match = await resolveConstructionRecordAfterCreate(
        calAppId,
        created,
        {
          customerName,
          housingStatus: sourceHousing,
          customerFieldId: resolvedCustomer,
          housingFieldId: resolvedHousing,
          startDateFieldId: fids.startDate?.trim() || undefined,
          // 作成直後に読むのは取込キー（Aki番号）。T番号 は移動元にもある
          tNumberFieldId: resolvedImportKey,
        },
        readAuth,
      );
      movedRecordId = match.recordId ?? "";
      movedAki = match.uniqueKey ?? "";

      if (movedRecordId && !movedAki) {
        movedAki =
          (await ensureConstructionImportKeyOnRecord(
            calAppId,
            movedRecordId,
            resolvedImportKey,
            readAuth,
            recordFieldsCsv,
          )) ?? "";
      }

      if (movedRecordId) {
        auditTasks.push(
        recordMoveAuditLog({
          lineUserId: auth.lineUserId,
          operation: "create",
          calAppId,
          recordId: movedRecordId,
          tNumber,
          before: null,
          payload: movePatch,
          constructionFields,
          note: `${sourceDayKey || "不明"} のレコード（ID ${sourceRecordId}）から工事日を移動`,
        }));
      } else {
        console.error(
          "[api/calendar/move-construction-case] 作成したレコードのIDを特定できません（監査ログを残せません）",
          JSON.stringify({ calAppId, sourceRecordId, targetDayKey }),
        );
      }
    }

    invalidateCalendarConstructionRecordsCache();
    invalidateAllCalendarPayloadCache();

    timing.mark("w1-post");

    // ── 3〜5) W2: 移動元を空き枠へ戻す ──────────────────────
    const keep = buildConstructionSlotKeepFieldIds((key) =>
      key === "startDate"
        ? fids.startDate
        : key === "contractor"
          ? fids.contractor
          : resolvedImportKey,
    );
    if (keep.unresolved.length > 0) {
      console.warn(
        "[api/calendar/move-construction-case] 残す列を解決できないものがあります",
        JSON.stringify({ unresolved: keep.unresolved }),
      );
    }

    const reset = buildConstructionEmptySlotResetPatch({
      fieldIdsOf: (key) => {
        switch (key) {
          case "customerName":
            // 見出しと環境変数で列が食い違うことがある。両方消す
            return [resolvedCustomer, fids.title];
          case "tNumber":
            return resolvedTNumber;
          case "housingStatus":
            return resolvedHousing;
          case "constructionHandler":
            return fids.constructionHandler;
        }
      },
      keepFieldIds: keep.fieldIds,
    });
    if (reset.unresolved.length > 0 || reset.keptFieldIds.length > 0) {
      console.warn(
        "[api/calendar/move-construction-case] 移動元で空にできない列があります",
        JSON.stringify({
          unresolved: reset.unresolved,
          keptFieldIds: reset.keptFieldIds,
        }),
      );
    }

    const sourceReset =
      Object.keys(reset.patch).length > 0
        ? await resetSourceToEmptySlot({
            calAppId,
            sourceRecordId,
            resolvedCustomer,
            resolvedImportKey,
            tNumber,
            resolvedTNumber,
            patch: reset.patch,
            sourceRec,
            readAuth,
            writeAuth,
          })
        : { ok: false as const, reason: "no-columns" as const };

    timing.mark("w2-write");

    if (sourceReset.ok) {
      auditTasks.push(
        recordMoveAuditLog({
        lineUserId: auth.lineUserId,
        operation: "update",
        calAppId,
        recordId: sourceRecordId,
        tNumber,
        before: sourceRec,
        payload: reset.patch,
        constructionFields,
        note: `工事日を ${targetDayKey} へ移動し、この枠を空き枠へ戻した`,
      }));
      invalidateCalendarConstructionRecordsCache();
      invalidateAllCalendarPayloadCache();
    } else {
      console.error(
        "[api/calendar/move-construction-case] 移動元を空き枠へ戻せませんでした",
        JSON.stringify({
          calAppId,
          sourceRecordId,
          movedRecordId,
          reason: sourceReset.reason,
        }),
      );
      // 監査ログを書き切ってから返す（返した瞬間に実行環境が凍結する）
      await flushAudits();
      timing.flush({ result: "source-reset-failed", movedTo });
      return NextResponse.json(
        {
          error: buildMoveSourceResetFailedMessage({
            sourceRecordId,
            sourceDayKey,
            targetDayKey,
          }),
          constructionSaved: true,
          movedTo,
          sourceResetToEmptySlot: false,
          sourceRecordId,
          sourceDayKey,
        },
        { status: 502 },
      );
    }

    // ── 6) 後処理（お客様情報の Aki番号・施工予定日はここで更新される）
    const finalized = await finalizeConstructionCalendarSave({
      calAppId,
      constructionRecordId: movedRecordId || null,
      constructionUniqueKey: tNumber,
      // 移動先に T番号 が入った保証はしない（3-2 と同じ理由で必ず書き戻す）
      constructionRecordTNumber: "",
      constructionImportKey: movedAki || undefined,
      customerName,
      housingStatus: sourceHousing || undefined,
      constructionFields,
      calendarAuth: writeAuth,
      lineUserId: auth.lineUserId,
      viewYear: body.viewYear,
      viewMonth: body.viewMonth,
      savedVerb: "更新",
      /**
       * カレンダーの即時反映パッチは組み立てない。
       * 移動のパネルは onSaved(null) を呼んで必ず再取得するので、
       * 組み立てても捨てられる（@pocket の GET を1回節約）
       */
      skipCalendarPatch: true,
      extraResponse: {
        movedTo,
        sourceResetToEmptySlot: true,
        sourceRecordId,
        sourceDayKey,
        slotDeleted: false,
      },
    });
    timing.mark("finalize");

    // レスポンスを返す前に監査ログを必ず書き切る
    await flushAudits();
    timing.flush({ result: "ok", movedTo });
    return finalized;
  } catch (e) {
    console.error("[api/calendar/move-construction-case]", e);
    await flushAudits();
    timing.flush({ result: "error" });
    const detail = formatConstructionCreateRecordError(
      e instanceof Error ? e.message : String(e),
    );
    if (movedWritten) {
      return NextResponse.json(
        {
          error: `${detail}（移動先への登録は完了しています。移動元が残っている場合は @pocket で確認してください）`,
          constructionSaved: true,
        },
        { status: 502 },
      );
    }
    return NextResponse.json(
      {
        error:
          detail.includes("list fields failed") || detail.includes("403")
            ? `工事アプリの設定取得に失敗しました。CALENDAR_ATPOCKET_API_KEY と CALENDAR_APP_ID を確認してください。(${detail})`
            : "工事日の変更に失敗しました。しばらくしてから再度お試しください。",
      },
      { status: 502 },
    );
  }
}

/**
 * 移動元を空き枠へ戻す。書き込み直前にもう一度、まだこの案件かを見る。
 *
 * 空にするだけの冪等な更新なので短く再試行する。ここで諦めると案件が
 * 2件のまま残るため、粘る価値がある。
 */
async function resetSourceToEmptySlot(input: {
  calAppId: string;
  sourceRecordId: string;
  resolvedCustomer: string;
  resolvedImportKey: string;
  resolvedTNumber: string;
  tNumber: string;
  patch: Record<string, unknown>;
  sourceRec: Record<string, unknown>;
  readAuth: { apiKey: string };
  writeAuth: { apiKey: string };
}): Promise<
  { ok: true } | { ok: false; reason: "changed" | "write-failed" | "no-columns" }
> {
  let lastError: unknown = null;

  for (const delay of SOURCE_RESET_RETRY_DELAYS_MS) {
    if (delay > 0) await sleep(delay);

    // まだこの案件か（別の人が触っていないか）。読めないときは進む
    try {
      const fresh = await fetchRecordById(
        input.calAppId,
        input.sourceRecordId,
        input.readAuth,
        uniqueFieldsCsv(input.resolvedCustomer, input.resolvedTNumber),
      );
      if (fresh?.record && typeof fresh.record === "object") {
        const recObj = fresh.record as Record<string, unknown>;
        if (constructionTitleFieldIsEmpty(recObj, input.resolvedCustomer)) {
          // 既に空き枠。戻す仕事は済んでいる
          return { ok: true };
        }
        const currentT =
          readConstructionTNumberFromRecord(recObj, input.resolvedTNumber) ??
          "";
        if (currentT && currentT !== input.tNumber) {
          // 別の案件に変わっている。消してはいけない
          return { ok: false, reason: "changed" };
        }
      }
    } catch (e) {
      // 再確認が失敗しただけ。書き込みは試す
      lastError = e;
    }

    try {
      await writePocketRecordWithImportKey({
        appId: input.calAppId,
        recordId: input.sourceRecordId,
        payload: { ...input.patch },
        importKeyFieldId: input.resolvedImportKey,
        allowMissingImportKey: true,
        existingRecord: input.sourceRec,
        readAuth: input.readAuth,
        writeAuth: input.writeAuth,
      });
      return { ok: true };
    } catch (e) {
      lastError = e;
    }
  }

  console.error(
    "[api/calendar/move-construction-case] 移動元の更新を再試行しても失敗",
    lastError instanceof Error ? lastError.message : String(lastError),
  );
  return { ok: false, reason: "write-failed" };
}

/**
 * 監査ログ。移動であることが後から分かるよう、列の差分に加えて
 * 「どこから／どこへ」の1行を足す（キャンセルの空き枠作成と同じ流儀）。
 * ベストエフォート。記録に失敗しても書き込みは取り消さない。
 */
async function recordMoveAuditLog(input: {
  lineUserId: string;
  operation: "create" | "update";
  calAppId: string;
  recordId: string;
  tNumber: string;
  before: Record<string, unknown> | null;
  payload: Record<string, unknown>;
  constructionFields: Awaited<ReturnType<typeof fetchAppFields>>;
  note: string;
}): Promise<void> {
  try {
    await recordAuditLog({
      lineUserId: input.lineUserId,
      operation: input.operation,
      targetAppId: input.calAppId,
      targetRecordId: input.recordId,
      targetTNumber: input.tNumber,
      changes: [
        {
          fieldId: "__construction_case_move__",
          label: "工事日の移動",
          before: "",
          after: input.note,
        },
        ...computeAuditChanges(input.before, input.payload, {
          labelOf: (fieldId) =>
            fieldCaptionByUniqueId(input.constructionFields, fieldId),
        }),
      ],
    });
  } catch (e) {
    console.warn(
      "[api/calendar/move-construction-case] 監査ログの記録に失敗",
      e instanceof Error ? e.message : String(e),
    );
  }
}
