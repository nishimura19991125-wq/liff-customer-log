import { describe, expect, it } from "vitest";

import type { CalendarMonthApiItem } from "@/lib/calendar-api-types";
import {
  buildCalendarPayload,
  buildConstructionRecordsFromTodayQuery,
  buildConstructionRecordsMonthOverlapQuery,
  collectConstructionFieldsCsv,
  resolveConstructionFieldIds,
} from "@/lib/calendar-kojo";
import { buildContractRecordMap } from "@/lib/contract-records";
import { buildZankoCaseEntries } from "@/lib/zanko-cards";
import { buildZankoIndex } from "@/lib/zanko-index";

/**
 * 工事カレンダーの【残工】カード（残工 段階2）。
 *
 *   - 186 の残工日にカードが出る（施工予定日が過去の月でも）
 *   - 1行目「【残工】お客様名様」、市区郡があれば（）で後ろに付ける
 *   - 2行目は他のカードと同じ形（工事対応・『メーカー』kW / kWh・施工）
 *   - 中身は契約情報入力から。工事登録アプリの値は使わない
 *   - 該当が無ければ空欄
 *   - 古い判定（工事登録の 入力ステータス＝残工・残工日、工事報告の「残工」で
 *     【延期】）は外れている
 */

const F = {
  name: "field-1",
  contractor: "field-2",
  start: "field-3",
  housing: "field-4",
  t: "field-5",
  maker: "field-6",
  panel: "field-7",
  battery: "field-8",
  handler: "field-9",
  inputStatus: "field-10",
  zankoDay: "field-11",
};

const CONSTRUCTION_FIELDS = [
  { uniqueId: F.name, caption: "お客様名" },
  { uniqueId: F.contractor, caption: "施工会社" },
  { uniqueId: F.start, caption: "施工予定日" },
  { uniqueId: F.housing, caption: "住宅ステータス" },
  { uniqueId: F.t, caption: "T番号" },
  { uniqueId: F.maker, caption: "メーカー" },
  { uniqueId: F.panel, caption: "パネル容量" },
  { uniqueId: F.battery, caption: "蓄電池容量" },
  { uniqueId: F.handler, caption: "工事対応者" },
  { uniqueId: F.inputStatus, caption: "入力ステータス" },
  { uniqueId: F.zankoDay, caption: "残工日" },
];

const REPORT_FIELDS = [
  { uniqueId: "r-1", caption: "T番号" },
  { uniqueId: "r-2", caption: "報告内容" },
];

const ZFIDS = { tNumberFieldId: "z-3", dateFieldId: "z-7" };

type Contract = {
  recordId: string;
  tNumber: string;
  customerName: string;
  constructionHandler?: string;
  contractorName?: string;
  housingStatus?: string;
  isCancelled?: boolean;
  contract?: {
    manufacturer: string;
    panelCapacity: string;
    batteryCapacity1: string;
    batteryCapacity2: string;
    city: string;
  };
};

const YAMADA: Contract = {
  recordId: "500",
  tNumber: "T0001",
  customerName: "山田 太郎",
  constructionHandler: "工事 太郎",
  contractorName: "株式会社アルファ",
  housingStatus: "既築案件",
  contract: {
    manufacturer: "長州産業",
    panelCapacity: "5.6",
    batteryCapacity1: "9.8",
    batteryCapacity2: "",
    city: "福岡市",
  },
};

function payload(opts: {
  zankoRows?: Array<[string, string]>;
  contracts?: Contract[];
  construction?: Array<Record<string, unknown>>;
  reports?: Array<Record<string, unknown>>;
  year?: number;
  month?: number;
}) {
  const year = opts.year ?? 2026;
  const month = opts.month ?? 11;
  const index = buildZankoIndex(
    (opts.zankoRows ?? []).map(([t, d], i) => ({
      recordId: i + 1,
      record: { "z-3": t, "z-7": d },
    })),
    ZFIDS,
  );
  const byT = buildContractRecordMap(opts.contracts ?? []);
  return buildCalendarPayload(
    year,
    month,
    (opts.construction ?? []).map((record, i) => ({ recordId: 100 + i, record })),
    (opts.reports ?? []).map((record, i) => ({ recordId: 900 + i, record })),
    CONSTRUCTION_FIELDS,
    REPORT_FIELDS,
    { zankoEntries: buildZankoCaseEntries(index, byT, year, month) },
  );
}

function zankoItems(day: CalendarMonthApiItem[] | undefined) {
  return (day ?? []).filter((i) => i.zanko === true);
}

describe("【残工】カードが出る", () => {
  it("★ 186 の残工日にカードが出る", () => {
    const p = payload({ zankoRows: [["T0001", "2026-11-05"]], contracts: [YAMADA] });

    expect(zankoItems(p.byDay["2026-11-05"])).toHaveLength(1);
  });

  it("★ 1行目は【残工】お客様名様（市区郡）", () => {
    const p = payload({ zankoRows: [["T0001", "2026-11-05"]], contracts: [YAMADA] });

    expect(zankoItems(p.byDay["2026-11-05"])[0]?.line1).toBe(
      "【残工】山田 太郎様（福岡市）",
    );
  });

  it("★ 市区郡が無ければ（）を付けない", () => {
    const p = payload({
      zankoRows: [["T0001", "2026-11-05"]],
      contracts: [{ ...YAMADA, contract: { ...YAMADA.contract!, city: "" } }],
    });

    expect(zankoItems(p.byDay["2026-11-05"])[0]?.line1).toBe("【残工】山田 太郎様");
  });

  it("★ 2行目は他のカードと同じ形", () => {
    const p = payload({
      zankoRows: [["T0001", "2026-11-05"]],
      contracts: [YAMADA],
      // 同じ値を持つ普通の案件カード
      construction: [
        {
          [F.name]: "鈴木 一郎",
          [F.start]: "2026-11-05",
          [F.t]: "T0099",
          [F.contractor]: "株式会社アルファ",
          [F.handler]: "工事 太郎",
          [F.maker]: "長州産業",
          [F.panel]: "5.6",
          [F.battery]: "9.8",
          [F.housing]: "既築案件",
        },
      ],
    });
    const day = p.byDay["2026-11-05"] ?? [];
    const normal = day.find((i) => !i.zanko);
    const z = zankoItems(day)[0];

    expect(z?.line2).toBe(
      "工事対応: 工事 太郎｜『長州産業』 5.6kW / 9.8kWh｜施工: 株式会社アルファ",
    );
    expect(z?.line2).toBe(normal?.line2);
  });

  it("★ 蓄電池①②は「 / 」でつなぐ（スクリプトと同じ）", () => {
    const p = payload({
      zankoRows: [["T0001", "2026-11-05"]],
      contracts: [
        { ...YAMADA, contract: { ...YAMADA.contract!, batteryCapacity2: "6.5" } },
      ],
    });

    expect(zankoItems(p.byDay["2026-11-05"])[0]?.line2).toBe(
      "工事対応: 工事 太郎｜『長州産業』 5.6kW / 9.8kWh / 6.5kWh｜施工: 株式会社アルファ",
    );
  });

  it("★ 左の縁の色・業者フィルターは施工業者（契約情報入力の値）で決まる", () => {
    const p = payload({ zankoRows: [["T0001", "2026-11-05"]], contracts: [YAMADA] });
    const z = zankoItems(p.byDay["2026-11-05"])[0];

    expect(z?.contractorKey).toBe("株式会社アルファ");
    expect(z?.category).toBe("list");
    expect(z?.housingShort).toBe("既築");
    expect(z?.segmentShort).toBe("残工");
  });

  it("★ 工事登録アプリのレコードに紐づけない（ID・@pocket の URL・住所を持たない）", () => {
    const p = payload({ zankoRows: [["T0001", "2026-11-05"]], contracts: [YAMADA] });
    const z = zankoItems(p.byDay["2026-11-05"])[0];

    expect(z?.recordId).toBeNull();
    expect(z?.accessEditUrl).toBe("");
    expect(z?.pinpointAddress).toBe("");
    expect(z?.normalAddress).toBe("");
    // お客様情報を開く導線は T番号 で動く
    expect(z?.tNumber).toBe("T0001");
    expect(z?.showKankoCheck).toBe(false);
    expect(z?.postponedBadge).toBe(false);
  });
});

describe("中身は契約情報入力から", () => {
  it("★ 同じ T番号 の工事レコードがあっても、その値は使わない", () => {
    const p = payload({
      zankoRows: [["T0001", "2026-11-05"]],
      contracts: [YAMADA],
      construction: [
        {
          [F.name]: "工事側の名前",
          [F.start]: "2026-11-20",
          [F.t]: "T0001",
          [F.contractor]: "工事側の業者",
          [F.handler]: "工事側の担当",
          [F.maker]: "工事側メーカー",
        },
      ],
    });
    const z = zankoItems(p.byDay["2026-11-05"])[0];

    expect(z?.line1).toBe("【残工】山田 太郎様（福岡市）");
    expect(z?.line2).not.toContain("工事側");
    expect(z?.contractorKey).toBe("株式会社アルファ");
  });

  it("★ T番号 で該当が無ければ空欄（工事登録アプリの値に戻さない）", () => {
    const p = payload({
      zankoRows: [["T0001", "2026-11-05"]],
      contracts: [],
      construction: [
        {
          [F.name]: "工事側の名前",
          [F.start]: "2026-11-20",
          [F.t]: "T0001",
          [F.contractor]: "工事側の業者",
          [F.handler]: "工事側の担当",
        },
      ],
    });
    const z = zankoItems(p.byDay["2026-11-05"])[0];

    expect(z?.line1).toBe("【残工】");
    expect(z?.line2).toBe("");
    expect(z?.contractorKey).toBe("__UNSET__");
    expect(z?.housingShort).toBe("");
    expect(z?.constructionHandlerName).toBeUndefined();
  });
});

describe("月をまたぐ案件", () => {
  it("★ 施工予定日が過去の月でも、残工日が表示月なら出る", () => {
    const p = payload({
      zankoRows: [["T0001", "2026-11-05"]],
      contracts: [YAMADA],
      // 施工予定日は9月。11月の月データの材料には普通は入らない
      construction: [],
    });

    expect(zankoItems(p.byDay["2026-11-05"])).toHaveLength(1);
  });

  it("★ 残工日が表示月の外なら出ない", () => {
    const p = payload({ zankoRows: [["T0001", "2026-12-05"]], contracts: [YAMADA] });

    expect(Object.values(p.byDay).flatMap(zankoItems)).toEqual([]);
  });
});

describe("186 が読めないとき", () => {
  it("★ 残工の材料が無ければカードは出ず、他のカードはそのまま出る", () => {
    const p = payload({
      zankoRows: [],
      contracts: [YAMADA],
      construction: [{ [F.name]: "鈴木 一郎", [F.start]: "2026-11-05", [F.t]: "T0099" }],
    });

    expect(Object.values(p.byDay).flatMap(zankoItems)).toEqual([]);
    expect(p.byDay["2026-11-05"]).toHaveLength(1);
  });
});

describe("古い判定は外れている", () => {
  it("★ 工事登録の 入力ステータス＝残工・残工日 では【残工】を出さない", () => {
    const p = payload({
      construction: [
        {
          [F.name]: "鈴木 一郎",
          [F.start]: "2026-11-02",
          [F.t]: "T0099",
          [F.inputStatus]: "残工",
          [F.zankoDay]: "2026-11-10",
        },
      ],
    });

    expect(p.byDay["2026-11-10"]).toBeUndefined();
    for (const item of Object.values(p.byDay).flat()) {
      expect(item.line1).not.toContain("【残工】");
    }
  });

  it("★ 工事報告の報告内容「残工」では【延期】を出さない（段階3で入れ直す）", () => {
    const p = payload({
      construction: [{ [F.name]: "鈴木 一郎", [F.start]: "2026-11-02", [F.t]: "T0099" }],
      reports: [{ "r-1": "T0099", "r-2": "残工" }],
    });
    const item = p.byDay["2026-11-02"]?.[0];

    expect(item?.line1).toBe("鈴木 一郎様");
    expect(item?.postponedBadge).toBe(false);
  });

  it("★ 工事報告の ✅（完工）の判定はそのまま", () => {
    const p = payload({
      construction: [{ [F.name]: "鈴木 一郎", [F.start]: "2026-11-02", [F.t]: "T0099" }],
      reports: [{ "r-1": "T0099", "r-2": "完工" }],
    });

    expect(p.byDay["2026-11-02"]?.[0]?.showKankoCheck).toBe(true);
  });

  it("★ 入力ステータス・残工日の列を取得しない", () => {
    const fids = resolveConstructionFieldIds(CONSTRUCTION_FIELDS);
    const csv = collectConstructionFieldsCsv(fids).split(",");

    expect(csv).not.toContain(F.inputStatus);
    expect(csv).not.toContain(F.zankoDay);
  });

  it("★ 月の絞り込み・本日以降の絞り込みに残工日を使わない", () => {
    const fids = resolveConstructionFieldIds(CONSTRUCTION_FIELDS);

    expect(buildConstructionRecordsMonthOverlapQuery(fids, 2026, 11)).not.toContain(
      F.zankoDay,
    );
    expect(buildConstructionRecordsFromTodayQuery(fids, "2026-11-01")).not.toContain(
      F.zankoDay,
    );
  });
});
