import { describe, expect, it } from "vitest";

import {
  buildCalendarEmptySlotCandidates,
  normalizeContractorKey,
  pickEmptySlotForDay,
  type CalendarEmptySlotCandidate,
} from "@/lib/calendar-empty-slot-match";

/**
 * タスクS-2: 同じ日・同じ施工会社の空き枠を探す。
 *
 * 空き枠の削除は不可逆なので、条件に少しでも当てはまらないものは
 * 返さない側に倒す。
 */

const APP_FIELDS = [
  { uniqueId: "field-1", caption: "T番号" },
  { uniqueId: "field-2", caption: "お客様名" },
  { uniqueId: "field-3", caption: "施工予定日" },
  { uniqueId: "field-4", caption: "施工会社" },
];

function slot(
  recordId: string,
  dayKey: string,
  contractorName: string,
): CalendarEmptySlotCandidate {
  return { recordId, dayKey, contractorName };
}

describe("★ 施工会社の比較（表記ゆれ）", () => {
  it("全角・空白・大小文字のゆれを同じものとして扱う", () => {
    expect(normalizeContractorKey("ピュアライフ")).toBe(
      normalizeContractorKey(" ピュアライフ "),
    );
    expect(normalizeContractorKey("ＡＢＣ工務店")).toBe(
      normalizeContractorKey("ABC工務店"),
    );
    expect(normalizeContractorKey("Pure Life")).toBe(
      normalizeContractorKey("purelife"),
    );
    expect(normalizeContractorKey("　ピュア　ライフ　")).toBe(
      normalizeContractorKey("ピュアライフ"),
    );
  });

  it("別の会社は別のキーになる", () => {
    expect(normalizeContractorKey("ピュアライフ")).not.toBe(
      normalizeContractorKey("ピュアライト"),
    );
  });
});

describe("★ 空き枠の照合", () => {
  const candidates = [
    slot("101", "2026-09-05", "ピュアライフ"),
    slot("102", "2026-09-05", "別会社"),
    slot("103", "2026-09-06", "ピュアライフ"),
  ];

  it("① 同じ日・同じ施工店の空き枠が見つかる", () => {
    const r = pickEmptySlotForDay(candidates, {
      dayKey: "2026-09-05",
      contractor: "ピュアライフ",
    });
    expect(r.slot?.recordId).toBe("101");
    expect(r.matchCount).toBe(1);
  });

  it("② 施工店が違う空き枠は対象外", () => {
    const r = pickEmptySlotForDay(candidates, {
      dayKey: "2026-09-05",
      contractor: "ほかの施工店",
    });
    expect(r.slot).toBeNull();
    expect(r.matchCount).toBe(0);
  });

  it("② 表記ゆれだけの違いは同じ施工店として扱う", () => {
    const r = pickEmptySlotForDay(
      [slot("201", "2026-09-05", "　ピュア ライフ ")],
      { dayKey: "2026-09-05", contractor: "ピュアライフ" },
    );
    expect(r.slot?.recordId).toBe("201");
  });

  it("③ 日付が違えば対象外", () => {
    const r = pickEmptySlotForDay(candidates, {
      dayKey: "2026-09-07",
      contractor: "ピュアライフ",
    });
    expect(r.slot).toBeNull();
    expect(r.matchCount).toBe(0);
  });

  it("③ 空き枠が無いときは null", () => {
    expect(
      pickEmptySlotForDay([], {
        dayKey: "2026-09-05",
        contractor: "ピュアライフ",
      }),
    ).toEqual({ slot: null, matchCount: 0 });
  });

  it("④ 複数あるときはレコードID昇順の先頭が選ばれる", () => {
    const many = [
      slot("310", "2026-09-05", "ピュアライフ"),
      slot("9", "2026-09-05", "ピュアライフ"),
      slot("42", "2026-09-05", "ピュアライフ"),
    ];
    const r = pickEmptySlotForDay(many, {
      dayKey: "2026-09-05",
      contractor: "ピュアライフ",
    });
    // 文字列比較なら "310" が先頭になる。数値として比べる
    expect(r.slot?.recordId).toBe("9");
    expect(r.matchCount).toBe(3);
  });

  it("④ 入力の並び順が変わっても同じ枠を選ぶ（安定している）", () => {
    const many = [
      slot("310", "2026-09-05", "ピュアライフ"),
      slot("9", "2026-09-05", "ピュアライフ"),
      slot("42", "2026-09-05", "ピュアライフ"),
    ];
    const first = pickEmptySlotForDay(many, {
      dayKey: "2026-09-05",
      contractor: "ピュアライフ",
    });
    const reversed = pickEmptySlotForDay([...many].reverse(), {
      dayKey: "2026-09-05",
      contractor: "ピュアライフ",
    });
    expect(reversed.slot?.recordId).toBe(first.slot?.recordId);

    // 何度呼んでも同じ
    for (let i = 0; i < 5; i++) {
      expect(
        pickEmptySlotForDay(many, {
          dayKey: "2026-09-05",
          contractor: "ピュアライフ",
        }).slot?.recordId,
      ).toBe("9");
    }
  });

  it("入力を書き換えない（sort が呼び出し側の配列を並べ替えない）", () => {
    const many = [
      slot("310", "2026-09-05", "ピュアライフ"),
      slot("9", "2026-09-05", "ピュアライフ"),
    ];
    pickEmptySlotForDay(many, {
      dayKey: "2026-09-05",
      contractor: "ピュアライフ",
    });
    expect(many.map((c) => c.recordId)).toEqual(["310", "9"]);
  });
});

describe("★ 防御: 施工会社が空なら枠を返さない", () => {
  const candidates = [
    slot("101", "2026-09-05", "ピュアライフ"),
    // 施工会社が入っていない空き枠
    slot("102", "2026-09-05", ""),
  ];

  it("施工会社が空文字なら、日付が合っていても null", () => {
    expect(
      pickEmptySlotForDay(candidates, {
        dayKey: "2026-09-05",
        contractor: "",
      }),
    ).toEqual({ slot: null, matchCount: 0 });
  });

  it("施工会社が空白だけでも null", () => {
    expect(
      pickEmptySlotForDay(candidates, {
        dayKey: "2026-09-05",
        contractor: "　 ",
      }),
    ).toEqual({ slot: null, matchCount: 0 });
  });

  it("日付が空なら null", () => {
    expect(
      pickEmptySlotForDay(candidates, {
        dayKey: "",
        contractor: "ピュアライフ",
      }),
    ).toEqual({ slot: null, matchCount: 0 });
  });

  it("施工会社が空の空き枠は、どんな入力でも当たらない", () => {
    // 「空 vs 空」で一致してしまうと、意図せず枠を消すことになる
    expect(
      pickEmptySlotForDay([slot("102", "2026-09-05", "")], {
        dayKey: "2026-09-05",
        contractor: "ピュアライフ",
      }).slot,
    ).toBeNull();
  });
});

describe("@pocket レコードからの抽出", () => {
  /** @pocket の recordId は数値で返る */
  function rec(
    recordId: number,
    record: Record<string, unknown>,
  ): { recordId: number; record: Record<string, unknown> } {
    return { recordId, record };
  }

  it("お客様名が空で施工予定日がある行だけを空き枠として拾う", () => {
    const rows = [
      // 空き枠
      rec(1, { "field-2": "", "field-3": "2026-09-05", "field-4": "ピュアライフ" }),
      // 案件（お客様名あり）は空き枠ではない
      rec(2, {
        "field-2": "山田太郎",
        "field-3": "2026-09-05",
        "field-4": "ピュアライフ",
      }),
      // 日付なしは対象外
      rec(3, { "field-2": "", "field-3": "", "field-4": "ピュアライフ" }),
    ];

    const candidates = buildCalendarEmptySlotCandidates(rows, APP_FIELDS);
    expect(candidates).toEqual([
      { recordId: "1", dayKey: "2026-09-05", contractorName: "ピュアライフ" },
    ]);
  });

  it("抽出した候補をそのまま照合に使える", () => {
    const rows = [
      rec(1, { "field-2": "", "field-3": "2026-09-05", "field-4": "ピュアライフ" }),
      rec(2, { "field-2": "-", "field-3": "2026-09-05", "field-4": "別会社" }),
    ];
    const candidates = buildCalendarEmptySlotCandidates(rows, APP_FIELDS);
    const r = pickEmptySlotForDay(candidates, {
      dayKey: "2026-09-05",
      contractor: "ピュアライフ",
    });
    expect(r.slot?.recordId).toBe("1");
    expect(r.matchCount).toBe(1);
  });

  it("施工会社列が無いアプリでは、空き枠を返さない（照合できないため）", () => {
    const fieldsWithoutContractor = APP_FIELDS.filter(
      (f) => f.caption !== "施工会社",
    );
    const rows = [rec(1, { "field-2": "", "field-3": "2026-09-05" })];
    const candidates = buildCalendarEmptySlotCandidates(
      rows,
      fieldsWithoutContractor,
    );
    expect(candidates).toEqual([
      { recordId: "1", dayKey: "2026-09-05", contractorName: "" },
    ]);
    expect(
      pickEmptySlotForDay(candidates, {
        dayKey: "2026-09-05",
        contractor: "ピュアライフ",
      }).slot,
    ).toBeNull();
  });
});
