import { describe, expect, it } from "vitest";

import {
  DIALOG_DIAGNOSTICS_PARAM,
  DIALOG_TRACE_MAX,
  DIALOG_NO_SCROLL_LOCK_PARAM,
  EMPTY_DIALOG_TAP_PROBE,
  appendDialogTrace,
  describeDialogTapProbe,
  dialogTraceErrorText,
  formatDialogElapsed,
  formatDialogTrace,
  dialogDiagnosticsEnabled,
  dialogScrollLockDisabled,
} from "@/lib/dialog-diagnostics";

/**
 * 確認ダイアログの診断モード。
 *
 * 実機でボタンが反応しない件を切り分けるために入れた。ここで固定するのは
 *   ・**既定で無効**であること（本番で誤って出ない）
 *   ・URL でも環境変数でも入れられること
 *   ・スクロールロックを切れるのは診断が有効なときだけ
 * の3つ。
 */

describe("有効・無効の判定", () => {
  it("★ 何も指定しなければ無効", () => {
    expect(dialogDiagnosticsEnabled({})).toBe(false);
    expect(dialogDiagnosticsEnabled({ search: "", envValue: "" })).toBe(false);
    expect(dialogDiagnosticsEnabled({ search: "?foo=1" })).toBe(false);
  });

  it("★ URL パラメータで有効にできる（再デプロイが要らない）", () => {
    expect(dialogDiagnosticsEnabled({ search: "?dialogDebug=1" })).toBe(true);
    expect(dialogDiagnosticsEnabled({ search: "dialogDebug=1" })).toBe(true);
    expect(
      dialogDiagnosticsEnabled({ search: "?a=1&dialogDebug=1&b=2" }),
    ).toBe(true);
  });

  it("★ 環境変数でも有効にできる", () => {
    expect(dialogDiagnosticsEnabled({ envValue: "1" })).toBe(true);
    expect(dialogDiagnosticsEnabled({ envValue: "true" })).toBe(true);
    expect(dialogDiagnosticsEnabled({ envValue: "on" })).toBe(true);
  });

  it("★ 知らない値では有効にならない（ホワイトリスト）", () => {
    for (const v of ["0", "false", "off", "2", "yes", "  ", "1 1"]) {
      expect(dialogDiagnosticsEnabled({ envValue: v }), v).toBe(false);
      expect(
        dialogDiagnosticsEnabled({ search: `?dialogDebug=${v}` }),
        v,
      ).toBe(false);
    }
  });

  it("★ 似た名前のパラメータでは反応しない", () => {
    expect(dialogDiagnosticsEnabled({ search: "?dialogDebugX=1" })).toBe(false);
    expect(dialogDiagnosticsEnabled({ search: "?xdialogDebug=1" })).toBe(false);
  });

  it("大文字・前後の空白は許す", () => {
    expect(dialogDiagnosticsEnabled({ envValue: " TRUE " })).toBe(true);
  });

  it("パラメータ名は定数から使う", () => {
    expect(DIALOG_DIAGNOSTICS_PARAM).toBe("dialogDebug");
    expect(DIALOG_NO_SCROLL_LOCK_PARAM).toBe("dialogNoScrollLock");
  });
});

describe("スクロールロックの切り替え", () => {
  it("★ 診断が無効なら、指定しても切れない", () => {
    expect(dialogScrollLockDisabled({ search: "?dialogNoScrollLock=1" })).toBe(
      false,
    );
    expect(
      dialogScrollLockDisabled({
        search: "?dialogNoScrollLock=1",
        envValue: "0",
      }),
    ).toBe(false);
  });

  it("★ 診断が有効で、かつ指定したときだけ切れる", () => {
    expect(
      dialogScrollLockDisabled({
        search: "?dialogDebug=1&dialogNoScrollLock=1",
      }),
    ).toBe(true);
  });

  it("★ 診断が有効でも、指定しなければ切れない（既定は入）", () => {
    expect(dialogScrollLockDisabled({ search: "?dialogDebug=1" })).toBe(false);
  });
});

describe("どこで止まっているかの説明", () => {
  const probe = (over: Partial<typeof EMPTY_DIALOG_TAP_PROBE>) => ({
    ...EMPTY_DIALOG_TAP_PROBE,
    ...over,
  });

  it("★ 何も届いていない", () => {
    expect(describeDialogTapProbe(EMPTY_DIALOG_TAP_PROBE)).toContain(
      "届いていません",
    );
  });

  it("★ 覆いで止まっている", () => {
    expect(describeDialogTapProbe(probe({ overlay: 1 }))).toContain(
      "覆いで止まっています",
    );
  });

  it("★ 本体までは届くがボタンに当たっていない", () => {
    expect(describeDialogTapProbe(probe({ overlay: 1, panel: 1 }))).toContain(
      "ボタンに当たっていません",
    );
  });

  it("★ ボタンに触れたが click になっていない", () => {
    expect(
      describeDialogTapProbe(probe({ overlay: 1, panel: 1, confirmDown: 1 })),
    ).toContain("click になっていません");
  });

  it("★ click まで届いている", () => {
    expect(
      describeDialogTapProbe(
        probe({ overlay: 1, panel: 1, confirmDown: 1, confirmClick: 1 }),
      ),
    ).toContain("click まで届いています");
  });
});

/**
 * handleMove の到達点の記録。
 *
 * click までは届いていることが分かったので、次に要るのは中のどこで
 * 止まったか。溜めすぎず、例外も必ず読める形にする。
 */
describe("到達点の記録", () => {
  it("★ 順番が分かるよう番号を振る", () => {
    let t = appendDialogTrace([], "開始", 100);
    t = appendDialogTrace(t, "判定OK", 102);

    expect(formatDialogTrace(t)).toEqual(["1. 開始", "2. 判定OK (+2ms)"]);
  });

  it("★ 直前の段階からの差分を出す（区間が読める）", () => {
    let t = appendDialogTrace([], "トークン取得中", 1000);
    t = appendDialogTrace(t, "トークンOK", 4200);
    t = appendDialogTrace(t, "送信", 4201);
    t = appendDialogTrace(t, "応答 HTTP 200", 13501);

    expect(formatDialogTrace(t)).toEqual([
      "1. トークン取得中",
      "2. トークンOK (+3200ms)",
      "3. 送信 (+1ms)",
      "4. 応答 HTTP 200 (+9300ms)",
    ]);
  });

  it("★ 最初の1行には差分を付けない（基準が無い）", () => {
    const t = appendDialogTrace([], "onConfirm 到達", 50);

    expect(formatDialogTrace(t)).toEqual(["1. onConfirm 到達"]);
  });

  it("小数は丸める", () => {
    let t = appendDialogTrace([], "a", 0);
    t = appendDialogTrace(t, "b", 12.6);

    expect(formatDialogTrace(t)[1]).toBe("2. b (+13ms)");
  });

  it("★ 溜めすぎない（古いものから捨てる）", () => {
    let t: ReturnType<typeof appendDialogTrace> = [];
    for (let i = 0; i < DIALOG_TRACE_MAX + 5; i += 1) {
      t = appendDialogTrace(t, `step${i}`, i);
    }

    expect(t).toHaveLength(DIALOG_TRACE_MAX);
    // 最後の行＝到達点が残る
    expect(t[t.length - 1].label).toBe(`step${DIALOG_TRACE_MAX + 4}`);
  });

  it("★ 応答後の待ち時間を読める形にする", () => {
    expect(formatDialogElapsed(0)).toBe("0ms");
    expect(formatDialogElapsed(999)).toBe("999ms");
    expect(formatDialogElapsed(1000)).toBe("1.0秒");
    expect(formatDialogElapsed(2149)).toBe("2.1秒");
  });

  it("★ 例外は握り潰さず1行にする", () => {
    expect(dialogTraceErrorText(new TypeError("boom"))).toBe(
      "TypeError: boom",
    );
    expect(dialogTraceErrorText("そのまま")).toBe("そのまま");
    expect(dialogTraceErrorText({ a: 1 })).toBe('{"a":1}');
  });

  it("読めない値でも落ちない", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(() => dialogTraceErrorText(cyclic)).not.toThrow();
    expect(dialogTraceErrorText(undefined)).toBe("undefined");
  });
});
