import { describe, expect, it } from "vitest";

import {
  DIALOG_BACKDROP_CLASS,
  DIALOG_BODY_CLASS,
  DIALOG_FOOTER_CLASS,
  DIALOG_PANEL_CLASS,
  DIALOG_VIEWPORT_CENTERED_CLASS,
  DIALOG_VIEWPORT_CLASS,
} from "@/lib/dialog-shell";

/**
 * 確認ダイアログの枠。
 *
 * 実機で2回続けて事故を出している。1回目は「下部が画面外に出てボタンに
 * 届かない」、2回目は「ダイアログがタップを受け取らず背後のパネルが反応する」。
 * どちらも高さの取り方が原因だった。ここで固定するのは
 *   ・覆いの高さが計算に依存しないこと（潰れたら背後へ抜ける）
 *   ・中身と操作が分かれ、操作がスクロールの外にあること
 * の2つ。
 */

const classes = (raw: string) => raw.split(/\s+/).filter(Boolean);

describe("覆い（backdrop）", () => {
  it("★ inset-0 だけで画面全部を覆う（高さを計算に頼らない）", () => {
    // 高さのクラスを足すと、それが解けなかったときに覆いが潰れて
    // タップが背後へ抜ける。実機で起きた事故そのもの
    expect(classes(DIALOG_BACKDROP_CLASS)).toContain("fixed");
    expect(classes(DIALOG_BACKDROP_CLASS)).toContain("inset-0");
    expect(DIALOG_BACKDROP_CLASS).not.toContain("liff-dialog-viewport");
    expect(DIALOG_BACKDROP_CLASS).not.toContain("h-");
    expect(DIALOG_BACKDROP_CLASS).not.toContain("dvh");
    expect(DIALOG_BACKDROP_CLASS).not.toContain("vh]");
  });

  it("★ タップを止める層である（透過させない指定を持たない）", () => {
    expect(DIALOG_BACKDROP_CLASS).not.toContain("pointer-events-none");
  });

  it("★ 背後より前面に出る", () => {
    expect(classes(DIALOG_BACKDROP_CLASS)).toContain("z-50");
  });

  it("暗転はここが持つ", () => {
    expect(classes(DIALOG_BACKDROP_CLASS)).toContain("bg-slate-900/50");
  });
});

describe("位置決め（viewport）", () => {
  it("★ 高さは globals.css の .liff-dialog-viewport が持つ", () => {
    for (const c of [DIALOG_VIEWPORT_CLASS, DIALOG_VIEWPORT_CENTERED_CLASS]) {
      expect(classes(c)).toContain("liff-dialog-viewport");
    }
  });

  it("★ 覆いの役目は持たない（fixed も z も置かない）", () => {
    for (const c of [DIALOG_VIEWPORT_CLASS, DIALOG_VIEWPORT_CENTERED_CLASS]) {
      expect(classes(c)).not.toContain("fixed");
      expect(classes(c)).not.toContain("inset-0");
      expect(classes(c)).not.toContain("z-50");
    }
  });

  it("★ 下端は safe-area を避ける（ホームバーに潜らせない）", () => {
    for (const c of [DIALOG_VIEWPORT_CLASS, DIALOG_VIEWPORT_CENTERED_CLASS]) {
      expect(c).toContain("pb-[max(1rem,env(safe-area-inset-bottom))]");
    }
  });

  it("スマホは下から、広い画面は中央（従来どおり）", () => {
    expect(classes(DIALOG_VIEWPORT_CLASS)).toContain("items-end");
    expect(classes(DIALOG_VIEWPORT_CLASS)).toContain("sm:items-center");
    expect(classes(DIALOG_VIEWPORT_CENTERED_CLASS)).toContain("items-center");
  });
});

describe("本体（panel）", () => {
  it("★ 中身と操作を縦に分ける", () => {
    expect(classes(DIALOG_PANEL_CLASS)).toContain("flex");
    expect(classes(DIALOG_PANEL_CLASS)).toContain("flex-col");
  });

  it("★ 高さの上限を % に頼らない（globals.css の .liff-dialog-panel）", () => {
    expect(classes(DIALOG_PANEL_CLASS)).toContain("liff-dialog-panel");
    // max-height: 100% は土台の高さが確定していないと解けない。
    // 解けないと上限が無くなり、操作が画面外へ出て押せなくなる
    expect(classes(DIALOG_PANEL_CLASS)).not.toContain("max-h-full");
    expect(DIALOG_PANEL_CLASS).not.toContain("vh]");
  });

  it("★ 本体自体はスクロールしない（中身だけがスクロールする）", () => {
    expect(classes(DIALOG_PANEL_CLASS)).not.toContain("overflow-y-auto");
    // 角丸で切り抜く
    expect(classes(DIALOG_PANEL_CLASS)).toContain("overflow-hidden");
  });

  it("★ 見た目は各ダイアログが足す（背景を決め打たない）", () => {
    expect(DIALOG_PANEL_CLASS).not.toContain("bg-");
    expect(DIALOG_PANEL_CLASS).not.toContain("shadow");
  });

  it("幅は従来どおり", () => {
    expect(classes(DIALOG_PANEL_CLASS)).toContain("w-full");
    expect(classes(DIALOG_PANEL_CLASS)).toContain("max-w-sm");
    expect(classes(DIALOG_PANEL_CLASS)).toContain("rounded-2xl");
  });
});

describe("中身（body）", () => {
  it("★ ここだけがスクロールする", () => {
    expect(classes(DIALOG_BODY_CLASS)).toContain("overflow-y-auto");
    expect(classes(DIALOG_BODY_CLASS)).toContain("flex-1");
  });

  it("★ min-h-0 がある（無いと flex の子が縮まずスクロールしない）", () => {
    expect(classes(DIALOG_BODY_CLASS)).toContain("min-h-0");
  });

  it("★ 背後のページへスクロールを流さない", () => {
    expect(classes(DIALOG_BODY_CLASS)).toContain("overscroll-contain");
  });
});

describe("操作（footer）", () => {
  it("★ スクロールしない（常に見える位置に残る）", () => {
    expect(classes(DIALOG_FOOTER_CLASS)).not.toContain("overflow-y-auto");
    expect(classes(DIALOG_FOOTER_CLASS)).not.toContain("flex-1");
  });

  it("★ 中身が長くても潰されない", () => {
    expect(classes(DIALOG_FOOTER_CLASS)).toContain("shrink-0");
  });

  it("スクロールの境目が分かる", () => {
    expect(classes(DIALOG_FOOTER_CLASS)).toContain("border-t");
  });

  it("★ 中身がボタンの上に重ならない（押せない状態を作らない）", () => {
    expect(classes(DIALOG_FOOTER_CLASS)).toContain("relative");
    expect(classes(DIALOG_FOOTER_CLASS)).toContain("z-10");
  });
});
