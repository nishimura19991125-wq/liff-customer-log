"use client";


/**
 * 商談進捗の更新を送る（PATCH）。
 *
 * 商談予定とアポ情報一覧の両方から呼ぶ。エラーの拾い方を画面ごとに書くと、
 * 片方だけ「通信に失敗しました」が出ない、といったずれが起きる。
 *
 * ⚠ 何を送るかは呼び出し側が決める（planMeetingScheduleCardSave の patch）。
 *    ここは運ぶだけで、業務の判断は持たない。
 */
export type MeetingSchedulePatchResult = {
  ok: boolean;
  error?: string;
  body?: { estimateStatus?: string };
};

export async function patchMeetingSchedule(
  path: string,
  idToken: string,
  body: unknown,
): Promise<MeetingSchedulePatchResult> {
  try {
    const res = await fetch(path, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${idToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const raw = await res.text();
    let parsed: { error?: string; estimateStatus?: string } = {};
    try {
      parsed = raw.trim() ? (JSON.parse(raw) as typeof parsed) : {};
    } catch {
      parsed = {};
    }
    if (!res.ok) return { ok: false, error: parsed.error };
    return { ok: true, body: parsed };
  } catch {
    return { ok: false, error: "通信に失敗しました。電波状況をご確認ください" };
  }
}

/** 商談ステータスと付随項目の更新先 */
export function meetingScheduleStatusPath(recordId: string): string {
  return `/api/meeting-schedule/records/${encodeURIComponent(recordId)}/status`;
}

