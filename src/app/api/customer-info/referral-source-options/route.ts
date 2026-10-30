import { NextResponse } from "next/server";

import { fetchTradingPartnerClubMemberOptions } from "@/lib/trading-partner-manufacturers";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";

export const dynamic = "force-dynamic";

/**
 * お客様情報入力：紹介元の選択肢
 * （取引先会社一覧・トラーチ倶楽部加盟店・取引中）。
 *
 * 取得できなくても画面は紹介元をテキスト入力に戻すだけで、保存は止めない。
 */
export async function GET(request: Request) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  try {
    const options = await fetchTradingPartnerClubMemberOptions();
    if (options === null) {
      return NextResponse.json({ options: [], configured: false });
    }
    return NextResponse.json({ options: options ?? [], configured: true });
  } catch (e) {
    console.error("[api/customer-info/referral-source-options]", e);
    return NextResponse.json(
      {
        error: "紹介元の選択肢の取得に失敗しました",
        options: [],
        configured: false,
      },
      { status: 502 },
    );
  }
}
