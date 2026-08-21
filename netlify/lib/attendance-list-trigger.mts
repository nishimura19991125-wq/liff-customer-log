/**
 * タスクY: 勤怠の定時リストを起動する（Netlify Scheduled Functions の中身）。
 *
 * ここは**薄い引き金**でしかない。集計も本文の組み立ても Google Chat への
 * 送信も、すべて Next.js 側（/api/attendance/list-notify）で行う。
 * @pocket の取得処理・キャッシュ・レート上限のバックオフを二重に持たない
 * ためで、この関数が知っているのは「どこへ」「どの合図を」送るかだけ。
 *
 * ── 認証 ──────────────────────────────────────────────────
 * 定時実行に利用者はいないので LINE 認証は通らない。
 * 代わりに ATTENDANCE_LIST_NOTIFY_SECRET を突き合わせる。
 * Netlify の環境変数は Functions の実行時にも読めるため、秘密を
 * 外部に置かずに渡せる（外部の cron サービスは不要）。
 *
 * ── ログ ──────────────────────────────────────────────────
 * 秘密も氏名も出さない。出すのはモードと HTTP ステータスまで。
 */

export type AttendanceListMode = "clock-in" | "missing-clock-out";

/** 応答が返らないまま関数の上限（30秒）に当たらないよう手前で打ち切る */
const TIMEOUT_MS = 20_000;

/**
 * 呼び出し先の起点。
 *
 * Netlify の URL / DEPLOY_URL は**ビルド時のみ**の変数で実行時には入らない
 * ことがあるため、まず NEXT_PUBLIC_SITE_URL を見る。
 */
function siteOrigin(): string {
  const candidates = [
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.URL,
    process.env.DEPLOY_URL,
  ];
  for (const raw of candidates) {
    const value = raw?.trim();
    if (value) return value.replace(/\/+$/, "");
  }
  return "";
}

export async function triggerAttendanceList(
  mode: AttendanceListMode,
): Promise<Response> {
  const origin = siteOrigin();
  const secret = process.env.ATTENDANCE_LIST_NOTIFY_SECRET?.trim() ?? "";

  if (!origin || !secret) {
    // 未設定は異常だが、ここで投げても誰も受け取らない。事実だけ残す
    console.error(
      "[attendance-list] 定時送信の設定が足りません",
      JSON.stringify({
        mode,
        hasOrigin: Boolean(origin),
        hasSecret: Boolean(secret),
      }),
    );
    return new Response("not configured", { status: 200 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${origin}/api/attendance/list-notify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-attendance-list-secret": secret,
      },
      body: JSON.stringify({ mode }),
      signal: controller.signal,
    });
    console.log(
      "[attendance-list] 定時送信を呼びました",
      JSON.stringify({ mode, status: res.status }),
    );
  } catch (e) {
    // e には URL が載りうる。中身は見ず、打ち切りかどうかだけ判定する
    const aborted =
      typeof e === "object" &&
      e !== null &&
      (e as { name?: unknown }).name === "AbortError";
    console.error(
      "[attendance-list] 定時送信の呼び出しに失敗しました",
      JSON.stringify({ mode, reason: aborted ? "timeout" : "network" }),
    );
  } finally {
    clearTimeout(timer);
  }

  // リトライはしない（翌日また実行される）。常に成功で返して再実行を招かない
  return new Response("ok", { status: 200 });
}
