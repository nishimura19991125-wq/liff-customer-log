import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CLOCK_OUT_REMINDER_FROM_JST,
  CLOCK_OUT_REMINDER_UNTIL_NEXT_DAY_JST,
  isBeforeNextDayClockInDisplay,
  msUntilPendingClockOutExpires,
} from "@/lib/attendance-clock-out-reminder-client";
import {
  DAILY_OMIKUJI_FROM_JST,
  isAfterDailyOmikujiTimeJst,
} from "@/lib/daily-omikuji-shown";
import { isAtOrAfterJstHm, jstHmNow, msUntilJstHmToday } from "@/lib/jst-hm";

/**
 * 出勤選択（おみくじ）モーダルと退勤未打刻リマインダーの、時刻の境界。
 *
 *   出勤選択モーダルの開始        08:30（JST）
 *   退勤未打刻リマインダーの終了  翌日 07:00（JST）
 *
 * 以前は1つの定数（07:00）を共有していた。出勤選択の開始を 8:30 に遅らせる
 * ときに分けたので、**片方を動かしてももう片方が動かないこと**を固定する。
 *
 * ⚠ 時刻はすべて固定の瞬間（UTC の絶対時刻）で渡す。実行時の現在時刻には
 *    依存させない。判定は端末で動くので、端末のタイムゾーンにも依存させない。
 */

/** JST の壁時計の時刻を、絶対時刻（Date）にする。JST = UTC+9 で夏時間は無い */
function jst(
  y: number,
  mo: number,
  d: number,
  h: number,
  min: number,
  s = 0,
): Date {
  return new Date(Date.UTC(y, mo - 1, d, h - 9, min, s));
}

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

describe("★ 定数", () => {
  it("★ 出勤選択モーダルの開始は 08:30", () => {
    expect(DAILY_OMIKUJI_FROM_JST).toBe("08:30");
  });

  it("★ 退勤未打刻リマインダーの終了は 07:00 のまま", () => {
    expect(CLOCK_OUT_REMINDER_UNTIL_NEXT_DAY_JST).toBe("07:00");
  });

  it("退勤未打刻リマインダーの開始（18:30）は変えていない", () => {
    expect(CLOCK_OUT_REMINDER_FROM_JST).toBe("18:30");
  });

  it("★ 2つは別の定数（片方を変えてももう片方は動かない）", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/lib/attendance-clock-out-reminder-client.ts"),
      "utf8",
    );

    // 退勤リマインダー側は、出勤選択の定数をもう参照していない
    expect(src).not.toContain("DAILY_OMIKUJI_FROM_JST,");
    expect(src).not.toContain('from "@/lib/daily-omikuji-shown"');
    expect(src).toContain("CLOCK_OUT_REMINDER_UNTIL_NEXT_DAY_JST");
  });
});

describe("★ 出勤選択モーダルは 8:30 から", () => {
  it("★ 8:29 では出ない", () => {
    expect(isAfterDailyOmikujiTimeJst(jst(2026, 9, 8, 8, 29))).toBe(false);
  });

  it("★ 8:29:59 でも出ない", () => {
    expect(isAfterDailyOmikujiTimeJst(jst(2026, 9, 8, 8, 29, 59))).toBe(false);
  });

  it("★ 8:30 ちょうどで出る", () => {
    expect(isAfterDailyOmikujiTimeJst(jst(2026, 9, 8, 8, 30, 0))).toBe(true);
  });

  it("★ 8:31 以降も出る", () => {
    for (const [h, min] of [
      [8, 31],
      [9, 0],
      [12, 0],
      [18, 30],
      [23, 59],
    ] as const) {
      expect(
        isAfterDailyOmikujiTimeJst(jst(2026, 9, 8, h, min)),
        `${h}:${min}`,
      ).toBe(true);
    }
  });

  it("★ 以前の開始時刻（7:00）ではもう出ない", () => {
    expect(isAfterDailyOmikujiTimeJst(jst(2026, 9, 8, 7, 0))).toBe(false);
    expect(isAfterDailyOmikujiTimeJst(jst(2026, 9, 8, 7, 30))).toBe(false);
    expect(isAfterDailyOmikujiTimeJst(jst(2026, 9, 8, 8, 0))).toBe(false);
  });

  it("深夜・早朝は出ない", () => {
    for (const [h, min] of [
      [0, 0],
      [0, 1],
      [5, 0],
      [6, 59],
    ] as const) {
      expect(
        isAfterDailyOmikujiTimeJst(jst(2026, 9, 8, h, min)),
        `${h}:${min}`,
      ).toBe(false);
    }
  });
});

describe("★ 日付が変わる前後", () => {
  it("★ 23:59 は出る → 日付が変わった 0:00 は出ない → 8:30 でまた出る", () => {
    expect(isAfterDailyOmikujiTimeJst(jst(2026, 9, 8, 23, 59, 59))).toBe(true);
    expect(isAfterDailyOmikujiTimeJst(jst(2026, 9, 9, 0, 0, 0))).toBe(false);
    expect(isAfterDailyOmikujiTimeJst(jst(2026, 9, 9, 8, 29))).toBe(false);
    expect(isAfterDailyOmikujiTimeJst(jst(2026, 9, 9, 8, 30))).toBe(true);
  });

  it("0:00 は「24:00」ではなく「00:00」として比べる", () => {
    // 24:00 と表記されると、文字列比較で常に 8:30 以降になってしまう
    expect(jstHmNow(jst(2026, 9, 9, 0, 0))).toBe("00:00");
    expect(jstHmNow(jst(2026, 9, 9, 0, 5))).toBe("00:05");
  });

  it("月末・年末をまたいでも同じ", () => {
    expect(isAfterDailyOmikujiTimeJst(jst(2026, 9, 30, 23, 59))).toBe(true);
    expect(isAfterDailyOmikujiTimeJst(jst(2026, 10, 1, 0, 0))).toBe(false);
    expect(isAfterDailyOmikujiTimeJst(jst(2026, 12, 31, 23, 59))).toBe(true);
    expect(isAfterDailyOmikujiTimeJst(jst(2027, 1, 1, 8, 29))).toBe(false);
    expect(isAfterDailyOmikujiTimeJst(jst(2027, 1, 1, 8, 30))).toBe(true);
  });
});

describe("★ JST で判定する（端末のタイムゾーンに依存しない）", () => {
  const savedTz = process.env.TZ;

  afterEach(() => {
    if (savedTz === undefined) delete process.env.TZ;
    else process.env.TZ = savedTz;
  });

  it("★ UTC の 8:30 ではなく JST の 8:30 が基準", () => {
    // UTC 8:30 は JST 17:30。UTC 23:30（前日）が JST 8:30
    expect(
      isAfterDailyOmikujiTimeJst(new Date(Date.UTC(2026, 8, 7, 23, 29, 59))),
    ).toBe(false);
    expect(
      isAfterDailyOmikujiTimeJst(new Date(Date.UTC(2026, 8, 7, 23, 30, 0))),
    ).toBe(true);
    // UTC の 0:00〜8:29 は、JST では 9:00〜17:29 なので出る
    expect(
      isAfterDailyOmikujiTimeJst(new Date(Date.UTC(2026, 8, 8, 0, 0, 0))),
    ).toBe(true);
    // UTC の 22:00 は JST の翌日 7:00 なので出ない
    expect(
      isAfterDailyOmikujiTimeJst(new Date(Date.UTC(2026, 8, 8, 22, 0, 0))),
    ).toBe(false);
  });

  it("★ 端末のタイムゾーンを変えても、同じ瞬間の判定は変わらない", () => {
    const before = jst(2026, 9, 8, 8, 29, 59);
    const at = jst(2026, 9, 8, 8, 30, 0);
    const reminderBefore = jst(2026, 9, 8, 6, 59, 59);
    const reminderAt = jst(2026, 9, 8, 7, 0, 0);

    for (const tz of [
      "UTC",
      "Asia/Tokyo",
      "America/New_York",
      "America/Los_Angeles",
      "Europe/London",
      "Pacific/Auckland",
    ]) {
      process.env.TZ = tz;

      expect(isAfterDailyOmikujiTimeJst(before), tz).toBe(false);
      expect(isAfterDailyOmikujiTimeJst(at), tz).toBe(true);
      expect(jstHmNow(at), tz).toBe("08:30");
      expect(msUntilJstHmToday(DAILY_OMIKUJI_FROM_JST, before), tz).toBe(1000);
      expect(isBeforeNextDayClockInDisplay("2026-09-07", reminderBefore), tz).toBe(
        true,
      );
      expect(isBeforeNextDayClockInDisplay("2026-09-07", reminderAt), tz).toBe(
        false,
      );
    }
  });

  it("★ 時刻の取り出しに端末のタイムゾーン（getHours など）を使っていない", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/lib/jst-hm.ts"),
      "utf8",
    );

    expect(src).toContain('timeZone: "Asia/Tokyo"');
    expect(src).not.toMatch(/\.getHours\(|\.getMinutes\(|\.getDate\(/);
  });
});

describe("★ 待機タイマーの残り時間（8:30 より前に開いた場合）", () => {
  const wait = (now: Date) => msUntilJstHmToday(DAILY_OMIKUJI_FROM_JST, now);

  it("★ 8:00 に開いたら 30分", () => {
    expect(wait(jst(2026, 9, 8, 8, 0, 0))).toBe(30 * MIN);
  });

  it("★ 7:00 に開いたら 1時間30分", () => {
    expect(wait(jst(2026, 9, 8, 7, 0, 0))).toBe(90 * MIN);
  });

  it("★ 8:29:30 に開いたら 30秒", () => {
    expect(wait(jst(2026, 9, 8, 8, 29, 30))).toBe(30 * 1000);
  });

  it("日付が変わった直後（0:00）に開いたら 8時間30分", () => {
    expect(wait(jst(2026, 9, 8, 0, 0, 0))).toBe(8 * HOUR + 30 * MIN);
  });

  it("★ 8:30 ちょうど・それ以降は待たない（null）", () => {
    expect(wait(jst(2026, 9, 8, 8, 30, 0))).toBeNull();
    expect(wait(jst(2026, 9, 8, 8, 30, 1))).toBeNull();
    expect(wait(jst(2026, 9, 8, 12, 0, 0))).toBeNull();
    expect(wait(jst(2026, 9, 8, 23, 59, 59))).toBeNull();
  });

  it("★ 残り時間が切れた瞬間に、表示の判定も true になる", () => {
    // タイマーが鳴ったのに「まだ時刻前」と判定されると、モーダルが出ない
    for (const now of [
      jst(2026, 9, 8, 0, 0, 0),
      jst(2026, 9, 8, 7, 15, 20),
      jst(2026, 9, 8, 8, 29, 59),
    ]) {
      const ms = wait(now);
      expect(ms).not.toBeNull();
      const fired = new Date(now.getTime() + (ms ?? 0));
      expect(isAfterDailyOmikujiTimeJst(fired)).toBe(true);
      expect(
        isAfterDailyOmikujiTimeJst(new Date(fired.getTime() - 1000)),
      ).toBe(false);
    }
  });
});

describe("★ 画面側は出勤選択の定数で判定・待機している", () => {
  const guard = readFileSync(
    path.join(process.cwd(), "src/components/liff-pin-guard.tsx"),
    "utf8",
  );

  it("★ 表示の判定は isAfterDailyOmikujiTimeJst", () => {
    expect(guard).toContain("if (!isAfterDailyOmikujiTimeJst()) return;");
  });

  it("★ 待機は DAILY_OMIKUJI_FROM_JST までの残り時間", () => {
    expect(guard).toContain("msUntilJstHmToday(DAILY_OMIKUJI_FROM_JST)");
    // 退勤リマインダーの終了時刻で待っていない
    expect(guard).not.toContain("CLOCK_OUT_REMINDER_UNTIL_NEXT_DAY_JST");
  });
});

describe("★ 退勤未打刻リマインダーは翌日 07:00 まで", () => {
  const WORK_DATE = "2026-09-07";
  const keep = (now: Date) => isBeforeNextDayClockInDisplay(WORK_DATE, now);

  it("勤怠日の当日中は残る", () => {
    expect(keep(jst(2026, 9, 7, 18, 30))).toBe(true);
    expect(keep(jst(2026, 9, 7, 23, 59, 59))).toBe(true);
  });

  it("日付が変わっても残る", () => {
    expect(keep(jst(2026, 9, 8, 0, 0, 0))).toBe(true);
    expect(keep(jst(2026, 9, 8, 3, 0))).toBe(true);
  });

  it("★ 6:59 では残る", () => {
    expect(keep(jst(2026, 9, 8, 6, 59))).toBe(true);
    expect(keep(jst(2026, 9, 8, 6, 59, 59))).toBe(true);
  });

  it("★ 07:00 ちょうどで消える", () => {
    expect(keep(jst(2026, 9, 8, 7, 0, 0))).toBe(false);
  });

  it("★ 07:00 以降は消えたまま（出勤選択の 8:30 まで延びていない）", () => {
    expect(keep(jst(2026, 9, 8, 7, 1))).toBe(false);
    expect(keep(jst(2026, 9, 8, 8, 0))).toBe(false);
    expect(keep(jst(2026, 9, 8, 8, 29))).toBe(false);
    expect(keep(jst(2026, 9, 8, 8, 30))).toBe(false);
    expect(keep(jst(2026, 9, 8, 12, 0))).toBe(false);
  });

  it("翌々日以降は、時刻に関係なく出さない", () => {
    expect(keep(jst(2026, 9, 9, 0, 0))).toBe(false);
    expect(keep(jst(2026, 9, 9, 6, 59))).toBe(false);
  });

  it("勤怠日より前・勤怠日が空なら出さない", () => {
    expect(keep(jst(2026, 9, 6, 23, 59))).toBe(false);
    expect(isBeforeNextDayClockInDisplay("", jst(2026, 9, 8, 6, 0))).toBe(false);
  });

  it("月末・年末をまたいでも、翌日の 07:00 で消える", () => {
    expect(
      isBeforeNextDayClockInDisplay("2026-09-30", jst(2026, 10, 1, 6, 59)),
    ).toBe(true);
    expect(
      isBeforeNextDayClockInDisplay("2026-09-30", jst(2026, 10, 1, 7, 0)),
    ).toBe(false);
    expect(
      isBeforeNextDayClockInDisplay("2026-12-31", jst(2027, 1, 1, 6, 59)),
    ).toBe(true);
    expect(
      isBeforeNextDayClockInDisplay("2026-12-31", jst(2027, 1, 1, 7, 0)),
    ).toBe(false);
  });

  it("★ 07:00〜08:29 は、退勤リマインダーも出勤選択も出ない", () => {
    for (const [h, min] of [
      [7, 0],
      [7, 45],
      [8, 29],
    ] as const) {
      const now = jst(2026, 9, 8, h, min);
      expect(keep(now), `${h}:${min}`).toBe(false);
      expect(isAfterDailyOmikujiTimeJst(now), `${h}:${min}`).toBe(false);
    }
  });
});

describe("★ 退勤未打刻リマインダーが消えるまでの残り時間", () => {
  const pending = {
    staffName: "試験 太郎",
    workDate: "2026-09-07",
    clockIn: "08:50",
  };
  const left = (now: Date) => msUntilPendingClockOutExpires(pending, now);

  it("★ 勤怠日の 18:30 なら、翌日 07:00 まで 12時間30分", () => {
    expect(left(jst(2026, 9, 7, 18, 30, 0))).toBe(12 * HOUR + 30 * MIN);
  });

  it("★ 翌日 6:59 なら 1分", () => {
    expect(left(jst(2026, 9, 8, 6, 59, 0))).toBe(MIN);
  });

  it("★ 翌日 07:00 ちょうど・それ以降は null（8:30 まで待たない）", () => {
    expect(left(jst(2026, 9, 8, 7, 0, 0))).toBeNull();
    expect(left(jst(2026, 9, 8, 8, 0, 0))).toBeNull();
  });

  it("★ 残り時間が切れた瞬間に、残すかの判定も false になる", () => {
    const now = jst(2026, 9, 7, 22, 13, 40);
    const ms = left(now);
    expect(ms).not.toBeNull();
    const fired = new Date(now.getTime() + (ms ?? 0));

    expect(isBeforeNextDayClockInDisplay(pending.workDate, fired)).toBe(false);
    expect(
      isBeforeNextDayClockInDisplay(
        pending.workDate,
        new Date(fired.getTime() - 1000),
      ),
    ).toBe(true);
  });

  it("勤怠日の形式が不正なら null", () => {
    expect(
      msUntilPendingClockOutExpires(
        { ...pending, workDate: "2026/09/07" },
        jst(2026, 9, 7, 18, 30),
      ),
    ).toBeNull();
  });
});

describe("共通の時刻比較", () => {
  it("同じ時刻は「以降」に含める", () => {
    expect(isAtOrAfterJstHm("08:30", jst(2026, 9, 8, 8, 30))).toBe(true);
    expect(isAtOrAfterJstHm("12:00", jst(2026, 9, 8, 12, 0))).toBe(true);
  });

  it("1桁の時も2桁に揃えて比べる（9:00 は 08:30 より後）", () => {
    expect(jstHmNow(jst(2026, 9, 8, 9, 0))).toBe("09:00");
    expect(isAtOrAfterJstHm("08:30", jst(2026, 9, 8, 9, 0))).toBe(true);
    expect(isAtOrAfterJstHm("12:00", jst(2026, 9, 8, 9, 0))).toBe(false);
  });
});
