import { describe, expect, it } from "vitest";

import type { AtPocketFieldRow } from "@/lib/atpocket";
import {
  dayKeyFromConstructionRecord,
  resolveConsumeEmptySlotDayKey,
} from "@/lib/calendar-consume-empty-slot";

const constructionFieldsFixture: AtPocketFieldRow[] = [
  { uniqueId: "field-1", caption: "お客様名" },
  { uniqueId: "field-2", caption: "施工予定日" },
  { uniqueId: "field-6", caption: "仕込日" },
  { uniqueId: "field-7", caption: "パネル工事日" },
  { uniqueId: "field-8", caption: "電気工事日" },
  { uniqueId: "field-9", caption: "アプリ設定日" },
];

describe("dayKeyFromConstructionRecord", () => {
  it("normalizes slash and datetime start dates to YYYY-MM-DD", () => {
    const rec = { "field-2": "2026/07/18 09:30:00" };
    expect(
      dayKeyFromConstructionRecord(rec, constructionFieldsFixture),
    ).toBe("2026-07-18");
  });

  it("normalizes YYYY-MM-DD HH:mm:ss", () => {
    const rec = { "field-2": "2026-07-18 09:30:00" };
    expect(
      dayKeyFromConstructionRecord(rec, constructionFieldsFixture),
    ).toBe("2026-07-18");
  });
});

describe("resolveConsumeEmptySlotDayKey", () => {
  it("prefers 施工予定日 on the record over fallback dates", () => {
    const rec = { "field-2": "2026-07-20" };
    const key = resolveConsumeEmptySlotDayKey(rec, constructionFieldsFixture, [
      "2026-07-10",
      "2026-07-11",
    ]);
    expect(key).toBe("2026-07-20");
  });

  it("uses fallback dates in order (施工予定日相当 → 新築4日程)", () => {
    const rec: Record<string, unknown> = {};
    const key = resolveConsumeEmptySlotDayKey(rec, constructionFieldsFixture, [
      undefined,
      "2026-07-10",
      "2026-07-11",
      "2026-07-12",
      "2026-07-13",
    ]);
    expect(key).toBe("2026-07-10");
  });

  it("returns null when no date is available", () => {
    expect(
      resolveConsumeEmptySlotDayKey({}, constructionFieldsFixture, []),
    ).toBeNull();
  });
});
