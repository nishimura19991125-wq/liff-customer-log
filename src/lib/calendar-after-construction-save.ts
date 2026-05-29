import "server-only";

import { NextResponse } from "next/server";

import type { AtPocketFetchAuth, AtPocketFieldRow } from "@/lib/atpocket";
import { buildCalendarPatchAfterConstructionSave } from "@/lib/calendar-record-patch-server";
import { syncConstructionRecordToCustomerInfoApp } from "@/lib/sync-construction-to-customer-info";

/** 工事空枠更新・工事日未定新規のいずれも同じ後処理（お客様情報連携→カレンダーパッチ） */
export async function finalizeConstructionCalendarSave(opts: {
  calAppId: string;
  constructionRecordId: string | null;
  /** 工事レコードの T番号（recordId が取れないときのお客様情報連携用） */
  constructionUniqueKey?: string | null;
  customerName: string;
  constructionFields: AtPocketFieldRow[];
  calendarAuth: AtPocketFetchAuth;
  lineUserId?: string;
  viewYear?: number;
  viewMonth?: number;
  /** エラー文言用: 「登録」|「更新」 */
  savedVerb?: "登録" | "更新";
}): Promise<NextResponse> {
  const savedVerb = opts.savedVerb ?? "更新";
  const recordId = opts.constructionRecordId?.trim() || null;
  const uniqueKey = opts.constructionUniqueKey?.trim() || null;

  if (!recordId && !uniqueKey) {
    return NextResponse.json(
      {
        error:
          savedVerb === "登録"
            ? "工事レコードは登録されましたが、レコード ID を取得できませんでした。お客様情報アプリへの連携は行えません。しばらくしてからカレンダーを更新し、登録された案件を確認してください。"
            : "工事レコードは更新されましたが、レコード ID を取得できませんでした。お客様情報アプリへの連携は行えません。",
        constructionSaved: true,
      },
      { status: 502 },
    );
  }

  const customerSync = await syncConstructionRecordToCustomerInfoApp({
    calAppId: opts.calAppId,
    constructionRecordId: recordId ?? undefined,
    constructionUniqueKey: uniqueKey ?? undefined,
    customerName: opts.customerName,
    constructionFields: opts.constructionFields,
    calendarAuth: opts.calendarAuth,
    lineUserId: opts.lineUserId,
  });

  if (customerSync.kind === "failed") {
    return NextResponse.json(
      {
        error: `${customerSync.error}（工事アプリへの${savedVerb}は完了しています）`,
        constructionSaved: true,
      },
      { status: 502 },
    );
  }

  const calendarPatch = recordId
    ? await buildCalendarPatchAfterConstructionSave(
        opts.calAppId,
        recordId,
        opts.calendarAuth,
        opts.viewYear,
        opts.viewMonth,
      )
    : null;

  return NextResponse.json({
    ok: true,
    customerInfoSynced: customerSync.kind === "synced",
    ...(recordId ? { recordId } : {}),
    ...(calendarPatch ? { calendarPatch } : {}),
  });
}
