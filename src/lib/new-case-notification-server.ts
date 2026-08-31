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
 *   いずれも T番号 を新規発行しないため、呼び出し側が enabled:false を渡す。
 *
 * 本文の組み立ては純粋関数（new-case-notification.ts）、送信は
 * google-chat.ts に分けてあり、ここは「読む・判定する・呼ぶ」だけを持つ。
 *
 * ── 判断を必ず1行残す ──────────────────────────────────────
 * 実装直後に「通知が届かない」が起きたが、送らないと決めた分岐が
 * どれも無言だったため、環境変数・T番号・呼び出し側フラグのどれで
 * 止まったのかlog から切り分けられなかった。
 *
 * **送っても送らなくても必ず1行残す。** 判断できない状態を作らない。
 * 出してよいのは T番号・段階・真偽値・HTTP ステータスまで。
 * Webhook URL・お客様名・担当者名は出さない。
 */

/** Netlify のログで絞り込むための固定の目印 */
const LOG_TAG = "[new-case-notification]";

export type NewCaseNotificationOutcome =
  | { kind: "sent" }
  | {
      kind: "skipped";
      reason:
        /** 呼び出し側が「この操作は新規発行ではない」と判断した */
        | "not-requested"
        | "no-t-number"
        | "not-configured"
        | "send-skipped";
    }
  | { kind: "failed" };

export type NewCaseNotificationInputs = {
  /**
   * この操作で T番号 が新規発行されたか。
   *
   * false でも**呼ぶこと**。呼ばずに握り潰すと、送らなかった理由が
   * ログに残らない（届かない原因を切り分けられなくなる）。
   * 省略時は true（新規登録ルートからの直接呼び出し）。
   */
  enabled?: boolean;
  /** お客様情報アプリが採番した T番号。空なら送らない */
  tNumber: string | null | undefined;
  customerName: string;
  /** 操作した人の LINE userId（`auth.lineUserId`） */
  lineUserId?: string;
};

/** 判断の記録。値そのものではなく「有無」を残す */
function logStage(stage: string, detail: Record<string, unknown>): void {
  console.info(`${LOG_TAG} ${stage}`, JSON.stringify(detail));
}

/**
 * 案件作成者（操作した人）の担当者名を名簿から引く。
 *
 * **引けなくても通知は止めない。** 名前欄が空になるだけで、T番号 と
 * お客様名は伝わる。通知が飛ばない方が困る。
 * 引けなかったことは残す（本文の作成者が空で届いた理由になる）。
 */
async function resolveCreatorName(
  lineUserId: string | undefined,
): Promise<string> {
  const want = lineUserId?.trim() ?? "";
  if (!want) {
    console.warn(
      `${LOG_TAG} lineUserId が空のため案件作成者を空で送ります（送信は続行）`,
    );
    return "";
  }
  try {
    const name = (await resolveBoundStaffNameForLineUser(want)) ?? "";
    if (!name) {
      console.warn(
        `${LOG_TAG} 名簿に紐付けが無いため案件作成者を空で送ります（送信は続行）`,
      );
    }
    return name;
  } catch (e) {
    // 名簿には氏名・メールが載る。種別だけ出す
    console.warn(
      `${LOG_TAG} 名簿を引けず案件作成者を空で送ります（送信は続行）`,
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
export async function notifyNewCaseCreated(
  input: NewCaseNotificationInputs,
): Promise<NewCaseNotificationOutcome> {
  try {
    return await runNewCaseNotification(input);
  } catch (e) {
    // ここで投げると、登録が済んでいるのに応答がエラーになる。
    // 例外メッセージにはレコードの中身が載りうるので種別だけ出す
    console.error(
      `${LOG_TAG} 想定外の例外で送れませんでした`,
      JSON.stringify({
        tNumber: input.tNumber ?? "",
        name: e instanceof Error ? e.name : "unknown",
      }),
    );
    return { kind: "failed" };
  }
}

async function runNewCaseNotification(
  input: NewCaseNotificationInputs,
): Promise<NewCaseNotificationOutcome> {
  const tNumber = input.tNumber?.trim() ?? "";

  /**
   * ① 呼び出し側が「新規発行ではない」と判断した。
   *
   * 空き枠入力・未定案件の割り当て・工事日の移動はここで止まる。
   * 意図した動作だが、**新規登録のつもりで止まっていないか**を
   * 確かめられるように残す。
   */
  if (input.enabled === false) {
    logStage("送りません（この操作では T番号 を新規発行していない）", {
      stage: "not-requested",
      hasTNumber: Boolean(tNumber),
    });
    return { kind: "skipped", reason: "not-requested" };
  }

  /**
   * ② T番号 が読めなかった。
   *
   * 通知の主役が空の本文を流しても受け取り側が案件を特定できない。
   * 採番自体は済んでいる可能性があるので、記録だけ残す。
   */
  if (!tNumber) {
    logStage("送りません（T番号 が空。お客様情報の採番を読めていない）", {
      stage: "no-t-number",
      hasCustomerName: Boolean(input.customerName.trim()),
      hasLineUserId: Boolean(input.lineUserId?.trim()),
    });
    return { kind: "skipped", reason: "no-t-number" };
  }

  /**
   * ③ 環境変数が未設定。
   *
   * 異常ではない（用意される前でも登録は止めない）が、**届かない原因の
   * 第一候補**なので必ず残す。値は出さず、設定の有無だけを出す。
   */
  if (!googleChatNewCaseWebhookConfigured()) {
    logStage(
      "送りません（GOOGLE_CHAT_NEW_CASE_WEBHOOK_URL が未設定）",
      { stage: "not-configured", tNumber },
    );
    return { kind: "skipped", reason: "not-configured" };
  }

  // ④ 案件作成者。引けなくても止めない（resolveCreatorName の中で残す）
  const creatorName = await resolveCreatorName(input.lineUserId);

  const text = buildNewCaseNotificationText({
    tNumber,
    customerName: input.customerName,
    creatorName,
  });

  logStage("送信します", {
    stage: "sending",
    tNumber,
    hasCustomerName: Boolean(input.customerName.trim()),
    hasCreatorName: Boolean(creatorName),
    textLength: text.length,
  });

  const result = await sendGoogleChatNewCaseMessage(text);

  if (result.kind === "sent") {
    logStage("送信しました", { stage: "sent", tNumber });
    return { kind: "sent" };
  }

  if (result.kind === "skipped") {
    // 上で設定済みと判定しているので、通常ここには来ない
    logStage("送信側がスキップしました", {
      stage: "send-skipped",
      tNumber,
      reason: result.reason,
    });
    return { kind: "skipped", reason: "send-skipped" };
  }

  // ⑤ 送信でエラー。
  // 出してよいのは T番号・エラーの種類・HTTP ステータスまで。
  // Webhook URL とお客様名・担当者名は出さない
  console.error(
    `${LOG_TAG} 送信に失敗しました`,
    JSON.stringify({
      stage: "send-failed",
      tNumber,
      reason: result.reason,
      status: result.status,
    }),
  );
  return { kind: "failed" };
}
