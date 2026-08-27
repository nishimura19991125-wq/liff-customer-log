import { NextResponse } from "next/server";

import type { UndatedConstructionCasesPayload } from "@/lib/calendar-api-types";
import { getCachedCustomerCrmSnapshot } from "@/lib/customer-crm-list";
import { customerInfoConfigReady } from "@/lib/customer-info-config";
import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";
import { buildUndatedCustomerCases } from "@/lib/customer-undated-cases";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";
import { resolveBoundStaffNameForLineUser } from "@/lib/staff-bound-lookup";

export const dynamic = "force-dynamic";

/**
 * 工事日未定の案件一覧（第3段階 3-3 で抽出元を変更）。
 *
 *   旧: 工事登録アプリの全件から「お客様名あり・日付が全部空」を拾う
 *   新: お客様情報アプリから「施工予定日が空・キャンセル以外・T番号あり」
 *
 * 第1段階（b7f4169）で施工予定日が未定の新規登録を工事登録アプリに
 * 作らなくなったため、旧の拾い方ではその案件が一覧に出てこなかった。
 *
 * ■ @pocket の呼び出しが減る
 * 旧はこの1リクエストで3系統の全件走査を起こしていた。
 *   工事アプリ全件 ＋ キャンセルT番号（お客様情報全件）
 *   ＋ 担当顧客一覧（お客様情報全件）＋ 工事アプリの fields
 * 新は 3-1 の共有スナップショット1系統だけ。顧客ステータスは
 * スナップショットに載っているのでキャンセル用の走査が要らず、
 * 工事アプリはそもそも読まない。
 */
export async function GET(request: Request) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  const customerCfg = customerInfoConfigReady();
  if (!customerCfg.ok) {
    const payload: UndatedConstructionCasesPayload = {
      configured: false,
      disabled: true,
      items: [],
      myItems: [],
      error: customerCfg.error,
    };
    return NextResponse.json(payload, { status: 503 });
  }

  try {
    const boundStaffName = await resolveBoundStaffNameForLineUser(
      auth.lineUserId,
    );
    const staffName = normApClStaffName(boundStaffName ?? "");

    const snapshot = await getCachedCustomerCrmSnapshot();
    const { items, myItems } = buildUndatedCustomerCases(snapshot, staffName);

    const payload: UndatedConstructionCasesPayload = {
      configured: true,
      staffName,
      items,
      myItems,
      ...(staffName ? {} : { needsStaffBind: true }),
    };
    return NextResponse.json(payload);
  } catch (e) {
    console.error("[api/calendar/undated-construction-cases]", e);
    const msg =
      e instanceof Error ? e.message : "工事日未定案件の取得に失敗しました";
    const isRateLimited =
      msg.includes("429") || msg.includes("Too Many Request");
    return NextResponse.json(
      {
        configured: true,
        items: [],
        myItems: [],
        error: isRateLimited
          ? "データ取得の利用上限に達しました。1〜2分待ってから再度お試しください。"
          : msg,
      } satisfies UndatedConstructionCasesPayload,
      { status: isRateLimited ? 429 : 502 },
    );
  }
}
