import { describe, expect, it } from "vitest";

import {
  EMPTY_SLOT_MIN_BUSINESS_DAYS,
  buildCustomerCancelPlan,
  countBusinessDaysBetween,
  isBusinessDay,
} from "@/lib/customer-cancel-plan";
import { japanHolidayKeysForRange } from "@/lib/japan-holidays";
import {
  isCustomerStatusCancelled,
  isCustomerStatusCancelledExact,
} from "@/lib/customer-status-label";

/**
 * タスクV: キャンセル処理の判断。
 *
 * 元に戻せない処理なので、「実行しない側」に倒れることを厚めに見る。
 */

/**
 * テスト用の祝日集合。
 * 本番は外部APIから取るが、営業日計算そのものを固定したいのでここでは
 * 組み込みの計算表（japan-holidays.ts）から作る。
 */
function holidays(from: string, to: string): Set<string> {
  return japanHolidayKeysForRange(
    Number(from.slice(0, 4)),
    Number(to.slice(0, 4)),
  );
}

/** 祝日を注入して plan を作る。既定は 2026 年の祝日 */
function makePlan(input: {
  todayDayKey: string;
  constructionDate: string;
  contractor: string;
  holidayKeys?: ReadonlySet<string>;
}) {
  return buildCustomerCancelPlan({
    ...input,
    holidayKeys:
      input.holidayKeys ??
      holidays(input.todayDayKey, input.constructionDate || input.todayDayKey),
  });
}

describe("★ ⑤ 営業日の計算（土日祝を除く）", () => {
  it("土日は営業日ではない", () => {
    const h = new Set<string>();
    // 2026-09-05 は土曜、09-06 は日曜
    expect(isBusinessDay("2026-09-04", h)).toBe(true); // 金
    expect(isBusinessDay("2026-09-05", h)).toBe(false); // 土
    expect(isBusinessDay("2026-09-06", h)).toBe(false); // 日
    expect(isBusinessDay("2026-09-07", h)).toBe(true); // 月
  });

  it("祝日は営業日ではない", () => {
    const h = holidays("2026-01-01", "2026-12-31");
    // 元日
    expect(h.has("2026-01-01")).toBe(true);
    expect(isBusinessDay("2026-01-01", h)).toBe(false);
    // 敬老の日（9月第3月曜 = 2026-09-21）
    expect(h.has("2026-09-21")).toBe(true);
    expect(isBusinessDay("2026-09-21", h)).toBe(false);
  });

  it("振替休日も除く", () => {
    // 2026-11-23（勤労感謝の日）は月曜なので振替なし。
    // 2026-05-03（憲法記念日）は日曜 → 05-06 が振替
    const h = holidays("2026-05-01", "2026-05-31");
    expect(h.has("2026-05-03")).toBe(true);
    expect(h.has("2026-05-06")).toBe(true);
    expect(isBusinessDay("2026-05-06", h)).toBe(false);
  });

  it("翌日から対象日まで（対象日を含む）を数える", () => {
    const h = new Set<string>();
    // 2026-09-07(月) → 09-11(金)。9/8,9,10,11 の4日
    expect(countBusinessDaysBetween("2026-09-07", "2026-09-11", h)).toBe(4);
  });

  it("同日・過去は 0", () => {
    const h = new Set<string>();
    expect(countBusinessDaysBetween("2026-09-07", "2026-09-07", h)).toBe(0);
    expect(countBusinessDaysBetween("2026-09-07", "2026-09-01", h)).toBe(0);
  });

  it("土日をまたぐと平日だけ数える", () => {
    const h = new Set<string>();
    // 09-04(金) → 09-07(月)。9/5(土) 9/6(日) を除いて 9/7 の1日
    expect(countBusinessDaysBetween("2026-09-04", "2026-09-07", h)).toBe(1);
  });

  it("祝日をまたぐと祝日を除く", () => {
    const h = holidays("2026-09-01", "2026-09-30");
    // 09-18(金) → 09-24(木)。9/19(土)9/20(日)9/21(敬老)9/22(国民の休日?)9/23(秋分)
    // を除いた平日を数える
    const withHoliday = countBusinessDaysBetween("2026-09-18", "2026-09-24", h);
    const withoutHoliday = countBusinessDaysBetween(
      "2026-09-18",
      "2026-09-24",
      new Set<string>(),
    );
    expect(withHoliday).toBeLessThan(withoutHoliday);
  });

  it("不正な日付は 0 / 非営業日として扱う", () => {
    const h = new Set<string>();
    expect(isBusinessDay("", h)).toBe(false);
    expect(isBusinessDay("-", h)).toBe(false);
    expect(isBusinessDay("2026-02-30", h)).toBe(false);
    expect(countBusinessDaysBetween("", "2026-09-07", h)).toBe(0);
    expect(countBusinessDaysBetween("2026-09-07", "", h)).toBe(0);
  });
});

describe("仕様書の例で検算する（今日 = 2026-09-01 月曜）", () => {
  const TODAY = "2026-09-01";

  it("2026-09-01 は月曜", () => {
    expect(new Date(2026, 8, 1).getDay()).toBe(2);
  });

  it("★ ⑥ 4営業日先（7営業日以内）なら作らない", () => {
    // 2026-09-01(火) → 09-04(金) は 9/2,3,4 の3営業日
    const plan = makePlan({
      todayDayKey: TODAY,
      constructionDate: "2026-09-04",
      contractor: "ピュアライフ",
    });
    expect(plan.businessDays).toBeLessThanOrEqual(EMPTY_SLOT_MIN_BUSINESS_DAYS);
    expect(plan.createsEmptySlot).toBe(false);
    expect(plan.skipReason).toBe("too-soon");
  });

  it("★ ⑦ 7営業日を超えるなら作る", () => {
    const plan = makePlan({
      todayDayKey: TODAY,
      constructionDate: "2026-09-30",
      contractor: "ピュアライフ",
    });
    expect(plan.businessDays).toBeGreaterThan(EMPTY_SLOT_MIN_BUSINESS_DAYS);
    expect(plan.createsEmptySlot).toBe(true);
    expect(plan.emptySlotDayKey).toBe("2026-09-30");
    expect(plan.emptySlotContractor).toBe("ピュアライフ");
    expect(plan.skipReason).toBeNull();
  });

  it("ちょうど7営業日なら作らない（超えたときだけ）", () => {
    // 7営業日ちょうどになる日を探す
    let target = "";
    const cursor = new Date(2026, 8, 1);
    for (let i = 0; i < 40; i++) {
      cursor.setDate(cursor.getDate() + 1);
      const key = `2026-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(
        cursor.getDate(),
      ).padStart(2, "0")}`;
      const plan = makePlan({
        todayDayKey: TODAY,
        constructionDate: key,
        contractor: "ピュアライフ",
      });
      if (plan.businessDays === 7) {
        target = key;
        break;
      }
    }
    expect(target).not.toBe("");
    const plan = makePlan({
      todayDayKey: TODAY,
      constructionDate: target,
      contractor: "ピュアライフ",
    });
    expect(plan.createsEmptySlot).toBe(false);
    expect(plan.skipReason).toBe("too-soon");
  });
});

describe("★ ⑧ 過去の日付なら作らない", () => {
  it("今日より前は past", () => {
    const plan = makePlan({
      todayDayKey: "2026-09-01",
      constructionDate: "2026-08-25",
      contractor: "ピュアライフ",
    });
    expect(plan.createsEmptySlot).toBe(false);
    expect(plan.skipReason).toBe("past");
  });

  it("今日そのものも作らない", () => {
    const plan = makePlan({
      todayDayKey: "2026-09-01",
      constructionDate: "2026-09-01",
      contractor: "ピュアライフ",
    });
    expect(plan.createsEmptySlot).toBe(false);
    expect(plan.skipReason).toBe("past");
  });
});

describe("★ ⑨ 施工会社が空なら作らない", () => {
  it("空文字なら no-contractor", () => {
    const plan = makePlan({
      todayDayKey: "2026-09-01",
      constructionDate: "2026-09-30",
      contractor: "",
    });
    expect(plan.createsEmptySlot).toBe(false);
    expect(plan.skipReason).toBe("no-contractor");
  });

  it("@pocket の「-」でも作らない", () => {
    const plan = makePlan({
      todayDayKey: "2026-09-01",
      constructionDate: "2026-09-30",
      contractor: "-",
    });
    expect(plan.createsEmptySlot).toBe(false);
    expect(plan.skipReason).toBe("no-contractor");
  });

  it("日数が足りていても施工会社が無ければ作らない", () => {
    const plan = makePlan({
      todayDayKey: "2026-09-01",
      constructionDate: "2026-12-01",
      contractor: "   ",
    });
    expect(plan.createsEmptySlot).toBe(false);
    expect(plan.skipReason).toBe("no-contractor");
  });
});

describe("施工予定日が無い場合", () => {
  it("空なら no-date", () => {
    expect(
      makePlan({
        todayDayKey: "2026-09-01",
        constructionDate: "",
        contractor: "ピュアライフ",
      }).skipReason,
    ).toBe("no-date");
  });

  it("「-」なら no-date", () => {
    expect(
      makePlan({
        todayDayKey: "2026-09-01",
        constructionDate: "-",
        contractor: "ピュアライフ",
      }).skipReason,
    ).toBe("no-date");
  });
});

describe("★ トリガーの判定は完全一致のみ", () => {
  it("「キャンセル」だけが true", () => {
    expect(isCustomerStatusCancelledExact("キャンセル")).toBe(true);
    expect(isCustomerStatusCancelledExact(" キャンセル ")).toBe(true);
  });

  it("「キャンセル」を含むだけの値では実行しない", () => {
    // 元に戻せない処理なので、部分一致では起動させない
    expect(isCustomerStatusCancelledExact("キャンセル保留")).toBe(false);
    expect(isCustomerStatusCancelledExact("キャンセル検討中")).toBe(false);
    expect(isCustomerStatusCancelledExact("仮キャンセル")).toBe(false);
  });

  it("工事待ち・空は false", () => {
    expect(isCustomerStatusCancelledExact("工事待ち")).toBe(false);
    expect(isCustomerStatusCancelledExact("")).toBe(false);
    expect(isCustomerStatusCancelledExact(null)).toBe(false);
    expect(isCustomerStatusCancelledExact(undefined)).toBe(false);
  });

  it("既存の緩い判定（部分一致）は変えていない", () => {
    // 書類未回収アラートの除外などは従来どおり
    expect(isCustomerStatusCancelled("キャンセル保留")).toBe(true);
    expect(isCustomerStatusCancelled("キャンセル")).toBe(true);
    expect(isCustomerStatusCancelled("工事待ち")).toBe(false);
  });
});
