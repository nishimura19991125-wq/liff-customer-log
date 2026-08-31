import { NextResponse } from "next/server";

/**
 * 【一時的な調査用ルート】新規案件通知が届かない件の切り分け用です。
 * **原因が判明したら削除し、NEW_CASE_NOTIFY_PROBE_ENABLED を外してください。**
 *
 * 案件を1件登録しないと確かめられない、という状態を無くすためのものです。
 * @pocket には一切書き込みません。
 *
 * フォルダ名が `%5Fprobe` なのは Next.js の仕様によるものです。
 * `_` 始まりのフォルダは private folder としてルーティングから除外されるため、
 * URL に `_` を出すには `%5F` を使います。
 * 実際のパスは /api/_probe/new-case-notify になります。
 *
 * ── 呼び出し方 ────────────────────────────────────────────
 *   POST /api/_probe/new-case-notify
 *   {}                                 設定と本文を確認するだけ（送らない）
 *   { "tNumber": "T00003420" }         T番号 を指定して本文を確認
 *   { "send": true }                   実際に Google Chat へ送る
 *
 * ── 返すもの ──────────────────────────────────────────────
 *   - webhookConfigured：GOOGLE_CHAT_NEW_CASE_WEBHOOK_URL が
 *     **実行中のサーバから見えているか**（true/false のみ）
 *   - creatorName：呼び出した本人が名簿から引けたか（引けなければ null）
 *   - text：実際に送られる本文そのもの
 *   - send:true のとき outcome（sent / skipped＋理由 / failed）
 *
 * ⚠ Webhook URL は返しません。値も、先頭数文字も返しません。
 *   creatorName は**呼び出した本人の名前**だけです。
 *
 * ── 安全策 ────────────────────────────────────────────────
 *   - NEW_CASE_NOTIFY_PROBE_ENABLED=1 のときだけ動作。未設定なら 404
 *     （存在しないルートと区別が付かないよう、認証より前に判定する）
 *   - 既存の調査ルートとは別の変数にする。片方を開けたらもう片方も開く、
 *     という事故を避ける
 *   - LINE 認証必須（401）。スタッフ名簿への紐付け必須（403）
 *   - **既定は送信しない。** send:true を明示したときだけ送る
 */

import {
  googleChatNewCaseWebhookConfigured,
} from "@/lib/google-chat";
import { buildNewCaseNotificationText } from "@/lib/new-case-notification";
import { notifyNewCaseCreated } from "@/lib/new-case-notification-server";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";
import { resolveBoundStaffNameForLineUser } from "@/lib/staff-bound-lookup";

export const dynamic = "force-dynamic";

/** 送信を試すときの既定値。実在の案件と紛れないようにしておく */
const PROBE_T_NUMBER = "T-PROBE";
const PROBE_CUSTOMER_NAME = "（通知テスト）";

export async function POST(request: Request) {
  // 無効時は存在しないルートと同じ見え方にする。認証より前に判定する
  if (process.env.NEW_CASE_NOTIFY_PROBE_ENABLED?.trim() !== "1") {
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

  let body: { tNumber?: unknown; customerName?: unknown; send?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // 引数なしで叩けるようにする（設定の確認だけなら本文は要らない）
    body = {};
  }

  const tNumber =
    typeof body.tNumber === "string" && body.tNumber.trim()
      ? body.tNumber.trim()
      : PROBE_T_NUMBER;
  const customerName =
    typeof body.customerName === "string" && body.customerName.trim()
      ? body.customerName.trim()
      : PROBE_CUSTOMER_NAME;
  const send = body.send === true;

  /**
   * 環境変数が**実行中のサーバから見えているか**。
   *
   * 届かない原因の第一候補。Netlify に登録しても、対象スコープや
   * デプロイのやり直しを忘れると関数からは見えないことがある。
   * 返すのは有無だけで、値も長さも返さない。
   */
  const webhookConfigured = googleChatNewCaseWebhookConfigured();

  const text = buildNewCaseNotificationText({
    tNumber,
    customerName,
    creatorName: boundStaffName,
  });

  if (!send) {
    return NextResponse.json({
      dryRun: true,
      webhookConfigured,
      creatorName: boundStaffName,
      text,
      note: "送っていません。実際に送るには send:true を付けてください。一時的な確認用ルートです。原因が判明したら削除し、NEW_CASE_NOTIFY_PROBE_ENABLED を外してください",
    });
  }

  // 本番と同じ関数を通す。判定・ログ・送信をここで作り直さない
  const outcome = await notifyNewCaseCreated({
    // 施工予定日なしと同じ入口を通す（工事アプリを触らない経路）
    source: "create-record:undated",
    tNumber,
    customerName,
    lineUserId: auth.lineUserId,
  });

  return NextResponse.json({
    dryRun: false,
    webhookConfigured,
    creatorName: boundStaffName,
    text,
    outcome,
    note: "一時的な確認用ルートです。原因が判明したら削除し、NEW_CASE_NOTIFY_PROBE_ENABLED を外してください",
  });
}
