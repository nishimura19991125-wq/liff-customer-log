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
