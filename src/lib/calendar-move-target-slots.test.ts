import { describe, expect, it } from "vitest";

import type { AtPocketFieldRow, AtPocketRecordRow } from "@/lib/atpocket";
import type { CalendarMonthApiItem } from "@/lib/calendar-api-types";
import { buildCalendarPayload } from "@/lib/calendar-kojo";
import {
  contractorNameFromKey,
  dayKeyInMonth,
  emptySlotsFromDayItems,
  monthKeyOf,
  resolveMoveTargetMonthState,
} from "@/lib/calendar-move-target-slots";

/**
 * 工事日変更 M-3: 移動先の空き枠を月次ペイロードから組み立てる。
 *
 * ここで固定するのは次の3つ。
 *   - byDay から空き枠だけを取り出し、施工会社が分かる
 *   - 施工会社に関係なく**その日の枠を全部**返す
 *     （pickEmptySlotForDay は一致必須で1件だけ。移動には使えない）
 *   - 案件に T番号 が載る（expectedTNumber の事前検証に要る）
 */

const NAME = "field-1";
const START = "field-2";
const T_NUMBER = "field-3";
const CONTRACTOR = "field-4";
const HOUSING = "field-5";

const FIELDS: AtPocketFieldRow[] = [
  { uniqueId: NAME, caption: "お客様名" },
  { uniqueId: START, caption: "施工予定日" },
  { uniqueId: T_NUMBER, caption: "T番号" },
  { uniqueId: CONTRACTOR, caption: "施工業者" },
  { uniqueId: HOUSING, caption: "住宅ステータス" },
];

function row(
  recordId: number,
  record: Record<string, unknown>,
): AtPocketRecordRow {
  return { recordId, record };
}

/** 12/1 に案件1件、12/5 に施工会社の違う空き枠2件 */
const RECORDS: AtPocketRecordRow[] = [
  row(5001, {
    [NAME]: "山田 太郎",
    [START]: "2026-12-01",
    [T_NUMBER]: "T00003420",
    [CONTRACTOR]: "株式会社アルファ",
    [HOUSING]: "既築案件",
  }),
  row(5002, {
    [NAME]: "",
    [START]: "2026-12-05",
    [CONTRACTOR]: "株式会社ベータ",
  }),
  row(5003, {
    [NAME]: "",
    [START]: "2026-12-05",
    [CONTRACTOR]: "株式会社アルファ",
  }),
  // 施工会社の入っていない枠
  row(5004, { [NAME]: "", [START]: "2026-12-05" }),
];

const payload = buildCalendarPayload(2026, 12, RECORDS, null, FIELDS, null);

describe("★ 案件に T番号 が載る", () => {
  it("★ expectedTNumber に使える", () => {
    const cases = (payload.byDay["2026-12-01"] ?? []).filter(
      (i) => i.category === "list",
    );

    expect(cases).toHaveLength(1);
    expect(cases[0]?.tNumber).toBe("T00003420");
    expect(cases[0]?.recordId).toBe("5001");
  });

  it("空き枠には T番号 が付かない", () => {
    const slots = (payload.byDay["2026-12-05"] ?? []).filter(
      (i) => i.category === "empty",
    );

    for (const slot of slots) {
      expect(slot.tNumber).toBeUndefined();
    }
  });
});

describe("★ 移動先の空き枠", () => {
  it("★ その日の空き枠を全部返す（施工会社で絞らない）", () => {
    const slots = emptySlotsFromDayItems(payload.byDay["2026-12-05"]);

    expect(slots.map((s) => s.recordId).sort()).toEqual([
      "5002",
      "5003",
      "5004",
    ]);
  });

  it("★ 施工会社が分かる（選ぶ材料になる）", () => {
    const slots = emptySlotsFromDayItems(payload.byDay["2026-12-05"]);
    const byId = Object.fromEntries(
      slots.map((s) => [s.recordId, s.contractorName]),
    );

    expect(byId["5002"]).toBe("株式会社ベータ");
    expect(byId["5003"]).toBe("株式会社アルファ");
    // 施工会社が入っていない枠は空文字（画面では「未設定」と出す）
    expect(byId["5004"]).toBe("");
  });

  it("★ 案件は候補に入らない", () => {
    const slots = emptySlotsFromDayItems(payload.byDay["2026-12-01"]);

    expect(slots).toEqual([]);
  });

  it("空き枠が無い日は空配列", () => {
    expect(emptySlotsFromDayItems(payload.byDay["2026-12-20"])).toEqual([]);
    expect(emptySlotsFromDayItems(undefined)).toEqual([]);
  });

  it("同じレコードが複数行で出ても1つに畳む", () => {
    const slots = emptySlotsFromDayItems([
      { category: "empty", recordId: "9", contractorKey: "A" },
      { category: "empty", recordId: "9", contractorKey: "A" },
    ] as never);

    expect(slots).toHaveLength(1);
  });

  it("recordId が無い行は無視する", () => {
    const slots = emptySlotsFromDayItems([
      { category: "empty", recordId: null, contractorKey: "A" },
    ] as never);

    expect(slots).toEqual([]);
  });
});

describe("施工会社キーの変換", () => {
  it("未設定キーは空文字にする", () => {
    expect(contractorNameFromKey("__UNSET__")).toBe("");
    expect(contractorNameFromKey("")).toBe("");
    expect(contractorNameFromKey(undefined)).toBe("");
    expect(contractorNameFromKey("株式会社アルファ")).toBe("株式会社アルファ");
  });
});

describe("★ 別の月かどうか", () => {
  it("★ 同じ月なら取りにいかない", () => {
    expect(dayKeyInMonth("2026-12-05", 2026, 12)).toBe(true);
  });

  it("★ 月をまたぐと false（呼び出し側が1回だけ取りにいく）", () => {
    expect(dayKeyInMonth("2027-01-05", 2026, 12)).toBe(false);
    expect(dayKeyInMonth("2026-11-30", 2026, 12)).toBe(false);
  });

  it("壊れた値は false", () => {
    expect(dayKeyInMonth("", 2026, 12)).toBe(false);
    expect(dayKeyInMonth("not-a-date", 2026, 12)).toBe(false);
  });
});

/**
 * 月をまたぐ移動ができなかった件の再発防止。
 *
 * 実装は「読み込み中」を state に持ち、それをエフェクトの依存にも入れて
 * いた。エフェクトが自分の書いた state で再実行され、走っている fetch を
 * 自分でキャンセルするため、別の月を選ぶと**永久に読み込み中**になった。
 * 症状は「空き枠の一覧が空・新規作成も出ない・実行ボタンが押せない・
 * どこにもエラーが出ない」。
 *
 * ここでは状態を**キー比較だけ**から導くことを固定する。
 */
describe("★ 移動先の月の状態", () => {
  const VIEW_BY_DAY = { "2026-12-05": [] } as Record<
    string,
    CalendarMonthApiItem[]
  >;
  const OTHER_BY_DAY = { "2027-05-11": [] } as Record<
    string,
    CalendarMonthApiItem[]
  >;

  const base = {
    viewYear: 2026,
    viewMonth: 12,
    viewByDay: VIEW_BY_DAY,
  };

  it("日付を選んでいなければ何もしない", () => {
    expect(
      resolveMoveTargetMonthState({
        ...base,
        targetDayKey: "",
        loadedMonth: null,
      }),
    ).toEqual({
      needsFetch: false,
      loading: false,
      error: "",
      byDay: undefined,
    });
  });

  it("★ 同じ月なら取りにいかず、月次ペイロードをそのまま使う", () => {
    const state = resolveMoveTargetMonthState({
      ...base,
      targetDayKey: "2026-12-20",
      loadedMonth: null,
    });

    expect(state.needsFetch).toBe(false);
    expect(state.loading).toBe(false);
    expect(state.byDay).toBe(VIEW_BY_DAY);
  });

  it("★ 別の月で未取得なら読み込み中", () => {
    const state = resolveMoveTargetMonthState({
      ...base,
      targetDayKey: "2027-05-11",
      loadedMonth: null,
    });

    expect(state).toEqual({
      needsFetch: true,
      loading: true,
      error: "",
      byDay: undefined,
    });
  });

  it("★ 別の月が取れたら読み込み中を抜け、その月で組み立てる", () => {
    const state = resolveMoveTargetMonthState({
      ...base,
      targetDayKey: "2027-05-11",
      loadedMonth: { key: "2027-05", byDay: OTHER_BY_DAY, error: "" },
    });

    expect(state.loading).toBe(false);
    expect(state.error).toBe("");
    expect(state.byDay).toBe(OTHER_BY_DAY);
  });

  it("★ 取れているのが別の月なら、まだ読み込み中（前の月の枠を出さない）", () => {
    const state = resolveMoveTargetMonthState({
      ...base,
      targetDayKey: "2027-05-11",
      loadedMonth: { key: "2027-06", byDay: OTHER_BY_DAY, error: "" },
    });

    expect(state.loading).toBe(true);
    expect(state.byDay).toBeUndefined();
  });

  it("★ 失敗したら読み込み中を抜け、理由を返す", () => {
    const state = resolveMoveTargetMonthState({
      ...base,
      targetDayKey: "2027-05-11",
      loadedMonth: { key: "2027-05", byDay: {}, error: "通信に失敗しました" },
    });

    expect(state.loading).toBe(false);
    expect(state.error).toBe("通信に失敗しました");
    // 枠の有無が分からないまま新規作成へ進ませない
    expect(state.byDay).toBeUndefined();
  });

  it("★ 失敗しても永久に読み込み中にならない", () => {
    // 症状の裏返し。loading と error が同時に立つことは無い
    const state = resolveMoveTargetMonthState({
      ...base,
      targetDayKey: "2027-05-11",
      loadedMonth: { key: "2027-05", byDay: {}, error: "boom" },
    });

    expect(state.loading && Boolean(state.error)).toBe(false);
  });

  it("★ 別月で空き枠が0件でも読み込みは終わる（新規作成を選べる）", () => {
    const state = resolveMoveTargetMonthState({
      ...base,
      targetDayKey: "2027-05-11",
      loadedMonth: { key: "2027-05", byDay: {}, error: "" },
    });

    expect(state.loading).toBe(false);
    expect(state.error).toBe("");
    // byDay はあるが、その日に枠が無いだけ＝新規作成の選択肢が出る状態
    expect(state.byDay).toEqual({});
    expect(emptySlotsFromDayItems(state.byDay?.["2027-05-11"])).toEqual([]);
  });

  it("表示中の月のデータがまだ無くても壊れない", () => {
    const state = resolveMoveTargetMonthState({
      ...base,
      viewByDay: undefined,
      targetDayKey: "2026-12-20",
      loadedMonth: null,
    });

    expect(state.loading).toBe(false);
    expect(state.byDay).toBeUndefined();
  });
});

describe("月キー", () => {
  it("YYYY-MM-DD から YYYY-MM を作る", () => {
    expect(monthKeyOf("2027-05-11")).toBe("2027-05");
  });

  it("読めない値は空文字", () => {
    expect(monthKeyOf("")).toBe("");
    expect(monthKeyOf("2027-05")).toBe("");
    expect(monthKeyOf("not-a-date")).toBe("");
  });
});
