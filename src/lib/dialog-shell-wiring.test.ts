import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 確認ダイアログが全部、共有の枠に乗っていること（ソースを直接見る）。
 *
 * 実機（iPhone / LIFF）で工事日の移動の確認ダイアログの下部が画面外に出て、
 * ボタンに届かなくなった。原因は高さの取り方（iOS の 100vh は見えている
 * 高さより大きい）で、**同じ書き方をしていたダイアログは全部同じ地雷**を
 * 踏んでいた。1つ直して他が取り残される状態にしない。
 *
 * レンダリングを組めないので文字列一致で見る（このリポジトリの流儀）。
 */

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

/** 確認・選択のために画面を覆うダイアログ。増やしたらここへ足すこと */
const DIALOGS = [
  {
    rel: "src/components/calendar-move-case-panel.tsx",
    label: "工事日の移動",
    overlay: "DIALOG_OVERLAY_CLASS",
  },
  {
    rel: "src/components/customer-cancel-confirm-dialog.tsx",
    label: "顧客キャンセル",
    overlay: "DIALOG_OVERLAY_CLASS",
  },
  {
    rel: "src/components/calendar-empty-slot-confirm-dialog.tsx",
    label: "空き枠の確認",
    overlay: "DIALOG_OVERLAY_CLASS",
  },
  {
    rel: "src/components/meeting-schedule-negotiation-confirm-dialog.tsx",
    label: "商談ステータスの変更",
    overlay: "DIALOG_OVERLAY_CENTERED_CLASS",
  },
] as const;

describe("確認ダイアログの枠", () => {
  for (const d of DIALOGS) {
    describe(d.label, () => {
      it("★ 共有の枠を使う", () => {
        const src = read(d.rel);

        expect(src).toContain(d.overlay);
        expect(src).toContain("DIALOG_PANEL_CLASS");
        expect(src).toContain("DIALOG_BODY_CLASS");
        expect(src).toContain("DIALOG_FOOTER_CLASS");
      });

      it("★ 自前で高さを決めない（iOS の vh に従わせない）", () => {
        const src = read(d.rel);

        expect(src).not.toContain("fixed inset-0");
        expect(src).not.toContain("max-h-[85vh]");
      });

      it("★ 中身より後ろに操作がある（ボタンがスクロールの外）", () => {
        const src = read(d.rel);

        expect(src.indexOf("DIALOG_BODY_CLASS}>")).toBeLessThan(
          src.indexOf("${DIALOG_FOOTER_CLASS}"),
        );
      });

      it("★ ARIA は維持されている", () => {
        const src = read(d.rel);

        expect(src).toContain('role="alertdialog"');
        expect(src).toContain('aria-modal="true"');
        expect(src).toContain("aria-labelledby=");
      });

      it("★ Esc でキャンセルされる", () => {
        expect(read(d.rel)).toContain('"Escape"');
      });
    });
  }

  it("★ 覆うダイアログを取りこぼしていない", () => {
    // 共有の枠に乗っていない alertdialog が増えていないか
    for (const d of DIALOGS) {
      expect(read(d.rel), d.label).toContain("@/lib/dialog-shell");
    }
    expect(DIALOGS).toHaveLength(4);
  });
});

describe("土台の高さ（globals.css）", () => {
  const css = read("src/app/globals.css");

  it("★ dvh で取る（見えている高さに追従する）", () => {
    expect(css).toContain(".liff-dialog-viewport");
    expect(css).toContain("height: 100dvh;");
  });

  it("★ 本体の高さも dvh で決める（% に頼らない）", () => {
    expect(css).toContain(".liff-dialog-panel");
    expect(css).toContain("max-height: 85dvh;");
    expect(css).toContain("max-height: 85vh;");
  });

  it("★ dvh を知らない環境のために vh を残す", () => {
    const block = css.slice(
      css.indexOf(".liff-dialog-viewport"),
      css.indexOf(".liff-dialog-viewport") + 200,
    );

    // 先に vh、あとから dvh。順序が逆だと古い環境で高さが消える
    expect(block.indexOf("height: 100vh;")).toBeGreaterThan(-1);
    expect(block.indexOf("height: 100vh;")).toBeLessThan(
      block.indexOf("height: 100dvh;"),
    );
  });
});
