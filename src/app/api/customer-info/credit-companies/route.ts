import { NextResponse } from "next/server";

import { fetchTradingPartnerCreditCompanyOptions } from "@/lib/trading-partner-manufacturers";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  try {
    const options = await fetchTradingPartnerCreditCompanyOptions();
    if (options === null) {
      return NextResponse.json({ options: [], configured: false });
    }
    return NextResponse.json({ options: options ?? [], configured: true });
  } catch (e) {
    console.error("[api/customer-info/credit-companies]", e);
    return NextResponse.json(
      { error: "信販会社一覧の取得に失敗しました", options: [], configured: false },
      { status: 502 },
    );
  }
}

