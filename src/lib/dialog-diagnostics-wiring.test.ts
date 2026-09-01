import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 診断モードの配線（調査用・原因が分かったら消すこと）。
 *
 * ⚠ 共有の枠（lib/dialog-shell）は iOS でボタンが押せなくなったため
 *    取り消した。構造を固定していたテストもここで落としてある。
 *    残すのは**診断の配線**だけ。
 */

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

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

  it("★ スクロールロックは入れていない（328addd は取り消した）", () => {
    const src = read(PANEL);

    // 背後のスクロールを止める仕掛けごと戻したので、参照も残さない
    expect(src).not.toContain("useDialogScrollLock");
    // 判定側の口は残してある（診断の URL は今までどおり効く）
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

    expect(src).toContain(
      "diagnosticsTrace={diagnostics.enabled ? formatDialogTrace(trace) : null}",
    );
    expect(src).toContain("handleMove の到達点");
  });
});

/**
 * 各段階の所要時間（調査用・要削除）。
 *
 * iOS でのみ極端に遅い件の切り分け。区間ごとの実測が要る。
 * とくに「トークン取得中 → トークンOK」は liff.init() の時間で、
 * 送信のたびに実行しているため疑わしい。
 */
describe("段階の所要時間（調査用・要削除）", () => {
  const PANEL = "src/components/calendar-move-case-panel.tsx";
  const PAGE = "src/components/liff-calendar-month-page.tsx";

  it("★ 時刻は performance.now() で取る（時計合わせで巻き戻らない）", () => {
    const src = read(PANEL);

    expect(src).toContain("appendDialogTrace(prev, line, performance.now())");
    expect(src).not.toContain("appendDialogTrace(prev, line)");
  });

  it("★ liff.init() の区間が測れる", () => {
    const src = read(PANEL);

    expect(src).toContain('note("トークン取得中")');
    expect(src).toContain('note(token ? "トークンOK" : "トークンなし")');
  });

  it("★ サーバ処理の区間が測れる", () => {
    const src = read(PANEL);

    expect(src).toContain('note("送信")');
    expect(src).toContain("note(`応答 HTTP ${res.status}`)");
  });

  it("★ 反映とリフレッシュを分けて測れる", () => {
    const page = read(PAGE);

    expect(page).toContain('move.note?.("反映")');
    expect(page).toContain('move.note?.("リフレッシュ完了")');
    // 反映は楽観更新の直後、リフレッシュはその待ちの後。
    // forceRefreshCalendar は他の保存経路にもあるので、移動の関数だけを見る
    const move = page.slice(page.indexOf("const applyCaseMoveToView"));
    const refreshAt = move.indexOf("await forceRefreshCalendar()");

    expect(move.indexOf('move.note?.("反映")')).toBeLessThan(refreshAt);
    expect(move.indexOf('move.note?.("リフレッシュ完了")')).toBeGreaterThan(
      refreshAt,
    );
  });

  it("★ 計測点は任意（呼ばなくても動く）", () => {
    const page = read(PAGE);

    // ?. で呼ぶので、note を渡さない呼び出し元でも落ちない
    expect(page).toContain("note?: (label: string) => void;");
    expect(page).toContain("move.note?.(");
  });

  it("★ 成功後は feedback に内訳を添える（画面が閉じても残る唯一の表示）", () => {
    const src = read(PANEL);

    expect(src).toContain("const diagnosticsTail = diagnostics.enabled");
    expect(src).toContain("[診断] 応答後の待ち");
    expect(src).toContain("formatDialogTrace(traceRef.current)");
  });

  it("★ 既定では成功メッセージに1文字も足さない", () => {
    const src = read(PANEL);
    const tail = src.slice(
      src.indexOf("const diagnosticsTail = diagnostics.enabled"),
      src.indexOf("const diagnosticsTail = diagnostics.enabled") + 400,
    );

    // 診断が無効なら空文字
    expect(tail).toContain(': "";');
  });

  it("★ 挙動は変えない（閉じる順序も待ち方もそのまま）", () => {
    const src = read(PANEL);

    // 成功したらダイアログとパネルを先に閉じる（従来どおり）
    expect(src).toContain('note("成功");');
    expect(src).toContain("setConfirming(false);\n      setOpen(false);");
    // onMoved は今までどおり待つ
    expect(src).toContain("await onMoved({");
  });
});

/**
 * 当たり判定の実測（調査用・要削除）。
 */
describe("当たり判定の実測（調査用・要削除）", () => {
  const PANEL = "src/components/calendar-move-case-panel.tsx";

  it("★ 触った座標を拾う", () => {
    const src = read(PANEL);

    expect(src).toContain("tap: { x: e.clientX, y: e.clientY }");
    expect(src).toContain("document.elementFromPoint(e.clientX, e.clientY)");
  });

  it("★ 実行ボタンの矩形を取る", () => {
    const src = read(PANEL);

    expect(src).toContain(
      "confirmButtonRef.current?.getBoundingClientRect()",
    );
    // 既存のフォーカス用 ref も壊さない
    expect(src).toContain("firstButtonRef.current = el;");
  });

  it("★ 診断が無効なら測らない", () => {
    const src = read(PANEL);
    const fn = src.slice(
      src.indexOf("const recordHit = (e: React.PointerEvent) => {"),
      src.indexOf("const recordHit = (e: React.PointerEvent) => {") + 160,
    );

    expect(fn).toContain("if (!diagnostics.enabled) return;");
  });

  it("★ 結果を画面に出す", () => {
    expect(read(PANEL)).toContain("formatDialogHitReport(hitReport).map");
  });
});

/**
 * 確認ダイアログを body 直下へ出す。
 *
 * iOS の実測で、覆いにはタップが届くのに本体には届かず、実行ボタンの矩形が
 * 触った位置から約370px ずれていた。position: fixed が祖先に閉じ込められ、
 * 見た目と当たり判定がずれていた。body 直下なら祖先に依存しない。
 */
describe("ダイアログを body 直下へ出す", () => {
  const PANEL = "src/components/calendar-move-case-panel.tsx";

  it("★ createPortal で document.body へ出す", () => {
    const src = read(PANEL);

    expect(src).toContain('import { createPortal } from "react-dom";');
    expect(src).toContain("return createPortal(");
    expect(src).toContain("document.body,");
  });

  it("★ SSR では描画しない（document が無い）", () => {
    const src = read(PANEL);

    expect(src).toContain("const isClient = useIsClient();");
    expect(src).toContain("if (!open || !isClient) return null;");
  });

  it("★ サーバ側は必ず false（hydration を壊さない）", () => {
    const hook = read("src/hooks/use-is-client.ts");

    expect(hook).toContain("const serverSnapshot = () => false;");
    expect(hook).toContain("useSyncExternalStore");
    // 効果の中で setState する形は使わない（説明のためコメントには出る）
    expect(hook).not.toContain("useEffect(");
  });

  it("★ フックは早期 return より前にある（数をそろえる）", () => {
    const src = read(PANEL);

    expect(src.indexOf("const isClient = useIsClient();")).toBeLessThan(
      src.indexOf("if (!open || !isClient) return null;"),
    );
  });

  it("★ ARIA と Esc は維持されている", () => {
    const src = read(PANEL);

    expect(src).toContain('role="alertdialog"');
    expect(src).toContain('aria-modal="true"');
    expect(src).toContain('aria-labelledby="calendar-move-case-confirm-title"');
    expect(src).toContain('e.key !== "Escape"');
    expect(src).toContain("onKeyDown={onPanelKeyDown}");
  });

  it("★ 診断の計測点は portal の中に残っている", () => {
    const src = read(PANEL);
    const portal = src.slice(src.indexOf("return createPortal("));

    expect(portal).toContain('bumpProbe("overlay")');
    expect(portal).toContain('bumpProbe("panel")');
    expect(portal).toContain('bumpProbe("confirmDown")');
    expect(portal).toContain("recordHit(e)");
  });
});
