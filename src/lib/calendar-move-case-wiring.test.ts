import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 工事日変更 M-3 の配線（ソースを直接見る）。
 *
 * 挙動ではなく**どこへ繋がっているか**を固定する。ここが狂うと、
 * 案件カードから導線が消えたことや、移動が別のルートへ向いたことに
 * 誰も気づけない。レンダリングを組まずに済む代わり、対象は文字列一致に
 * 限っている（3-3 の calendar-undated-wiring.test.ts と同じ流儀）。
 */

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

const PAGE = "src/components/liff-calendar-month-page.tsx";
const PANEL = "src/components/calendar-move-case-panel.tsx";

describe("案件カードの導線（M-3）", () => {
  it("★ 案件カードに工事日変更のパネルが入っている", () => {
    const src = read(PAGE);

    expect(src).toContain("CalendarMoveCasePanel");
    // 既存の導線と並べる（@pocket で開く・工事対応者の変更）
    expect(src).toContain("CaseConstructionHandlerEditor");
    expect(src).toContain("タップして @pocket で開く →");
  });

  it("★ 移動元の日付として、表示中の日を渡している", () => {
    expect(read(PAGE)).toContain("sourceDayKey={selectedDayKey}");
  });

  it("★ 同じ月の空き枠は月次ペイロードから作る（byDay を渡している）", () => {
    expect(read(PAGE)).toContain("byDay={data?.byDay}");
  });

  it("★ ボタンの文言が「工事日を変更」", () => {
    expect(read(PANEL)).toContain("工事日を変更");
  });
});

describe("送信先（M-3）", () => {
  it("★ M-2 の移動ルートへ送る", () => {
    const src = read(PANEL);

    expect(src).toContain("MOVE_CONSTRUCTION_CASE_PATH");
  });

  it("★ 割り当て・空き枠入力・旧経路へは送らない", () => {
    const src = read(PANEL);

    for (const other of [
      "/api/calendar/assign-customer-case",
      "/api/calendar/assign-case-to-slot",
      "/api/calendar/schedule-undated-case",
      "/api/calendar/fill-empty-slot",
      "/api/calendar/create-record",
    ]) {
      expect(src, `${other} を呼んでいる`).not.toContain(other);
    }
  });

  it("★ expectedTNumber を送る（キャッシュ越しの取り違えを防ぐ）", () => {
    const src = read(PANEL);

    expect(src).toContain("expectedTNumber");
    expect(src).toContain("item.tNumber");
  });

  it("★ 空き枠を選んだときだけ slotRecordId を送る", () => {
    expect(read(PANEL)).toContain("slotRecordId: selectedSlotId");
  });
});

describe("確認画面（M-3）", () => {
  it("★ alertdialog として出す", () => {
    const src = read(PANEL);

    expect(src).toContain('role="alertdialog"');
    expect(src).toContain('aria-modal="true"');
  });

  it("★ Esc はキャンセル扱い", () => {
    const src = read(PANEL);

    expect(src).toContain('e.key !== "Escape"');
    expect(src).toContain("onCancel()");
  });

  it("★ 文言は共有 lib から作る（画面に直書きしない）", () => {
    const src = read(PANEL);

    expect(src).toContain("buildMoveCaseConfirmLines");
    expect(src).toContain("MOVE_CASE_CONFIRM_WARNING");
  });

  it("★ サーバのエラーはそのまま出す（要約しない）", () => {
    // 移動元を戻せなかったときの案内には、直す対象のレコードIDと
    // 日付が入っている。要約すると @pocket で直せなくなる
    expect(read(PANEL)).toContain("data.error?.trim() ||");
  });
});

describe("★ 月をまたぐ移動（読み込み中で固まらない）", () => {
  it("★ 読み込み中／失敗の判定を純粋関数へ寄せている", () => {
    // 状態をコンポーネントの useState に持ち、それをエフェクトの依存にも
    // 入れていたため、走っている fetch を自分でキャンセルして永久に
    // 読み込み中になっていた。導出はテストできる場所に置く
    expect(read(PANEL)).toContain("resolveMoveTargetMonthState");
  });

  it("★ 途中状態を state に持たない", () => {
    const src = read(PANEL);

    // 持つのは「取れた月の結果」だけ
    expect(src).toContain("LoadedMonthByDay");
    expect(src).not.toContain('status: "loading"');
  });

  it("★ 取得エフェクトが自分の書いた state に依存しない", () => {
    const src = read(PANEL);
    const deps = src.slice(
      src.indexOf("}, [open, needsOtherMonth"),
      src.indexOf("reloadNonce]") + "reloadNonce]".length,
    );

    expect(deps).toBeTruthy();
    expect(deps).not.toContain("loadedMonth");
    // onSessionExpired は毎描画で別物になるので ref 経由にする
    expect(deps).not.toContain("onSessionExpired");
    expect(src).toContain("onSessionExpiredRef");
  });

  it("★ 失敗したら再読み込みできる", () => {
    const src = read(PANEL);

    expect(src).toContain("再読み込み");
    expect(src).toContain("setReloadNonce");
  });

  it("★ 枠を読めていないまま実行させない", () => {
    expect(read(PANEL)).toContain("Boolean(slotsError)");
  });
});

describe("既存の経路を変えていない（M-3）", () => {
  it("★ 3-3 の割り当てフローはそのまま", () => {
    expect(
      existsSync(
        path.join(ROOT, "src/app/api/calendar/assign-customer-case/route.ts"),
      ),
    ).toBe(true);
    expect(read("src/components/calendar-assign-undated-case-form.tsx")).toContain(
      "ASSIGN_CUSTOMER_CASE_PATH",
    );
  });

  it("★ 旧経路のファイルも消していない（撤去は M-4 / 3-4）", () => {
    for (const rel of [
      "src/app/api/calendar/assign-case-to-slot/route.ts",
      "src/app/api/calendar/schedule-undated-case/route.ts",
      "src/app/api/calendar/fill-empty-slot/route.ts",
    ]) {
      expect(existsSync(path.join(ROOT, rel)), `${rel} が無い`).toBe(true);
    }
  });

  it("★ pickEmptySlotForDay は変えていない（施工会社一致・1件返し）", () => {
    const src = read("src/lib/calendar-empty-slot-match.ts");

    expect(src).toContain("export function pickEmptySlotForDay");
    // 施工会社が空なら枠を返さない、という約束が残っていること
    expect(src).toContain("if (!dayKey || !contractorKey)");
  });

  it("★ 移動パネルは pickEmptySlotForDay を使わない", () => {
    // 説明のためコメントには出てくるので、import と呼び出しで見る
    const src = read(PANEL);

    expect(src).not.toContain("pickEmptySlotForDay(");
    expect(src).not.toContain("calendar-empty-slot-match");
    expect(src).not.toContain("/api/calendar/empty-slots-for-day");
  });
});

/**
 * 移動先の選び方（ラジオ）と、新規作成のときの施工業者。
 *
 * レンダリングを組めないので、ここでも配線を文字列で固定する。
 * 見るのは「どの選択肢が出るか」ではなく（それは
 * calendar-move-slot-choice.test.ts が持つ）、**画面が純粋関数へ
 * 繋がっているか**と、押させない条件が消えていないか。
 */
describe("移動先の選択（ラジオ）", () => {
  it("★ プルダウンではなくラジオで選ばせる", () => {
    const src = read(PANEL);

    expect(src).toContain('type="radio"');
    expect(src).toContain('role="radiogroup"');
    // 空き枠の選択に select は使わない
    expect(src).not.toContain("value={selectedSlotId}");
  });

  it("★ 選択肢の組み立ては純粋関数に寄せる（画面で並べ替えない）", () => {
    const src = read(PANEL);

    expect(src).toContain("buildMoveSlotChoices");
    expect(src).toContain("choices.map((choice)");
  });

  it("★ 「未選択」と「新しく作成する」を別の値で持つ", () => {
    const src = read(PANEL);

    // 初期値は未選択。新規作成かどうかは共有の判定に任せる
    expect(src).toContain("useState(MOVE_SLOT_CHOICE_NONE)");
    expect(src).toContain("moveSlotChoiceIsNew(slotChoice)");
    // 空文字が新規作成を兼ねていた頃の state を残さない
    expect(src).not.toContain("setSelectedSlotId");
  });

  it("★ 日付を変えたら選び直させる", () => {
    const src = read(PANEL);
    const onChange = src.slice(
      src.indexOf("setTargetDayKey(e.target.value)"),
      src.indexOf("setTargetDayKey(e.target.value)") + 320,
    );

    expect(onChange).toContain("setSlotChoice(MOVE_SLOT_CHOICE_NONE)");
    expect(onChange).toContain('setNewContractor("")');
  });

  it("★ 送る slotRecordId は選んだ値から導く（新規作成では送らない）", () => {
    const src = read(PANEL);

    expect(src).toContain("slotRecordIdFromChoice(slotChoice)");
    expect(src).toContain("slotRecordId: selectedSlotId");
  });
});

describe("新規作成のときの施工業者", () => {
  it("★ 新規登録・未定案件の割り当てと同じフックを使う（取得を増やさない）", () => {
    const src = read(PANEL);

    expect(src).toContain("useConstructionContractorOptions");
    // 取引先会社一覧を自前で叩かない
    expect(src).not.toContain("/api/calendar/construction-contractors");
  });

  it("★ 「新しく作成する」を選んでいる間だけ取りにいく", () => {
    const src = read(PANEL);

    expect(src).toContain(
      "open && choosingNew && !slotsLoading && !slotsError,",
    );
  });

  it("★ 欄を出すかどうかは純粋関数で決める", () => {
    const src = read(PANEL);

    expect(src).toContain("resolveMoveContractorInput");
    expect(src).toContain("{contractorInput.show && slotChoiceVisible ? (");
  });

  it("★ 選んだ施工業者を API へ送る", () => {
    const src = read(PANEL);

    expect(src).toContain("contractor: newContractor.trim()");
    // 空き枠を選んだときは送らない
    expect(src).toContain("choosingNew && newContractor.trim()");
  });

  it("★ 確認画面へは新規作成用のフィールドで渡す（枠の分岐に混ぜない）", () => {
    const src = read(PANEL);

    expect(src).toContain(
      "newRecordContractor: choosingNew ? newContractor.trim() || null : null,",
    );
    expect(src).toContain(
      "targetSlotContractor: selectedSlot ? selectedSlot.contractorName : null,",
    );
  });
});

describe("実行ボタンの制御", () => {
  it("★ 押せるかの判定を純粋関数へ寄せている", () => {
    expect(read(PANEL)).toContain("canConfirmMoveCase({");
  });

  it("★ 施工業者の未選択を判定に渡している", () => {
    const src = read(PANEL);

    expect(src).toContain("contractorRequired: contractorInput.required,");
    expect(src).toContain("contractor: newContractor,");
  });

  it("★ 工事対応者の判定は残っている", () => {
    const src = read(PANEL);

    expect(src).toContain("handlerRequired: handlerFromStaff,");
    expect(src).toContain("handlerStaffId: selectedHandlerStaffId,");
  });

  it("★ 枠を読めていない・読み込み中は今までどおり押させない", () => {
    const src = read(PANEL);

    expect(src).toContain("slotsLoading ||");
    expect(src).toContain("Boolean(slotsError)");
  });
});
