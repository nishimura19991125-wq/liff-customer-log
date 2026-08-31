import "server-only";

import {
  googleChatNewCaseWebhookConfigured,
  sendGoogleChatNewCaseMessage,
} from "@/lib/google-chat";
import { buildNewCaseNotificationText } from "@/lib/new-case-notification";
import { resolveBoundStaffNameForLineUser } from "@/lib/staff-bound-lookup";

/**
 * 新規案件通知のサーバ側の段取り。
 *
 * ■ 送る条件
 *   工事カレンダーの**新規登録**で T番号 が新規発行されたときだけ。
 *   施工予定日の有無は問わない（どちらの経路でも送る）。
 *
 * ■ 送らない操作
 *   空き枠入力・未定案件の割り当て・工事日の移動・お客様情報からの保存。
 *   いずれも T番号 を新規発行しないため、呼び出し自体を行わない
 *   （finalizeConstructionCalendarSave は notifyNewCase を渡された経路だけ送る）。
 *
 * 本文の組み立ては純粋関数（new-case-notification.ts）、送信は
 * google-chat.ts に分けてあり、ここは「読む・判定する・呼ぶ」だけを持つ。
 */

export type NewCaseNotificationOutcome =
  | { kind: "sent" }
  | {
      kind: "skipped";
      reason: "no-t-number" | "not-configured" | "send-skipped";
    }
  | { kind: "failed" };

/**
 * 案件作成者（操作した人）の担当者名を名簿から引く。
 *
 * 引けなくても通知は止めない。名前欄が空になるだけで、T番号 と
 * お客様名は伝わる。通知が飛ばない方が困る。
 */
async function resolveCreatorName(
  lineUserId: string | undefined,
): Promise<string> {
  const want = lineUserId?.trim() ?? "";
  if (!want) return "";
  try {
    return (await resolveBoundStaffNameForLineUser(want)) ?? "";
  } catch (e) {
    // 名簿には氏名・メールが載る。種別だけ出す
    console.warn(
      "[new-case-notification] 名簿を引けず案件作成者を空で送ります",
      e instanceof Error ? e.name : "unknown",
    );
    return "";
  }
}

/**
 * 新規案件を Google Chat へ知らせる。
 *
 * @pocket への登録が成功したあとに呼ぶこと。登録に失敗したのに通知が飛ぶ
 * 事態を避けるため、呼び出し順は登録処理のあとに固定する。
 * 例外は投げない。失敗しても登録は成功のままにする（画面には出さない）。
 */
export async function notifyNewCaseCreated(input: {
  /** お客様情報アプリが採番した T番号。空なら送らない */
  tNumber: string | null | undefined;
  customerName: string;
  /** 操作した人の LINE userId（`auth.lineUserId`） */
  lineUserId?: string;
}): Promise<NewCaseNotificationOutcome> {
  try {
    return await runNewCaseNotification(input);
  } catch (e) {
    // ここで投げると、登録が済んでいるのに応答がエラーになる。
    // 例外メッセージにはレコードの中身が載りうるので種別だけ出す
    console.error(
      "[new-case-notification] 新規案件通知の処理で想定外の例外",
      JSON.stringify({
        tNumber: input.tNumber ?? "",
        name: e instanceof Error ? e.name : "unknown",
      }),
    );
    return { kind: "failed" };
  }
}

async function runNewCaseNotification(input: {
  tNumber: string | null | undefined;
  customerName: string;
  lineUserId?: string;
}): Promise<NewCaseNotificationOutcome> {
  /**
   * T番号 が読めなかったときは送らない。
   *
   * 通知の主役が空の本文を流しても受け取り側が案件を特定できない。
   * 採番自体は済んでいる可能性があるので、記録だけ残す。
   */
  const tNumber = input.tNumber?.trim() ?? "";
  if (!tNumber) return { kind: "skipped", reason: "no-t-number" };

  // 環境変数が未設定なら送信をスキップし、エラーにしない
  if (!googleChatNewCaseWebhookConfigured()) {
    return { kind: "skipped", reason: "not-configured" };
  }

  const text = buildNewCaseNotificationText({
    tNumber,
    customerName: input.customerName,
    creatorName: await resolveCreatorName(input.lineUserId),
  });

  const result = await sendGoogleChatNewCaseMessage(text);
  if (result.kind === "sent") return { kind: "sent" };
  if (result.kind === "skipped") {
    return { kind: "skipped", reason: "send-skipped" };
  }

  // 出してよいのは T番号・エラーの種類・HTTP ステータスまで。
  // Webhook URL とお客様名・担当者名は出さない
  console.error(
    "[new-case-notification] 新規案件通知の送信に失敗",
    JSON.stringify({
      tNumber,
      reason: result.reason,
      status: result.status,
    }),
  );
  return { kind: "failed" };
}
