import { describe, expect, it } from "vitest";

import {
  filterCrmCandidatesForStaff,
  type CrmSnapshot,
} from "@/lib/customer-crm-list";

/**
 * 担当者での絞り込みが、**キャッシュから取り出した後**に行われることの確認
 * （タスクO-3 / O-6-2・O-6-3）。
 *
 * キャッシュに載るのは絞り込み前の全件（CrmSnapshot）で、氏名を含むキーは
 * 使わない。ここでは「同じ snapshot から担当者ごとに違う結果が出る」ことで、
 * 絞り込みが取り出し後であることを示す。
 */

const AP = "field-10";
const CL = "field-11";
const CREATOR = "field-12";

function candidate(
  recordId: string,
  audience: Record<string, unknown>,
): CrmSnapshot["items"][number] {
  return {
    recordId,
    customerName: `顧客${recordId}`,
    subtitle: "",
    tNumber: `T0000${recordId}`,
    isDocumentMissing: false,
    isSubsidyTarget: false,
    combinedSubsidyName: null,
    isConstructionDateUnset: false,
    isCancelled: false,
    sortKey: Number(recordId),
    audience,
  };
}

/** 全件。誰の担当かは audience にだけ入っている */
const SNAPSHOT: CrmSnapshot = {
  apFieldId: AP,
  clFieldId: CL,
  creatorFieldId: CREATOR,
  items: [
    candidate("1", { [AP]: "山田太郎", [CL]: "鈴木一郎" }),
    candidate("2", { [AP]: "佐藤花子", [CL]: "高橋二郎" }),
    candidate("3", { [AP]: "-", [CL]: "-", [CREATOR]: "山田太郎" }),
    candidate("4", { [AP]: "佐藤花子", [CL]: "山田太郎" }),
  ],
};

describe("filterCrmCandidatesForStaff", () => {
  it("★ 同じ全件データから、担当者ごとに違う結果が出る", () => {
    const yamada = filterCrmCandidatesForStaff(SNAPSHOT, "山田太郎");
    const sato = filterCrmCandidatesForStaff(SNAPSHOT, "佐藤花子");

    // 山田: AP一致(1) / 担当者未設定＋作成者一致(3) / CL一致(4)
    expect(yamada.map((c) => c.recordId)).toEqual(["1", "3", "4"]);
    // 佐藤: AP一致(2, 4)
    expect(sato.map((c) => c.recordId)).toEqual(["2", "4"]);
  });

  it("★ キャッシュ側（snapshot）は誰の担当かで絞られていない", () => {
    // 絞り込み済みを非依存キーへ入れていないことの裏返し。
    // snapshot は常に全件のままで、呼び出しても変化しない
    filterCrmCandidatesForStaff(SNAPSHOT, "山田太郎");
    expect(SNAPSHOT.items).toHaveLength(4);
    expect(SNAPSHOT.items.map((c) => c.recordId)).toEqual(["1", "2", "3", "4"]);
  });

  it("担当者が未設定でも作成者が一致すれば含める（既存の判定そのまま）", () => {
    const only = filterCrmCandidatesForStaff(
      { ...SNAPSHOT, items: [SNAPSHOT.items[2]!] },
      "山田太郎",
    );
    expect(only).toHaveLength(1);
  });

  it("担当者が入っていれば、作成者一致だけでは含めない", () => {
    const snapshot: CrmSnapshot = {
      ...SNAPSHOT,
      items: [candidate("9", { [AP]: "佐藤花子", [CREATOR]: "山田太郎" })],
    };
    expect(filterCrmCandidatesForStaff(snapshot, "山田太郎")).toHaveLength(0);
  });

  it("該当が無ければ空", () => {
    expect(filterCrmCandidatesForStaff(SNAPSHOT, "存在しない人")).toEqual([]);
  });

  it("担当者名が空なら空（全件を誤って返さない）", () => {
    expect(filterCrmCandidatesForStaff(SNAPSHOT, "")).toEqual([]);
    expect(filterCrmCandidatesForStaff(SNAPSHOT, "   ")).toEqual([]);
  });

  it("全角半角・空白のゆれを吸収する", () => {
    const snapshot: CrmSnapshot = {
      ...SNAPSHOT,
      items: [candidate("9", { [AP]: "山田 太郎" })],
    };
    expect(filterCrmCandidatesForStaff(snapshot, "山田　太郎")).toHaveLength(1);
  });
});
