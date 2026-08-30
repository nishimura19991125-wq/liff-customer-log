import { NextResponse } from "next/server";

import {
  apiKeyForCalendarPocket1,
  apiKeyForCalendarWrite,
  fetchAppFields,
} from "@/lib/atpocket";
import { writePocketRecordWithImportKey } from "@/lib/atpocket-write-with-import-key";
import { recordAuditLog } from "@/lib/audit-log";
import { computeAuditChanges } from "@/lib/audit-log-changes";
import { fieldCaptionByUniqueId } from "@/lib/customer-info-record";
import { finalizeConstructionCalendarSave } from "@/lib/calendar-after-construction-save";
import {
  buildConstructionFillPatch,
  ensureConstructionImportKeyOnRecord,
  resolveConstructionRecordAfterCreate,
  uniqueFieldsCsv,
} from "@/lib/calendar-construction-pocket-common";
import { formatConstructionCreateRecordError } from "@/lib/calendar-construction-create-error";
import { syncConstructionRecordToCustomerInfoApp } from "@/lib/sync-construction-to-customer-info";
import { invalidateAllCalendarPayloadCache } from "@/lib/calendar-response-cache";
import { calendarConstructionHandlerFieldIdFromEnv } from "@/lib/calendar-construction-handler-env";
import { isValidEmptyFillHousingStatus } from "@/lib/calendar-empty-fill-options";
import { optionalCalendarYmd } from "@/lib/calendar-optional-ymd";
import {
  resolveConfiguredFieldToSchemaUniqueId,
  resolveConstructionFieldIds,
  resolveConstructionImportKeyFieldId,
  resolveConstructionTNumberFieldId,
  resolveEmptyFillHousingStatusFieldId,
} from "@/lib/calendar-kojo";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";
import {
  constructionHandlerStaffConfigReady,
  resolveConstructionHandlerNameForActiveStaff,
} from "@/lib/staff-construction-handler-candidates";

export const dynamic = "force-dynamic";
/** Netlify Pro 等で延長可能。Free はプラットフォーム上限（約10秒） */
export const maxDuration = 26;

/** 新築案件の任意日程（YYYY-MM-DD）。未送信・空は書き込まない */
type Body = {
  customerName?: string;
  housingStatus?: string;
  constructionHandlerStaffRecordId?: string;
  constructionRegistrantStaffRecordId?: string;
  shigumiDate?: string;
  panelWorkDate?: string;
  electricWorkDate?: string;
  appSettingsDayDate?: string;
  /** 施工予定日 YYYY-MM-DD（任意） */
  scheduledStartDate?: string;
  /** 施工会社（任意） */
  contractor?: string;
  viewYear?: number;
  viewMonth?: number;
};

/**
 * 工事カレンダー新規登録。
 *
 * ■ 施工予定日で経路が分かれる
 *   あり → 工事登録アプリに作成 → お客様情報へ連携 → T番号 を書き戻す
 *   なし → **工事登録アプリに作らない**。お客様情報にだけ作る
 *          （日付未定の案件に Aki番号 を採番しないため。カレンダーには出ない）
 *
 * 工事アプリへ書き込み（取込キー＝Aki番号は空で送り @pocket が採番）
 *   → recordId 確定 → GET で Aki番号確認 → PUT
 *   → お客様情報連携（Aki番号で突合。ここで T番号 が採番される）
 *   → 採番された T番号 を工事アプリへ書き戻す（finalizeConstructionCalendarSave 内）
 *
 * T番号 を採番するのは**お客様情報アプリ**で、工事アプリではない。
 * 工事アプリの T番号 は転記されてくる値を入れるだけのテキスト列。
 */
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

  const customerName = body.customerName?.trim();
  const housingRaw = body.housingStatus?.trim() ?? "";
  const constructionHandlerStaffRecordId =
    body.constructionHandlerStaffRecordId?.trim() ||
    body.constructionRegistrantStaffRecordId?.trim() ||
    "";

  if (!customerName || !housingRaw) {
    return NextResponse.json(
      { error: "お客様名・住宅ステータスはすべて必須です" },
      { status: 400 },
    );
  }

  if (!isValidEmptyFillHousingStatus(housingRaw)) {
    return NextResponse.json(
      {
        error:
          "住宅ステータスは「新築案件」または「既築案件」を指定してください",
      },
      { status: 400 },
    );
  }

  const scheduledStartDateRaw = body.scheduledStartDate?.trim() ?? "";
  const scheduledStartDate = optionalCalendarYmd(scheduledStartDateRaw);
  if (scheduledStartDateRaw && !scheduledStartDate) {
    return NextResponse.json(
      { error: "施工予定日は YYYY-MM-DD 形式で入力してください" },
      { status: 400 },
    );
  }
  const contractor = body.contractor?.trim() ?? "";

  const readAuth = { apiKey: apiKeyForCalendarPocket1() };
  const writeAuth = { apiKey: apiKeyForCalendarWrite() };

  /**
   * 施工予定日が未定なら、工事登録アプリにレコードを作らない。
   *
   * 日程が決まっていない案件にまで Aki番号 を採番すると、カレンダー上に
   * 日付の無い案件が溜まる。お客様情報にだけ作り、日程が決まってから
   * 工事登録アプリへ載せる（第2段階で実装予定）。
   *
   * 工事アプリを一切触らないので、列定義の取得も行わない。
   * カレンダーには出ないが、これは意図した動作
   */
  if (!scheduledStartDate) {
    // 監査ログを走らせたまま返してくるので、この経路でも必ず合流させる
    const sync = await syncConstructionRecordToCustomerInfoApp({
      calAppId,
      customerInfoOnly: true,
      customerName,
      housingStatus: housingRaw,
      contractor,
      lineUserId: auth.lineUserId,
    });

    if (sync.kind === "failed") {
      return NextResponse.json({ error: sync.error }, { status: 502 });
    }
    if (sync.kind === "skipped") {
      return NextResponse.json(
        {
          error:
            "施工予定日が未定の案件はお客様情報アプリへ登録しますが、CUSTOMER_INFO_APP_ID が未設定のため登録できませんでした。",
        },
        { status: 503 },
      );
    }

    // 返した瞬間に実行環境が凍結する。監査ログを書き切ってから返す
    await sync.pendingAudit;

    return NextResponse.json({
      ok: true,
      customerInfoSynced: true,
      /** 工事アプリに作っていないことを画面に伝える */
      constructionSkipped: true,
      ...(sync.customerInfoRecordId
        ? { customerInfoRecordId: sync.customerInfoRecordId }
        : {}),
      ...(sync.tNumber ? { tNumber: sync.tNumber } : {}),
      ...(sync.dropboxWarning ? { warning: sync.dropboxWarning } : {}),
    });
  }

  let constructionSaved = false;

  try {
    const constructionFields = await fetchAppFields(calAppId, readAuth);

    const resolvedCustomer = resolveConfiguredFieldToSchemaUniqueId(
      customerField,
      constructionFields,
    );
    if (!resolvedCustomer) {
      return NextResponse.json(
        {
          error:
            `お客様名フィールド「${customerField}」が工事アプリのフィールド定義と一致しません。GET /api/apps/{アプリID}/fields で返る uniqueId を CALENDAR_EMPTY_FILL_CUSTOMER_NAME_FIELD_ID に設定してください。`,
        },
        { status: 500 },
      );
    }

    const resolvedHousing =
      resolveEmptyFillHousingStatusFieldId(constructionFields);
    if (!resolvedHousing) {
      return NextResponse.json(
        {
          error:
            "住宅ステータスフィールドが見つかりません。工事アプリに「住宅ステータス」列があるか、CALENDAR_EMPTY_FILL_HOUSING_STATUS_FIELD_ID を設定してください。",
        },
        { status: 500 },
      );
    }

    const handlerFieldEnv = calendarConstructionHandlerFieldIdFromEnv();
    let resolvedHandlerField: string | undefined;
    let handlerValueToPut: string | undefined;

    /** 新規登録では工事対応者は任意。送信されたときのみ検証して書き込む */
    if (handlerFieldEnv && constructionHandlerStaffRecordId) {
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
            error:
              `工事対応者フィールド「${handlerFieldEnv}」が工事アプリのフィールド定義と一致しません。GET /api/apps/{アプリID}/fields の uniqueId を CALENDAR_EMPTY_FILL_CONSTRUCTION_HANDLER_FIELD_ID（または後方互換 CALENDAR_EMPTY_FILL_CONSTRUCTION_REGISTRANT_FIELD_ID）に設定してください。`,
          },
          { status: 500 },
        );
      }
      resolvedHandlerField = resolved;
      const resolvedName = await resolveConstructionHandlerNameForActiveStaff(
        constructionHandlerStaffRecordId,
      );
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
      handlerValueToPut = resolvedName.name;
    }

    const fids = resolveConstructionFieldIds(constructionFields);
    const resolvedTNumber =
      resolveConstructionTNumberFieldId(constructionFields);
    if (!resolvedTNumber) {
      return NextResponse.json(
        {
          error:
            "T番号フィールドの uniqueId が分かりません。CALENDAR_EMPTY_FILL_TNUMBER_FIELD_ID を .env に設定するか、アプリに「T番号」見出しのフィールドを用意してください。",
        },
        { status: 500 },
      );
    }

    /** 取込キー（Aki番号）。これが無いと @pocket が作成を受け付けない */
    const resolvedImportKey =
      resolveConstructionImportKeyFieldId(constructionFields);
    if (!resolvedImportKey) {
      return NextResponse.json(
        {
          error:
            "取込キー（Aki番号）フィールドの uniqueId が分かりません。CALENDAR_CONSTRUCTION_IMPORT_KEY_FIELD_ID を .env に設定するか、アプリに「Aki番号」見出しのフィールドを用意してください。",
        },
        { status: 500 },
      );
    }

    const fieldsCsv = uniqueFieldsCsv(
      resolvedCustomer,
      resolvedHousing,
      resolvedTNumber,
      resolvedImportKey,
      fids.startDate,
      fids.contractor,
    );

    const patchExtras = {
      shigumiDate: body.shigumiDate,
      panelWorkDate: body.panelWorkDate,
      electricWorkDate: body.electricWorkDate,
      appSettingsDayDate: body.appSettingsDayDate,
      scheduledStartDate: scheduledStartDate ?? undefined,
      contractor: contractor || undefined,
    };

    const createResult = await writePocketRecordWithImportKey({
      appId: calAppId,
      payload: buildConstructionFillPatch({
        resolvedCustomer,
        resolvedHousing,
        resolvedImportKey,
        // 空で送る。@pocket が Aki番号 を採番する
        importKeyValue: "",
        resolvedTNumber,
        // 工事アプリでは採番されない。お客様情報の採番後に書き戻す
        tNumberValue: "",
        customerName,
        housingRaw,
        resolvedHandlerField,
        handlerValue: handlerValueToPut,
        fids,
        ...patchExtras,
      }),
      importKeyFieldId: resolvedImportKey,
      writeAuth,
    });
    if (!createResult) {
      throw new Error("工事レコードの新規登録に失敗しました");
    }
    constructionSaved = true;
    invalidateAllCalendarPayloadCache();

    const constructionMatch = await resolveConstructionRecordAfterCreate(
      calAppId,
      createResult,
      {
        customerName,
        housingStatus: housingRaw,
        customerFieldId: resolvedCustomer,
        housingFieldId: resolvedHousing,
        startDateFieldId: fids.startDate?.trim() || undefined,
        // 作成直後の照合で読むのは取込キー（Aki番号）。T番号 はまだ空
        tNumberFieldId: resolvedImportKey,
      },
      readAuth,
    );

    const recordId = constructionMatch.recordId;
    let uniqueKey = constructionMatch.uniqueKey;

    if (!recordId && uniqueKey) {
      // この経路では監査ログを残せない（recordId が無いため）。
      // 実際に発生するかを観測するために記録する。
      console.error(
        "[api/calendar/create-record] recordId を解決できず監査ログを記録できません",
        { akiNumber: uniqueKey, customerName },
      );
    }

    if (!recordId && !uniqueKey) {
      return NextResponse.json(
        {
          error:
            `工事レコードは登録されましたが、登録内容を再取得できませんでした（お客様名「${customerName}」で検索）。@pocket に案件があるか、CALENDAR_EMPTY_FILL_CUSTOMER_NAME_FIELD_ID がお客様名列の uniqueId と一致しているか確認してください。`,
          constructionSaved: true,
        },
        { status: 502 },
      );
    }

    if (recordId) {
      /**
       * 待つのは Aki番号（工事アプリの自動採番）。
       * T番号 はお客様情報アプリが採番するので、ここで待っても永久に空になる
       */
      const akiNumber = await ensureConstructionImportKeyOnRecord(
        calAppId,
        recordId,
        resolvedImportKey,
        writeAuth,
        fieldsCsv,
      );
      uniqueKey = uniqueKey ?? akiNumber;
      if (!uniqueKey) {
        /**
         * レコードは作成済み。ここで失敗を返すと利用者が押し直して
         * 重複レコードになる。Aki番号 が読めないと突合できないので
         * お客様情報連携は諦めるが、登録そのものは成功として扱う
         */
        console.error(
          "[api/calendar/create-record] Aki番号を取得できないため、お客様情報連携を行いません",
          { calAppId, recordId },
        );
      }

      const patch = buildConstructionFillPatch({
        resolvedCustomer,
        resolvedHousing,
        resolvedImportKey,
        importKeyValue: uniqueKey ?? "",
        resolvedTNumber,
        // T番号 はまだ無い。空で上書きしないよう空文字を渡す
        tNumberValue: "",
        customerName,
        housingRaw,
        resolvedHandlerField,
        handlerValue: handlerValueToPut,
        fids,
        ...patchExtras,
      });

      await writePocketRecordWithImportKey({
        appId: calAppId,
        recordId,
        payload: patch,
        importKeyFieldId: resolvedImportKey,
        readAuth,
        writeAuth,
        allowMissingImportKey: true,
      });

      // 新規登録（ベストエフォート。登録は確定済み）
      await recordAuditLog({
        lineUserId: auth.lineUserId,
        operation: "create",
        targetAppId: calAppId,
        targetRecordId: recordId,
        targetTNumber: uniqueKey ?? "",
        changes: computeAuditChanges(null, patch, {
          labelOf: (fieldId) =>
            fieldCaptionByUniqueId(constructionFields, fieldId),
        }),
      });
    }

    return finalizeConstructionCalendarSave({
      calAppId,
      constructionRecordId: recordId,
      // 新規なので工事側に T番号 は無い。突合は Aki番号 で行う
      constructionImportKey: uniqueKey,
      customerName,
      housingStatus: housingRaw,
      constructionFields,
      calendarAuth: writeAuth,
      lineUserId: auth.lineUserId,
      viewYear: body.viewYear,
      viewMonth: body.viewMonth,
      savedVerb: "登録",
    });
  } catch (e) {
    console.error("[api/calendar/create-record]", e);
    const rawDetail = e instanceof Error ? e.message : String(e);
    const detail = formatConstructionCreateRecordError(rawDetail);
    if (constructionSaved) {
      return NextResponse.json(
        {
          error: `${detail}（工事アプリへの登録は完了しています）`,
          constructionSaved: true,
        },
        { status: 502 },
      );
    }
    return NextResponse.json(
      {
        error:
          detail.includes("@pocket:")
            ? detail
            : "レコードの登録に失敗しました。APIキーの登録権限や@pocketの必須項目を確認してください。",
      },
      { status: 502 },
    );
  }
}
