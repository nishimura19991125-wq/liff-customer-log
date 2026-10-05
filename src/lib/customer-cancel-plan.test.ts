import { describe, expect, it } from "vitest";

import { buildCancelActionLines } from "@/lib/customer-cancel-plan";
import {
  isCustomerStatusCancelled,
  isCustomerStatusCancelledExact,
} from "@/lib/customer-status-label";

/**
 * タスクV: キャンセル処理の判断。
 *
 * 元に戻せない処理なので、「実行しない側」に倒れることを厚めに見る。
 *
 * ■ ここにあった空き枠の判定のテストは削除した
 * 以前は、キャンセル時に空き枠を作るかどうかを buildCustomerCancelPlan が
 * 決めていた。空き枠の自動作成を廃止し、判定と営業日の計算（isBusinessDay・
 * countBusinessDaysBetween）を**関数ごと削除した**ので、次のテストも
 * 対象が無くなった（期待値の書き換えではない）。
 *   - ⑤ 営業日の計算（土日祝を除く）
 *   - ⑥⑦ 仕様書の例での検算（7営業日を超えるときだけ作る）
 *   - ⑧ 過去の日付なら作らない
 *   - ⑨ 施工会社が空なら作らない
 *   - 施工予定日が無い場合
 * キャンセルを起動する条件（顧客ステータスの完全一致）は変わっていないので、
 * そのテストは残してある。
 */

describe("★ トリガーの判定は完全一致のみ", () => {
  it("「キャンセル」だけが true", () => {
    expect(isCustomerStatusCancelledExact("キャンセル")).toBe(true);
    expect(isCustomerStatusCancelledExact(" キャンセル ")).toBe(true);
  });

  it("「キャンセル」を含むだけの値では実行しない", () => {
    // 元に戻せない処理なので、部分一致では起動させない
    expect(isCustomerStatusCancelledExact("キャンセル保留")).toBe(false);
    expect(isCustomerStatusCancelledExact("キャンセル検討中")).toBe(false);
    expect(isCustomerStatusCancelledExact("仮キャンセル")).toBe(false);
  });

  it("工事待ち・空は false", () => {
    expect(isCustomerStatusCancelledExact("工事待ち")).toBe(false);
    expect(isCustomerStatusCancelledExact("")).toBe(false);
    expect(isCustomerStatusCancelledExact(null)).toBe(false);
    expect(isCustomerStatusCancelledExact(undefined)).toBe(false);
  });

  it("既存の緩い判定（部分一致）は変えていない", () => {
    // 書類未回収アラートの除外などは従来どおり
    expect(isCustomerStatusCancelled("キャンセル保留")).toBe(true);
    expect(isCustomerStatusCancelled("キャンセル")).toBe(true);
    expect(isCustomerStatusCancelled("工事待ち")).toBe(false);
  });
});

/**
 * 確認画面に並べる「実行されること」。
 *
 * 工事登録アプリの行は、**実際に行うほう**を出す。削除は元に戻せないので、
 * 「項目を消します」と書いておいてレコードごと消すのも、その逆も避ける。
 * 削除するかは環境変数で決まり、画面はサーバが返した plan だけを見る。
 */
describe("★ 確認画面の文言は削除の可否で出し分ける", () => {
  const DELETE_LINE = "工事登録アプリのレコードを削除します";
  const CLEAR_LINE = "工事登録アプリの該当項目も消します";

  it("★ 削除するときは「レコードを削除します」", () => {
    const lines = buildCancelActionLines({ deletesConstructionRecord: true });

    expect(lines).toContain(DELETE_LINE);
    expect(lines).not.toContain(CLEAR_LINE);
  });

  it("★ 削除を止めているときは「該当項目も消します」", () => {
    const lines = buildCancelActionLines({ deletesConstructionRecord: false });

    expect(lines).toContain(CLEAR_LINE);
    expect(lines).not.toContain(DELETE_LINE);
  });

  it("お客様情報側の2行はどちらでも同じ", () => {
    for (const deletesConstructionRecord of [true, false]) {
      const lines = buildCancelActionLines({ deletesConstructionRecord });

      expect(lines).toHaveLength(3);
      expect(lines[0]).toBe("PT、APPT、CLPT を 0 にします");
      expect(lines[1]).toBe(
        "施工予定日、初回施工予定日、施工会社、工事対応者を消します",
      );
    }
  });

  it("★ 空き枠の行は出ない（自動作成は廃止）", () => {
    for (const deletesConstructionRecord of [true, false]) {
      const lines = buildCancelActionLines({ deletesConstructionRecord });

      expect(lines.some((line) => line.includes("空き枠"))).toBe(false);
    }
  });
});
