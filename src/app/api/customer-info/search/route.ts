import { NextResponse } from "next/server";

import { pocketErrorResponse } from "@/lib/api-error-response";

import { customerInfoConfigReady } from "@/lib/customer-info-config";
import { searchCustomerInfoRecordsByName } from "@/lib/customer-info-search";
import { consumeRateLimit } from "@/lib/simple-rate-limit";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";

export const dynamic = "force-dynamic";

/** 1文字検索は全件走査を誘発するため 2 文字以上を必須にする */
const SEARCH_MIN_LENGTH = 2;
const SEARCH_MAX_LENGTH = 64;
/** 同一ユーザーからの検索頻度（メモリベース。インスタンス分散の注意あり） */
const SEARCH_RATE_WINDOW_MS = 10_000;
const SEARCH_RATE_MAX = 5;

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

  // 1文字検索は @pocket の全件ページング（最大15ページ×1000件）を毎回発火させるため禁止。
  // サロゲートペアを1文字として数える。
  const qLength = Array.from(q).length;
  if (qLength < SEARCH_MIN_LENGTH) {
    return NextResponse.json(
      { error: `お客様名は${SEARCH_MIN_LENGTH}文字以上で検索してください` },
      { status: 400 },
    );
  }
  if (qLength > SEARCH_MAX_LENGTH) {
    return NextResponse.json(
      { error: `検索語は${SEARCH_MAX_LENGTH}文字以内にしてください` },
      { status: 400 },
    );
  }

  if (
    !consumeRateLimit(`customer-info-search:${auth.lineUserId}`, {
      windowMs: SEARCH_RATE_WINDOW_MS,
      max: SEARCH_RATE_MAX,
    })
  ) {
    return NextResponse.json(
      { error: "検索が続けて行われています。少し待ってから再度お試しください。" },
      { status: 429 },
    );
  }

  try {
    const results = await searchCustomerInfoRecordsByName(q);
    return NextResponse.json({ results });
  } catch (e) {
    return pocketErrorResponse(e, {
      scope: "api/customer-info/search",
      message: "検索に失敗しました",
    });
  }
}
