import { triggerAttendanceList } from "../lib/attendance-list-trigger.mjs";

/**
 * タスクY: 19:55（JST）に退勤打刻がない人を Google Chat へ流す。
 *
 * スケジュールは netlify.toml で指定する（cron は UTC 固定）。
 *   19:55 JST = 10:55 UTC → "55 10 * * *"
 *
 * 対象は「出勤打刻はあるが退勤打刻がない人」。出勤打刻自体が無い人は
 * 入らない（休みの人が毎日並ぶのを避けるため）。
 */
export default async function handler(): Promise<Response> {
  return triggerAttendanceList("missing-clock-out");
}
