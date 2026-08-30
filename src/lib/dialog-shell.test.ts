import { describe, expect, it } from "vitest";

import {
  DIALOG_BODY_CLASS,
  DIALOG_FOOTER_CLASS,
  DIALOG_OVERLAY_CENTERED_CLASS,
  DIALOG_OVERLAY_CLASS,
  DIALOG_PANEL_CLASS,
} from "@/lib/dialog-shell";

/**
 * 確認ダイアログの枠。
 *
 * 実機（iPhone / LIFF）で、中身が増えた確認ダイアログの下部が画面外に出て、
 * 実行ボタンにもキャンセルボタンにも届かなくなった。ここで固定するのは
 *   ・高さを iOS の vh に委ねないこと
 *   ・中身と操作が分かれ、操作がスクロールの外にあること
 * の2つ。どちらが欠けても同じ症状に戻る。
 */

const classes = (raw: string) => raw.split(/\s+/).filter(Boolean);

describe("下敷き（overlay）", () => {
  it("★ 高さを dvh で取る（globals.css の .liff-dialog-viewport）", () => {
    for (const c of [DIALOG_OVERLAY_CLASS, DIALOG_OVERLAY_CENTERED_CLASS]) {
      expect(classes(c)).toContain("liff-dialog-viewport");
    }
  });

  it("★ inset-0 で高さを決めない（iOS の vh に従ってしまう）", () => {
    for (const c of [DIALOG_OVERLAY_CLASS, DIALOG_OVERLAY_CENTERED_CLASS]) {
      expect(classes(c)).not.toContain("inset-0");
      // 横と上だけ張る
      expect(classes(c)).toContain("inset-x-0");
      expect(classes(c)).toContain("top-0");
    }
  });

  it("★ 画面を覆い、中央に寄せる", () => {
    for (const c of [DIALOG_OVERLAY_CLASS, DIALOG_OVERLAY_CENTERED_CLASS]) {
      expect(classes(c)).toContain("fixed");
      expect(classes(c)).toContain("z-50");
      expect(classes(c)).toContain("flex");
      expect(classes(c)).toContain("justify-center");
    }
  });

  it("★ 下端は safe-area を避ける（ホームバーに潜らせない）", () => {
    expect(DIALOG_OVERLAY_CLASS).toContain(
      "pb-[max(1rem,env(safe-area-inset-bottom))]",
    );
    expect(DIALOG_OVERLAY_CENTERED_CLASS).toContain(
      "pb-[max(1rem,env(safe-area-inset-bottom))]",
    );
  });

  it("スマホは下から、広い画面は中央（従来どおり）", () => {
    expect(classes(DIALOG_OVERLAY_CLASS)).toContain("items-end");
    expect(classes(DIALOG_OVERLAY_CLASS)).toContain("sm:items-center");
    expect(classes(DIALOG_OVERLAY_CENTERED_CLASS)).toContain("items-center");
  });
});

describe("本体（panel）", () => {
  it("★ 中身と操作を縦に分ける", () => {
    expect(classes(DIALOG_PANEL_CLASS)).toContain("flex");
    expect(classes(DIALOG_PANEL_CLASS)).toContain("flex-col");
  });

  it("★ 下敷きからはみ出さない", () => {
    expect(classes(DIALOG_PANEL_CLASS)).toContain("max-h-full");
    // 高さを vh で持たない（下敷きに任せる）
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
});
