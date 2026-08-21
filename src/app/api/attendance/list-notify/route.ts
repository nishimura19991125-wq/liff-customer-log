import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

/**
 * タスクY: 勤怠の定時リスト送信（定時実行からの呼び出し口）。
 *
 * ── 認証について ──────────────────────────────────────────
 * 呼び出し元は利用者ではないので LINE 認証は通らない。
 * `resolveCallerLineAuth` は**使わない**（既存の 401 と
 * LINE_SESSION_EXPIRED の挙動には一切触れない）。
 *
 * 代わりに Bearer トークン（ATTENDANCE_SCHEDULE_TOKEN）で守る。
 * 一致しないときも、未設定のときも **404** を返す。
 * 401 だとルートの存在が判ってしまい総当たりの的になるし、
 * 設定漏れで誰でも叩ける状態になるのが最も避けたい事故のため。
 * トークンはログにもレスポンスにも出さない。
 *
 * ── 呼び出し元を選ばない形にしてある ──────────────────────
 * GET でも POST でも動き、mode はクエリでも本文でも受ける。
 * cron サービスによっては POST や本文を送れないものがあるため、
 * 特定のサービスに依存しないようにしている。
 *
 *   GET  /api/attendance/list-notify?mode=clock-in
 *   POST /api/attendance/list-notify   {"mode":"missing-clock-out"}
 *   いずれも Authorization: Bearer <ATTENDANCE_SCHEDULE_TOKEN>
 */

import {
  runAttendanceListNotification,
  type AttendanceListNotifyMode,
} from "@/lib/attendance-list-notification-server";

export const dynamic = "force-dynamic";

function notFound() {
  return NextResponse.json({ error: "Not Found" }, { status: 404 });
}

/** `Authorization: Bearer xxx` から xxx を取り出す（無ければ空文字） */
function bearerToken(request: Request): string {
  const raw = request.headers.get("authorization")?.trim() ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(raw);
  return m ? m[1].trim() : "";
}

/**
 * 定数時間で突き合わせる。
 *
 * 長さが違う場合も比較そのものは行い、早期 return による時間差を作らない。
 */
function tokenMatches(provided: string, expected: string): boolean {
  if (!expected) return false;
  const enc = new TextEncoder();
  const a = Buffer.from(enc.encode(provided));
  const b = Buffer.from(enc.encode(expected));
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

function parseMode(raw: unknown): AttendanceListNotifyMode | null {
  if (raw === "clock-in" || raw === "missing-clock-out") return raw;
  return null;
}

async function handle(request: Request) {
  const expected = process.env.ATTENDANCE_SCHEDULE_TOKEN?.trim() ?? "";
  // トークンが未設定ならこのルートは存在しないものとして扱う。
  // 設定漏れのまま誰でも叩ける状態にはしない
  if (!expected) return notFound();
  if (!tokenMatches(bearerToken(request), expected)) return notFound();

  const fromQuery = new URL(request.url).searchParams.get("mode");
  let fromBody: unknown = null;
  if (request.method === "POST") {
    try {
      const body = (await request.json()) as { mode?: unknown };
      fromBody = body?.mode ?? null;
    } catch {
      // 本文が無い・壊れているのは許す。mode はクエリでも受け取れる
    }
  }

  const mode = parseMode(fromBody) ?? parseMode(fromQuery);
  if (!mode) {
    return NextResponse.json(
      { error: "mode は clock-in か missing-clock-out" },
      { status: 400 },
    );
  }

  try {
    const outcome = await runAttendanceListNotification(mode);
    // 氏名もトークンも返さない。呼び出し元のログに残るだけの応答
    return NextResponse.json({
      mode: outcome.mode,
      sent: outcome.sent,
      skipped: outcome.skipped ?? null,
      attendeeCount: outcome.attendeeCount,
      listedCount: outcome.listedCount,
    });
  } catch (e) {
    // 例外の中身は出さない。呼び出し元に伝わるのは事実だけでよい
    console.error(
      "[attendance-list] 定時送信で想定外の例外",
      JSON.stringify({ mode, name: e instanceof Error ? e.name : "unknown" }),
    );
    return NextResponse.json({ error: "送信に失敗しました" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
