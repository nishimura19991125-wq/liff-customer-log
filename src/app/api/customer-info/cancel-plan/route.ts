import { NextResponse } from "next/server";

import { todayJstDayKey } from "@/lib/customer-cancel-plan";
import type { CustomerCancelPlan } from "@/lib/customer-cancel-plan";
import { resolveCancelPlanWithHolidays } from "@/lib/customer-cancel-server";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";

export const dynamic = "force-dynamic";

/**
 * キャンセル確認画面に出す「実行される内容」を返す（タスクV-6）。
 *
 * レコードは一切変更しない。祝日は外部APIを使うためサーバでしか引けず、
 * 画面が自前で数えるとサーバの判断とズレる（「空き枠を作ります」と出したのに
 * 作らない）。**判断はサーバに一本化**し、画面はその結果だけを表示する。
 */
export async function GET(request: Request) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  const url = new URL(request.url);
  const constructionDate = (
    url.searchParams.get("constructionDate") ?? ""
  ).trim();
  const contractor = (url.searchParams.get("contractor") ?? "").trim();

  try {
    const plan = await resolveCancelPlanWithHolidays({
      todayDayKey: todayJstDayKey(),
      constructionDate,
      contractor,
    });
    return NextResponse.json({ ok: true, plan });
  } catch (e) {
    console.error("[api/customer-info/cancel-plan]", e);
    // 判断できないときは「空き枠を作らない」側の内容で確認させる。
    // 実際の保存でもサーバが同じ関数で判断し直す
    const fallback: CustomerCancelPlan = {
      createsEmptySlot: false,
      emptySlotDayKey: "",
      emptySlotContractor: "",
      skipReason: "no-date",
      businessDays: 0,
      holidaysDegraded: true,
    };
    return NextResponse.json({ ok: true, plan: fallback });
  }
}
