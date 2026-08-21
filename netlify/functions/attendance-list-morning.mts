import { triggerAttendanceList } from "../lib/attendance-list-trigger.mjs";

/**
 * タスクY: 9:32（JST）に本日の出勤者を Google Chat へ流す。
 *
 * スケジュールは netlify.toml で指定する（cron は UTC 固定・タイムゾーンは
 * 指定できない）。日本には夏時間が無いので JST = UTC+9 の固定換算でよい。
 *   9:32 JST = 0:32 UTC → "32 0 * * *"
 *
 * この関数は本番では HTTP から到達できない（Netlify がスケジュール実行
 * 専用として扱う）。定時を待たずに動かしたいときは、Netlify の Functions
 * 画面の「Run now」か、/api/_probe/attendance-list-notify を使う。
 */
export default async function handler(): Promise<Response> {
  return triggerAttendanceList("clock-in");
}
