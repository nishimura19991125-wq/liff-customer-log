import { NextResponse } from "next/server";

import { customerInfoConfigReady } from "@/lib/customer-info-config";
import { searchCustomerInfoRecordsByName } from "@/lib/customer-info-search";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  const cfg = customerInfoConfigReady();
  if (!cfg.ok) {
    return NextResponse.json(
      { error: cfg.error, disabled: true },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  if (!q) {
    return NextResponse.json(
      { error: "検索するお客様名を入力してください（クエリ q）" },
      { status: 400 },
    );
  }
  if (q.length < 1) {
    return NextResponse.json({ results: [] });
  }

  try {
    const results = await searchCustomerInfoRecordsByName(q);
    return NextResponse.json({ results });
  } catch (e) {
    console.error("[api/customer-info/search]", e);
    const msg = e instanceof Error ? e.message : "検索に失敗しました";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
