import { describe, expect, it } from "vitest";

import type { AtPocketFieldRow } from "@/lib/atpocket";
import { resolveConstructionFieldIds } from "@/lib/calendar-kojo";

const constructionFieldsFixture: AtPocketFieldRow[] = [
  { uniqueId: "field-1", caption: "お客様名" },
  { uniqueId: "field-2", caption: "施工予定日" },
  { uniqueId: "field-3", caption: "T番号" },
  { uniqueId: "field-4", caption: "施工業者" },
  { uniqueId: "field-5", caption: "住宅ステータス" },
  { uniqueId: "field-6", caption: "仕込日" },
  { uniqueId: "field-7", caption: "パネル工事日" },
  { uniqueId: "field-8", caption: "電気工事日" },
  { uniqueId: "field-9", caption: "アプリ設定日" },
];

describe("resolveConstructionFieldIds", () => {
  it("resolves uniqueIds from Japanese captions", () => {
    const fids = resolveConstructionFieldIds(constructionFieldsFixture);

    expect(fids.title).toBe("field-1");
    expect(fids.startDate).toBe("field-2");
    expect(fids.tNumber).toBe("field-3");
    expect(fids.contractor).toBe("field-4");
    expect(fids.housingStatus).toBe("field-5");
    expect(fids.shigumi).toBe("field-6");
    expect(fids.panelWork).toBe("field-7");
    expect(fids.electricWork).toBe("field-8");
    expect(fids.appSettingsDay).toBe("field-9");
  });
});
