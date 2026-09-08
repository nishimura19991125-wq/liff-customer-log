import { describe, expect, it } from "vitest";

import { sortByValueThenTarget } from "@/lib/sales-dashboard-ranking-sort";

function item(name: string, pt: number) {
  return { name, pt };
}

/** 並んだ結果の氏名だけを取り出す */
function order(
  items: Array<{ name: string; pt: number }>,
  targets: Record<string, number> = {},
): string[] {
  return sortByValueThenTarget(
    items,
    (x) => x.pt,
    new Map(Object.entries(targets)),
  ).map((x) => x.name);
}

describe("★ PT の降順", () => {
  it("PT が違えば PT の降順", () => {
    expect(
      order([item("安藤", 100), item("近藤", 300), item("伊藤", 200)]),
    ).toEqual(["近藤", "伊藤", "安藤"]);
  });

  it("目標が高くても PT が低ければ下に来る", () => {
    expect(
      order([item("安藤", 100), item("近藤", 300)], {
        安藤: 9_999_999,
        近藤: 1,
      }),
    ).toEqual(["近藤", "安藤"]);
  });
});

describe("★ PT が同じときは目標の降順", () => {
  it("目標が高い人が上に来る", () => {
    expect(
      order([item("安藤", 100), item("近藤", 100), item("伊藤", 100)], {
        安藤: 200,
        近藤: 500,
        伊藤: 300,
      }),
    ).toEqual(["近藤", "伊藤", "安藤"]);
  });

  it("PT が 0 の人同士でも目標順に並ぶ", () => {
    expect(
      order([item("安藤", 0), item("近藤", 0), item("伊藤", 0)], {
        安藤: 100,
        近藤: 300,
        伊藤: 200,
      }),
    ).toEqual(["近藤", "伊藤", "安藤"]);
  });

  it("目標が未設定の人は 0 として扱い、目標がある人より下に来る", () => {
    expect(
      order([item("安藤", 0), item("近藤", 0)], { 近藤: 1 }),
    ).toEqual(["近藤", "安藤"]);
  });
});

describe("★ PT・目標とも同じなら氏名の五十音順", () => {
  it("目標がどちらも設定済みで同額", () => {
    expect(
      order([item("近藤", 100), item("安藤", 100)], { 安藤: 500, 近藤: 500 }),
    ).toEqual(["安藤", "近藤"]);
  });

  it("PT も目標も 0（どちらも未設定）", () => {
    expect(order([item("近藤", 0), item("伊藤", 0), item("安藤", 0)])).toEqual([
      "安藤",
      "伊藤",
      "近藤",
    ]);
  });
});

describe("★ 防御", () => {
  it("元の配列を書き換えない", () => {
    const items = [item("安藤", 100), item("近藤", 300)];
    sortByValueThenTarget(items, (x) => x.pt, new Map());
    expect(items.map((x) => x.name)).toEqual(["安藤", "近藤"]);
  });

  it("空でも落ちない", () => {
    expect(
      sortByValueThenTarget<{ name: string; pt: number }>(
        [],
        (x) => x.pt,
        new Map(),
      ),
    ).toEqual([]);
  });

  it("目標のマップが空でも PT と氏名で並ぶ", () => {
    expect(order([item("近藤", 100), item("安藤", 100), item("伊藤", 200)])).toEqual([
      "伊藤",
      "安藤",
      "近藤",
    ]);
  });

  it("並び替えのキーに無い項目（契約件数など）は順序に影響しない", () => {
    const rows = [
      { name: "近藤", pt: 100, contractCount: 99 },
      { name: "安藤", pt: 100, contractCount: 0 },
    ];
    expect(
      sortByValueThenTarget(rows, (x) => x.pt, new Map()).map((x) => x.name),
    ).toEqual(["安藤", "近藤"]);
  });
});
