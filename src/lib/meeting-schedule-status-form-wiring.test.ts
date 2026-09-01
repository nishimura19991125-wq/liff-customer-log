import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 商談ステータス編集のロジックを1か所へ寄せた件（段階 B-1）。
 *
 * 同じ編集をアポ情報一覧にも載せるため、入力・判定・保存をフックへ移した。
 * 画面ごとに条件を書き足すと、調査で挙がった4点がずれる。
 *
 *   1. フォームの表示条件
 *   2. 返待ち回答日の枠を出す条件
 *   3. 保存後にどの項目を差し替えるか（画面ごと。フックは onSave の結果を返すだけ）
 *   4. 保存ボタンの有効条件
 *
 * ここで固定するのは「カード側に条件が残っていないこと」。
 */

const ROOT = process.cwd();
const HOOK = "src/hooks/use-meeting-schedule-status-form.ts";
const CARD = "src/components/meeting-schedule-item-card.tsx";

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

describe("判定はフックだけが持つ", () => {
  it("★ カードは条件を組み立て直さない", () => {
    const card = read(CARD);

    for (const owned of [
      "showSetCreatedForm =",
      "showHenmachiForm =",
      "hasEditableField =",
      "const saveHint =",
      "planMeetingScheduleCardSave(",
      "resolveMeetingScheduleCardEditability(",
      "buildMeetingScheduleSaveConfirm(",
      "isMeetingScheduleInputLocked(",
      "meetingScheduleNegotiationOptionsFor(",
    ]) {
      expect(card, owned).not.toContain(owned);
    }
  });

  it("★ フックが4つの条件をすべて持つ", () => {
    const hook = read(HOOK);

    expect(hook).toContain("const showSetCreatedForm =");
    expect(hook).toContain("const showHenmachiForm =");
    expect(hook).toContain("const hasEditableField =");
    expect(hook).toContain("const saveHint =");
  });

  it("★ カードはフックを使う", () => {
    const card = read(CARD);

    expect(card).toContain("useMeetingScheduleStatusForm({");
    expect(card).toContain('from "@/hooks/use-meeting-schedule-status-form"');
  });
});

describe("保存後の差し替えは親が決める（ずれ 3）", () => {
  it("★ フックは onSave の結果をそのまま扱い、再取得しない", () => {
    const hook = read(HOOK);

    expect(hook).toContain("const result = await onSave(recordId, plan.patch);");
    // 一覧の取り直しはフックの仕事ではない
    expect(hook).not.toContain("mutate(");
    expect(hook).not.toContain("fetch(");
  });

  it("★ 変わった項目だけ入れ替える（未保存の入力を消さない）", () => {
    const hook = read(HOOK);

    expect(hook).toContain(
      "if (prev.negotiationStatus !== server.negotiationStatus) {",
    );
    expect(hook).toContain("if (prev.closeType !== server.closeType)");
  });

  it("★ レコードが差し替わったときだけ全部入れ替える", () => {
    const hook = read(HOOK);

    expect(hook).toContain("if (recordIdRef.current !== recordId) {");
  });
});

describe("フックが扱うのは値だけ（段階 C で使い回せる）", () => {
  it("★ MeetingScheduleItem を受け取らない", () => {
    const hook = read(HOOK);

    expect(hook).not.toContain("MeetingScheduleItem");
    // 受け取るのは MeetingScheduleCardValues と recordId だけ
    expect(hook).toContain("server: MeetingScheduleCardValues;");
    expect(hook).toContain("recordId: string;");
  });

  it("★ 画面の見た目を持たない（JSX を書かない）", () => {
    const hook = read(HOOK);

    expect(hook).not.toContain("className");
    expect(hook).not.toContain("<div");
  });

  it("★ 編集不可の画面でも使える（statusEditable / scheduleEditable が引数）", () => {
    const hook = read(HOOK);

    expect(hook).toContain("statusEditable: boolean;");
    expect(hook).toContain("scheduleEditable: boolean;");
  });
});
