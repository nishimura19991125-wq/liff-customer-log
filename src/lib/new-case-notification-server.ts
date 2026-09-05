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
 * ■ 送る条件は「T番号 が新規発行されたか」ひとつ
 *   T番号 を採番するのはお客様情報アプリで、採番されるのは**お客様情報
 *   レコードを新規作成したときだけ**。既存を引き当てた更新は採番済みの
 *   T番号 を読み直すだけなので、送ると同じ案件の通知が何度も飛ぶ。
 *
 *   - 工事カレンダーの**新規登録**（create-record）
 *     施工予定日の有無は問わない（どちらの経路でも送る）。
 *   - 空き枠カードの**新規入力**（fill-empty-slot）
 *     空き枠に入れたお客様名の顧客がお客様情報に無ければ、連携が
 *     新規作成して T番号 が採番される。**そのときだけ送る。**
 *     突合キーで既存が見つかったときは更新なので送らない。この分岐は
 *     finalizeConstructionCalendarSave が連携の結果を見て決める
 *     （notifyNewCase: "when-customer-info-created"）。
 *
 * ■ 送らない操作
 *   未定案件の割り当て（assign-customer-case）・工事日の移動・
 *   お客様情報からの保存。いずれも入口で既存の T番号 を必須にしており
 *   新規発行が起きないため、呼び出し側が enabled:false を渡す。
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

/**
 * どの呼び出し口から来たか。**ログの切り分け用**。
 *
 * 「T番号 が空」で止まったとき、施工予定日ありとなしでは原因が違う。
 *   - なし（create-record:undated）… 工事レコードが無く Aki番号 も無い。
 *     作成応答から recordId が取れないと引き直す手がかりが無くなる
 *   - あり（finalize）… Aki番号 で引き直せる。空なら採番待ちを疑う
 * 区別が付かないと、どちらを直すべきか決められない。
 */
export type NewCaseNotificationSource =
  /** 工事カレンダーの新規登録（施工予定日なし。工事アプリを触らない） */
  | "create-record:undated"
  /**
   * 工事レコード保存の後処理。
   * 新規登録の施工予定日ありと、空き枠の新規入力（お客様情報を
   * 新規作成したときだけ enabled:true）がここを通る
   */
  | "finalize";

export type NewCaseNotificationInputs = {
  /** どの呼び出し口か。ログにそのまま出す */
  source: NewCaseNotificationSource;
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
        source: input.source,
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
   * 未定案件の割り当て・工事日の移動と、既存のお客様情報を引き当てた
   * 空き枠入力がここで止まる。意図した動作だが、**新規登録のつもりで
   * 止まっていないか**を確かめられるように残す。
   */
  if (input.enabled === false) {
    logStage("送りません（この操作では T番号 を新規発行していない）", {
      stage: "not-requested",
      source: input.source,
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
      source: input.source,
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
    logStage("送りません（GOOGLE_CHAT_NEW_CASE_WEBHOOK_URL が未設定）", {
      stage: "not-configured",
      source: input.source,
      tNumber,
    });
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
    source: input.source,
    tNumber,
    hasCustomerName: Boolean(input.customerName.trim()),
    hasCreatorName: Boolean(creatorName),
    textLength: text.length,
  });

  const result = await sendGoogleChatNewCaseMessage(text);

  if (result.kind === "sent") {
    logStage("送信しました", { stage: "sent", source: input.source, tNumber });
    return { kind: "sent" };
  }

  if (result.kind === "skipped") {
    // 上で設定済みと判定しているので、通常ここには来ない
    logStage("送信側がスキップしました", {
      stage: "send-skipped",
      source: input.source,
      tNumber,
      reason: result.reason,
    });
    return { kind: "skipped", reason: "send-skipped" };
  }

  // ⑤ 送信でエラー。
  // 出してよいのは T番号・エラーの種類・HTTP ステータス・応答本文まで。
  // detail は google-chat 側で URL を落としてある。
  // Webhook URL とお客様名・担当者名は出さない
  console.error(
    `${LOG_TAG} 送信に失敗しました`,
    JSON.stringify({
      stage: "send-failed",
      source: input.source,
      tNumber,
      reason: result.reason,
      status: result.status,
      // 400 の理由は本文にしか入らない（スペースが無い・Webhook が無効 等）
      detail: result.detail,
    }),
  );
  return { kind: "failed" };
}
