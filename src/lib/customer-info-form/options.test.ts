import { describe, expect, it } from "vitest";

import {
  CUSTOMER_STATUS_DEFAULT,
  CUSTOMER_STATUS_OPTIONS,
  INPUT_STATUS_COMPLETE,
  INPUT_STATUS_OPTIONS,
  INPUT_STATUS_PENDING,
  customerStatusWithDefault,
} from "@/lib/customer-info-form/options";
import { CUSTOMER_INFO_FORM_FIELD_MAP } from "@/lib/customer-info-form/schema";
import { CUSTOMER_STATUS_CANCELLED } from "@/lib/customer-status-label";

/**
 * 設定値が選択肢に含まれていないと、画面のリストが未選択に見えるのに
 * 値だけが入る状態になる（タスクG の書類16項目で実害が出た）。
 * 顧客ステータス・入力ステータスも同じ形で固定する。
 */

describe("★ 顧客ステータスの選択肢と設定値の整合", () => {
  it("@pocket の実物と一致している", () => {
    expect([...CUSTOMER_STATUS_OPTIONS]).toEqual([
      "工事待ち",
      "完工",
      "残工",
      "完了",
      "キャンセル",
    ]);
  });

  it("初期値が選択肢に含まれる", () => {
    expect([...CUSTOMER_STATUS_OPTIONS]).toContain(CUSTOMER_STATUS_DEFAULT);
  });

  it("★ キャンセル処理のトリガー値が選択肢に含まれる", () => {
    // 含まれないと、キャンセルにしたくても画面から選べない
    expect([...CUSTOMER_STATUS_OPTIONS]).toContain(CUSTOMER_STATUS_CANCELLED);
  });

  it("フォームの選択肢が options.ts と同じ", () => {
    const def = CUSTOMER_INFO_FORM_FIELD_MAP.get("customerStatus");
    expect(def?.caption).toBe("顧客ステータス");
    expect(def?.options ?? []).toEqual([...CUSTOMER_STATUS_OPTIONS]);
  });

  it("重複や空の選択肢が無い", () => {
    const values = [...CUSTOMER_STATUS_OPTIONS];
    expect(new Set(values).size).toBe(values.length);
    for (const v of values) expect(v.trim()).toBe(v);
    expect(values.every(Boolean)).toBe(true);
  });

  it("未設定なら初期値を返す", () => {
    expect(customerStatusWithDefault("")).toBe(CUSTOMER_STATUS_DEFAULT);
    expect(customerStatusWithDefault(null)).toBe(CUSTOMER_STATUS_DEFAULT);
    expect(customerStatusWithDefault("キャンセル")).toBe("キャンセル");
    expect(customerStatusWithDefault("完工")).toBe("完工");
  });
});

describe("入力ステータスの選択肢と設定値の整合", () => {
  it("完了値・未入力値が選択肢に含まれる", () => {
    expect([...INPUT_STATUS_OPTIONS]).toContain(INPUT_STATUS_COMPLETE);
    expect([...INPUT_STATUS_OPTIONS]).toContain(INPUT_STATUS_PENDING);
  });

  it("フォームの選択肢が options.ts と同じ", () => {
    const def = CUSTOMER_INFO_FORM_FIELD_MAP.get("inputStatus");
    expect(def?.caption).toBe("入力ステータス");
    expect(def?.options ?? []).toEqual([...INPUT_STATUS_OPTIONS]);
  });
});
