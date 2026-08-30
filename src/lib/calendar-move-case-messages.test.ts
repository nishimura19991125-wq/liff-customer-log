import { describe, expect, it } from "vitest";

import {
  MOVE_CONSTRUCTION_CASE_PATH,
  buildMoveSourceDeleteFailedMessage,
  buildMoveSourceResetFailedMessage,
  movedSourceClearedColumnsLabel,
  MOVE_CASE_CONFIRM_WARNING,
  MOVE_CASE_DELETE_SOURCE_WARNING,
  buildMoveCaseConfirmLines,
  buildMoveCaseConfirmSubject,
  buildMoveCaseConfirmTitle,
  moveCaseConfirmActionLabel,
  moveCaseConfirmWarning,
  moveCaseContractorChanges,
  moveCaseDeletesSource,
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

/**
 * 新規作成で施工業者を選べるようにしたぶん（M-3）。
 *
 * 確認画面の**構成は変えない**ことを固定する。新規作成は新規作成のまま
 * 見え、増えるのは「施工会社が変わります」の1行だけ。
 */
describe("新規作成で施工業者を選んだとき", () => {
  const NEW_RECORD: MoveCaseConfirmInput = {
    customerName: "山田 太郎",
    tNumber: "T00003420",
    sourceDayKey: "2026-12-01",
    targetDayKey: "2026-12-05",
    sourceContractor: "△△工務店",
    targetSlotContractor: null,
    newRecordContractor: null,
  };

  it("★ 移動元と違う施工業者を選んだら「変わります」を出す", () => {
    const input = { ...NEW_RECORD, newRecordContractor: "◯◯建設" };

    expect(moveCaseContractorChanges(input)).toBe(true);
    expect(buildMoveCaseConfirmLines(input)).toEqual([
      "2026/12/05 に新しいレコードを作成します（Aki番号 は新規採番）",
      "2026/12/01 のレコードは顧客情報を消して、空き枠として残します（削除しません）",
      "施工会社が △△工務店 → ◯◯建設 に変わります",
      "Aki番号 が新規採番されます（お客様情報にも反映）",
    ]);
  });

  it("★ 移動元と同じ施工業者なら出さない", () => {
    const input = { ...NEW_RECORD, newRecordContractor: "△△工務店" };

    expect(moveCaseContractorChanges(input)).toBe(false);
    expect(buildMoveCaseConfirmLines(input).some((l) => l.includes("施工会社が"))).toBe(
      false,
    );
  });

  it("★ 施工業者を選んでいなければ、これまでと同じ文言のまま", () => {
    expect(buildMoveCaseConfirmLines(NEW_RECORD)).toEqual([
      "2026/12/05 に新しいレコードを作成します（Aki番号 は新規採番）",
      "2026/12/01 のレコードは顧客情報を消して、空き枠として残します（削除しません）",
      "Aki番号 が新規採番されます（お客様情報にも反映）",
    ]);
  });

  it("★ 施工業者を選んでも「新しいレコードを作成します」のまま（枠に化けない）", () => {
    const lines = buildMoveCaseConfirmLines({
      ...NEW_RECORD,
      newRecordContractor: "◯◯建設",
    });

    expect(lines[0]).toBe(
      "2026/12/05 に新しいレコードを作成します（Aki番号 は新規採番）",
    );
    expect(lines[0]).not.toContain("空き枠");
    expect(lines[lines.length - 1]).toBe(
      "Aki番号 が新規採番されます（お客様情報にも反映）",
    );
  });

  it("★ 空き枠を選んだときは、枠の施工会社が優先される", () => {
    // 画面が取り違えて両方入れても、枠の値で判断する
    const input: MoveCaseConfirmInput = {
      ...NEW_RECORD,
      targetSlotContractor: "◯◯建設",
      newRecordContractor: "無関係な会社",
    };

    expect(buildMoveCaseConfirmLines(input)[0]).toContain(
      "空き枠（施工会社: ◯◯建設）",
    );
    expect(
      buildMoveCaseConfirmLines(input).some((l) =>
        l.includes("→ ◯◯建設 に変わります"),
      ),
    ).toBe(true);
  });

  it("表記ゆれでは「変わります」を出さない（枠のときと同じ扱い）", () => {
    expect(
      moveCaseContractorChanges({
        ...NEW_RECORD,
        sourceContractor: "△△ 工務店",
        newRecordContractor: "△△工務店",
      }),
    ).toBe(false);
  });

  it("フィールドが無くても（既存の呼び出し）壊れない", () => {
    const { newRecordContractor: _omit, ...withoutField } = NEW_RECORD;

    expect(moveCaseContractorChanges(withoutField)).toBe(false);
    expect(buildMoveCaseConfirmLines(withoutField)).toHaveLength(3);
  });
});

/**
 * 移動元を削除できなかったときの文言（M-4）。
 *
 * 空き枠へ戻せなかったときと**状態は同じ**（同じ T番号 が2件）だが、
 * 直し方が違う。片方の文言をもう片方へ流用しないことを固定する。
 */
describe("移動元を削除できなかったとき", () => {
  const INPUT = {
    sourceRecordId: "5001",
    sourceDayKey: "2026-12-01",
    targetDayKey: "2026-12-05",
  };

  it("★ レコードIDと日付を名指しする", () => {
    const msg = buildMoveSourceDeleteFailedMessage(INPUT);

    expect(msg).toContain("レコードID 5001");
    expect(msg).toContain("2026/12/01");
    expect(msg).toContain("2026/12/05");
  });

  it("★ 重複していること・直し方・直すまでどうなるかを書く", () => {
    const msg = buildMoveSourceDeleteFailedMessage(INPUT);

    expect(msg).toContain("2日に重複して表示されています");
    expect(msg).toContain("@pocket で2026/12/01のレコードを削除してください");
    expect(msg).toContain(
      "削除するまで、この案件の割り当て・キャンセルはエラーになります",
    );
  });

  it("★ 移動先への登録が完了していることを先に伝える", () => {
    const lines = buildMoveSourceDeleteFailedMessage(INPUT).split("\n");

    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain("移動先（2026/12/05）への登録は完了しました");
  });

  it("★ 空き枠へ戻せなかったときの文言とは別物（消す列の話をしない）", () => {
    const del = buildMoveSourceDeleteFailedMessage(INPUT);
    const reset = buildMoveSourceResetFailedMessage(INPUT);

    expect(del).not.toBe(reset);
    // 削除の案内に「列を消してください」と書かない
    expect(del).not.toContain(movedSourceClearedColumnsLabel());
    expect(reset).toContain(movedSourceClearedColumnsLabel());
  });

  it("月をまたいでも年が分かる", () => {
    const msg = buildMoveSourceDeleteFailedMessage({
      ...INPUT,
      sourceDayKey: "2026-12-28",
      targetDayKey: "2027-01-05",
    });

    expect(msg).toContain("2026/12/28");
    expect(msg).toContain("2027/01/05");
  });
});

/**
 * 移動元を削除する選択（M-4）の確認画面。
 *
 * 元に戻せない操作なので、固定するのは
 *   ・既定（残す）の文言が1文字も変わらないこと
 *   ・削除を選んだときだけ、消えること・失うものが出ること
 */
describe("移動元を削除するとき", () => {
  const KEEP: MoveCaseConfirmInput = {
    customerName: "山田 太郎",
    tNumber: "T00003420",
    sourceDayKey: "2026-12-01",
    targetDayKey: "2026-12-05",
    sourceContractor: "△△工務店",
    targetSlotContractor: "◯◯建設",
  };
  const DELETE: MoveCaseConfirmInput = {
    ...KEEP,
    sourceDisposition: "delete",
  };

  it("★ 省略時は「残す」（これまでの呼び出しが変わらない）", () => {
    expect(moveCaseDeletesSource(KEEP)).toBe(false);
    expect(moveCaseDeletesSource({ ...KEEP, sourceDisposition: "keep" })).toBe(
      false,
    );
    expect(moveCaseDeletesSource(DELETE)).toBe(true);
  });

  it("★ 「残す」の文言はこれまでと同じ", () => {
    expect(buildMoveCaseConfirmLines(KEEP)).toEqual([
      "2026/12/05 の空き枠（施工会社: ◯◯建設）にこの案件を書き込みます",
      "2026/12/01 のレコードは顧客情報を消して、空き枠として残します（削除しません）",
      "施工会社が △△工務店 → ◯◯建設 に変わります",
      "Aki番号 が移動先の空き枠のものに入れ替わります（お客様情報にも反映）",
    ]);
    expect(moveCaseConfirmWarning(KEEP)).toBe(MOVE_CASE_CONFIRM_WARNING);
    expect(moveCaseConfirmActionLabel(KEEP)).toBe("2026/12/05 へ移動する");
  });

  it("★ 削除を選ぶと、消えることと枠が減ることを出す", () => {
    expect(buildMoveCaseConfirmLines(DELETE)).toEqual([
      "2026/12/05 の空き枠（施工会社: ◯◯建設）にこの案件を書き込みます",
      "2026/12/01 のレコードを削除します（元に戻せません）",
      "2026/12/01 の空き枠が1つ減ります",
      "施工会社が △△工務店 → ◯◯建設 に変わります",
      "Aki番号 が移動先の空き枠のものに入れ替わります（お客様情報にも反映）",
    ]);
  });

  it("★ 削除のときは「空き枠として残します」と言わない", () => {
    const lines = buildMoveCaseConfirmLines(DELETE);

    expect(lines.some((l) => l.includes("空き枠として残します"))).toBe(false);
    expect(lines.some((l) => l.includes("削除しません"))).toBe(false);
  });

  it("★ 警告で、転記されない項目が失われることを名指しする", () => {
    const w = moveCaseConfirmWarning(DELETE);

    expect(w).toBe(MOVE_CASE_DELETE_SOURCE_WARNING);
    expect(w).toContain("元に戻せません");
    expect(w).toContain("移動先へ転記されない項目");
    expect(w).toContain("終了日・メモ");
    expect(w).toContain("2日に重複");
  });

  it("★ 実行ボタンにも削除することを出す", () => {
    expect(moveCaseConfirmActionLabel(DELETE)).toBe(
      "2026/12/05 へ移動して移動元を削除する",
    );
  });

  it("★ 新規作成で移すときも削除の文言になる", () => {
    const lines = buildMoveCaseConfirmLines({
      ...DELETE,
      targetSlotContractor: null,
    });

    expect(lines[0]).toContain("新しいレコードを作成します");
    expect(lines[1]).toBe("2026/12/01 のレコードを削除します（元に戻せません）");
    expect(lines[2]).toBe("2026/12/01 の空き枠が1つ減ります");
  });
});
