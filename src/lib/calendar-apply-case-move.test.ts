import { describe, expect, it } from "vitest";

import { applyCalendarCaseMove } from "@/lib/calendar-apply-patch";
import type {
  CalendarApiPayload,
  CalendarMonthApiItem,
} from "@/lib/calendar-api-types";

/**
 * 工事日を移動した直後の、クライアント側の組み替え。
 *
 * 実機で「移動しても画面が5分ほど変わらない」が出た。工事レコードの
 * キャッシュ（既定300秒）と月ペイロードのキャッシュを挟むので、
 * 再取得だけでは間に合わない。サーバに patch を2つ作らせると @pocket の
 * GET が増えるうえ、直後の再取得で上書きされるだけなので採らない。
 *
 * ここで固定するのは次の4つ。
 *   - 案件が移動先の日へ出る
 *   - 移動元が空き枠に戻る（レコードは消えない）
 *   - 空き枠を使ったなら、その枠の行は二重に出ない
 *   - 触るのは押した日の1行だけ（新築の他の工程を巻き込まない）
 */

function item(over: Partial<CalendarMonthApiItem>): CalendarMonthApiItem {
  return {
    line1: "",
    line2: "",
    memo: "",
    reportKankoComplete: false,
    showKankoCheck: false,
    postponedBadge: false,
    segmentShort: "",
    housingShort: "",
    category: "list",
    contractorKey: "c-1",
    recordId: null,
    accessEditUrl: "",
    pinpointAddress: "",
    normalAddress: "",
    ...over,
  };
}

const CASE_ROW = item({
  recordId: "con-1",
  line1: "山田 太郎",
  line2: "A社",
  memo: "メモ",
  housingShort: "新築",
  segmentShort: "戸建",
  constructionHandlerName: "佐藤",
  tNumber: "T00003420",
  showKankoCheck: true,
  reportKankoComplete: true,
  postponedBadge: true,
});

const SLOT_ROW = item({
  recordId: "slot-9",
  category: "empty",
  line1: "（空枠）",
  contractorKey: "c-2",
});

function payload(
  byDay: Record<string, CalendarMonthApiItem[]>,
): CalendarApiPayload {
  return { byDay } as unknown as CalendarApiPayload;
}

const MOVE = {
  caseRecordId: "con-1",
  sourceDayKey: "2026-09-03",
  targetDayKey: "2026-09-10",
  movedRecordId: "slot-9",
  slotRecordId: "slot-9",
};

describe("空き枠へ移す", () => {
  const base = payload({
    "2026-09-03": [CASE_ROW],
    "2026-09-10": [SLOT_ROW],
  });

  it("★ 案件が移動先の日へ出る", () => {
    const out = applyCalendarCaseMove(base, MOVE);

    const target = out.byDay["2026-09-10"] ?? [];
    expect(target).toHaveLength(1);
    expect(target[0]?.line1).toBe("山田 太郎");
    expect(target[0]?.category).toBe("list");
    // 移動後に案件を持つのは、使った枠のレコード
    expect(target[0]?.recordId).toBe("slot-9");
    // 違う施工会社の枠へ移したら色分けも移る
    expect(target[0]?.contractorKey).toBe("c-2");
  });

  it("★ 移動元は空き枠に戻る（レコードは残る）", () => {
    const out = applyCalendarCaseMove(base, MOVE);

    const source = out.byDay["2026-09-03"] ?? [];
    expect(source).toHaveLength(1);
    expect(source[0]?.recordId).toBe("con-1");
    expect(source[0]?.category).toBe("empty");
    expect(source[0]?.line1).toBe("（空枠）");
    // 案件の中身は消す（お客様名・T番号・工事対応者・メモ・住宅ステータス）
    expect(source[0]?.line2).toBe("");
    expect(source[0]?.memo).toBe("");
    expect(source[0]?.tNumber).toBeUndefined();
    expect(source[0]?.constructionHandlerName).toBeUndefined();
    expect(source[0]?.housingShort).toBe("");
    expect(source[0]?.segmentShort).toBe("");
    // 空き枠に完了バッジ等が残らない
    expect(source[0]?.showKankoCheck).toBe(false);
    expect(source[0]?.reportKankoComplete).toBe(false);
    expect(source[0]?.postponedBadge).toBe(false);
    // 施工会社は枠に残る（移動元は同じ会社の空き枠のまま）
    expect(source[0]?.contractorKey).toBe("c-1");
  });

  it("★ 使った枠の行が二重に出ない", () => {
    const out = applyCalendarCaseMove(base, MOVE);

    const ids = (out.byDay["2026-09-10"] ?? []).map((i) => i.recordId);
    expect(ids).toEqual(["slot-9"]);
  });

  it("★ 押した日以外の行は動かさない（新築の他の工程を巻き込まない）", () => {
    const withOther = payload({
      "2026-09-01": [item({ recordId: "con-1", line1: "山田 太郎（仕込）" })],
      "2026-09-03": [CASE_ROW],
      "2026-09-10": [SLOT_ROW],
    });

    const out = applyCalendarCaseMove(withOther, MOVE);

    expect(out.byDay["2026-09-01"]).toHaveLength(1);
    expect(out.byDay["2026-09-01"]?.[0]?.line1).toBe("山田 太郎（仕込）");
  });

  it("移動先に元からある他の案件は残す", () => {
    const busy = payload({
      "2026-09-03": [CASE_ROW],
      "2026-09-10": [item({ recordId: "con-7", line1: "鈴木 一郎" }), SLOT_ROW],
    });

    const out = applyCalendarCaseMove(busy, MOVE);

    const ids = (out.byDay["2026-09-10"] ?? []).map((i) => i.recordId);
    expect(ids).toEqual(["con-7", "slot-9"]);
  });

  it("元の payload を書き換えない", () => {
    applyCalendarCaseMove(base, MOVE);

    expect(base.byDay["2026-09-03"]?.[0]?.category).toBe("list");
    expect(base.byDay["2026-09-10"]).toHaveLength(1);
  });
});

describe("新しいレコードを作る移動", () => {
  const base = payload({ "2026-09-03": [CASE_ROW] });

  it("★ 空き枠が無くても移動先へ出る（作られたIDを使う）", () => {
    const out = applyCalendarCaseMove(base, {
      ...MOVE,
      slotRecordId: null,
      movedRecordId: "con-new",
    });

    const target = out.byDay["2026-09-10"] ?? [];
    expect(target).toHaveLength(1);
    expect(target[0]?.recordId).toBe("con-new");
    expect(target[0]?.line1).toBe("山田 太郎");
    // 枠が無いので施工会社は元のまま
    expect(target[0]?.contractorKey).toBe("c-1");
  });

  it("★ IDが分からなくても表示は出す（再取得で正になる）", () => {
    const out = applyCalendarCaseMove(base, {
      ...MOVE,
      slotRecordId: null,
      movedRecordId: null,
    });

    expect(out.byDay["2026-09-10"]?.[0]?.recordId).toBeNull();
    expect(out.byDay["2026-09-10"]?.[0]?.line1).toBe("山田 太郎");
  });
});

describe("触らない場合", () => {
  const base = payload({
    "2026-09-03": [CASE_ROW],
    "2026-09-10": [SLOT_ROW],
  });

  it("★ 押した日にその案件が無ければ何もしない（別の月を見ている等）", () => {
    const out = applyCalendarCaseMove(base, { ...MOVE, caseRecordId: "con-x" });

    expect(out).toBe(base);
  });

  it("同じ日への移動は何もしない", () => {
    const out = applyCalendarCaseMove(base, {
      ...MOVE,
      targetDayKey: "2026-09-03",
    });

    expect(out).toBe(base);
  });

  it("日付が空なら何もしない", () => {
    expect(applyCalendarCaseMove(base, { ...MOVE, targetDayKey: "" })).toBe(
      base,
    );
    expect(applyCalendarCaseMove(base, { ...MOVE, caseRecordId: "" })).toBe(
      base,
    );
  });
});
