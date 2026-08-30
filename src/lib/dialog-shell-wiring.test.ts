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
    viewport: "DIALOG_VIEWPORT_CLASS",
  },
  {
    rel: "src/components/customer-cancel-confirm-dialog.tsx",
    label: "顧客キャンセル",
    viewport: "DIALOG_VIEWPORT_CLASS",
  },
  {
    rel: "src/components/calendar-empty-slot-confirm-dialog.tsx",
    label: "空き枠の確認",
    viewport: "DIALOG_VIEWPORT_CLASS",
  },
  {
    rel: "src/components/meeting-schedule-negotiation-confirm-dialog.tsx",
    label: "商談ステータスの変更",
    viewport: "DIALOG_VIEWPORT_CENTERED_CLASS",
  },
] as const;

describe("確認ダイアログの枠", () => {
  for (const d of DIALOGS) {
    describe(d.label, () => {
      it("★ 共有の枠を使う", () => {
        const src = read(d.rel);

        expect(src).toContain("DIALOG_BACKDROP_CLASS");
        expect(src).toContain(d.viewport);
        expect(src).toContain("DIALOG_PANEL_CLASS");
        expect(src).toContain("DIALOG_BODY_CLASS");
        expect(src).toContain("DIALOG_FOOTER_CLASS");
      });

      it("★ 覆いが位置決めより外側にある（潰れない層が背後を守る）", () => {
        const src = read(d.rel);

        expect(src.indexOf("{DIALOG_BACKDROP_CLASS}")).toBeLessThan(
          src.indexOf("{" + d.viewport + "}"),
        );
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

  it("★ 本体の高さも @supports で決める", () => {
    expect(css).toContain(".liff-dialog-panel");
    expect(css).toContain("@supports (max-height: 85dvh)");
    expect(css).toContain("max-height: 85dvh;");
  });

  it("★ フォールバックを同じルールに2行並べない（ミニファイアに捨てられる）", () => {
    // height: 100vh; height: 100dvh; と書くと、ビルドが後ろだけ残して
    // 前を捨てる。dvh を知らない環境で高さが丸ごと消え、覆いが潰れて
    // タップが背後へ抜けた（実機で発生）
    expect(css).not.toContain("height: 100vh;\n  height: 100dvh;");
    expect(css).not.toContain("max-height: 85vh;\n  max-height: 85dvh;");
  });

  it("★ dvh を知らない環境でも高さが残る（@supports の外に 100%）", () => {
    const base = css.slice(
      css.indexOf(".liff-dialog-viewport {"),
      css.indexOf("@supports (height: 100dvh)"),
    );

    expect(base).toContain("height: 100%;");
  });
});

/**
 * 背後のスクロールを止める（ダイアログが開いている間）。
 *
 * 勤怠アラート・掲示板・月カレンダーは以前から各自でやっているが、
 * 確認ダイアログには入っていなかった。実機で「ダイアログが出たまま
 * 背後のパネルも見えている／触れる」状態になっていた。
 *
 * DOM も React も無い環境なので、動きはソースで固定する。
 */
describe("背後のスクロールロック", () => {
  const HOOK = "src/hooks/use-dialog-scroll-lock.ts";

  it("★ 4つのダイアログすべてが使う", () => {
    for (const d of DIALOGS) {
      const src = read(d.rel);

      expect(src, d.label).toContain(
        'from "@/hooks/use-dialog-scroll-lock"',
      );
      expect(src, d.label).toContain("useDialogScrollLock(open");
    }
  });

  it("★ 開いている間だけ止める", () => {
    const src = read(HOOK);

    expect(src).toContain("if (!open || !enabled) return;");
    expect(src).toContain('document.body.style.overflow = "hidden"');
  });

  it("★ 閉じたら元へ戻す（退避した値で復元する）", () => {
    const src = read(HOOK);

    expect(src).toContain("savedOverflow = document.body.style.overflow;");
    expect(src).toContain("document.body.style.overflow = savedOverflow;");
  });

  it("★ 重なって開いても数え上げる（内側が閉じても外側を戻さない）", () => {
    const src = read(HOOK);

    expect(src).toContain("lockCount += 1;");
    expect(src).toContain("lockCount -= 1;");
    // 0 になったときだけ復元する
    expect(src).toContain("if (lockCount === 0) {");
  });

  it("★ touch-action は触らない（中身までスクロールできなくなる）", () => {
    const src = read(HOOK);

    expect(src).not.toContain("touchAction");
    expect(src).not.toContain("touch-action: none");
  });

  it("★ 背後への伝播はダイアログ側で止めている", () => {
    // スクロールロックと二重に効かせる。片方だけでは端まで送ったときに漏れる
    expect(read("src/lib/dialog-shell.ts")).toContain("overscroll-contain");
  });
});

/**
 * 診断モードの配線（調査用・原因が分かったら消すこと）。
 *
 * 実機でボタンが反応しない件を切り分けるための仕掛け。**既定は無効**で、
 * 本番で誤って出ないことをここで固定する。
 */
describe("診断モード（調査用・要削除）", () => {
  const PANEL = "src/components/calendar-move-case-panel.tsx";

  it("★ 既定では描画されない（有効なときだけ出す）", () => {
    const src = read(PANEL);

    expect(src).toContain("{diagnostics.enabled ? (");
    expect(src).toContain("診断モード");
  });

  it("★ 数え上げは診断が有効なときだけ動く", () => {
    const src = read(PANEL);
    const bump = src.slice(
      src.indexOf("const bumpProbe ="),
      src.indexOf("const bumpProbe =") + 220,
    );

    expect(bump).toContain("if (!diagnostics.enabled) return;");
  });

  it("★ 覆い・本体・両ボタンで数える", () => {
    const src = read(PANEL);

    for (const key of [
      "overlay",
      "panel",
      "confirmDown",
      "confirmClick",
      "cancelDown",
      "cancelClick",
    ]) {
      expect(src, key).toContain(`bumpProbe("${key}")`);
    }
  });

  it("★ 計測しても本来の処理は必ず呼ぶ", () => {
    const src = read(PANEL);

    expect(src).toContain("onConfirm();");
    expect(src).toContain("onCancel();");
  });

  it("★ スクロールロックは診断からだけ切れる", () => {
    const src = read(PANEL);

    expect(src).toContain(
      "useDialogScrollLock(open, !diagnostics.scrollLockDisabled)",
    );
    // 既定（診断が無効）では切れない側に倒れる
    expect(read("src/lib/dialog-diagnostics.ts")).toContain(
      "if (!dialogDiagnosticsEnabled(input)) return false;",
    );
  });

  it("★ 環境変数は NEXT_PUBLIC_（クライアントに届く名前）", () => {
    // それ以外の名前だとクライアントで値が読めず、いつまでも無効になる
    expect(read("src/hooks/use-dialog-diagnostics.ts")).toContain(
      "process.env.NEXT_PUBLIC_CALENDAR_DIALOG_DIAGNOSTICS",
    );
  });

  it("★ サーバ側では無効に固定する（hydration を壊さない）", () => {
    const src = read("src/hooks/use-dialog-diagnostics.ts");

    expect(src).toContain("const serverSnapshot = () => false;");
    expect(src).toContain("useSyncExternalStore");
  });

  it("★ 消し忘れないよう、コードに印が付いている", () => {
    expect(read("src/lib/dialog-diagnostics.ts")).toContain("診断モード");
  });
});

/**
 * handleMove の到達点を診断で出す（調査用・要削除）。
 *
 * click までは届いていることが実機で確認できた。次は中のどこで止まるか。
 */
describe("handleMove の到達点（調査用・要削除）", () => {
  const PANEL = "src/components/calendar-move-case-panel.tsx";

  it("★ 段階ごとに印を残す", () => {
    const src = read(PANEL);

    for (const step of [
      'note("開始")',
      'note("判定OK")',
      'note("トークン取得中")',
      'note("送信")',
      'note("成功")',
      'note("終了")',
    ]) {
      expect(src, step).toContain(step);
    }
  });

  it("★ 応答とトークンの結果も残す", () => {
    const src = read(PANEL);

    expect(src).toContain('note(`応答 HTTP ${res.status}`)');
    expect(src).toContain('note(token ? "トークンOK" : "トークンなし")');
  });

  it("★ 失敗と例外も残す", () => {
    const src = read(PANEL);

    expect(src).toContain("note(`失敗: ${text.slice(0, 40)}`)");
    expect(src).toContain("note(`例外: ${dialogTraceErrorText(e)}`)");
  });

  it("★ 握り潰された例外を拾う", () => {
    const src = read(PANEL);

    expect(src).toContain('window.addEventListener("error", onError)');
    expect(src).toContain(
      'window.addEventListener("unhandledrejection", onRejection)',
    );
    // handleMove が reject しても取りこぼさない
    expect(src).toContain("handleMove().catch((e) =>");
  });

  it("★ 診断が無効なら1行も溜めない", () => {
    const src = read(PANEL);
    const noteFn = src.slice(
      src.indexOf("const note = (line: string) => {"),
      src.indexOf("const note = (line: string) => {") + 200,
    );

    expect(noteFn).toContain("if (!diagnostics.enabled) return;");
  });

  it("★ 到達点は確認画面に出す（覆いの後ろに出さない）", () => {
    const src = read(PANEL);

    expect(src).toContain("diagnosticsTrace={diagnostics.enabled ? trace : null}");
    expect(src).toContain("handleMove の到達点");
  });
});
