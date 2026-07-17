import { describe, expect, it } from "vitest";

import { buildConstructionFillPatch } from "@/lib/calendar-construction-pocket-common";
import { EMPTY_FILL_HOUSING_STATUS_NEW_BUILD } from "@/lib/calendar-empty-fill-options";
import type { ConstructionFieldIds } from "@/lib/calendar-kojo";

const fids: ConstructionFieldIds = {
  title: "field-title",
  contractor: "field-contractor",
  startDate: "field-start",
  endDate: "",
  memo: "",
  housingStatus: "field-housing",
  shigumi: "field-shigumi",
  panelWork: "field-panel",
  electricWork: "field-electric",
  appSettingsDay: "field-app",
  tNumber: "field-tnumber",
  manufacturer: "",
  panelCapacity: "",
  batteryCapacity: "",
  inputStatus: "",
  zankoDay: "",
  constructionHandler: "",
};

describe("buildConstructionFillPatch", () => {
  it("always includes import key (T番号) in payload", () => {
    const patch = buildConstructionFillPatch({
      resolvedCustomer: "field-title",
      resolvedHousing: "field-housing",
      resolvedTNumber: "field-tnumber",
      tNumberValue: "T-1001",
      customerName: "山田太郎",
      housingRaw: "既築案件",
      fids,
    });

    expect(patch).toHaveProperty("field-tnumber", "T-1001");
    expect(patch).toHaveProperty("field-title", "山田太郎");
  });

  it("includes new-build schedule fields only for 新築案件", () => {
    const patch = buildConstructionFillPatch({
      resolvedCustomer: "field-title",
      resolvedHousing: "field-housing",
      resolvedTNumber: "field-tnumber",
      tNumberValue: "T-2002",
      customerName: "佐藤花子",
      housingRaw: EMPTY_FILL_HOUSING_STATUS_NEW_BUILD,
      fids,
      shigumiDate: "2026-07-10",
      panelWorkDate: "2026-07-11",
      electricWorkDate: "2026-07-12",
      appSettingsDayDate: "2026-07-13",
    });

    expect(patch["field-shigumi"]).toBe("2026-07-10");
    expect(patch["field-panel"]).toBe("2026-07-11");
    expect(patch["field-electric"]).toBe("2026-07-12");
    expect(patch["field-app"]).toBe("2026-07-13");
  });

  it("omits optional dates when empty", () => {
    const patch = buildConstructionFillPatch({
      resolvedCustomer: "field-title",
      resolvedHousing: "field-housing",
      resolvedTNumber: "field-tnumber",
      tNumberValue: "T-3003",
      customerName: "鈴木一郎",
      housingRaw: "既築案件",
      fids,
      scheduledStartDate: "",
      shigumiDate: "2026-07-10",
    });

    expect(patch).not.toHaveProperty("field-start");
    expect(patch).not.toHaveProperty("field-shigumi");
  });
});
