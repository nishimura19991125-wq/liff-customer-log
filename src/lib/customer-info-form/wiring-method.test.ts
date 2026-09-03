import { describe, expect, it } from "vitest";

import {
  INSTALLATION_TYPES_WITH_WIRING_METHOD,
  shouldShowWiringMethod,
} from "@/lib/customer-info-form/options";
import { INSTALLATION_TYPE_OPTIONS } from "@/lib/customer-info-form/schema";

/**
 * 配線方式は「表示・必須・保存」の3つを shouldShowWiringMethod だけから導く。
 * 引継ぎ資料のアポキャン事故（表示を消しただけで、画面に出ていない値が
 * 保存時に書き込まれていた）と同じ構造なので、判定を1箇所に固定する。
 */

describe("shouldShowWiringMethod", () => {
  it("「太陽光パネル+蓄電池」で true", () => {
    expect(shouldShowWiringMethod("太陽光パネル+蓄電池")).toBe(true);
  });

  it("「蓄電池のみ」で true", () => {
    expect(shouldShowWiringMethod("蓄電池のみ")).toBe(true);
  });

  it("「太陽光パネルのみ」で false", () => {
    expect(shouldShowWiringMethod("太陽光パネルのみ")).toBe(false);
  });

  it("「パワコン取替のみ」で false", () => {
    expect(shouldShowWiringMethod("パワコン取替のみ")).toBe(false);
  });

  it("選択肢に無い値で false", () => {
    expect(shouldShowWiringMethod("太陽光のみ")).toBe(false);
    expect(shouldShowWiringMethod("蓄電池")).toBe(false);
  });

  it("空文字で false", () => {
    expect(shouldShowWiringMethod("")).toBe(false);
  });

  it("前後に空白があっても判定する（trim する）", () => {
    expect(shouldShowWiringMethod(" 蓄電池のみ")).toBe(true);
    expect(shouldShowWiringMethod("太陽光パネル+蓄電池 ")).toBe(true);
    expect(shouldShowWiringMethod("  ")).toBe(false);
  });

  it("空白だけを落とす（全角化・NFKC 正規化はしない）", () => {
    // 設置種別の他の判定（installationTypeHidesPanelSection 等）と同じ扱い。
    // 全角の＋は @pocket の値と別物なので false のままにする
    expect(shouldShowWiringMethod("太陽光パネル＋蓄電池")).toBe(false);
    expect(shouldShowWiringMethod("蓄電池 のみ")).toBe(false);
  });
});

describe("★ 配線方式を出す設置種別が @pocket の選択肢と一致している", () => {
  it("2つとも設置種別の選択肢に含まれる", () => {
    // 1文字でもズレると、条件が永久に成立せず入力欄が出ない
    for (const v of INSTALLATION_TYPES_WITH_WIRING_METHOD) {
      expect([...INSTALLATION_TYPE_OPTIONS], `設置種別「${v}」`).toContain(v);
    }
  });

  it("設置種別の4種類すべてで判定が定義どおり", () => {
    const shown = INSTALLATION_TYPE_OPTIONS.filter((t) =>
      shouldShowWiringMethod(t),
    );
    expect(shown).toEqual(["太陽光パネル+蓄電池", "蓄電池のみ"]);
  });
});
