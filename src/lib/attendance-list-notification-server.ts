import "server-only";

/**
 * タスクY: 勤怠の定時リストを Google Chat へ送る。
 *
 * 9:32 に出勤者、19:55 に未退勤者を流す。呼び出し元は Netlify の
 * Scheduled Functions（本番）と調査用ルート（手動確認）の2つ。
 *
 * ── 設計の前提 ────────────────────────────────────────────
 * - 定時実行には結果を返す相手がいない。失敗しても例外は投げず、
 *   console に残して終わる。リトライもしない（翌日また実行される）
 * - @pocket への取得は1回の実行につき1回。勤怠日で絞り込むので、
 *   レコードが年 7,000 件のペースで増えても1ページで収まる
 * - Webhook URL はログにもレスポンスにも出さない
 */

import { getTodayAttendanceRoster } from "@/lib/attendance-server";
import {
  buildAttendanceClockInListMessage,
  buildMissingClockOutListMessage,
} from "@/lib/attendance-list-notification";
import {
  googleChatAttendanceListWebhookConfigured,
  sendGoogleChatAttendanceListMessage,
} from "@/lib/google-chat";
import { listStaffDepartmentsInRosterOrder } from "@/lib/staff-department-lookup";

export type AttendanceListNotifyMode = "clock-in" | "missing-clock-out";

export type AttendanceListNotifyOutcome = {
  mode: AttendanceListNotifyMode;
  /** 実際に Google Chat へ送ったか */
  sent: boolean;
  /** 送らなかった理由。送った場合は undefined */
  skipped?:
    | "not-configured"
    | "no-attendees"
    | "rate-limited"
    | "fetch-failed"
    | "send-failed"
    | "dry-run";
  /** 出勤打刻があった人数 */
  attendeeCount: number;
  /** 本文に載せた人数 */
  listedCount: number;
  /**
   * 組み立てた本文。
   *
   * 氏名が入るため、**返すのは調査用ルートだけ**（`includeText`）。
   * 定時実行の経路では持ち回らない。
   */
  text?: string;
};

export type AttendanceListNotifyOptions = {
  /** 送らずに本文だけ組み立てる（調査用ルートの既定） */
  dryRun?: boolean;
  /** 結果に本文を含める（調査用ルートのみ） */
  includeText?: boolean;
};

/**
 * 部署の並び順（名簿の登録順）。
 *
 * 引けなくても通知は出す。並びが出勤者に現れた順になるだけで、
 * 誰かが欠けることはない。
 */
async function departmentOrderOrEmpty(): Promise<string[]> {
  try {
    return await listStaffDepartmentsInRosterOrder();
  } catch {
    return [];
  }
}

export async function runAttendanceListNotification(
  mode: AttendanceListNotifyMode,
  options?: AttendanceListNotifyOptions,
): Promise<AttendanceListNotifyOutcome> {
  const base = { mode, sent: false, attendeeCount: 0, listedCount: 0 };

  if (!googleChatAttendanceListWebhookConfigured() && !options?.dryRun) {
    // 未設定は異常ではない。環境変数が用意される前でも落とさない
    return { ...base, skipped: "not-configured" };
  }

  // 定時に流す一覧なので、直前の打刻まで反映させる（取得は1回のまま）
  const roster = await getTodayAttendanceRoster({ bypassCache: true });
  if (!roster.ok) {
    console.error(
      "[attendance-list] 勤怠の取得に失敗しました",
      JSON.stringify({ mode, reason: roster.reason }),
    );
    return {
      ...base,
      skipped: roster.reason === "rate-limited" ? "rate-limited" : "fetch-failed",
    };
  }

  const departmentOrder = await departmentOrderOrEmpty();
  const attendeeCount = roster.attendees.length;

  const people =
    mode === "clock-in"
      ? roster.attendees
      : roster.attendees.filter((a) => !a.clockOut);

  const text =
    mode === "clock-in"
      ? buildAttendanceClockInListMessage({
          workDate: roster.workDate,
          people,
          departmentOrder,
        })
      : buildMissingClockOutListMessage({
          workDate: roster.workDate,
          people,
          departmentOrder,
          attendeeCount,
        });

  const result = {
    ...base,
    attendeeCount,
    listedCount: people.length,
    ...(options?.includeText && text ? { text } : {}),
  };

  if (!text) return { ...result, skipped: "no-attendees" };
  if (options?.dryRun) return { ...result, skipped: "dry-run" };

  const outcome = await sendGoogleChatAttendanceListMessage(text);
  if (outcome.kind === "sent") return { ...result, sent: true };

  if (outcome.kind === "skipped") {
    return { ...result, skipped: "not-configured" };
  }

  // 出してよいのは失敗の種別と HTTP ステータスまで。URL も氏名も出さない
  console.error(
    "[attendance-list] Google Chat への送信に失敗しました",
    JSON.stringify({ mode, reason: outcome.reason, status: outcome.status }),
  );
  return { ...result, skipped: "send-failed" };
}
