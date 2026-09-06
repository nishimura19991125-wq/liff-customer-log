import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 勤怠カレンダーの遅延読み込み（出勤打刻の時間帯の @pocket 429 対策・段階2）。
 *
 * `/api/attendance/calendar` は**利用者ごとの別クエリ**で、サーバ側で
 * 共有できない。@pocket の上限は 100秒あたり100回・サイト単位なので、
 * 打刻画面を開いただけで人数分の取得が乗るのが効いていた。
 * **見ていないなら呼ばない**のが唯一の削減手段。
 *
 * ここで固定するのは「いつマウントするか」。挙動ではなく配線を見る
 * （このリポジトリにコンポーネントを描画する仕組みが無いため、対象は
 * ソースの文字列一致に限っている）。
 */

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

const PAGE = "src/app/attendance/page.tsx";
const CALENDAR = "src/components/attendance-month-calendar.tsx";

describe("開くまで取りに行かない", () => {
  it("★ カレンダーは一度開くまでマウントしない", () => {
    const src = read(PAGE);

    // 無条件マウント（`{idToken ? <AttendanceMonthCalendar` だけ）に戻さない
    expect(src).toContain("calendarMounted && idToken");
    expect(src).not.toMatch(
      /\{\s*idToken\s*\?\s*\(?\s*<AttendanceMonthCalendar/,
    );
  });

  it("★ 開閉の状態と、一度開いたかの状態を分けている", () => {
    const src = read(PAGE);

    // 同じ状態を使い回すと、閉じるたびにアンマウントされて取り直しになる
    expect(src).toContain("setCalendarMounted(true)");
    expect(src).toContain("setCalendarOpen((open) => !open)");
  });

  it("★ 閉じてもアンマウントせず、表示だけ切り替える（開き直しで取り直さない）", () => {
    const src = read(PAGE);

    // 開いている間だけ表示する。閉じている間も SWR のキーは張られたまま
    expect(src).toContain('calendarOpen ? "mt-4" : "hidden"');
  });

  it("開閉ボタンが支援技術にも状態を伝えている", () => {
    const src = read(PAGE);

    expect(src).toContain("aria-expanded={calendarOpen}");
    expect(src).toContain('aria-controls="attendance-month-calendar"');
    expect(src).toContain('id="attendance-month-calendar"');
  });
});

describe("読み込み中の表示", () => {
  it("★ 取得中であることを文字で出す（押しても何も起きないように見せない）", () => {
    const src = read(CALENDAR);

    expect(src).toContain("読み込み中…");
    expect(src).toContain('role="status"');
  });

  it("★ 月の切り替えの判定は変えていない", () => {
    const src = read(CALENDAR);

    // keepPreviousData のまま。ここを変えると月送りの見え方が変わる
    expect(src).toContain("const loading = isLoading && !data;");
    expect(src).toContain(
      "const path = `/api/attendance/calendar?year=${year}&month=${month}`",
    );
  });
});
