import { describe, expect, it } from "vitest";

import type { AtPocketFieldRow } from "@/lib/atpocket";
import { applyAttendanceAutoNumberOnCreate } from "@/lib/attendance-fields";
import { applyImportKeyForWrite } from "@/lib/pocket-import-key-payload";
import { applyWorkEndReportAutoNumberOnCreate } from "@/lib/work-end-report-fields";

/**
 * 取込キー（自動採番の列）の規約。
 *   - 作成時は空文字（@pocket に採番させる）
 *   - 更新時は既存の値（空文字や未指定で送ると更新が落ちる）
 */

describe("★ 作成時は空文字を載せる", () => {
  it("★ 指定した列に空文字が入る", () => {
    const out = applyImportKeyForWrite(
      { "field-1": "社員A" },
      { importKeyFieldId: "field-3", mode: "create" },
    );
    expect(out).toEqual({ "field-1": "社員A", "field-3": "" });
  });

  it("★ 呼び出し側が値を入れていても空文字で上書きする（番号を手で決めない）", () => {
    const out = applyImportKeyForWrite(
      { "field-3": "123" },
      { importKeyFieldId: "field-3", mode: "create" },
    );
    expect(out["field-3"]).toBe("");
  });

  it("元の payload は書き換えない", () => {
    const payload = { "field-1": "社員A" };
    applyImportKeyForWrite(payload, { importKeyFieldId: "field-3", mode: "create" });
    expect(payload).toEqual({ "field-1": "社員A" });
  });
});

describe("★ 更新時は既存の値を載せる", () => {
  it("★ 既存の値が入る", () => {
    const out = applyImportKeyForWrite(
      { "field-2": "有給" },
      { importKeyFieldId: "field-3", mode: "update", existingValue: "42" },
    );
    expect(out).toEqual({ "field-2": "有給", "field-3": "42" });
  });

  it("★ 既存の値が空なら空文字で送らず例外にする", () => {
    expect(() =>
      applyImportKeyForWrite(
        {},
        { importKeyFieldId: "field-3", mode: "update", existingValue: "  " },
      ),
    ).toThrow();
    expect(() =>
      applyImportKeyForWrite(
        {},
        { importKeyFieldId: "field-3", mode: "update", existingValue: null },
      ),
    ).toThrow();
  });
});

describe("★ 列IDが無いときは何もしない", () => {
  it("列IDが空なら payload をそのまま返す", () => {
    const out = applyImportKeyForWrite(
      { "field-1": "社員A" },
      { importKeyFieldId: " ", mode: "create" },
    );
    expect(out).toEqual({ "field-1": "社員A" });
  });
});

describe("★ 既存の2つの関数に影響していない", () => {
  const fields: AtPocketFieldRow[] = [
    { uniqueId: "field-1", caption: "社員名", fieldType: "Text" },
    { uniqueId: "field-9", caption: "自動採番", fieldType: "AutoNumber", primaryKey: true },
    { uniqueId: "field-8", caption: "作成日時", fieldType: "CreatedAt" },
  ];

  it("★ 勤怠: 自動採番に空文字、システム列は外す（従来どおり）", () => {
    const out = applyAttendanceAutoNumberOnCreate(
      { "field-1": "社員A", "field-8": "x" },
      fields,
    );
    expect(out).toEqual({ "field-1": "社員A", "field-9": "" });
  });

  it("★ 稼働終了報告: 自動採番に空文字、システム列は外す（従来どおり）", () => {
    const out = applyWorkEndReportAutoNumberOnCreate(
      { "field-1": "社員A", "field-8": "x" },
      fields,
    );
    expect(out).toEqual({ "field-1": "社員A", "field-9": "" });
  });
});
