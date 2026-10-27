import "server-only";

import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";
import { leaveRegistrationWindow } from "@/lib/leave-register-server";
import { fetchLeaveMonth } from "@/lib/leave-server";
import { resolveBoundStaffNameForLineUser } from "@/lib/staff-bound-lookup";

/**
 * 登録画面に出す「登録できる期間」と「本人の登録済みの日」（休暇・段階5）。
 *
 * 期間は登録 API と同じ leaveRegistrationWindow で決める（画面とサーバで
 * ずれないように、画面では計算しない）。
 *
 * 休みは段階1の fetchLeaveMonth（年月ごとの全員共通キャッシュ）から取る。
 * 2週間が月をまたぐと2か月分を引くが、どちらも全員で共有するキャッシュなので、
 * 開く人が増えても @pocket への問い合わせは増えない。
 * キャッシュは最大5分古い。古くて登録済みの日を選べても、登録 API が
 * その場で読み直して飛ばすので二重にはならない。
 */

export type RegisteredLeavesResult =
  | {
      ok: true;
      window: { start: string; end: string };
      /** 本人の、期間内の登録済みの日（昇順）。leavesStatus が error のときは null */
      registered: string[] | null;
      leavesStatus: "disabled" | "ok" | "error";
    }
  | { ok: false; status: number; error: string };

function monthsBetween(start: string, end: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const ymd of [start, end]) {
    const [y, m] = ymd.split("-").map(Number);
    if (!out.some(([oy, om]) => oy === y && om === m)) out.push([y!, m!]);
  }
  return out;
}

export async function getRegisteredLeavesForLineUser(
  lineUserId: string,
  now: Date = new Date(),
): Promise<RegisteredLeavesResult> {
  const staffName = await resolveBoundStaffNameForLineUser(lineUserId);
  if (!staffName) {
    return { ok: false, status: 403, error: "担当者の紐付けが必要です" };
  }

  const window = leaveRegistrationWindow(now);
  const results = await Promise.all(
    monthsBetween(window.start, window.end).map(([y, m]) => fetchLeaveMonth(y, m)),
  );

  if (results.some((r) => r.status === "disabled")) {
    return { ok: true, window, registered: [], leavesStatus: "disabled" };
  }
  if (results.some((r) => r.status === "error")) {
    return { ok: true, window, registered: null, leavesStatus: "error" };
  }

  const me = normApClStaffName(staffName);
  const dates = new Set<string>();
  for (const r of results) {
    if (r.status !== "ok") continue;
    for (const e of r.entries) {
      if (e.date < window.start || e.date > window.end) continue;
      if (me && normApClStaffName(e.staffName) === me) dates.add(e.date);
    }
  }
  return { ok: true, window, registered: [...dates].sort(), leavesStatus: "ok" };
}
