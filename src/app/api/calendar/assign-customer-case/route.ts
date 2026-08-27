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
import {
  buildConstructionFillPatch,
  readConstructionTNumberFromRecord,
  uniqueFieldsCsv,
} from "@/lib/calendar-construction-pocket-common";
import { formatConstructionCreateRecordError } from "@/lib/calendar-construction-create-error";
import { invalidateCalendarConstructionRecordsCache } from "@/lib/calendar-construction-records-cache";
import {
  constructionTitleFieldIsEmpty,
  pickRecordValueByFieldAliases,
  resolveConfiguredFieldToSchemaUniqueId,
  resolveConstructionFieldIds,
  resolveConstructionImportKeyFieldId,
  resolveConstructionTNumberFieldId,
  resolveEmptyFillHousingStatusFieldId,
} from "@/lib/calendar-kojo";
import { optionalCalendarYmd } from "@/lib/calendar-optional-ymd";
import { invalidateAllCalendarPayloadCache } from "@/lib/calendar-response-cache";
import {
  calendarSlotConflictResponse,
  readFreshConstructionEmptySlotState,
} from "@/lib/calendar-slot-reservation";
import { isCustomerTNumberCancelled } from "@/lib/customer-cancelled-t-numbers";
import { getCachedCustomerCrmSnapshot } from "@/lib/customer-crm-list";
import {
  findConstructionRecordByTNumber,
  linkCustomerInfoToConstruction,
} from "@/lib/customer-info-construction-link";
import { fieldCaptionByUniqueId } from "@/lib/customer-info-record";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";
import {
  constructionHandlerStaffConfigReady,
  resolveConstructionHandlerNameForActiveStaff,
} from "@/lib/staff-construction-handler-candidates";

export const dynamic = "force-dynamic";
export const maxDuration = 26;

/**
 * お客様情報の案件を工事カレンダーへ載せる（第3段階 3-2）。
 *
 * ⚠ **3-2 の時点ではどの画面からも呼ばれない。** 配線は 3-3 で行う。
 *
 * 未定案件の抽出元が工事登録アプリからお客様情報アプリへ移るのに伴い、
 * 「お客様情報のレコードを起点に工事レコードを用意する」入口が要る。
 * 既存の assign-case-to-slot / schedule-undated-case は工事レコードの
 * ID を起点にしており、この起点では使えない。
 *
 * ■ 3つの経路（この順に決まる）
 *   1. T番号 の工事レコードが既にある → **そこ**に施工予定日・施工会社を書く
 *      空き枠は使わない（残す）
 *   2. 無い＋空き枠あり → **空き枠のレコード**に書いて案件に変える
 *      Aki番号 は空き枠のものを引き継ぎ、T番号 はお客様情報のものを書く
 *   3. 無い＋空き枠なし → 工事登録アプリに新規作成（Aki番号 が採番される）
 *
 * ■ 1 を必ず先に判定する理由（案A）
 * 既存レコードがあるのに空き枠へ書くと、同じ T番号 の工事レコードが2件になる。
 * そうなると findConstructionRecordByTNumber が「複数一致」で error を返し、
 * その顧客はもう自動照合できない。カレンダー表示・キャンセル処理・
 * お客様情報との突合まで巻き込むので、この判定は省略できない。
 *
 * ■ 削除しない
 * **deleteRecord を呼ばない。** 空き枠を使う場合もレコードを案件に変えるだけで、
 * 枠は消さない。物理削除は assign-case-to-slot だけの仕事のまま。
 *
 * ■ 書き戻し
 * finalizeConstructionCalendarSave → sync-construction-to-customer-info が
 * Aki番号・施工予定日・初回施工予定日・施工業者をお客様情報へ書く。
 * あちらは自前で updateRecord を呼ぶので、/customer-info の編集不可
 * （customer-info-construction-locked-fields）は通らない。
 */

type Body = {
  /** お客様情報のレコードID。T番号 はここからサーバ側で引く */
  customerInfoRecordId?: string;
  /** 施工予定日 YYYY-MM-DD */
  scheduledStartDate?: string;
  contractor?: string;
  /** 使う空き枠。省略・空なら空き枠を使わない */
  slotRecordId?: string;
  constructionHandlerStaffRecordId?: string;
  /** 後方互換（工事登録者API名） */
  constructionRegistrantStaffRecordId?: string;
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

const LINK_FAILED_STATUS = 502;

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

  const customerInfoRecordId = body.customerInfoRecordId?.trim() ?? "";
  const scheduledStartDate = optionalCalendarYmd(body.scheduledStartDate);
  const contractor = body.contractor?.trim() ?? "";
  const slotRecordId = body.slotRecordId?.trim() ?? "";
  const handlerStaffRecordId =
    body.constructionHandlerStaffRecordId?.trim() ||
    body.constructionRegistrantStaffRecordId?.trim() ||
    "";

  if (!customerInfoRecordId || !scheduledStartDate) {
    return NextResponse.json(
      {
        error:
          "customerInfoRecordId と scheduledStartDate（YYYY-MM-DD）は必須です",
      },
      { status: 400 },
    );
  }
  // 施工会社は空き枠との照合に使う。schedule-undated-case と同じく必須
  if (!contractor) {
    return NextResponse.json(
      { error: "施工会社を選択してください" },
      { status: 400 },
    );
  }

  const readAuth = { apiKey: apiKeyForCalendarPocket1() };
  const writeAuth = { apiKey: apiKeyForCalendarWrite() };

  /** 空き枠へ書き込み済みか。ここから先の失敗は「保存済み」で返す */
  let constructionWritten = false;

  try {
    /**
     * お客様情報は 3-1 の共有スナップショットから読む。
     * 単票 GET も列定義の取得もしないので、@pocket の呼び出しは 0 回
     * （キャッシュが空なら全件走査1回。3-3 の一覧と同じキャッシュを使う）。
     */
    const snapshot = await getCachedCustomerCrmSnapshot();
    const customer = snapshot.items.find(
      (item) => item.recordId === customerInfoRecordId,
    );
    if (!customer) {
      return NextResponse.json(
        {
          error:
            "お客様情報のレコードが見つかりません。一覧を更新してから選び直してください。",
        },
        { status: 404 },
      );
    }

    const tNumber = customer.tNumber.trim();
    if (!tNumber) {
      /**
       * T番号 が無いと工事レコードと突合できない。
       * このまま空き枠へ書くと、連携が既存のお客様情報を引き当てられず
       * **同じ顧客のレコードをもう1件作ってしまう**。必ずここで止める
       */
      return NextResponse.json(
        {
          error:
            "この案件にはT番号が採番されていません。お客様情報でT番号を確認してから割り当ててください。",
        },
        { status: 400 },
      );
    }

    const customerName = customer.customerName.trim();
    if (!customerName) {
      return NextResponse.json(
        { error: "お客様情報のお客様名を取得できませんでした" },
        { status: 400 },
      );
    }

    // キャンセル済みは載せない。スナップショットと専用キャッシュの両方で見る
    if (customer.isCancelled || (await isCustomerTNumberCancelled(tNumber))) {
      return NextResponse.json(
        {
          error:
            "顧客ステータスが「キャンセル」の案件は割り当てできません。別の案件を選んでください。",
        },
        { status: 400 },
      );
    }

    /** お客様情報の住宅ステータス（3-1 でスナップショットに載せた列） */
    const housingStatus = customer.housingStatus.trim();

    const constructionFields = await fetchAppFields(calAppId, readAuth, {
      operation: "calendar:お客様情報起点の割り当てfields",
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
    if (!resolvedTNumber) {
      return NextResponse.json(
        {
          error:
            "T番号フィールドの uniqueId が分かりません。CALENDAR_EMPTY_FILL_TNUMBER_FIELD_ID を .env に設定するか、アプリに「T番号」見出しのフィールドを用意してください。",
        },
        { status: 500 },
      );
    }

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

    const resolvedHousing =
      resolveEmptyFillHousingStatusFieldId(constructionFields) ||
      fids.housingStatus?.trim() ||
      "";
    if (!resolvedHousing) {
      return NextResponse.json(
        {
          error:
            "住宅ステータスフィールドが見つかりません。工事アプリに「住宅ステータス」列があるか、CALENDAR_EMPTY_FILL_HOUSING_STATUS_FIELD_ID を設定してください。",
        },
        { status: 500 },
      );
    }

    /**
     * 工事対応者。**扱いは fill-empty-slot に揃える**。
     * 環境変数が設定されているときだけ必須にし、未設定なら書かない。
     */
    const handlerFieldEnv = calendarConstructionHandlerFieldIdFromEnv();
    let resolvedHandlerField: string | undefined;
    let handlerValueToPut: string | undefined;

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
      resolvedHandlerField = resolved;
      if (!handlerStaffRecordId) {
        return NextResponse.json(
          { error: "工事対応者を選択してください" },
          { status: 400 },
        );
      }
      const resolvedName =
        await resolveConstructionHandlerNameForActiveStaff(
          handlerStaffRecordId,
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

    /**
     * 既存の工事レコードへ書く／無ければ作る経路。
     * customer-info-construction-link.ts をそのまま使う（第2段階で用意し、
     * fac1774 で保存経路からは切り離したもの）。あちらが T番号 で
     * 既存を探し、あれば更新・無ければ作成まで面倒を見る。
     *
     * ⚠ CUSTOMER_INFO_CONSTRUCTION_LINK_ON_SAVE は**立てない**。
     *    あれは「お客様情報の保存時に連携する」ためのフラグで、
     *    立てると保存経路まで復活してしまう。ここは工事カレンダーからの
     *    明示操作なので、関数を直接呼ぶ
     */
    const linkAndFinalize = async () => {
      const linked = await linkCustomerInfoToConstruction({
        tNumber,
        customerName,
        housingStatus,
        constructionDate: scheduledStartDate,
        contractor,
        constructionHandler: handlerValueToPut ?? "",
        lineUserId: auth.lineUserId,
      });

      if (linked.kind === "failed") {
        // 探せなかった・書けなかった。工事レコードは作っていない
        return NextResponse.json(
          { error: linked.warning },
          { status: LINK_FAILED_STATUS },
        );
      }
      if (linked.kind === "skipped") {
        console.error(
          "[api/calendar/assign-customer-case] 連携が skipped で返りました",
          JSON.stringify({ reason: linked.reason }),
        );
        return NextResponse.json(
          {
            error:
              "工事カレンダーへの登録に必要な設定が足りません。DX事業部へ連絡してください。",
          },
          { status: 500 },
        );
      }

      invalidateCalendarConstructionRecordsCache();
      invalidateAllCalendarPayloadCache();

      return finalizeConstructionCalendarSave({
        calAppId,
        constructionRecordId: linked.recordId || null,
        constructionUniqueKey: tNumber,
        constructionImportKey:
          linked.kind === "created" ? linked.akiNumber : undefined,
        customerName,
        housingStatus: housingStatus || undefined,
        constructionFields,
        calendarAuth: writeAuth,
        lineUserId: auth.lineUserId,
        viewYear: body.viewYear,
        viewMonth: body.viewMonth,
        savedVerb: linked.kind === "created" ? "登録" : "更新",
        extraResponse: {
          assignedTo: linked.kind === "created" ? "new" : "existing",
          slotUsed: false,
          slotDeleted: false,
        },
      });
    };

    // 空き枠を使わない指定なら、そのまま既存更新／新規作成へ
    if (!slotRecordId) return linkAndFinalize();

    /**
     * ここから空き枠を使う経路。**先に既存の工事レコードを探す（案A）。**
     * 既にあるのに空き枠へ書くと同じ T番号 が2件になる
     */
    const lookupCsv = uniqueFieldsCsv(
      resolvedTNumber,
      resolvedImportKey,
      resolvedCustomer,
      resolvedHousing,
      fids.startDate,
      fids.contractor,
      resolvedHandlerField,
    );
    const existing = await findConstructionRecordByTNumber({
      calAppId,
      tNumberFieldId: resolvedTNumber,
      tNumber,
      fieldsCsv: lookupCsv,
    });
    if (existing.kind === "error") {
      // 「見つからなかった」と「探せなかった」を取り違えない。何も書かない
      return NextResponse.json(
        {
          error:
            "工事レコードの照合に失敗したため、割り当てを中止しました。時間をおいて再度お試しください。",
        },
        { status: LINK_FAILED_STATUS },
      );
    }
    if (existing.kind === "found") {
      // 既存があるので空き枠は使わない（残す）。既存レコードへ書く
      return linkAndFinalize();
    }

    /** 空き枠のレコードを案件に変える。削除はしない */
    const slotFieldsCsv = uniqueFieldsCsv(
      resolvedCustomer,
      resolvedHousing,
      resolvedTNumber,
      resolvedImportKey,
      fids.startDate,
      fids.contractor,
      resolvedHandlerField,
    );
    let slotRow = await fetchRecordById(
      calAppId,
      slotRecordId,
      readAuth,
      slotFieldsCsv,
    );
    if (!slotRow?.record) {
      slotRow = await fetchRecordById(calAppId, slotRecordId, readAuth);
    }
    if (!slotRow?.record || typeof slotRow.record !== "object") {
      return NextResponse.json(
        { error: "空き枠レコードが見つかりません" },
        { status: 404 },
      );
    }

    const slotRec = slotRow.record as Record<string, unknown>;
    if (!constructionTitleFieldIsEmpty(slotRec, resolvedCustomer)) {
      const { status, body: conflictBody } = calendarSlotConflictResponse();
      return NextResponse.json(conflictBody, { status });
    }

    /** 空き枠が持っている Aki番号。これを**引き継ぐ**（採番し直さない） */
    const slotAki =
      readConstructionTNumberFromRecord(slotRec, resolvedImportKey) ?? "";
    const slotContractor = fids.contractor?.trim()
      ? coercePlainString(
          pickRecordValueByFieldAliases(slotRec, fids.contractor),
        )
      : "";

    const patch = buildConstructionFillPatch({
      resolvedCustomer,
      resolvedHousing,
      resolvedImportKey,
      // 空き枠の Aki番号 をそのまま載せる
      importKeyValue: slotAki,
      resolvedTNumber,
      // T番号 はお客様情報のもの。これが無いと連携が既存を引き当てられない
      tNumberValue: tNumber,
      customerName,
      housingRaw: housingStatus,
      resolvedHandlerField,
      handlerValue: handlerValueToPut,
      fids,
      scheduledStartDate,
      // 枠そのものの施工会社を正とする（無ければ画面の入力）
      contractor: slotContractor || contractor,
    });
    /**
     * お客様情報に住宅ステータスが無いときは列ごと載せない。
     * 空文字で送ると工事アプリ側の値を消してしまう
     * （連携＝linkCustomerInfoToConstruction も同じく空は載せない）
     */
    if (!housingStatus) delete patch[resolvedHousing];

    // 書き込み直前にもう一度、まだ空き枠かを見る（fill-empty-slot と同じ）
    const fresh = await readFreshConstructionEmptySlotState(
      calAppId,
      slotRecordId,
      readAuth,
      resolvedCustomer,
    );
    if (!fresh.ok) {
      return NextResponse.json(
        { error: "空き枠レコードが見つかりません" },
        { status: 404 },
      );
    }
    if (!fresh.isEmpty) {
      const { status, body: conflictBody } = calendarSlotConflictResponse();
      return NextResponse.json(conflictBody, { status });
    }

    await writePocketRecordWithImportKey({
      appId: calAppId,
      recordId: slotRecordId,
      payload: patch,
      importKeyFieldId: resolvedImportKey,
      allowMissingImportKey: true,
      existingRecord: slotRec,
      readAuth,
      writeAuth,
    });
    constructionWritten = true;

    /**
     * 監査ログはベストエフォート。**削除を伴わないので、記録できなくても
     * 書き込みを取り消さない。** assign-case-to-slot が削除ログの失敗で
     * 中止するのは物理削除だからで、ここは元の値が差分として残る
     */
    await recordAuditLog({
      lineUserId: auth.lineUserId,
      operation: "update",
      targetAppId: calAppId,
      targetRecordId: slotRecordId,
      targetTNumber: tNumber,
      changes: computeAuditChanges(slotRec, patch, {
        labelOf: (fieldId) =>
          fieldCaptionByUniqueId(constructionFields, fieldId),
      }),
    });

    invalidateCalendarConstructionRecordsCache();
    invalidateAllCalendarPayloadCache();

    return finalizeConstructionCalendarSave({
      calAppId,
      constructionRecordId: slotRecordId,
      constructionUniqueKey: tNumber,
      constructionImportKey: slotAki,
      customerName,
      housingStatus: housingStatus || undefined,
      constructionFields,
      calendarAuth: writeAuth,
      lineUserId: auth.lineUserId,
      viewYear: body.viewYear,
      viewMonth: body.viewMonth,
      savedVerb: "更新",
      extraResponse: {
        assignedTo: "slot",
        slotUsed: true,
        slotRecordId,
        // 空き枠は案件に変わっただけ。消していない
        slotDeleted: false,
      },
    });
  } catch (e) {
    console.error("[api/calendar/assign-customer-case]", e);
    const detail = formatConstructionCreateRecordError(
      e instanceof Error ? e.message : String(e),
    );
    if (constructionWritten) {
      return NextResponse.json(
        {
          error: `${detail}（工事アプリへの更新は完了しています）`,
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
            : "工事カレンダーへの割り当てに失敗しました。しばらくしてから再度お試しください。",
      },
      { status: 502 },
    );
  }
}
