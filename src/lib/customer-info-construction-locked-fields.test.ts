import { describe, expect, it } from "vitest";

import {
  CUSTOMER_INFO_CONSTRUCTION_LOCKED_FIELDS,
  CUSTOMER_INFO_CONSTRUCTION_LOCKED_FIELD_LABELS,
  CUSTOMER_INFO_CONSTRUCTION_LOCKED_HINT,
  isCustomerInfoConstructionFieldLocked,
  stripCustomerInfoConstructionFieldsFromPayload,
} from "@/lib/customer-info-construction-locked-fields";
import { CUSTOMER_INFO_FORM_FIELDS } from "@/lib/customer-info-form/schema";

/**
 * お客様情報から施工予定日・施工業者を変更できないようにした件。
 *
 * 施工予定日の割り当ては工事カレンダーからのみ行う方針になったため、
 * お客様情報側は表示だけにする。
 *
 * 画面（入力欄を出すか）とサーバ（payload に載せるか）が同じ定義を見る。
 * 片方だけ塞いでも、古いキャッシュの画面や API の直叩きで書けてしまう。
 */

describe("★ 対象の項目", () => {
  it("施工予定日・施工業者・初回施工予定日の3つ", () => {
    expect([...CUSTOMER_INFO_CONSTRUCTION_LOCKED_FIELDS]).toEqual([
      "constructionDate",
      "constructionContractor",
      "firstConstructionDate",
    ]);
  });

  it("判定はキーで行う", () => {
    expect(isCustomerInfoConstructionFieldLocked("constructionDate")).toBe(true);
    expect(isCustomerInfoConstructionFieldLocked("constructionContractor")).toBe(
      true,
    );
    expect(isCustomerInfoConstructionFieldLocked("customerName")).toBe(false);
  });

  it("★ 初回施工予定日も対象", () => {
    /*
     * 工事カレンダー連携が書く列。お客様情報側で編集しても次の連携で
     * 上書きされるため、「編集できるのに保存されない」状態を作らない
     */
    expect(isCustomerInfoConstructionFieldLocked("firstConstructionDate")).toBe(
      true,
    );
  });

  it("全項目にラベルがある", () => {
    for (const key of CUSTOMER_INFO_CONSTRUCTION_LOCKED_FIELDS) {
      expect(CUSTOMER_INFO_CONSTRUCTION_LOCKED_FIELD_LABELS[key]).toBeTruthy();
    }
  });

  it("★ どちらもフォーム定義で必須ではない", () => {
    /*
     * 編集できないのに必須だと、値が空の既存レコードで保存できなくなる。
     * 必須にするなら、先にこのロックを外す必要がある
     */
    for (const key of CUSTOMER_INFO_CONSTRUCTION_LOCKED_FIELDS) {
      const spec = CUSTOMER_INFO_FORM_FIELDS.find((f) => f.key === key);
      expect(spec).toBeDefined();
      expect(spec?.required ?? false).toBe(false);
    }
  });

  it("補足文はどこで変更するかまで書く", () => {
    expect(CUSTOMER_INFO_CONSTRUCTION_LOCKED_HINT).toContain("工事カレンダー");
  });
});

describe("★ payload から落とす", () => {
  const fieldIdOf = (key: string): string | null =>
    key === "constructionDate"
      ? "field-9"
      : key === "constructionContractor"
        ? "field-4"
        : key === "firstConstructionDate"
          ? "field-8"
          : null;

  it("★ 3列とも落とす", () => {
    const payload: Record<string, unknown> = {
      "field-9": "2026/12/01",
      "field-4": "ピュアライフ",
      "field-8": "2026/11/01",
      "field-2": "山田 太郎",
    };

    const dropped = stripCustomerInfoConstructionFieldsFromPayload(
      payload,
      fieldIdOf,
    );

    expect(dropped).toEqual([
      "constructionDate",
      "constructionContractor",
      "firstConstructionDate",
    ]);
    expect(payload).toEqual({ "field-2": "山田 太郎" });
  });

  it("★ 他の項目は残す（保存を巻き込まない）", () => {
    const payload: Record<string, unknown> = {
      "field-9": "2026/12/01",
      "field-2": "山田 太郎",
      "field-11": "西村 直也",
    };

    stripCustomerInfoConstructionFieldsFromPayload(payload, fieldIdOf);

    expect(payload).toEqual({
      "field-2": "山田 太郎",
      "field-11": "西村 直也",
    });
  });

  it("空文字でも落とす（空にする更新も通さない）", () => {
    const payload: Record<string, unknown> = { "field-9": "" };

    const dropped = stripCustomerInfoConstructionFieldsFromPayload(
      payload,
      fieldIdOf,
    );

    expect(dropped).toEqual(["constructionDate"]);
    expect(payload).toEqual({});
  });

  it("元から入っていなければ何もしない", () => {
    const payload: Record<string, unknown> = { "field-2": "山田 太郎" };

    const dropped = stripCustomerInfoConstructionFieldsFromPayload(
      payload,
      fieldIdOf,
    );

    expect(dropped).toEqual([]);
    expect(payload).toEqual({ "field-2": "山田 太郎" });
  });

  it("列を解決できない項目は飛ばす", () => {
    const payload: Record<string, unknown> = { "field-9": "2026/12/01" };

    const dropped = stripCustomerInfoConstructionFieldsFromPayload(
      payload,
      () => null,
    );

    expect(dropped).toEqual([]);
    expect(payload).toEqual({ "field-9": "2026/12/01" });
  });
});
