import { describe, expect, it } from "vitest";

import {
  MOVE_CONSTRUCTION_CASE_PATH,
  buildMoveSourceResetFailedMessage,
  movedSourceClearedColumnsLabel,
} from "@/lib/calendar-move-case-messages";
import { CONSTRUCTION_SLOT_RESET_FIELDS } from "@/lib/calendar-empty-slot-reset";

/**
 * 工事日変更 M-2: 送信先と、移動元を戻せなかったときの文言。
 *
 * 中途半端に終わった移動を放置させないための文言なので、
 * 「何が起きているか」「何をすればよいか」「直すまでどうなるか」を
 * 落とさないことを固定する。
 */

describe("送信先", () => {
  it("★ 移動専用のルートを指す", () => {
    expect(MOVE_CONSTRUCTION_CASE_PATH).toBe(
      "/api/calendar/move-construction-case",
    );
  });

  it("★ 割り当て（案A）のルートではない", () => {
    expect(MOVE_CONSTRUCTION_CASE_PATH).not.toContain("assign-customer-case");
    expect(MOVE_CONSTRUCTION_CASE_PATH).not.toContain("assign-case-to-slot");
  });
});

describe("消した列の見出し", () => {
  it("★ 定義から作る（文言と定義がずれない）", () => {
    const label = movedSourceClearedColumnsLabel();

    expect(label.split("・")).toHaveLength(
      CONSTRUCTION_SLOT_RESET_FIELDS.length,
    );
    expect(label).toBe("お客様名・T番号・住宅ステータス・工事対応者");
  });
});

describe("移動元を戻せなかったときの文言", () => {
  const message = () =>
    buildMoveSourceResetFailedMessage({
      sourceRecordId: "5001",
      sourceDayKey: "2026-12-01",
      targetDayKey: "2026-12-05",
    });

  it("★ 移動先への登録が済んでいることを先に伝える", () => {
    expect(message()).toContain("移動先（2026/12/05）への登録は完了");
  });

  it("★ 直す対象のレコードを名指しする", () => {
    const msg = message();
    expect(msg).toContain("2026/12/01");
    expect(msg).toContain("レコードID 5001");
  });

  it("★ 今2件に見えていることを言い切る", () => {
    // 「失敗しました」だけだと押し直して3件目を作りかねない
    expect(message()).toContain("2日に重複して表示されています");
  });

  it("★ 消す列を具体的に挙げる", () => {
    expect(message()).toContain(movedSourceClearedColumnsLabel());
  });

  it("★ 直すまで他の操作が止まることまで書く", () => {
    // 実際に案Aのガードが「複数一致」で止める
    expect(message()).toContain("割り当て・キャンセルはエラーになります");
  });

  it("★ 月をまたいでも年が分かる（yyyy/mm/dd で出す）", () => {
    const msg = buildMoveSourceResetFailedMessage({
      sourceRecordId: "5001",
      sourceDayKey: "2026-12-28",
      targetDayKey: "2027-01-05",
    });

    expect(msg).toContain("2026/12/28");
    expect(msg).toContain("2027/01/05");
  });

  it("日付が壊れていても文言が崩れない", () => {
    const msg = buildMoveSourceResetFailedMessage({
      sourceRecordId: "5001",
      sourceDayKey: "",
      targetDayKey: "not-a-date",
    });

    expect(msg).toContain("レコードID 5001");
    expect(msg).toContain("not-a-date");
  });
});
