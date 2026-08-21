import { NextResponse } from "next/server";

/**
 * 【一時的な調査用ルート】タスクY: 定時リストの手動確認。
 *
 * 9:32 / 19:55 を待たずに、実際のデータで本文を確認するためのものです。
 * **運用に乗ったら削除し、PROBE_ENABLED を外してください。**
 *
 * フォルダ名が `%5Fprobe` なのは Next.js の仕様によるものです。
 * `_` 始まりのフォルダは private folder としてルーティングから除外されるため、
 * URL に `_` を出すには `%5F` を使います。
 * 実際のパスは /api/_probe/attendance-list-notify になります。
 *
 * ── 呼び出し方 ────────────────────────────────────────────
 *   POST /api/_probe/attendance-list-notify
 *   { "mode": "clock-in" }                    本文を組み立てるだけ（送らない）
 *   { "mode": "missing-clock-out" }           同上
 *   { "mode": "clock-in", "send": true }      実際に Google Chat へ送る
 *
 * ── 安全策 ────────────────────────────────────────────────
 *   - ATTENDANCE_SCHEDULE_PROBE_ENABLED=1 のときだけ動作。未設定なら 404
 *     （存在しないルートと区別が付かないよう、認証より前に判定する）
 *   - LINE 認証必須（401）。スタッフ名簿への紐付け必須（403）
 *   - **既定は送信しない。** send:true を明示したときだけ送る
 *   - Webhook URL は返さない。設定の有無も返さない
 *
 * ⚠ 応答の text には出勤者の氏名が入ります。貼り付けて共有するときは
 *   中身を確認してください。
 */

import {
  runAttendanceListNotification,
  type AttendanceListNotifyMode,
} from "@/lib/attendance-list-notification-server";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";
import { resolveBoundStaffNameForLineUser } from "@/lib/staff-bound-lookup";

export const dynamic = "force-dynamic";

function parseMode(raw: unknown): AttendanceListNotifyMode | null {
  if (raw === "clock-in" || raw === "missing-clock-out") return raw;
  return null;
}

export async function POST(request: Request) {
  // 無効時は存在しないルートと同じ見え方にする。認証より前に判定する。
  // 既存の調査ルートの PROBE_ENABLED とは別の変数にして、
  // 片方を開けたらもう片方も開く、という事故を避ける
  if (process.env.ATTENDANCE_SCHEDULE_PROBE_ENABLED?.trim() !== "1") {
    return NextResponse.json({ error: "Not Found" }, { status: 404 });
  }

  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  const boundStaffName = await resolveBoundStaffNameForLineUser(
    auth.lineUserId,
  );
  if (!boundStaffName) {
    return NextResponse.json(
      { error: "スタッフ名簿への紐付けが必要です", needsStaffBind: true },
      { status: 403 },
    );
  }

  let body: { mode?: unknown; send?: unknown };
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

  const send = body.send === true;
  const outcome = await runAttendanceListNotification(mode, {
    dryRun: !send,
    includeText: true,
  });

  return NextResponse.json({
    mode: outcome.mode,
    dryRun: !send,
    sent: outcome.sent,
    skipped: outcome.skipped ?? null,
    attendeeCount: outcome.attendeeCount,
    listedCount: outcome.listedCount,
    // 本文そのもの。null なら「送らない」と判定されたということ
    text: outcome.text ?? null,
    note: "一時的な確認用ルートです。運用に乗ったら削除し、ATTENDANCE_SCHEDULE_PROBE_ENABLED を外してください",
  });
}
