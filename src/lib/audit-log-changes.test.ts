import { describe, expect, it } from "vitest";

import {
  AUDIT_REDACTED,
  auditValueToString,
  computeAuditChanges,
  formatAuditValue,
  formatChangeLine,
  formatDeletionContent,
  formatOverflowSummary,
} from "@/lib/audit-log-changes";

/**
 * 既存の別システムが書き込んでいる「変更内容」の実例。
 * この文字列と1文字でも変わると、更新履歴アプリ上で既存行と見分けがつかなくなる。
 */
const EXISTING_SAMPLE = "備考: （空） → 特になし";

describe("既存データとの書式一致（最重要）", () => {
  it("既存の実例とバイト単位で一致する", () => {
    const line = formatChangeLine({
      fieldId: "field-30",
      label: "備考",
      before: "",
      after: "特になし",
    });
    expect(line).toBe(EXISTING_SAMPLE);
  });

  it("区切り記号が想定どおり（全角矢印・前後に半角スペース1つ・全角括弧）", () => {
    const line = formatChangeLine({
      fieldId: "f",
      label: "L",
      before: "",
      after: "A",
    });
    expect(line).toBe("L: （空） → A");
    // 矢印は U+2192、括弧は U+FF08 / U+FF09
    expect(line).toContain(" → ");
    expect(line).toContain("（空）");
    expect(line).not.toContain("->");
    expect(line).not.toContain("(空)");
  });
});

describe("auditValueToString", () => {
  it("文字列・数値・真偽値を文字列にする", () => {
    expect(auditValueToString("  奈良市  ")).toBe("奈良市");
    expect(auditValueToString(1200)).toBe("1200");
    expect(auditValueToString(false)).toBe("false");
  });

  it("null / undefined は空文字", () => {
    expect(auditValueToString(null)).toBe("");
    expect(auditValueToString(undefined)).toBe("");
  });

  it("選択肢列は value(ID) ではなく label を優先する", () => {
    expect(auditValueToString({ value: "opt_3", label: "契約済" })).toBe("契約済");
  });

  it("label が無ければ value を使う", () => {
    expect(auditValueToString({ value: "契約済" })).toBe("契約済");
  });

  it("配列はカンマ区切りにする", () => {
    expect(auditValueToString(["A", "B"])).toBe("A, B");
    expect(auditValueToString([{ label: "太陽光" }, { label: "蓄電池" }])).toBe(
      "太陽光, 蓄電池",
    );
  });

  it("改行・タブは半角スペースに畳む（1行1レコードの書式を壊さない）", () => {
    expect(auditValueToString("1行目\n2行目")).toBe("1行目 2行目");
    expect(auditValueToString("a\t\tb")).toBe("a b");
    expect(auditValueToString("a\r\nb\nc")).toBe("a b c");
  });
});

describe("formatAuditValue", () => {
  it("空文字・ハイフン・全角ハイフンは（空）", () => {
    expect(formatAuditValue("")).toBe("（空）");
    expect(formatAuditValue("-")).toBe("（空）");
    expect(formatAuditValue("－")).toBe("（空）");
    expect(formatAuditValue("   ")).toBe("（空）");
  });

  it("既定200文字を超えたら切り詰めて…を付ける", () => {
    const long = "あ".repeat(250);
    const out = formatAuditValue(long);
    expect(out).toBe(`${"あ".repeat(200)}…`);
    expect(out).toHaveLength(201);
  });

  it("ちょうど200文字は切り詰めない", () => {
    const exact = "あ".repeat(200);
    expect(formatAuditValue(exact)).toBe(exact);
    expect(formatAuditValue(exact)).not.toContain("…");
  });

  it("最大長は指定できる", () => {
    expect(formatAuditValue("あいうえお", 3)).toBe("あいう…");
  });
});

describe("computeAuditChanges", () => {
  it("after に含まれる列だけを比較する（@pocket は部分更新のため）", () => {
    const changes = computeAuditChanges(
      { "field-1": "旧", "field-2": "触っていない" },
      { "field-1": "新" },
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      fieldId: "field-1",
      before: "旧",
      after: "新",
    });
  });

  it("値が変わっていない列は差分に出さない", () => {
    expect(
      computeAuditChanges({ "field-1": "同じ" }, { "field-1": "同じ" }),
    ).toEqual([]);
  });

  it("空文字・ハイフン・全角ハイフンは「値なし」として同一視する", () => {
    expect(computeAuditChanges({ "field-1": "-" }, { "field-1": "" })).toEqual([]);
    expect(computeAuditChanges({ "field-1": "－" }, { "field-1": "-" })).toEqual([]);
    expect(computeAuditChanges({}, { "field-1": "-" })).toEqual([]);
  });

  it("全角/半角と連続空白の差は変更とみなさない", () => {
    expect(
      computeAuditChanges({ "field-1": "田中　孝明" }, { "field-1": "田中 孝明" }),
    ).toEqual([]);
  });

  it("before が無いとき（新規作成）は after だけが載る", () => {
    const changes = computeAuditChanges(null, { "field-1": "新規" });
    expect(changes[0]).toMatchObject({ before: "", after: "新規" });
    expect(formatChangeLine(changes[0])).toBe("field-1: （空） → 新規");
  });

  it("labelOf で見出しを解決し、解決できなければ fieldId を使う", () => {
    const changes = computeAuditChanges(
      {},
      { "field-1": "a", "field-9": "b" },
      { labelOf: (id) => (id === "field-1" ? "お客様名" : null) },
    );
    expect(changes.map((c) => c.label).sort()).toEqual(["field-9", "お客様名"]);
  });

  it("redactFieldIds の列は差分検知だけして値を伏せる", () => {
    const changes = computeAuditChanges(
      { "field-9": "1111" },
      { "field-9": "2222" },
      { redactFieldIds: new Set(["field-9"]) },
    );
    expect(changes).toHaveLength(1);
    expect(formatChangeLine(changes[0])).toBe(
      `field-9: ${AUDIT_REDACTED} → ${AUDIT_REDACTED}`,
    );
  });
});

describe("偽差分の防止（比較用の正規化）", () => {
  const diff = (before: unknown, after: unknown) =>
    computeAuditChanges({ f: before }, { f: after });

  it("2026-03-01 と 2026/03/01 が差分にならない（報告された不具合）", () => {
    expect(diff("2026-03-01", "2026/03/01")).toEqual([]);
    expect(diff("2026/03/01", "2026-03-01")).toEqual([]);
  });

  it("実際に報告された3項目がいずれも差分にならない", () => {
    expect(
      computeAuditChanges(
        {
          keiyaku: "2026-03-01",
          sekou: "2026-03-16",
          shokai: "2026-03-01",
        },
        {
          keiyaku: "2026/03/01",
          sekou: "2026/03/16",
          shokai: "2026/03/01",
        },
      ),
    ).toEqual([]);
  });

  it("ゼロ埋めの有無・年月日区切りも同一とみなす", () => {
    expect(diff("2026-3-1", "2026/03/01")).toEqual([]);
    expect(diff("2026年3月1日", "2026/03/01")).toEqual([]);
    expect(diff("2026.03.01", "2026-03-01")).toEqual([]);
  });

  it("null と \"\" が差分にならない", () => {
    expect(diff(null, "")).toEqual([]);
    expect(diff(undefined, "")).toEqual([]);
    expect(diff(null, undefined)).toEqual([]);
    expect(diff("", "-")).toEqual([]);
  });

  it("全角数字と半角数字が差分にならない", () => {
    expect(diff("１２３", "123")).toEqual([]);
    expect(diff("２０２６／０３／０１", "2026-03-01")).toEqual([]);
  });

  it("数値の桁区切り・小数末尾ゼロを同一とみなす", () => {
    expect(diff("1,200", "1200")).toEqual([]);
    expect(diff("12", "12.0")).toEqual([]);
    expect(diff("12.50", "12.5")).toEqual([]);
  });

  it("前後の空白差は差分にならない", () => {
    expect(diff("  値  ", "値")).toEqual([]);
  });

  // ── 正規化しすぎていないこと ──────────────────────
  it("2026-03-01 と 2026-03-02 は差分になる", () => {
    const changes = diff("2026-03-01", "2026-03-02");
    expect(changes).toHaveLength(1);
    expect(formatChangeLine(changes[0])).toBe("f: 2026-03-01 → 2026-03-02");
  });

  it("年や月が違えば差分になる", () => {
    expect(diff("2026-03-01", "2027-03-01")).toHaveLength(1);
    expect(diff("2026-03-01", "2026-04-01")).toHaveLength(1);
  });

  it("先行ゼロのコード値は潰さない（007 と 7 は別物）", () => {
    expect(diff("007", "7")).toHaveLength(1);
  });

  it("数値が実際に変われば差分になる", () => {
    expect(diff("1200", "1300")).toHaveLength(1);
    expect(diff("12", "12.5")).toHaveLength(1);
  });

  it("日付でない数字列を日付として潰さない", () => {
    // 月・日として不正なので日付扱いしない
    expect(diff("1234-56-78", "1234-56-79")).toHaveLength(1);
  });

  it("空 → 値ありは差分になる", () => {
    const changes = diff(null, "2026-03-01");
    expect(changes).toHaveLength(1);
    expect(formatChangeLine(changes[0])).toBe("f: （空） → 2026-03-01");
  });

  it("表示は正規化前の元の値のまま（比較だけ正規化する）", () => {
    const changes = diff("2026-03-01", "2026/03/02");
    expect(formatChangeLine(changes[0])).toBe("f: 2026-03-01 → 2026/03/02");
  });

  it("変更なしの保存では空配列を返す（1レコードも書かせない）", () => {
    expect(
      computeAuditChanges(
        { a: "2026-03-01", b: "1,200", c: null, d: "値" },
        { a: "2026/03/01", b: "1200", d: "値" },
      ),
    ).toEqual([]);
  });
});

describe("formatDeletionContent（A-4: 削除は全項目を1レコード）", () => {
  it("各行が「<ラベル>: <値> → （削除）」で改行区切り", () => {
    const out = formatDeletionContent(
      { "field-1": "T00001691", "field-2": "山田太郎" },
      { labelOf: (id) => (id === "field-1" ? "T番号" : "お客様名") },
    );
    expect(out.split("\n")).toEqual([
      "T番号: T00001691 → （削除）",
      "お客様名: 山田太郎 → （削除）",
    ]);
  });

  it("空欄の項目は出力に含めない（可読性・復元に寄与しないため）", () => {
    const out = formatDeletionContent({
      "field-1": "値あり",
      "field-2": "",
      "field-3": "-",
    });
    expect(out).not.toContain("（空）");
    expect(out.split("\n")).toEqual([
      "field-1: 値あり → （削除）",
      "（他2項目は空欄）",
    ]);
  });

  it("値のある項目は1つも省かない（削除に行数上限を適用しない）", () => {
    const record: Record<string, unknown> = {};
    for (let i = 0; i < 40; i++) record[`v${i}`] = `値${i}`;
    for (let i = 0; i < 15; i++) record[`e${i}`] = "";
    const lines = formatDeletionContent(record).split("\n");
    expect(lines).toHaveLength(41);
    for (let i = 0; i < 40; i++) {
      expect(lines).toContain(`v${i}: 値${i} → （削除）`);
    }
    expect(lines[lines.length - 1]).toBe("（他15項目は空欄）");
  });

  it("空欄が無ければ集計行を付けない", () => {
    const out = formatDeletionContent({ a: "1", b: "2" });
    expect(out.split("\n")).toEqual(["a: 1 → （削除）", "b: 2 → （削除）"]);
    expect(out).not.toContain("項目は空欄");
  });

  it("全項目が空でも集計行だけは返す（0件を失敗にしない）", () => {
    const out = formatDeletionContent({ a: "", b: "-", c: "－" });
    expect(out).toBe("（他3項目は空欄）");
    expect(out).not.toBe("");
  });

  it("項目が1つも無ければ空文字（レコードを読めていないケース）", () => {
    expect(formatDeletionContent({})).toBe("");
  });
});

describe("formatOverflowSummary（A-1: 上限超過分）", () => {
  it("「他N件の項目を変更（項目名...）」の形式で値は省略する", () => {
    const overflow = [
      { fieldId: "a", label: "住所", before: "旧住所", after: "新住所" },
      { fieldId: "b", label: "電話番号", before: "000", after: "111" },
    ];
    expect(formatOverflowSummary(overflow)).toBe(
      "他2件の項目を変更（住所, 電話番号）",
    );
    expect(formatOverflowSummary(overflow)).not.toContain("旧住所");
    expect(formatOverflowSummary(overflow)).not.toContain("→");
  });

  it("超過が無ければ空文字", () => {
    expect(formatOverflowSummary([])).toBe("");
  });
});
