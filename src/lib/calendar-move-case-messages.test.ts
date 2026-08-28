import { describe, expect, it } from "vitest";

import {
  MOVE_CONSTRUCTION_CASE_PATH,
  buildMoveSourceResetFailedMessage,
  movedSourceClearedColumnsLabel,
  MOVE_CASE_CONFIRM_WARNING,
  buildMoveCaseConfirmLines,
  buildMoveCaseConfirmSubject,
  buildMoveCaseConfirmTitle,
  moveCaseConfirmActionLabel,
  moveCaseContractorChanges,
  type MoveCaseConfirmInput,
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

/**
 * 工事日変更 M-3: 確認画面の中身。
 *
 * 元に戻せない操作の同意を取る画面なので、
 *   ・何が起きるかを具体的に並べる
 *   ・変わらないことは書かない（読み飛ばす癖をつけない）
 *   ・「削除しません」を必ず書く
 * を固定する。
 */
describe("確認画面", () => {
  const SLOT: MoveCaseConfirmInput = {
    customerName: "山田 太郎",
    tNumber: "T00003420",
    sourceDayKey: "2026-12-01",
    targetDayKey: "2026-12-05",
    sourceContractor: "△△工務店",
    targetSlotContractor: "◯◯建設",
  };
  const NEW_RECORD: MoveCaseConfirmInput = {
    ...SLOT,
    targetSlotContractor: null,
  };

  it("★ 見出しが「工事日を 移動元 → 移動先 に変更します」", () => {
    expect(buildMoveCaseConfirmTitle(SLOT)).toBe(
      "工事日を 2026/12/01 → 2026/12/05 に変更します",
    );
  });

  it("★ 対象がお客様名とT番号で分かる", () => {
    expect(buildMoveCaseConfirmSubject(SLOT)).toBe("山田 太郎 様（T00003420）");
  });

  it("T番号 が無ければお客様名だけ出す", () => {
    expect(buildMoveCaseConfirmSubject({ ...SLOT, tNumber: "" })).toBe(
      "山田 太郎 様",
    );
  });

  it("★ 空き枠へ移すときの内容", () => {
    expect(buildMoveCaseConfirmLines(SLOT)).toEqual([
      "2026/12/05 の空き枠（施工会社: ◯◯建設）にこの案件を書き込みます",
      "2026/12/01 のレコードは顧客情報を消して、空き枠として残します（削除しません）",
      "施工会社が △△工務店 → ◯◯建設 に変わります",
      "Aki番号 が移動先の空き枠のものに入れ替わります（お客様情報にも反映）",
    ]);
  });

  it("★ 空き枠が無いときは文言が差し替わる", () => {
    expect(buildMoveCaseConfirmLines(NEW_RECORD)).toEqual([
      "2026/12/05 に新しいレコードを作成します（Aki番号 は新規採番）",
      "2026/12/01 のレコードは顧客情報を消して、空き枠として残します（削除しません）",
      "Aki番号 が新規採番されます（お客様情報にも反映）",
    ]);
  });

  it("★ 施工会社が変わらないときはその行を出さない", () => {
    const lines = buildMoveCaseConfirmLines({
      ...SLOT,
      targetSlotContractor: "△△工務店",
    });

    expect(lines.some((l) => l.includes("施工会社が"))).toBe(false);
    expect(moveCaseContractorChanges({ ...SLOT, targetSlotContractor: "△△工務店" })).toBe(false);
  });

  it("表記ゆれ（全角・空白）では「変わります」を出さない", () => {
    expect(
      moveCaseContractorChanges({
        ...SLOT,
        sourceContractor: "△△ 工務店",
        targetSlotContractor: "△△工務店",
      }),
    ).toBe(false);
  });

  it("★ 「削除しません」を必ず書く", () => {
    for (const input of [SLOT, NEW_RECORD]) {
      expect(
        buildMoveCaseConfirmLines(input).some((l) =>
          l.includes("削除しません"),
        ),
      ).toBe(true);
    }
  });

  it("★ 元に戻せないことと、失敗時に重複しうることを警告する", () => {
    expect(MOVE_CASE_CONFIRM_WARNING).toContain("元に戻せません");
    expect(MOVE_CASE_CONFIRM_WARNING).toContain("2日に重複");
  });

  it("★ 実行ボタンに移動先の日付が入る", () => {
    expect(moveCaseConfirmActionLabel(SLOT)).toBe("2026/12/05 へ移動する");
  });

  it("月をまたいでも年が分かる", () => {
    const lines = buildMoveCaseConfirmLines({
      ...SLOT,
      sourceDayKey: "2026-12-28",
      targetDayKey: "2027-01-05",
    });
    expect(lines[0]).toContain("2027/01/05");
    expect(lines[1]).toContain("2026/12/28");
  });

  it("施工会社が未設定の枠でも文言が崩れない", () => {
    const lines = buildMoveCaseConfirmLines({
      ...SLOT,
      targetSlotContractor: "",
    });
    expect(lines[0]).toContain("施工会社: 未設定");
    // 空の施工会社へ「変わります」とは言わない
    expect(lines.some((l) => l.includes("施工会社が"))).toBe(false);
  });
});
