import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { CalendarMonthApiItem } from "@/lib/calendar-api-types";
import { buildCalendarPayload } from "@/lib/calendar-kojo";
import { buildContractRecordMap } from "@/lib/contract-records";
import { buildZankoCaseEntries } from "@/lib/zanko-cards";
import { buildZankoIndex } from "@/lib/zanko-index";
import { ZANKO_NO_DATE_WARN_TITLE } from "@/lib/zanko-gray-colors";
import { shouldWarnZankoNoDate } from "@/lib/zanko-postpone";

/**
 * 残工日が未定の案件の ⚠️ と赤枠（残工 段階4-a）。
 *
 *   ZANKO_NO_DATE_WARN_MODE = "anyEmpty"
 *     186 に同じ T番号 で残工日が空のレコードが1件でもあれば出す
 *     （古いレコードに日付があっても、新しいのが空なら出す）
 *   ZANKO_NO_DATE_WARN_SKIP_REPORTED = true
 *     完了報告がある工程のカードには出さない（✅ と同じ判定）。
 *     工事報告を読めていなければ「報告なし」として出す
 *   出す場所: 工事登録側のカード（施工予定日・新築・産業用の4日程）。
 *            【残工】カードには出さない
 *   見た目: 赤枠 #dc2626・2px（カードの内側）、⚠️ 16px（640px 以下 14px）
 */

const FIDS = { tNumberFieldId: "z-3", dateFieldId: "z-7" };

function index(rows: Array<[string, string]>) {
  return buildZankoIndex(
    rows.map(([t, d], i) => ({ recordId: i + 1, record: { "z-3": t, "z-7": d } })),
    FIDS,
  );
}

describe("shouldWarnZankoNoDate", () => {
  it("★ 残工日が空のレコードがあれば出す", () => {
    expect(shouldWarnZankoNoDate(index([["T0001", ""]]), "T0001", false)).toBe(true);
  });

  it("★ 古いレコードに日付があっても、新しいのが空なら出す（anyEmpty）", () => {
    const idx = index([
      ["T0001", "2026-10-01"],
      ["T0001", ""],
    ]);
    expect(shouldWarnZankoNoDate(idx, "T0001", false)).toBe(true);
  });

  it("★ 全部に残工日が入っていれば出さない", () => {
    const idx = index([
      ["T0001", "2026-10-01"],
      ["T0001", "2026-11-01"],
    ]);
    expect(shouldWarnZankoNoDate(idx, "T0001", false)).toBe(false);
  });

  it("★ 186 に無い・T番号 が空なら出さない", () => {
    const idx = index([["T0001", ""]]);
    expect(shouldWarnZankoNoDate(idx, "T0009", false)).toBe(false);
    expect(shouldWarnZankoNoDate(idx, "", false)).toBe(false);
  });

  it("★ 完了報告がある工程には出さない", () => {
    expect(shouldWarnZankoNoDate(index([["T0001", ""]]), "T0001", true)).toBe(false);
  });
});

// ── 工事カレンダーの月データ ──

const F = {
  name: "field-1",
  start: "field-2",
  housing: "field-3",
  t: "field-4",
  shigumi: "field-5",
  panel: "field-6",
};

const CONSTRUCTION_FIELDS = [
  { uniqueId: F.name, caption: "お客様名" },
  { uniqueId: F.start, caption: "施工予定日" },
  { uniqueId: F.housing, caption: "住宅ステータス" },
  { uniqueId: F.t, caption: "T番号" },
  { uniqueId: F.shigumi, caption: "仕込日" },
  { uniqueId: F.panel, caption: "パネル工事日" },
];

const REPORT_FIELDS = [
  { uniqueId: "r-1", caption: "T番号" },
  { uniqueId: "r-2", caption: "報告内容" },
];

function payload(opts: {
  zankoRows: Array<[string, string]>;
  construction: Array<Record<string, unknown>>;
  reports?: Array<Record<string, unknown>> | null;
}) {
  const idx = index(opts.zankoRows);
  const reports = opts.reports === undefined ? [] : opts.reports;
  return buildCalendarPayload(
    2026,
    11,
    opts.construction.map((record, i) => ({ recordId: 100 + i, record })),
    reports === null ? null : reports.map((record, i) => ({ recordId: 900 + i, record })),
    CONSTRUCTION_FIELDS,
    reports === null ? null : REPORT_FIELDS,
    {
      zankoIndex: idx,
      zankoEntries: buildZankoCaseEntries(idx, buildContractRecordMap([]), 2026, 11),
    },
  );
}

const KICHIKU = {
  [F.name]: "山田 太郎",
  [F.start]: "2026-11-05",
  [F.housing]: "既築案件",
  [F.t]: "T0001",
};

const SHINCHIKU = {
  [F.name]: "鈴木 一郎",
  [F.housing]: "新築案件",
  [F.t]: "T0002",
  [F.shigumi]: "2026-11-03",
  [F.panel]: "2026-11-20",
};

function cases(day: CalendarMonthApiItem[] | undefined) {
  return (day ?? []).filter((i) => !i.zanko);
}

describe("工事カレンダーのカード", () => {
  it("★ 施工予定日のカードに出る", () => {
    const p = payload({ zankoRows: [["T0001", ""]], construction: [KICHIKU] });
    expect(cases(p.byDay["2026-11-05"])[0]?.zankoNoDateWarn).toBe(true);
  });

  it("★ 古いレコードに日付があっても、新しいのが空なら出る", () => {
    const p = payload({
      zankoRows: [
        ["T0001", "2026-10-20"],
        ["T0001", ""],
      ],
      construction: [KICHIKU],
    });
    expect(cases(p.byDay["2026-11-05"])[0]?.zankoNoDateWarn).toBe(true);
  });

  it("★ 残工日が全部入っていれば出ない", () => {
    const p = payload({ zankoRows: [["T0001", "2026-11-20"]], construction: [KICHIKU] });
    expect(cases(p.byDay["2026-11-05"])[0]?.zankoNoDateWarn).toBeFalsy();
  });

  it("★ 新築・産業用の4日程にも出る", () => {
    const p = payload({ zankoRows: [["T0002", ""]], construction: [SHINCHIKU] });
    expect(cases(p.byDay["2026-11-03"])[0]?.zankoNoDateWarn).toBe(true);
    expect(cases(p.byDay["2026-11-20"])[0]?.zankoNoDateWarn).toBe(true);
  });

  it("★ 完了報告がある工程には出ない（✅ と同じ判定）", () => {
    const p = payload({
      zankoRows: [["T0002", ""]],
      construction: [SHINCHIKU],
      reports: [{ "r-1": "T0002", "r-2": "仕込完了" }],
    });
    const shigumi = cases(p.byDay["2026-11-03"])[0];
    expect(shigumi?.showKankoCheck).toBe(true);
    expect(shigumi?.zankoNoDateWarn).toBeFalsy();
    expect(cases(p.byDay["2026-11-20"])[0]?.zankoNoDateWarn).toBe(true);
  });

  it("★ 施工予定日のカードは完工の報告があれば出ない", () => {
    const p = payload({
      zankoRows: [["T0001", ""]],
      construction: [KICHIKU],
      reports: [{ "r-1": "T0001", "r-2": "完工" }],
    });
    expect(cases(p.byDay["2026-11-05"])[0]?.zankoNoDateWarn).toBeFalsy();
  });

  it("★ 工事報告を読めていないときは出る（安全側）", () => {
    const p = payload({ zankoRows: [["T0002", ""]], construction: [SHINCHIKU], reports: null });
    expect(cases(p.byDay["2026-11-03"])[0]?.zankoNoDateWarn).toBe(true);
  });

  it("★ 【残工】カードには出ない", () => {
    const p = payload({
      zankoRows: [
        ["T0001", "2026-11-12"],
        ["T0001", ""],
      ],
      construction: [KICHIKU],
    });
    const z = p.byDay["2026-11-12"]?.find((i) => i.zanko);
    expect(z).toBeDefined();
    expect(z?.zankoNoDateWarn).toBeFalsy();
  });

  it("★ グレー・【延期】の判定は変わらない", () => {
    const p = payload({ zankoRows: [["T0001", ""]], construction: [KICHIKU] });
    const item = cases(p.byDay["2026-11-05"])[0];
    expect(item?.gray).toBe(true);
    expect(item?.line1).toBe("【延期】山田 太郎様");
  });
});

// ── 見た目 ──

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const CSS = read("src/app/globals.css");
const PAGE = read("src/components/liff-calendar-month-page.tsx");

function rule(selector: string): string {
  const re = new RegExp(
    `(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`,
  );
  const m = CSS.match(re);
  expect(m, `${selector} のルールが無い`).not.toBeNull();
  return m![2]!;
}

describe("見た目", () => {
  it("★ 赤枠は #dc2626・2px で、カードの内側に描く（inset）", () => {
    expect(rule(".zanko-warn-card::after")).toMatch(
      /box-shadow:\s*inset 0 0 0 2px #dc2626/,
    );
  });

  it("★ 赤枠はカードの高さ・幅を変えない（枠線・余白・外側の線を足さない）", () => {
    for (const sel of [".zanko-warn-card", ".zanko-warn-card::after"]) {
      const body = rule(sel);
      // border-radius（角の丸み）は大きさを変えないので除く
      expect(body, sel).not.toMatch(
        /(^|[\s;])(border(?!-radius)|padding|margin|outline)(-[a-z]+)?\s*:/,
      );
      expect(body, sel).not.toMatch(/(^|[\s;])(width|height)\s*:/);
    }
    // 重ねて描くだけ。押せる範囲も変えない
    const after = rule(".zanko-warn-card::after");
    expect(after).toMatch(/position:\s*absolute/);
    expect(after).toMatch(/inset:\s*0/);
    expect(after).toMatch(/pointer-events:\s*none/);
    expect(rule(".zanko-warn-card")).toMatch(/position:\s*relative/);
  });

  it("★ グレーのカードの上でも見える（本文の背景に隠れない重ね方）", () => {
    // 器の box-shadow だと、灰色の本文（最初の子の背景）に隠れる。
    // 疑似要素を最前面に重ねる
    expect(rule(".zanko-warn-card::after")).toMatch(/z-index:\s*\d+/);
    expect(rule(".zanko-warn-card")).not.toMatch(/box-shadow/);
  });

  it("★ ⚠️ は 16px（640px 以下 14px）。行の高さを変えない", () => {
    const icon = rule(".zanko-warn-icon");
    expect(icon).toMatch(/font-size:\s*16px/);
    expect(icon).toMatch(/line-height:\s*1(;|\s)/);
    expect(CSS).toMatch(
      /@media \(max-width: 640px\)\s*\{\s*\.zanko-warn-icon\s*\{\s*font-size:\s*14px;?\s*\}\s*\}/,
    );
  });

  it("★ ⚠️ は完工の ✅ の左。説明文が付いている", () => {
    const warn = PAGE.indexOf("zanko-warn-icon");
    const kanko = PAGE.indexOf("{item.showKankoCheck ? (", warn);
    expect(warn).toBeGreaterThan(0);
    expect(kanko).toBeGreaterThan(warn);
    expect(ZANKO_NO_DATE_WARN_TITLE).toBe(
      "残工日が未定です（残工案件アプリに登録済み・日付未入力）",
    );
    expect(PAGE).toContain("title={ZANKO_NO_DATE_WARN_TITLE}");
    expect(PAGE).toContain("zanko-warn-card");
  });
});
