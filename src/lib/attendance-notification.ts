import "server-only";

import { extractDisplayHHmm } from "@/lib/attendance-calendar-types";
import {
  googleChatAttendanceWebhookConfigured,
  sendGoogleChatAttendanceMessage,
} from "@/lib/google-chat";

/**
 * 出勤打刻の Google Chat 通知（タスクW）。
 *
 * 契約速報（タスクR）と同じ作りにしてある。
 *  - 本文の組み立ては純粋関数
 *  - 送信は google-chat.ts（Webhook URL をログにも例外にも出さない・5秒で打ち切る）
 *  - 失敗しても業務処理（打刻）は成功のままにし、warning を画面へ返す
 *
 * 送るのは**出勤のみ**。退勤では送らない。
 * 出勤打刻は「本日はすでに出勤打刻済みです」で 409 になるため、
 * 打刻が成立した瞬間だけ呼ばれ、重複通知は起きない。
 */

/** 送信に失敗したときに画面へ出す文言 */
export const ATTENDANCE_NOTIFICATION_FAILURE_WARNING =
  "出勤通知の送信に失敗しました。";

export type AttendanceClockInNotification = {
  /** スタッフ名簿から解決した氏名。クライアントの値は使わない */
  staffName: string;
  /** @pocket へ書き込んだ出勤時刻（形式は列の型による） */
  clockIn: string;
  /** スタッフ名簿の部署。無ければ行ごと省く */
  department?: string;
};

/** @pocket の「未入力」表現（"-"）は通知に出さない */
function plain(raw: string | null | undefined): string {
  const t = (raw ?? "").trim();
  return t === "-" ? "" : t;
}

/**
 * 出勤通知の本文。
 *
 *   🕘 出勤
 *   氏名：西村直也
 *   部署：DX事業部
 *   時刻：09:15
 *
 * 値が空の行は**行ごと省く**（契約速報は行を残すが、こちらは3行しかなく
 * 空行が目立つため）。時刻は列の型に関わらず HH:mm へ揃える。
 */
export function buildAttendanceClockInMessage(
  input: AttendanceClockInNotification,
): string {
  const lines = ["🕘 出勤"];

  const staffName = plain(input.staffName);
  if (staffName) lines.push(`氏名：${staffName}`);

  const department = plain(input.department);
  if (department) lines.push(`部署：${department}`);

  // "2026/08/21 09:15:30" も "09:15" も HH:mm に揃える
  const clockIn = extractDisplayHHmm(plain(input.clockIn));
  if (clockIn) lines.push(`時刻：${clockIn}`);

  return lines.join("\n");
}

export type AttendanceNotifyOutcome =
  | { kind: "sent" }
  | { kind: "skipped"; reason: "not-configured" | "no-staff-name" }
  | { kind: "failed"; warning: string };

/**
 * 出勤打刻を通知する。
 *
 * @pocket への打刻が成功したあとに呼ぶこと。例外は投げない。
 */
export async function notifyAttendanceClockIn(
  input: AttendanceClockInNotification,
): Promise<AttendanceNotifyOutcome> {
  try {
    // 氏名が無いと誰の出勤か分からない。送らずに黙って諦める
    if (!plain(input.staffName)) {
      return { kind: "skipped", reason: "no-staff-name" };
    }

    // 環境変数が未設定なら送信をスキップし、エラーにしない
    if (!googleChatAttendanceWebhookConfigured()) {
      return { kind: "skipped", reason: "not-configured" };
    }

    const result = await sendGoogleChatAttendanceMessage(
      buildAttendanceClockInMessage(input),
    );
    if (result.kind === "sent") return { kind: "sent" };
    if (result.kind === "skipped") {
      return { kind: "skipped", reason: "not-configured" };
    }

    // 出してよいのはエラーの種類と HTTP ステータスまで。
    // Webhook URL と個人情報（氏名・部署）は出さない
    console.error(
      "[attendance-notification] 出勤通知の送信に失敗",
      JSON.stringify({ reason: result.reason, status: result.status }),
    );
    return { kind: "failed", warning: ATTENDANCE_NOTIFICATION_FAILURE_WARNING };
  } catch (e) {
    // ここで投げると打刻が済んでいるのにエラー応答になる。
    // 例外メッセージには個人情報が載りうるので種別だけ出す
    console.error(
      "[attendance-notification] 出勤通知で想定外の例外",
      JSON.stringify({ name: e instanceof Error ? e.name : "unknown" }),
    );
    return { kind: "failed", warning: ATTENDANCE_NOTIFICATION_FAILURE_WARNING };
  }
}
