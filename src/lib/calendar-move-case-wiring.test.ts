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
    // M-4 で警告が移動元の扱いによって変わるため、定数から関数になった
    expect(src).toContain("moveCaseConfirmWarning");
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

  it("★ 日付と施工会社を2行で出す（文言は画面で組み立てない）", () => {
    const src = read(PANEL);

    // 1行目＝日付、2行目＝施工会社。どちらも純粋関数が作ったものを出すだけ
    expect(src).toContain("{choice.label}");
    expect(src).toContain("{choice.detail}");
    expect(src).toContain("{choice.detail ? (");
    // 画面側で「施工会社:」を組み立て直さない
    expect(src).not.toContain("施工会社: {");
    expect(src).not.toContain("空き枠（施工会社");
  });

  it("★ 2行になっても行そのものを押せる", () => {
    const src = read(PANEL);
    const row = src.slice(
      src.indexOf("{choices.map((choice) => ("),
      src.indexOf("{choice.label}"),
    );

    // label がラジオを包んでいるので、どこを押しても選べる
    expect(row).toContain("cursor-pointer");
    expect(row).toContain("min-h-[52px]");
    expect(row).toContain('type="radio"');
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
    // 押せるかと「押せない理由」を同じ判定から作る（M-5 で1本化）
    expect(read(PANEL)).toContain("describeMoveBlockedReason({");
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

/**
 * 移動元の扱いを確認画面で選ばせる（M-4）。
 *
 * 元に戻せない操作なので、**既定が「残す」から動いていないこと**を
 * 画面側でも固定する。判定と文言は lib のテストが持つ。
 */
describe("移動元の扱い（M-4）", () => {
  it("★ 確認画面でラジオで選ばせる", () => {
    const src = read(PANEL);

    expect(src).toContain("SOURCE_DISPOSITION_CHOICES");
    expect(src).toContain("空き枠として残す（従来どおり）");
    expect(src).toContain("削除する");
    expect(src).toContain('name="calendar-move-source-disposition"');
  });

  it("★ 「残す」が先頭で既定", () => {
    const src = read(PANEL);

    expect(src).toContain('useState<\n    "keep" | "delete"\n  >("keep")');
    // 並びも「残す」が先
    const keepAt = src.indexOf('{ value: "keep"');
    const deleteAt = src.indexOf('{ value: "delete"');
    expect(keepAt).toBeGreaterThan(-1);
    expect(keepAt).toBeLessThan(deleteAt);
  });

  it("★ 選択は「実行される内容」より前に出す（原因が結果より先）", () => {
    const src = read(PANEL);

    expect(src.indexOf("SOURCE_DISPOSITION_CHOICES.map")).toBeLessThan(
      src.indexOf("buildMoveCaseConfirmLines(input).map"),
    );
  });

  it("★ 削除を選んだときだけ送る（既定では body に入れない）", () => {
    const src = read(PANEL);

    expect(src).toContain('sourceDisposition === "delete"');
    expect(src).toContain('{ sourceDisposition: "delete" }');
  });

  it("★ パネルを閉じたら「残す」に戻る", () => {
    const src = read(PANEL);
    const reset = src.slice(
      src.indexOf("function reset() {"),
      src.indexOf("function reset() {") + 300,
    );

    expect(reset).toContain('setSourceDisposition("keep")');
  });

  it("★ 警告の文言も選択で切り替える（画面に直書きしない）", () => {
    const src = read(PANEL);

    expect(src).toContain("moveCaseConfirmWarning(input)");
    // 定数を直に出していたころの書き方を残さない
    expect(src).not.toContain("{MOVE_CASE_CONFIRM_WARNING}");
  });

  it("★ 片づけ方はサーバの結果で言う（画面の選択で言わない）", () => {
    const src = read(PANEL);

    // 削除を選んでも判定で見送られることがある。選択で言うと嘘になる
    expect(src).toContain("data.sourceDeleted");
    expect(src).toContain("data.sourceKeptNotice");
  });
});

/**
 * 確認ダイアログが画面に収まること。
 *
 * 実機（iPhone / LIFF）で下部のボタンに届かず、移動を実行できなくなった。
 * 中身が増えたのがきっかけだが、原因は高さの取り方（iOS の 100vh は
 * 見えている高さより大きい）。共有の枠へ寄せたことを固定する。
 */
describe("確認ダイアログの収まり", () => {
  it("★ 共有の枠を使う（自前で高さを決めない）", () => {
    const src = read(PANEL);

    expect(src).toContain("DIALOG_BACKDROP_CLASS");
    expect(src).toContain("DIALOG_VIEWPORT_CLASS");
    expect(src).toContain("DIALOG_PANEL_CLASS");
    expect(src).toContain("DIALOG_BODY_CLASS");
    expect(src).toContain("DIALOG_FOOTER_CLASS");
  });

  it("★ vh で高さを決めていた頃の書き方を残さない", () => {
    const src = read(PANEL);

    expect(src).not.toContain("max-h-[85vh]");
    expect(src).not.toContain("fixed inset-0");
  });

  it("★ ボタンはスクロールの外にある", () => {
    const src = read(PANEL);
    const bodyOpen = src.indexOf("<div className={DIALOG_BODY_CLASS}>");
    const footerOpen = src.indexOf("${DIALOG_FOOTER_CLASS}");
    const confirmButton = src.indexOf("moveCaseConfirmActionLabel(input)");

    expect(bodyOpen).toBeGreaterThan(-1);
    expect(footerOpen).toBeGreaterThan(bodyOpen);
    // 実行ボタンは操作側（＝スクロールする中身より後ろ）にある
    expect(confirmButton).toBeGreaterThan(footerOpen);
  });

  it("★ 中身は全部スクロール側に入っている", () => {
    const src = read(PANEL);
    const bodyOpen = src.indexOf("<div className={DIALOG_BODY_CLASS}>");
    const footerOpen = src.indexOf("${DIALOG_FOOTER_CLASS}");

    for (const inBody of [
      "buildMoveCaseConfirmTitle(input)",
      "SOURCE_DISPOSITION_CHOICES.map",
      "buildMoveCaseConfirmLines(input).map",
      "moveCaseConfirmWarning(input)",
    ]) {
      const at = src.indexOf(inBody);
      expect(at, inBody).toBeGreaterThan(bodyOpen);
      expect(at, inBody).toBeLessThan(footerOpen);
    }
  });

  it("★ ARIA と Esc は維持されている", () => {
    const src = read(PANEL);

    expect(src).toContain('role="alertdialog"');
    expect(src).toContain('aria-modal="true"');
    expect(src).toContain('aria-labelledby="calendar-move-case-confirm-title"');
    expect(src).toContain('e.key !== "Escape"');
    // フォーカストラップも残っている
    expect(src).toContain("onKeyDown={onPanelKeyDown}");
  });
});

/**
 * 押しても何も起きない、を作らない。
 *
 * 実機で「移動する を押しても無反応、ログにも残らない」が起きた。
 * handleMove の先頭が `if (!canConfirm) return;` で、押しても
 * 「移動中…」にすら変わらなかった。無音の return を残さない。
 */
describe("無音で失敗しない", () => {
  it("★ 実行できないときは理由を出してから戻る", () => {
    const src = read(PANEL);

    expect(src).toContain("if (confirmBlockedBy) {");
    expect(src).toContain("moveBlockedReasonMessage(confirmBlockedBy)");
    // 理由を出さずに戻る書き方を残さない
    expect(src).not.toContain("if (!canConfirm) return;");
  });

  it("★ 押せるかと理由を1つの判定から作る（食い違わせない）", () => {
    const src = read(PANEL);

    expect(src).toContain("const confirmBlockedBy = describeMoveBlockedReason({");
    expect(src).toContain("const canConfirm = confirmBlockedBy === null;");
  });

  it("★ ログインの期限切れでも画面に理由が残る", () => {
    const src = read(PANEL);

    expect(src).toContain("if (!token) {");
    expect(src).toContain("ログインの有効期限が切れました");
    // トークンが無いときに黙って戻る書き方を残さない
    expect(src).not.toContain("if (!token) return;");
  });

  it("★ 理由を出したら確認画面は閉じる（押し続けさせない）", () => {
    const src = read(PANEL);
    const block = src.slice(
      src.indexOf("if (confirmBlockedBy) {"),
      src.indexOf("if (confirmBlockedBy) {") + 300,
    );

    expect(block).toContain("setConfirming(false)");
  });
});
