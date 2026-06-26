import { NextResponse } from "next/server";

import { fetchTradingPartnerConstructionShopOptions } from "@/lib/trading-partner-manufacturers";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";

export const dynamic = "force-dynamic";

/** お客様情報入力：施工業者（取引先会社一覧・施工店・取引中） */
export async function GET(request: Request) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  try {
    const options = await fetchTradingPartnerConstructionShopOptions();
    if (options === null) {
      return NextResponse.json({ options: [], configured: false });
    }
    return NextResponse.json({ options: options ?? [], configured: true });
  } catch (e) {
    console.error("[api/customer-info/construction-contractors]", e);
    return NextResponse.json(
      {
        error: "施工業者一覧の取得に失敗しました",
        options: [],
        configured: false,
      },
      { status: 502 },
    );
  }
}
