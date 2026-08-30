import { describe, expect, it } from "vitest";

import {
  DIALOG_DIAGNOSTICS_PARAM,
  DIALOG_NO_SCROLL_LOCK_PARAM,
  EMPTY_DIALOG_TAP_PROBE,
  describeDialogTapProbe,
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
