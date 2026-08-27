import { afterEach, describe, expect, it } from "vitest";

import {
  resolveConstructionImportKeyFieldId,
  resolveConstructionTNumberFieldId,
} from "@/lib/calendar-kojo";
import { buildConstructionFillPatch } from "@/lib/calendar-construction-pocket-common";

/**
 * 工事アプリの取込キーが T番号 から Aki番号 へ移った件。
 *
 * @pocket 側で採番場所が入れ替わった。
 *   工事登録   Aki番号 = 自動採番（取込キー） / T番号 = テキスト（採番しない）
 *   お客様情報 T番号 = 自動採番            / Aki番号 = テキスト（突合キー）
 *
 * 取込キーの列が本文に無いと @pocket は作成も更新も 400 で弾く
 * （「取込設定にキー項目を追加してください」）。
 * この2つの列を取り違えないことをここで固定する。
 */

const FIELDS = [
  { uniqueId: "field-1", caption: "T番号" },
  { uniqueId: "field-2", caption: "お客様名" },
  { uniqueId: "field-3", caption: "施工予定日" },
  { uniqueId: "field-4", caption: "施工会社" },
  { uniqueId: "field-5", caption: "住宅ステータス" },
  { uniqueId: "field-101", caption: "Aki番号" },
];

afterEach(() => {
  delete process.env.CALENDAR_CONSTRUCTION_IMPORT_KEY_FIELD_ID;
  delete process.env.CALENDAR_CONSTRUCTION_UNIQUE_KEY_FIELD_ID;
  delete process.env.CALENDAR_EMPTY_FILL_TNUMBER_FIELD_ID;
});

describe("★ 取込キーと T番号 は別の列", () => {
  it("取込キーは Aki番号、T番号 は T番号 の列", () => {
    expect(resolveConstructionImportKeyFieldId(FIELDS)).toBe("field-101");
    expect(resolveConstructionTNumberFieldId(FIELDS)).toBe("field-1");
  });

  it("環境変数で差し替えられる", () => {
    process.env.CALENDAR_CONSTRUCTION_IMPORT_KEY_FIELD_ID = "field-101";
    expect(resolveConstructionImportKeyFieldId(FIELDS)).toBe("field-101");
  });

  it("見出しの表記ゆれも拾う", () => {
    for (const caption of ["Aki番号", "アキ番号", "AKI番号"]) {
      const fields = [{ uniqueId: "field-9", caption }];
      expect(resolveConstructionImportKeyFieldId(fields)).toBe("field-9");
    }
  });

  it("Aki番号 の列が無ければ null（T番号 で代用しない）", () => {
    const withoutAki = FIELDS.filter((f) => f.uniqueId !== "field-101");
    expect(resolveConstructionImportKeyFieldId(withoutAki)).toBeNull();
  });
});

describe("★ buildConstructionFillPatch", () => {
  const base = {
    resolvedCustomer: "field-2",
    resolvedHousing: "field-5",
    resolvedTNumber: "field-1",
    customerName: "山田 太郎",
    housingRaw: "既築案件",
    fids: {} as Parameters<typeof buildConstructionFillPatch>[0]["fids"],
  };

  it("取込キーの列は値が空でも必ず載せる（@pocket が採番する）", () => {
    const patch = buildConstructionFillPatch({
      ...base,
      resolvedImportKey: "field-101",
      importKeyValue: "",
      tNumberValue: "",
    });

    expect(patch).toHaveProperty("field-101", "");
  });

  it("★ T番号 が空なら載せない（既存の値を消さない）", () => {
    const patch = buildConstructionFillPatch({
      ...base,
      resolvedImportKey: "field-101",
      importKeyValue: "A0001",
      tNumberValue: "",
    });

    // 新規作成の時点では T番号 はまだ採番されていない
    expect(patch).not.toHaveProperty("field-1");
    expect(patch["field-101"]).toBe("A0001");
  });

  it("T番号 に値があれば載せる（連携後の書き戻し）", () => {
    const patch = buildConstructionFillPatch({
      ...base,
      resolvedImportKey: "field-101",
      importKeyValue: "A0001",
      tNumberValue: "T00003420",
    });

    expect(patch["field-1"]).toBe("T00003420");
  });

  it("お客様名・住宅ステータスは従来どおり載る", () => {
    const patch = buildConstructionFillPatch({
      ...base,
      resolvedImportKey: "field-101",
      importKeyValue: "A0001",
      tNumberValue: "",
    });

    expect(patch["field-2"]).toBe("山田 太郎");
    expect(patch["field-5"]).toBe("既築案件");
  });

  it("取込キーの列を渡さなければ載せない（呼び出し側が未対応でも壊さない）", () => {
    const patch = buildConstructionFillPatch({ ...base, tNumberValue: "T1" });

    expect(patch).not.toHaveProperty("field-101");
    expect(patch["field-1"]).toBe("T1");
  });
});
