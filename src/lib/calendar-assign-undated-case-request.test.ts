import { describe, expect, it } from "vitest";

import {
  ASSIGN_CASE_TO_SLOT_PATH,
  SCHEDULE_UNDATED_CASE_PATH,
  buildAssignUndatedCaseRequest,
  formatMissingFieldsMessage,
  missingAssignUndatedCaseFields,
} from "@/lib/calendar-assign-undated-case-request";
import type { CalendarEmptySlotMatch } from "@/lib/calendar-api-types";

/**
 * タスクS-3: 3択のどれを選んだかで、どこへ送るかが変わる。
 *
 * 空き枠を消す経路（assign-case-to-slot）へ迷い込まないことを厚めに見る。
 */

const VALUES = {
  caseRecordId: "5001",
  scheduledStartDate: "2026-09-05",
  contractor: "ピュアライフ",
};

const SLOT: CalendarEmptySlotMatch = {
  recordId: "101",
  dayKey: "2026-09-05",
  contractorName: "ピュアライフ",
};

function build(
  choice: "use-slot" | "skip-slot" | "cancel",
  slot: CalendarEmptySlotMatch | null,
  values = VALUES,
) {
  return buildAssignUndatedCaseRequest({
    choice,
    values,
    slot,
    viewYear: 2026,
    viewMonth: 9,
  });
}

describe("★ ⑤「この空き枠を使う」は既存の割り当て処理を呼ぶ", () => {
  it("assign-case-to-slot へ、空き枠と案件のIDを送る", () => {
    const req = build("use-slot", SLOT);

    expect(req?.path).toBe(ASSIGN_CASE_TO_SLOT_PATH);
    expect(req?.consumesSlot).toBe(true);
    expect(req?.body).toEqual({
      slotRecordId: "101",
      caseRecordId: "5001",
      slotDayKey: "2026-09-05",
      viewYear: 2026,
      viewMonth: 9,
    });
  });

  it("新しい API を作らず、既存のパスをそのまま使う", () => {
    expect(ASSIGN_CASE_TO_SLOT_PATH).toBe("/api/calendar/assign-case-to-slot");
  });

  it("日付は空き枠側のものを正とする（削除する枠の日付）", () => {
    const req = build("use-slot", { ...SLOT, dayKey: "2026-09-05" });
    expect(req?.body.slotDayKey).toBe("2026-09-05");
  });
});

describe("★ ⑥「空き枠を使わずに登録」は空き枠を消さない", () => {
  it("schedule-undated-case へ送る。空き枠のIDは送らない", () => {
    const req = build("skip-slot", SLOT);

    expect(req?.path).toBe(SCHEDULE_UNDATED_CASE_PATH);
    expect(req?.consumesSlot).toBe(false);
    expect(req?.body).toEqual({
      caseRecordId: "5001",
      scheduledStartDate: "2026-09-05",
      contractor: "ピュアライフ",
      viewYear: 2026,
      viewMonth: 9,
    });
    expect(req?.body).not.toHaveProperty("slotRecordId");
  });

  it("空き枠があっても skip なら削除経路へは行かない", () => {
    expect(build("skip-slot", SLOT)?.path).not.toBe(ASSIGN_CASE_TO_SLOT_PATH);
  });
});

describe("★ ③ 空き枠が無いときは確認せずそのまま登録", () => {
  it("slot が null なら schedule-undated-case", () => {
    const req = build("skip-slot", null);
    expect(req?.path).toBe(SCHEDULE_UNDATED_CASE_PATH);
    expect(req?.consumesSlot).toBe(false);
  });

  it("use-slot でも枠が無ければ削除経路へは行かない", () => {
    // 確認画面が出ていない＝枠が無い状況。取り違えても枠は消えない
    const req = build("use-slot", null);
    expect(req?.path).toBe(SCHEDULE_UNDATED_CASE_PATH);
    expect(req?.consumesSlot).toBe(false);
  });

  it("枠のレコードIDが空なら削除経路へは行かない", () => {
    const req = build("use-slot", { ...SLOT, recordId: "  " });
    expect(req?.path).toBe(SCHEDULE_UNDATED_CASE_PATH);
  });
});

describe("★ ⑦「キャンセル」は何もしない", () => {
  it("送信先を返さない", () => {
    expect(build("cancel", SLOT)).toBeNull();
    expect(build("cancel", null)).toBeNull();
  });
});

describe("★ ⑧ 必須が未入力なら送信しない", () => {
  it("施工会社が空なら missing に入る", () => {
    const missing = missingAssignUndatedCaseFields({
      ...VALUES,
      contractor: "",
    });
    expect(missing.map((m) => m.key)).toEqual(["contractor"]);
    expect(formatMissingFieldsMessage(missing)).toBe(
      "未入力の必須項目があります: 施工会社",
    );
  });

  it("施工会社が空白だけでも未入力扱い", () => {
    expect(
      missingAssignUndatedCaseFields({ ...VALUES, contractor: "   " }).map(
        (m) => m.key,
      ),
    ).toEqual(["contractor"]);
  });

  it("施工会社が空なら、空き枠があっても送信先を返さない", () => {
    // 画面のチェックを素通りしても空き枠は消えない
    expect(build("use-slot", SLOT, { ...VALUES, contractor: "" })).toBeNull();
    expect(build("skip-slot", SLOT, { ...VALUES, contractor: "" })).toBeNull();
  });

  it("施工予定日・案件が空でも送信しない", () => {
    expect(
      build("skip-slot", null, { ...VALUES, scheduledStartDate: "" }),
    ).toBeNull();
    expect(build("skip-slot", null, { ...VALUES, caseRecordId: "" })).toBeNull();
  });

  it("3つとも空なら3件とも並ぶ", () => {
    const missing = missingAssignUndatedCaseFields({
      caseRecordId: "",
      scheduledStartDate: "",
      contractor: "",
    });
    expect(missing.map((m) => m.label)).toEqual([
      "工事日未定案件",
      "施工予定日",
      "施工会社",
    ]);
    expect(formatMissingFieldsMessage(missing)).toBe(
      "未入力の必須項目があります: 工事日未定案件、施工予定日、施工会社",
    );
  });

  it("すべて入力済みなら missing は空", () => {
    expect(missingAssignUndatedCaseFields(VALUES)).toEqual([]);
    expect(formatMissingFieldsMessage([])).toBe("");
  });
});
