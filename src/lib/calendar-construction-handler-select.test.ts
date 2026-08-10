import { describe, expect, it } from "vitest";

import {
  collectSelectOptionsFromRecordCells,
  resolveConstructionHandlerSelectWriteValue,
  resolveConstructionHandlerWriteValue,
} from "@/lib/calendar-construction-handler-select";
import { pocketSelectCellDisplayString } from "@/lib/staff-construction-availability";

describe("pocketSelectCellDisplayString", () => {
  it("prefers label over value", () => {
    expect(
      pocketSelectCellDisplayString({ value: "opt_12", label: "石田幸樹" }),
    ).toBe("石田幸樹");
  });
});

describe("resolveConstructionHandlerSelectWriteValue", () => {
  it("writes option value when label matches staff name", () => {
    const resolved = resolveConstructionHandlerSelectWriteValue("石田幸樹", [
      { value: "opt_12", label: "石田幸樹" },
      { value: "森澤和真", label: "森澤和真" },
    ]);
    expect(resolved).toEqual({
      ok: true,
      writeValue: "opt_12",
      matchedByOption: true,
    });
  });

  it("falls back to name when options are empty", () => {
    const resolved = resolveConstructionHandlerSelectWriteValue("石田幸樹", []);
    expect(resolved).toEqual({
      ok: true,
      writeValue: "石田幸樹",
      matchedByOption: false,
    });
  });

  it("rejects unknown name when options exist", () => {
    const resolved = resolveConstructionHandlerSelectWriteValue("存在しない", [
      { value: "opt_12", label: "石田幸樹" },
    ]);
    expect(resolved).toEqual({ ok: false, reason: "not_in_options" });
  });
});

describe("resolveConstructionHandlerWriteValue", () => {
  it("uses field options when present", () => {
    const resolved = resolveConstructionHandlerWriteValue({
      staffName: "石田幸樹",
      handlerFieldId: "handler",
      constructionFields: [
        {
          uniqueId: "handler",
          options: [{ value: "opt_12", label: "石田幸樹" }],
        },
      ],
    });
    expect(resolved).toEqual({
      ok: true,
      writeValue: "opt_12",
      displayName: "石田幸樹",
    });
  });

  it("infers option value from existing records", () => {
    const resolved = resolveConstructionHandlerWriteValue({
      staffName: "石田幸樹",
      handlerFieldId: "handler",
      constructionFields: [{ uniqueId: "handler" }],
      sampleRows: [
        {
          record: {
            handler: { value: "opt_12", label: "石田幸樹" },
          },
        },
      ],
    });
    expect(resolved).toEqual({
      ok: true,
      writeValue: "opt_12",
      displayName: "石田幸樹",
    });
  });
});

describe("collectSelectOptionsFromRecordCells", () => {
  it("collects value/label pairs", () => {
    const options = collectSelectOptionsFromRecordCells(
      [
        { record: { handler: { value: "a", label: "山田" } } },
        { record: { handler: "森澤和真" } },
      ],
      "handler",
    );
    expect(options).toEqual(
      expect.arrayContaining([
        { value: "a", label: "山田" },
        { value: "森澤和真", label: "森澤和真" },
      ]),
    );
  });
});
