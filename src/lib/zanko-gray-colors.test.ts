import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ZANKO_GRAY_LINE_COLOR } from "@/lib/zanko-gray-colors";

/**
 * グレー表示の配色を @pocket（calendar_atpocket.js の CONFIG）に合わせる。
 *
 *   POSTPONED_COLOR_BG        #b6b6b6  背景
 *   POSTPONED_COLOR_BORDER    #909090  枠線
 *   POSTPONED_COLOR_LINE      #3f3f3f  左の縦線
 *   POSTPONED_COLOR_TEXT      #111111  お客様名
 *   POSTPONED_COLOR_SUB_TEXT  #262626  2行目
 *
 * 明るい表示のときだけ。ダークモード（@pocket に無い）は今のまま。
 * 工事カレンダーの「お客様情報」の行（@pocket に無い）は白のまま。
 * どのカードをグレーにするかの判定は変えない（zanko-postpone のテストのまま）。
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const CSS = read("src/app/globals.css");
const PAGE = read("src/components/liff-calendar-month-page.tsx");

/** セレクタがちょうど一致するルールの中身（宣言部分）を返す */
function rule(selector: string): string {
  const re = new RegExp(
    `(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`,
  );
  const m = CSS.match(re);
  expect(m, `${selector} のルールが無い`).not.toBeNull();
  return m![2]!;
}

function decl(selector: string, prop: string): string {
  const body = rule(selector);
  // 宣言の先頭で探す（color が background-color の中に当たらないように）
  const m = body.match(new RegExp(`(?:^|[\\s;])${prop}\\s*:\\s*([^;]+);`));
  expect(m, `${selector} に ${prop} が無い`).not.toBeNull();
  return m![1]!.replace("!important", "").trim().toLowerCase();
}

/** WCAG のコントラスト比 */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

describe("工事カレンダー（明るい表示）", () => {
  it("★ 本文の背景は #b6b6b6", () => {
    expect(decl(".zanko-gray-body > :first-child", "background-color")).toBe("#b6b6b6");
  });

  it("★ 枠線は #909090（左は縦線なので上書きしない）", () => {
    for (const side of ["top", "right", "bottom"]) {
      expect(decl(".zanko-gray-body", `border-${side}-color`)).toBe("#909090");
    }
    // まとめて指定すると、左の縦線（#3f3f3f）まで #909090 になる
    expect(rule(".zanko-gray-body")).not.toMatch(/(^|[s;])border-colors*:/);
    expect(rule(".zanko-gray-body")).not.toMatch(/border-left/);
  });

  it("★ 左の縦線はグレーのカードでは #3f3f3f（施工業者の色にしない）", () => {
    expect(ZANKO_GRAY_LINE_COLOR).toBe("#3f3f3f");
    expect(PAGE).toContain("const leftBorder = item.gray");
    expect(PAGE).toContain("ZANKO_GRAY_LINE_COLOR");
  });

  it("★ お客様名は #111111、2行目は #262626", () => {
    expect(decl(".zanko-gray-body > :first-child .zanko-gray-text", "color")).toBe(
      "#111111",
    );
    expect(decl(".zanko-gray-body > :first-child .zanko-gray-subtext", "color")).toBe(
      "#262626",
    );
  });

  it("★ 操作の行（工事対応者の変更・お客様情報・地図）もカード全体が #b6b6b6", () => {
    expect(decl(".zanko-gray-body", "background-color")).toBe("#b6b6b6");
    // 操作の行は器の中の、本文より後ろにある（器の背景がそのまま見える）
    const container = PAGE.indexOf("style={{ borderLeft: leftBorder }}");
    const body = PAGE.indexOf("{caseAccessLinkEnabled ? (", container);
    const link = PAGE.indexOf("<CaseCustomerInfoLink", body);
    expect(container).toBeGreaterThan(0);
    expect(body).toBeGreaterThan(container);
    expect(link).toBeGreaterThan(body);
  });
});

describe("工事カレンダーの操作の行（灰色の枠付きボタン）", () => {
  it("★ ボタンは背景 #b6b6b6・枠線 #3f3f3f・文字 #111111", () => {
    const sel = ".zanko-gray-body .zanko-gray-btn";
    expect(decl(sel, "background-color")).toBe("#b6b6b6");
    expect(decl(sel, "border-color")).toBe("#3f3f3f");
    expect(decl(sel, "color")).toBe("#111111");
  });

  it("★ 押したときは背景 #a3a3a3（灰色の上でも分かる）", () => {
    expect(decl(".zanko-gray-body .zanko-gray-btn:active", "background-color")).toBe(
      "#a3a3a3",
    );
  });

  it("★ 押せないときの薄さ（disabled:opacity）は上書きしない", () => {
    expect(rule(".zanko-gray-body .zanko-gray-btn")).not.toMatch(/opacity/);
  });

  it("★ 対象のボタンに目印が付いている（編集・キャンセル・保存・お客様情報・地図）", () => {
    const n = PAGE.split("zanko-gray-btn").length - 1;
    expect(n).toBeGreaterThanOrEqual(5);
    expect(PAGE).toContain(`<MapNavigationButton
                                    className="zanko-gray-btn"`);
  });

  it("★ メッセージは濃い色（成功 #064e3b・エラー #7f1d1d・注意 #111111）", () => {
    expect(decl(".zanko-gray-body .zanko-gray-msg-ok", "color")).toBe("#064e3b");
    expect(decl(".zanko-gray-body .zanko-gray-msg-err", "color")).toBe("#7f1d1d");
    expect(decl(".zanko-gray-body .zanko-gray-msg-warn", "color")).toBe("#111111");
    for (const c of ["zanko-gray-msg-ok", "zanko-gray-msg-err", "zanko-gray-msg-warn"]) {
      expect(PAGE).toContain(c);
    }
  });

  it("★ 工事カレンダーのカードはダークモードでも白いので、ダークモード用の色を持たない", () => {
    expect(CSS).not.toMatch(/.dark[^{]*zanko-gray-body/);
  });
});

describe("施工管理（明るい表示）", () => {
  it("★ 背景 #b6b6b6・枠線 #909090", () => {
    expect(decl(".zanko-gray-card", "background-color")).toBe("#b6b6b6");
    expect(decl(".zanko-gray-card", "border-color")).toBe("#909090");
  });

  it("★ 文字 #111111・2行目 #262626", () => {
    expect(decl(".zanko-gray-card .zanko-gray-text", "color")).toBe("#111111");
    expect(decl(".zanko-gray-card .zanko-gray-subtext", "color")).toBe("#262626");
  });
});

describe("ダークモード（今のまま）", () => {
  it("★ 施工管理のカードは #4b5563 / #f9fafb / #e5e7eb・枠線 #6b7280", () => {
    const sel = ".dark .zanko-gray-card.zanko-gray-follow-dark";
    expect(decl(sel, "background-color")).toBe("#4b5563");
    expect(decl(sel, "border-color")).toBe("#6b7280");
    expect(decl(`${sel} .zanko-gray-text`, "color")).toBe("#f9fafb");
    expect(decl(`${sel} .zanko-gray-subtext`, "color")).toBe("#e5e7eb");
  });
});

describe("コントラスト比（4.5:1 以上）", () => {
  it("★ #b6b6b6 と #111111 は 9.31:1", () => {
    expect(contrast("#b6b6b6", "#111111")).toBeCloseTo(9.31, 2);
  });

  it("★ #b6b6b6 と #262626 は 7.46:1", () => {
    expect(contrast("#b6b6b6", "#262626")).toBeCloseTo(7.46, 2);
  });

  it.each([
    ["ボタンの文字", "#111111", "#b6b6b6"],
    ["押したとき", "#111111", "#a3a3a3"],
    ["成功のメッセージ", "#064e3b", "#b6b6b6"],
    ["エラーのメッセージ", "#7f1d1d", "#b6b6b6"],
    ["注意のメッセージ", "#111111", "#b6b6b6"],
  ])("★ %s %s / %s は 4.5:1 以上", (_n, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it("★ ダークモードも 4.5:1 以上", () => {
    expect(contrast("#4b5563", "#f9fafb")).toBeGreaterThan(4.5);
    expect(contrast("#4b5563", "#e5e7eb")).toBeGreaterThan(4.5);
  });
});
