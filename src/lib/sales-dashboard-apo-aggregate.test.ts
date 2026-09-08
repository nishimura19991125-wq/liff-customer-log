import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  aggregateApoRecords,
  pickApoMonth,
  sumApoMonths,
} from "@/lib/sales-dashboard-apo-aggregate";
import type { ApoDashboardFieldMap } from "@/lib/sales-dashboard-fields";

const FIELD_MAP: ApoDashboardFieldMap = {
  salesperson: "field-1",
  apoType: "field-2",
  date: "field-3",
  negotiationStatus: "field-4",
};

const FILTER_VALUES = ["ダイレクト", "お客様紹介", "(DC)工務店OBリスト"];

/** 画面に出ない名前を使う。ログへ漏れていないかの確認に使う */
const STAFF_NAME = "旭日昇太郎";

function rec(fields: {
  staff?: string;
  apoType?: string;
  date?: string;
  status?: string;
}): { record: Record<string, unknown> } {
  return {
    record: {
      "field-1": fields.staff ?? STAFF_NAME,
      "field-2": fields.apoType ?? "ダイレクト",
      "field-3": fields.date ?? "2026年9月8日",
      "field-4": fields.status ?? "新規",
    },
  };
}

/** ログ1行分（メッセージ＋JSON）をつないだ文字列 */
function loggedText(spy: ReturnType<typeof vi.spyOn>): string {
  const call = spy.mock.calls.at(0) ?? [];
  return call.map((a) => String(a)).join(" ");
}

function loggedJson(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
  const call = spy.mock.calls.at(0) ?? [];
  return JSON.parse(String(call[1])) as Record<string, unknown>;
}

let infoSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("★ 月別に積む", () => {
  it("担当者ごと・年月ごとに件数を持つ", () => {
    const m = aggregateApoRecords(
      [
        rec({ date: "2026年9月8日" }),
        rec({ date: "2026年9月20日" }),
        rec({ date: "2026年10月1日" }),
      ],
      FIELD_MAP,
      FILTER_VALUES,
    );

    expect(m.get(STAFF_NAME)?.get("2026-09")?.apoCount).toBe(2);
    expect(m.get(STAFF_NAME)?.get("2026-10")?.apoCount).toBe(1);
  });

  it("対象月で捨てない（過去の月も残る）", () => {
    const m = aggregateApoRecords(
      [rec({ date: "2025年4月3日" }), rec({ date: "2026年9月8日" })],
      FIELD_MAP,
      FILTER_VALUES,
    );

    expect([...(m.get(STAFF_NAME)?.keys() ?? [])].sort()).toEqual([
      "2025-04",
      "2026-09",
    ]);
  });

  it("担当者が違えば別に積む", () => {
    const m = aggregateApoRecords(
      [rec({}), rec({ staff: "別府太郎" })],
      FIELD_MAP,
      FILTER_VALUES,
    );

    expect(m.get(STAFF_NAME)?.get("2026-09")?.apoCount).toBe(1);
    expect(m.get("別府太郎")?.get("2026-09")?.apoCount).toBe(1);
  });
});

describe("★ 月を取り出す", () => {
  const m = aggregateApoRecords(
    [
      rec({ date: "2026年9月8日" }),
      rec({ date: "2026年9月20日" }),
      rec({ date: "2026年10月1日" }),
      rec({ staff: "別府太郎", date: "2026年10月2日" }),
    ],
    FIELD_MAP,
    FILTER_VALUES,
  );

  it("単月を取り出す", () => {
    expect(pickApoMonth(m, "2026-09")).toEqual([
      { name: STAFF_NAME, apoCount: 2 },
    ]);
  });

  it("その月に件数が無い担当者は含めない", () => {
    const names = pickApoMonth(m, "2026-09").map((x) => x.name);
    expect(names).not.toContain("別府太郎");
  });

  it("該当の無い月は空", () => {
    expect(pickApoMonth(m, "2026-03")).toEqual([]);
  });

  it("複数月を足す（年度の累計）", () => {
    const summed = sumApoMonths(m, ["2026-09", "2026-10"]);
    expect(summed).toContainEqual({ name: STAFF_NAME, apoCount: 3 });
    expect(summed).toContainEqual({ name: "別府太郎", apoCount: 1 });
  });

  it("足して0になる担当者は含めない", () => {
    expect(sumApoMonths(m, ["2026-03", "2026-04"])).toEqual([]);
  });
});

describe("★ 除外件数のログ", () => {
  it("ループ後に1回だけ出す", () => {
    aggregateApoRecords([rec({}), rec({}), rec({})], FIELD_MAP, FILTER_VALUES);

    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(loggedText(infoSpy)).toContain("[sales-dashboard] アポ件数の集計内訳");
  });

  it("レコードが0件でも出す（取得できていないのか全件落ちたのかを分けるため）", () => {
    aggregateApoRecords([], FIELD_MAP, FILTER_VALUES);

    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(loggedJson(infoSpy)).toMatchObject({ total: 0, counted: 0 });
  });

  it("段ごとの件数を出す", () => {
    const records = [
      rec({}), // 集計対象
      rec({}), // 集計対象
      rec({ staff: "" }), // 担当者なし
      rec({ staff: "トラーチ倶楽部" }), // 除外担当者
      rec({ staff: "-" }), // 記号のみ＝除外担当者
      rec({ apoType: "" }), // 種別なし
      rec({ apoType: "ソーラーパートナーズ" }), // 種別が対象外
      rec({ apoType: "ダイレクト（卸案件）" }), // 除外ラベル
      rec({ date: "未定" }), // 日付が読めない
      rec({ status: "アポキャン" }), // キャンセル
    ];

    aggregateApoRecords(records, FIELD_MAP, FILTER_VALUES);

    expect(loggedJson(infoSpy)).toMatchObject({
      total: 10,
      noName: 1,
      excludedName: 2,
      typeEmpty: 1,
      typeMismatch: 1,
      excludedLabel: 1,
      dateUnparsed: 1,
      cancelled: 1,
      counted: 2,
    });
  });

  it("対象期間の外という区分は無くなった（全月を積むため）", () => {
    aggregateApoRecords(
      [rec({ date: "2025年4月3日" }), rec({ date: "2026年9月8日" })],
      FIELD_MAP,
      FILTER_VALUES,
    );

    const json = loggedJson(infoSpy);
    expect(json).not.toHaveProperty("outOfPeriod");
    expect(json.counted).toBe(2);
  });

  it("内訳の合計が total と一致する", () => {
    const records = [
      rec({}),
      rec({ staff: "" }),
      rec({ apoType: "対象外" }),
      rec({ date: "未定" }),
      rec({ status: "アポキャン" }),
    ];

    aggregateApoRecords(records, FIELD_MAP, FILTER_VALUES);

    const json = loggedJson(infoSpy) as Record<string, number>;
    const sum =
      json.noName +
      json.excludedName +
      json.typeEmpty +
      json.typeMismatch +
      json.excludedLabel +
      json.dateUnparsed +
      json.cancelled +
      json.counted;
    expect(sum).toBe(json.total);
  });

  it("月ごとの内訳を出す（どの月が0件かを見るため）", () => {
    aggregateApoRecords(
      [
        rec({ date: "2026年9月8日" }),
        rec({ date: "2026年9月20日" }),
        rec({ date: "2026年10月1日" }),
      ],
      FIELD_MAP,
      FILTER_VALUES,
    );

    const json = loggedJson(infoSpy);
    expect(json.months).toBe(2);
    expect(json.countedByYm).toEqual({ "2026-10": 1, "2026-09": 2 });
  });

  it("月別の内訳は新しい順に24ヶ月まで", () => {
    const records = [];
    for (let i = 0; i < 30; i += 1) {
      const year = 2024 + Math.floor(i / 12);
      const month1 = (i % 12) + 1;
      records.push(rec({ date: `${year}年${month1}月5日` }));
    }

    aggregateApoRecords(records, FIELD_MAP, FILTER_VALUES);

    const json = loggedJson(infoSpy);
    expect(json.months).toBe(30);
    const keys = Object.keys(json.countedByYm as Record<string, number>);
    expect(keys).toHaveLength(24);
    // 新しい順に並ぶ
    expect(keys[0]).toBe([...keys].sort().reverse()[0]);
  });
});

describe("★ ログに氏名・顧客名を出さない", () => {
  it("担当者名がログに出ない", () => {
    aggregateApoRecords(
      [rec({}), rec({ staff: "トラーチ倶楽部" }), rec({ staff: "" })],
      FIELD_MAP,
      FILTER_VALUES,
    );

    const text = loggedText(infoSpy);
    expect(text).not.toContain(STAFF_NAME);
    expect(text).not.toContain("トラーチ倶楽部");
  });

  it("レコードの他の列（顧客名など）がログに出ない", () => {
    const withCustomer = rec({});
    withCustomer.record["field-9"] = "契約 花子";

    aggregateApoRecords([withCustomer], FIELD_MAP, FILTER_VALUES);

    expect(loggedText(infoSpy)).not.toContain("契約 花子");
  });

  it("出す値は件数と月の内訳と日付の生値だけ", () => {
    aggregateApoRecords([rec({})], FIELD_MAP, FILTER_VALUES);

    expect(Object.keys(loggedJson(infoSpy)).sort()).toEqual(
      [
        "cancelled",
        "counted",
        "countedByYm",
        "dateUnparsed",
        "excludedLabel",
        "excludedName",
        "months",
        "noName",
        "total",
        "typeEmpty",
        "typeMismatch",
      ].sort(),
    );
  });
});

describe("★ 読めなかった日付の生値", () => {
  it("先頭2件までを残す", () => {
    aggregateApoRecords(
      [
        rec({ date: "未定その1" }),
        rec({ date: "未定その2" }),
        rec({ date: "未定その3" }),
      ],
      FIELD_MAP,
      FILTER_VALUES,
    );

    const json = loggedJson(infoSpy);
    expect(json.dateUnparsed).toBe(3);
    expect(json.dateSamples).toEqual(["未定その1", "未定その2"]);
  });

  it("読めない日付が無ければ項目ごと出さない", () => {
    aggregateApoRecords([rec({})], FIELD_MAP, FILTER_VALUES);

    expect(loggedJson(infoSpy)).not.toHaveProperty("dateSamples");
  });

  it("長い生値は頭だけにする", () => {
    aggregateApoRecords(
      [rec({ date: "あ".repeat(100) })],
      FIELD_MAP,
      FILTER_VALUES,
    );

    const samples = loggedJson(infoSpy).dateSamples as string[];
    expect(samples[0]).toHaveLength(40);
  });
});

describe("★ 集計の条件は変えていない", () => {
  const countOf = (records: Array<{ record: Record<string, unknown> }>) =>
    pickApoMonth(
      aggregateApoRecords(records, FIELD_MAP, FILTER_VALUES),
      "2026-09",
    ).find((x) => x.name === STAFF_NAME)?.apoCount ?? 0;

  it("「2026年9月8日」形式のレコードが集計に入る", () => {
    expect(
      countOf([rec({ date: "2026年9月8日" }), rec({ date: "2026年9月20日" })]),
    ).toBe(2);
  });

  it("YYYY-MM-DD 形式も従来どおり集計に入る", () => {
    expect(countOf([rec({ date: "2026-09-08" })])).toBe(1);
  });

  it("アポキャンは従来どおり除外する", () => {
    expect(countOf([rec({}), rec({ status: "アポキャン（顧客都合）" })])).toBe(1);
  });

  it("見積ステータス列が無ければアポキャン除外は掛からない", () => {
    const m = aggregateApoRecords(
      [rec({}), rec({ status: "アポキャン" })],
      { ...FIELD_MAP, negotiationStatus: null },
      FILTER_VALUES,
    );
    expect(pickApoMonth(m, "2026-09")[0]?.apoCount).toBe(2);
  });

  it("フィルタ値が空なら種別で絞らない", () => {
    const m = aggregateApoRecords(
      [rec({ apoType: "ソーラーパートナーズ" })],
      FIELD_MAP,
      [],
    );
    expect(pickApoMonth(m, "2026-09")[0]?.apoCount).toBe(1);
  });
});
