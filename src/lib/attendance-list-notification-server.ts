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
import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";
import { listStaffDepartmentsInRosterOrder } from "@/lib/staff-department-lookup";
import {
  lookupStaffAssignmentByStaffName,
  resolveStaffAssignmentLookupConfig,
} from "@/lib/staff-workplace-lookup";

/**
 * 退勤打刻もれ（19:55）に載せる人の所属会社。
 *
 * スタッフ名簿の「所属会社」がこの値の人だけを載せる。
 * 出勤者リスト（9:32）と打刻画面の「本日の出勤者」は絞らない。
 *
 * ⚠ **会社名が変わったら、この定数を直してデプロイすること。**
 *    環境変数ではないので、Netlify の設定を変えても反映されない。
 *    直す場所はここ1箇所だけ（比較は isMissingClockOutTargetCompany）。
 *    名簿側の表記が先に変わると、全員が対象外になり
 *    「全員が退勤打刻済みです」が流れ続ける。
 */
export const MISSING_CLOCK_OUT_TARGET_COMPANY = "株式会社トラーチ";

/**
 * 名簿の所属会社が対象会社か。
 *
 * NFKC → 連続空白を半角1つ → trim → 完全一致。氏名の突き合わせと同じ
 * normApClStaffName をそのまま使う（正規化を別に作らない）。
 */
function isMissingClockOutTargetCompany(company: string | null): boolean {
  const normalized = normApClStaffName(company ?? undefined);
  return (
    normalized !== "" &&
    normalized === normApClStaffName(MISSING_CLOCK_OUT_TARGET_COMPANY)
  );
}

/**
 * 未退勤の人を対象会社の人だけに絞る。
 *
 * 名簿は部署の付与と同じキャッシュを共有するので、@pocket への取得は
 * 増えない。
 *
 * ■ 名簿から会社が引けなかった人は載せない
 * 名簿の登録漏れの人が毎日出続けるのを防ぐため。ただし黙って消すと
 * 漏れに気づけないので、**件数だけ**残す（氏名は出さない）。
 *
 * ■ 未退勤の**全員**が引けなかったときは null（＝送らない）
 * 名簿そのものが引けていない疑いが強い。そのまま絞ると0人になり、
 * 未退勤者がいるのに「全員が退勤打刻済みです」が流れてしまう。
 * 一部の人だけ引けないのは個別の登録漏れなので、その人を外して送る。
 */
async function keepTargetCompanyOnly<T extends { staffName: string }>(
  people: T[],
): Promise<T[] | null> {
  if (people.length === 0) return people;

  let companies: Array<string | null>;
  /** 名簿の照会そのものが失敗したときの例外の種別 */
  let lookupErrorName: string | null = null;
  try {
    const cfg = await resolveStaffAssignmentLookupConfig();
    if (!cfg) throw new Error("not-configured");
    companies = await Promise.all(
      people.map(
        async (p) =>
          (await lookupStaffAssignmentByStaffName(p.staffName, cfg)).company,
      ),
    );
  } catch (e) {
    // 例外の中身には名簿の値が載りうる。種別だけ控える
    lookupErrorName = e instanceof Error ? e.name : "unknown";
    companies = people.map(() => null);
  }

  const unresolvedCount = companies.filter(
    (c) => !normApClStaffName(c ?? undefined),
  ).length;
  if (unresolvedCount === people.length) {
    console.error(
      "[attendance-list] 名簿から所属会社を引けませんでした（未退勤の全員が引けないため送りません）",
      JSON.stringify({
        unresolvedCount,
        lookupFailed: lookupErrorName !== null,
        ...(lookupErrorName ? { name: lookupErrorName } : {}),
      }),
    );
    return null;
  }
  if (unresolvedCount > 0) {
    console.warn(
      "[attendance-list] 名簿から所属会社を引けなかった人を対象外にしました",
      JSON.stringify({ unresolvedCount }),
    );
  }

  return people.filter((_, i) => isMissingClockOutTargetCompany(companies[i]));
}

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
    /** 未退勤者がいるのに、全員の所属会社を名簿から引けなかった */
    | "company-unresolved"
    | "dry-run";
  /** 出勤打刻があった人数 */
  attendeeCount: number;
  /** 本文に載せた人数（未退勤リストは対象会社で絞った後の人数） */
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

  // 所属会社で絞るのは未退勤リストだけ。出勤者リストは全員を載せる。
  // attendeeCount（全社の出勤者数）は絞らない。0 なら送らない挙動を保つ
  const people =
    mode === "clock-in"
      ? roster.attendees
      : await keepTargetCompanyOnly(
          roster.attendees.filter((a) => !a.clockOut),
        );

  // 誰が対象か判断できない。「全員が退勤打刻済みです」と流さず、送らない
  // （理由と件数は keepTargetCompanyOnly が残している）
  if (people === null) {
    return { ...base, attendeeCount, skipped: "company-unresolved" };
  }

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
