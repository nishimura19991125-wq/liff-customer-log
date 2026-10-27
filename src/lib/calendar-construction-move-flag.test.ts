import { describe, expect, it } from "vitest";

import {
  CALENDAR_CONSTRUCTION_MOVE_ENABLED_ENV,
  isCalendarConstructionMoveEnabled,
  shouldShowConstructionMovePanel,
} from "@/lib/calendar-construction-move-flag";

/**
 * 工事日の変更を止める切り替え（CALENDAR_CONSTRUCTION_MOVE_ENABLED）。
 *
 * 既定は false（止まった状態）。変数が無いときも止まっていること、
 * true を入れたときだけ戻ることを固定する。
 */

describe("isCalendarConstructionMoveEnabled", () => {
  it("★ 変数名", () => {
    expect(CALENDAR_CONSTRUCTION_MOVE_ENABLED_ENV).toBe(
      "CALENDAR_CONSTRUCTION_MOVE_ENABLED",
    );
  });

  it("★ 変数が無いときは false", () => {
    expect(isCalendarConstructionMoveEnabled({})).toBe(false);
  });

  it("★ process.env に無いときも false（引数なし）", () => {
    const saved = process.env.CALENDAR_CONSTRUCTION_MOVE_ENABLED;
    delete process.env.CALENDAR_CONSTRUCTION_MOVE_ENABLED;
    try {
      expect(isCalendarConstructionMoveEnabled()).toBe(false);
    } finally {
      if (saved !== undefined) {
        process.env.CALENDAR_CONSTRUCTION_MOVE_ENABLED = saved;
      }
    }
  });

  it.each(["", " ", "false", "FALSE", "0", "1", "yes", "on", "truee"])(
    "★ %j は false",
    (v) => {
      expect(
        isCalendarConstructionMoveEnabled({
          CALENDAR_CONSTRUCTION_MOVE_ENABLED: v,
        }),
      ).toBe(false);
    },
  );

  it.each(["true", "TRUE", " true ", "True"])("★ %j は true", (v) => {
    expect(
      isCalendarConstructionMoveEnabled({
        CALENDAR_CONSTRUCTION_MOVE_ENABLED: v,
      }),
    ).toBe(true);
  });
});

describe("shouldShowConstructionMovePanel（「工事日を変更」を出すか）", () => {
  it("★ フラグが false なら出さない", () => {
    expect(
      shouldShowConstructionMovePanel({
        enableEmptySlotFill: true,
        constructionMoveEnabled: false,
      }),
    ).toBe(false);
  });

  it("★ フラグが届いていない（undefined）ときも出さない", () => {
    expect(
      shouldShowConstructionMovePanel({
        enableEmptySlotFill: true,
        constructionMoveEnabled: undefined,
      }),
    ).toBe(false);
  });

  it("★ true なら元どおり出す", () => {
    expect(
      shouldShowConstructionMovePanel({
        enableEmptySlotFill: true,
        constructionMoveEnabled: true,
      }),
    ).toBe(true);
  });

  it("★ true でも、空き枠入力が無効な画面では出さない（従来の条件を残す）", () => {
    expect(
      shouldShowConstructionMovePanel({
        enableEmptySlotFill: false,
        constructionMoveEnabled: true,
      }),
    ).toBe(false);
  });
});
