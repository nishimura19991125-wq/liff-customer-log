import "server-only";

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

/**
 * @pocket 由来の例外をクライアント向け応答に変換する共通ハンドラ。
 *
 * formatPocketHttpError（atpocket.ts）が作るメッセージには
 * appsId・operation・**どの環境変数のキーを使ったか** が含まれる。
 * これがそのまま返ると社内ツールの内部構造が外へ出るため、
 * クライアントには固定文言＋相関IDだけを返し、生メッセージはサーバログに残す。
 *
 * 業務上の意味を持つ文言（権限・入力検証・暗証番号など）はこのハンドラを通さず、
 * 各ルートでこれまでどおり返すこと。
 */

/** 生メッセージをクライアントへ含めてよいか（本番は既定で false） */
function includeDetail(): boolean {
  const flag = process.env.API_ERROR_DETAIL?.trim();
  if (flag === "1" || flag === "true") return true;
  if (flag === "0" || flag === "false") return false;
  return process.env.NODE_ENV !== "production";
}

export function isPocketRateLimitMessage(message: string): boolean {
  return message.includes("429") || message.includes("Too Many Request");
}

const RATE_LIMITED_MESSAGE =
  "データ取得の利用上限に達しました。1〜2分待ってから再度お試しください。";

export type PocketErrorResponseOptions = {
  /** ログの出所（例: "api/customers"） */
  scope: string;
  /** 通常時にクライアントへ返す文言 */
  message: string;
  /** 通常時の HTTP ステータス（既定 502） */
  status?: number;
  /** 429 のときに文言を上書きしたい場合 */
  rateLimitedMessage?: string;
  /** 応答 JSON に足したいフィールド（例: { customers: [] }） */
  extra?: Record<string, unknown>;
};

/**
 * 例外を安全な JSON 応答に変換する。
 * 429 は既存挙動どおり status 429 と専用文言で返す。
 */
export function pocketErrorResponse(
  error: unknown,
  options: PocketErrorResponseOptions,
): NextResponse {
  const raw = error instanceof Error ? error.message : String(error);
  const correlationId = randomUUID().slice(0, 8);
  const rateLimited = isPocketRateLimitMessage(raw);

  console.error(
    `[${options.scope}] correlationId=${correlationId} rateLimited=${rateLimited}: ${raw}`,
    error,
  );

  const body: Record<string, unknown> = {
    ...(options.extra ?? {}),
    error: rateLimited
      ? (options.rateLimitedMessage ?? RATE_LIMITED_MESSAGE)
      : options.message,
    correlationId,
    ...(includeDetail() ? { detail: raw } : {}),
  };

  const status = rateLimited ? 429 : (options.status ?? 502);
  const init = rateLimited
    ? { status, headers: { "Retry-After": "120" } }
    : { status };

  return NextResponse.json(body, init);
}
