import { describe, expect, it } from "vitest";

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
