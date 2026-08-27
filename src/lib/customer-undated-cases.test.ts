import { describe, expect, it } from "vitest";

import {
  buildUndatedCustomerCases,
  customerHousingStatusToShort,
  isUndatedCustomerCase,
} from "@/lib/customer-undated-cases";
import type {
  CrmSnapshot,
  CustomerCrmCandidate,
} from "@/lib/customer-crm-list";

/**
 * 第3段階 3-3: 未定案件をお客様情報アプリから取り出す。
 *
 * ここで固定するのは次の3つ。
 *   - 抽出条件（施工予定日が空・キャンセル以外・T番号あり）
 *   - T番号 が空のものを**一覧に出さない**（割り当てで顧客が二重になる）
 *   - isMyApCl の判定が担当顧客一覧と同じ audience 判定であること
 */

const AP = "field-10";
const CL = "field-11";
const CREATOR = "field-12";

function candidate(
  over: Partial<CustomerCrmCandidate> & { recordId: string },
): CustomerCrmCandidate {
  return {
    customerName: `顧客${over.recordId}`,
    subtitle: "",
    tNumber: `T0000${over.recordId}`,
    isDocumentMissing: false,
    isSubsidyTarget: false,
    combinedSubsidyName: null,
    isConstructionDateUnset: true,
    isCancelled: false,
    isCompleted: false,
    housingStatus: "既築案件",
    contractorName: "株式会社アルファ",
    sortKey: Number(over.recordId) || 0,
    audience: {},
    ...over,
  };
}

function snapshot(items: CustomerCrmCandidate[]): CrmSnapshot {
  return { items, apFieldId: AP, clFieldId: CL, creatorFieldId: CREATOR };
}

describe("抽出条件", () => {
  it("★ 施工予定日が空・キャンセル以外・T番号ありだけ出す", () => {
    const s = snapshot([
      candidate({ recordId: "1" }),
      // 施工予定日が入っている
      candidate({ recordId: "2", isConstructionDateUnset: false }),
      // キャンセル
      candidate({ recordId: "3", isCancelled: true }),
      // T番号 なし
      candidate({ recordId: "4", tNumber: "" }),
    ]);

    const { items } = buildUndatedCustomerCases(s, "");
    expect(items.map((i) => i.customerInfoRecordId)).toEqual(["1"]);
  });

  it("★ T番号 が空白だけでも除外する", () => {
    const s = snapshot([candidate({ recordId: "1", tNumber: "   " })]);
    expect(buildUndatedCustomerCases(s, "").items).toEqual([]);
  });

  it("お客様名が空なら除外する", () => {
    const s = snapshot([candidate({ recordId: "1", customerName: "  " })]);
    expect(buildUndatedCustomerCases(s, "").items).toEqual([]);
  });

  it("キャンセルは施工予定日が空でも出さない", () => {
    expect(
      isUndatedCustomerCase(
        candidate({ recordId: "9", isCancelled: true }),
      ),
    ).toBe(false);
  });

  it("お客様名順で並ぶ（旧一覧と同じ localeCompare の並び）", () => {
    const s = snapshot([
      candidate({ recordId: "1", customerName: "サトウ ハナコ" }),
      candidate({ recordId: "2", customerName: "アオキ イチロウ" }),
    ]);
    expect(
      buildUndatedCustomerCases(s, "").items.map((i) => i.customerName),
    ).toEqual(["アオキ イチロウ", "サトウ ハナコ"]);
  });
});

describe("表示項目", () => {
  it("★ customerInfoRecordId を返す（工事レコードのIDではない）", () => {
    const s = snapshot([candidate({ recordId: "cus-1" })]);
    const item = buildUndatedCustomerCases(s, "").items[0]!;
    expect(item.customerInfoRecordId).toBe("cus-1");
    expect(item).not.toHaveProperty("recordId");
  });

  it("住宅ステータス・施工業者・T番号を引き継ぐ", () => {
    const s = snapshot([
      candidate({
        recordId: "1",
        housingStatus: "新築案件",
        contractorName: "株式会社ベータ",
        tNumber: "T00003420",
      }),
    ]);
    const item = buildUndatedCustomerCases(s, "").items[0]!;
    expect(item.housingShort).toBe("新築");
    expect(item.contractorName).toBe("株式会社ベータ");
    expect(item.tNumber).toBe("T00003420");
  });

  it("住宅ステータスの略称はカレンダーと同じ", () => {
    expect(customerHousingStatusToShort("新築案件")).toBe("新築");
    expect(customerHousingStatusToShort("既築案件")).toBe("既築");
    expect(customerHousingStatusToShort("トラーチ倶楽部案件")).toBe("トラーチ");
    expect(customerHousingStatusToShort("産業用案件")).toBe("産業用");
    expect(customerHousingStatusToShort("")).toBe("");
  });
});

describe("isMyApCl", () => {
  it("★ AP/CL担当の案件に印が付く", () => {
    const s = snapshot([
      candidate({ recordId: "1", audience: { [AP]: "山田太郎" } }),
      candidate({ recordId: "2", audience: { [AP]: "佐藤花子" } }),
    ]);
    const { items, myItems } = buildUndatedCustomerCases(s, "山田太郎");

    expect(items.find((i) => i.customerInfoRecordId === "1")?.isMyApCl).toBe(
      true,
    );
    expect(
      items.find((i) => i.customerInfoRecordId === "2")?.isMyApCl,
    ).toBeUndefined();
    expect(myItems.map((i) => i.customerInfoRecordId)).toEqual(["1"]);
  });

  it("担当者が未設定で案件作成者が一致する場合も自分の担当（既存判定のまま）", () => {
    const s = snapshot([
      candidate({
        recordId: "1",
        audience: { [AP]: "-", [CL]: "-", [CREATOR]: "山田太郎" },
      }),
    ]);
    expect(buildUndatedCustomerCases(s, "山田太郎").myItems).toHaveLength(1);
  });

  it("担当者名が空なら myItems は空。items は全件のまま", () => {
    const s = snapshot([
      candidate({ recordId: "1", audience: { [AP]: "山田太郎" } }),
    ]);
    const { items, myItems } = buildUndatedCustomerCases(s, "");
    expect(items).toHaveLength(1);
    expect(myItems).toEqual([]);
  });
});
