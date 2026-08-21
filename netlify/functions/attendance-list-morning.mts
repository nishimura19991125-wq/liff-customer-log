/**
 * タスクY: 9:32（JST）に本日の出勤者を Google Chat へ流す。
 *
 * スケジュールは netlify.toml で指定する（cron は UTC 固定・タイムゾーンは
 * 指定できない）。日本には夏時間が無いので JST = UTC+9 の固定換算でよい。
 *   9:32 JST = 0:32 UTC → "32 0 * * *"
 *
 * この関数は**薄い引き金**でしかない。集計も本文の組み立ても送信も、
 * すべて Next.js 側（/api/attendance/list-notify）で行う。@pocket の取得や
 * レート上限のバックオフを二重に持たないため。
 *
 * ── なぜ夕方の関数と同じコードが2つあるのか ────────────────
 * 共通ファイルに切り出して import すると、Netlify のバンドラ（esbuild）が
 * `netlify/` 配下のファイル間の参照を解決できるかに依存する。**解決に失敗
 * するとデプロイ全体が落ちて、サイトごと古いまま止まる。** 中身は数十行の
 * 引き金なので、依存を持たない方を選んでいる。
 * 直すときは夕方（attendance-list-evening.mts）も一緒に直すこと。
 *
 * ── 認証 ──────────────────────────────────────────────────
 * 定時実行に利用者はいないので LINE 認証は通らない。
 * 代わりに ATTENDANCE_SCHEDULE_TOKEN を Bearer トークンとして送る。
 * Netlify の環境変数は Functions の実行時にも読めるため、この経路では
 * トークンを外部に置かずに渡せる。
 *
 * ── ログ ──────────────────────────────────────────────────
 * トークンも氏名も出さない。出すのはモードと HTTP ステータスまで。
 */

/** 応答が返らないまま関数の上限（30秒）に当たらないよう手前で打ち切る */
const TIMEOUT_MS = 20_000;

const MODE = "clock-in";

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

export default async function handler(): Promise<Response> {
  const origin = siteOrigin();
  const token = process.env.ATTENDANCE_SCHEDULE_TOKEN?.trim() ?? "";

  if (!origin || !token) {
    // 未設定は異常だが、ここで投げても誰も受け取らない。事実だけ残す
    console.error(
      "[attendance-list] 定時送信の設定が足りません",
      JSON.stringify({
        mode: MODE,
        hasOrigin: Boolean(origin),
        hasToken: Boolean(token),
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
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ mode: MODE }),
      signal: controller.signal,
    });
    console.log(
      "[attendance-list] 定時送信を呼びました",
      JSON.stringify({ mode: MODE, status: res.status }),
    );
  } catch (e) {
    // e には URL が載りうる。中身は見ず、打ち切りかどうかだけ判定する
    const aborted =
      typeof e === "object" &&
      e !== null &&
      (e as { name?: unknown }).name === "AbortError";
    console.error(
      "[attendance-list] 定時送信の呼び出しに失敗しました",
      JSON.stringify({ mode: MODE, reason: aborted ? "timeout" : "network" }),
    );
  } finally {
    clearTimeout(timer);
  }

  // リトライはしない（翌日また実行される）。常に成功で返して再実行を招かない
  return new Response("ok", { status: 200 });
}
