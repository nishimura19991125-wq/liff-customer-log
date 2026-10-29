import { NextResponse } from "next/server";

import { recordAuditLog } from "@/lib/audit-log";
import { computeAuditChanges } from "@/lib/audit-log-changes";
import { fieldCaptionByUniqueId } from "@/lib/customer-info-record";
import { writeConstructionHandlerToCustomerInfo } from "@/lib/customer-info-construction-handler";
import { listConstructionRecordsByTNumber } from "@/lib/customer-info-construction-link";
import { invalidateCustomerCrmListCache } from "@/lib/customer-crm-list";
import { invalidateAllCalendarPayloadCache } from "@/lib/calendar-response-cache";
import { calendarConstructionHandlerFieldIdFromEnv } from "@/lib/calendar-construction-handler-env";
import { formatConstructionCreateRecordError } from "@/lib/calendar-construction-create-error";
import {
  readConstructionTNumberFromRecord,
  uniqueFieldsCsv,
} from "@/lib/calendar-construction-pocket-common";
import {
  resolveConfiguredFieldToSchemaUniqueId,
  resolveConstructionImportKeyFieldId,
  resolveConstructionTNumberFieldId,
} from "@/lib/calendar-kojo";
import {
  apiKeyForCalendarPocket1,
  apiKeyForCalendarWrite,
  fetchAppFields,
  isPocketHttpRateLimitError,
  updateRecord,
} from "@/lib/atpocket";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";
import {
  constructionHandlerStaffConfigReady,
  resolveConstructionHandlerNameForActiveStaff,
} from "@/lib/staff-construction-handler-candidates";

/**
 * 【残工】カードからの工事対応者の変更。
 *
 * 普通のカードの update-construction-handler と同じ確認・同じ部品・同じ順番
 * （お客様情報アプリ → 工事登録アプリ）で書く。違いは工事登録アプリの
 * レコードの探し方だけ。【残工】カードはレコードIDを持たないので T番号 で探す。
 *   - 見つからない: お客様情報だけ書いて成功（工事登録アプリに書くものが無い）
 *   - 複数ある:     全部に同じ値を書く（同じ T番号 は同じ案件）
 *
 * 探すのは書く前。探せなかった（429 など）のに書き始めると、
 * お客様情報だけが新しい値になり、工事登録アプリとずれるため。
 */

export const dynamic = "force-dynamic";

type Body = {
  tNumber?: string;
  constructionHandlerStaffRecordId?: string;
};

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

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const tNumber = body.tNumber?.trim() ?? "";
  const constructionHandlerStaffRecordId =
    body.constructionHandlerStaffRecordId?.trim() ?? "";

  if (!tNumber) {
    return NextResponse.json({ error: "T番号 が必要です" }, { status: 400 });
  }
  if (!constructionHandlerStaffRecordId) {
    return NextResponse.json(
      { error: "工事対応者を選択してください" },
      { status: 400 },
    );
  }

  const handlerFieldEnv = calendarConstructionHandlerFieldIdFromEnv();
  if (!handlerFieldEnv) {
    return NextResponse.json(
      {
        error:
          "工事対応者フィールドが未設定です。CALENDAR_EMPTY_FILL_CONSTRUCTION_HANDLER_FIELD_ID を設定してください。",
      },
      { status: 503 },
    );
  }

  if (!constructionHandlerStaffConfigReady()) {
    return NextResponse.json(
      {
        error:
          "工事対応者はスタッフ名簿と連携する必要があります。STAFF_APP_ID・STAFF_NAME_FIELD_ID・STAFF_CONSTRUCTION_AVAILABILITY_FIELD_ID を設定してください。",
      },
      { status: 503 },
    );
  }

  try {
    const readAuth = { apiKey: apiKeyForCalendarPocket1() };
    const constructionFields = await fetchAppFields(calAppId, readAuth);
    const resolvedHandlerField = resolveConfiguredFieldToSchemaUniqueId(
      handlerFieldEnv,
      constructionFields,
    );
    if (!resolvedHandlerField) {
      return NextResponse.json(
        {
          error: `工事対応者フィールド「${handlerFieldEnv}」が工事アプリのフィールド定義と一致しません。`,
        },
        { status: 503 },
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

    const resolvedName = await resolveConstructionHandlerNameForActiveStaff(
      constructionHandlerStaffRecordId,
    );
    if (!resolvedName.ok) {
      const msg =
        resolvedName.reason === "not_found"
          ? "選択した社員が見つかりません。"
          : resolvedName.reason === "not_active"
            ? "選択した社員は工事対応が「稼働」ではありません。一覧を更新して選び直してください。"
            : resolvedName.reason === "no_name"
              ? "スタッフ名簿に氏名が入っていません。"
              : "工事対応者を検証できませんでした。";
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    /** 取込キー（Aki番号）。更新の PUT に同送する */
    const resolvedImportKey =
      resolveConstructionImportKeyFieldId(constructionFields);

    // 書く前に探す（@pocket の呼び出しは絞り込み1回）
    const listed = await listConstructionRecordsByTNumber({
      calAppId,
      tNumberFieldId: resolvedTNumber,
      tNumber,
      fieldsCsv: uniqueFieldsCsv(
        resolvedHandlerField,
        resolvedTNumber,
        resolvedImportKey ?? undefined,
      ),
    });
    if (listed.kind === "error") {
      return NextResponse.json(
        {
          error:
            "工事登録アプリのレコードを探せなかったため、変更を中止しました。時間をおいてもう一度お試しください。",
        },
        { status: 502 },
      );
    }
    const targets = listed.matched;

    // ① お客様情報アプリ（普通のカードと同じ部品・同じ順番）
    const customerInfoWrite = await writeConstructionHandlerToCustomerInfo({
      tNumber,
      handlerName: resolvedName.name,
      lineUserId: auth.lineUserId,
    });
    if (customerInfoWrite.kind === "failed") {
      return NextResponse.json(
        {
          error:
            formatConstructionCreateRecordError(customerInfoWrite.error) ||
            "お客様情報の工事対応者を更新できませんでした。施工カレンダーも更新していません。",
        },
        { status: 502 },
      );
    }

    if (targets.length === 0) {
      if (customerInfoWrite.kind === "skipped") {
        // どちらにも書いていない。成功にはしない
        return NextResponse.json(
          {
            error:
              "お客様情報・工事登録アプリのどちらにも、この T番号 の案件が見つかりませんでした。",
          },
          { status: 404 },
        );
      }
      // 工事登録アプリに書くものが無い。お客様情報だけで整合する
      console.warn(
        `[api/calendar/update-zanko-construction-handler] 工事登録アプリに T番号「${tNumber}」のレコードが無いため、お客様情報だけ書きました（工事登録アプリには書いていません）`,
      );
    }

    // ② 工事登録アプリ。同じ T番号 のレコードすべてに同じ値を書く
    const writeAuth = { apiKey: apiKeyForCalendarWrite() };
    const failedRecordIds: string[] = [];
    let rateLimitError: unknown = null;
    for (const target of targets) {
      const existingAki = resolvedImportKey
        ? readConstructionTNumberFromRecord(target.record, resolvedImportKey)
        : null;
      const handlerPatch: Record<string, unknown> = {
        [resolvedTNumber]:
          readConstructionTNumberFromRecord(target.record, resolvedTNumber) ??
          tNumber,
        [resolvedHandlerField]: resolvedName.name,
        ...(resolvedImportKey && existingAki
          ? { [resolvedImportKey]: existingAki }
          : {}),
      };
      try {
        await updateRecord(calAppId, target.recordId, handlerPatch, writeAuth);
      } catch (calendarErr) {
        console.error(
          `[api/calendar/update-zanko-construction-handler] お客様情報は更新済みだが工事登録アプリ（recordId=${target.recordId}）の更新に失敗`,
          calendarErr,
        );
        failedRecordIds.push(target.recordId);
        if (isPocketHttpRateLimitError(calendarErr)) rateLimitError = calendarErr;
        continue;
      }

      // ベストエフォート。更新は確定済み
      await recordAuditLog({
        lineUserId: auth.lineUserId,
        operation: "update",
        targetAppId: calAppId,
        targetRecordId: target.recordId,
        targetTNumber: tNumber,
        changes: computeAuditChanges(target.record, handlerPatch, {
          labelOf: (fieldId) =>
            fieldCaptionByUniqueId(constructionFields, fieldId),
        }),
      });
    }

    /**
     * 普通のカードと同じく、元データのキャッシュを捨てる。
     * 【残工】カードの工事対応者はお客様情報の全件キャッシュから読むので、
     * そちらも捨てる（捨てないと最大10分古い名前が出る）
     */
    invalidateAllCalendarPayloadCache();
    invalidateCustomerCrmListCache();

    if (failedRecordIds.length > 0) {
      return NextResponse.json(
        {
          error: rateLimitError
            ? "お客様情報には反映されましたが、@pocket のリクエスト上限に達したため施工カレンダーの一部を更新できませんでした。100秒ほど待ってからもう一度保存してください。"
            : `お客様情報には反映されましたが、施工カレンダーの更新に失敗しました（${targets.length}件中${failedRecordIds.length}件）。`,
          customerInfoUpdated: true,
        },
        { status: 502 },
      );
    }

    const customerInfoWarning =
      customerInfoWrite.kind === "skipped"
        ? customerInfoWrite.warning
        : undefined;

    return NextResponse.json({
      ok: true,
      tNumber,
      constructionHandlerName: resolvedName.name,
      constructionRecordsUpdated: targets.length,
      ...(customerInfoWarning ? { warning: customerInfoWarning } : {}),
    });
  } catch (e) {
    console.error("[api/calendar/update-zanko-construction-handler]", e);
    if (isPocketHttpRateLimitError(e)) {
      return NextResponse.json(
        {
          error:
            "いま @pocket のリクエスト上限に達しています。100秒ほど待ってからもう一度保存してください。",
          rateLimited: true,
        },
        { status: 429, headers: { "Retry-After": "100" } },
      );
    }
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        error:
          formatConstructionCreateRecordError(msg) ||
          "工事対応者の更新に失敗しました",
      },
      { status: 502 },
    );
  }
}
