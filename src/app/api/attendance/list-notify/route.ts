import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

/**
 * タスクY: 勤怠の定時リスト送信（Netlify Scheduled Functions からの呼び出し口）。
 *
 * ── 認証について ──────────────────────────────────────────
 * 呼び出し元は利用者ではないので LINE 認証は通らない。
 * `resolveCallerLineAuth` は**使わない**（既存の 401 と
 * LINE_SESSION_EXPIRED の挙動には一切触れない）。
 *
 * 代わりに共有秘密で守る。秘密は Netlify の環境変数で
 * Scheduled Function 側にも同じ値を入れておく。
 * 一致しないときは **404** を返す。401 だとルートの存在が判ってしまい、
 * 総当たりの的になるため。
 */

import {
  runAttendanceListNotification,
  type AttendanceListNotifyMode,
} from "@/lib/attendance-list-notification-server";

export const dynamic = "force-dynamic";

const SECRET_HEADER = "x-attendance-list-secret";

/** 長さの違いも比較時間に出さないよう、両方を固定長へ潰してから比べる */
function secretMatches(provided: string, expected: string): boolean {
  if (!expected) return false;
  const enc = new TextEncoder();
  const a = Buffer.from(enc.encode(provided));
  const b = Buffer.from(enc.encode(expected));
  if (a.length !== b.length) {
    // 長さが違っても比較は行い、早期 return による時間差を作らない
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

function notFound() {
  return NextResponse.json({ error: "Not Found" }, { status: 404 });
}

function parseMode(raw: unknown): AttendanceListNotifyMode | null {
  if (raw === "clock-in" || raw === "missing-clock-out") return raw;
  return null;
}

export async function POST(request: Request) {
  const expected = process.env.ATTENDANCE_LIST_NOTIFY_SECRET?.trim() ?? "";
  // 秘密が未設定ならこのルートは存在しないものとして扱う
  if (!expected) return notFound();

  const provided = request.headers.get(SECRET_HEADER)?.trim() ?? "";
  if (!secretMatches(provided, expected)) return notFound();

  let body: { mode?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const mode = parseMode(body.mode);
  if (!mode) {
    return NextResponse.json(
      { error: "mode は clock-in か missing-clock-out" },
      { status: 400 },
    );
  }

  try {
    const outcome = await runAttendanceListNotification(mode);
    // 氏名は返さない。呼び出し元は Netlify のログに残るだけの機械
    return NextResponse.json({
      mode: outcome.mode,
      sent: outcome.sent,
      skipped: outcome.skipped ?? null,
      attendeeCount: outcome.attendeeCount,
      listedCount: outcome.listedCount,
    });
  } catch (e) {
    // 例外で 500 を返しても呼び出し元は何もできない。事実だけ残す
    console.error(
      "[attendance-list] 定時送信で想定外の例外",
      JSON.stringify({ mode, name: e instanceof Error ? e.name : "unknown" }),
    );
    return NextResponse.json({ error: "送信に失敗しました" }, { status: 500 });
  }
}
