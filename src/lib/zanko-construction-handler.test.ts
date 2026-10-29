import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CalendarApiPayload, CalendarMonthApiItem } from "@/lib/calendar-api-types";

/**
 * 【残工】カードからの工事対応者の変更（画面・検索・変更直後の表示）。
 * API の書き込み順などは update-zanko-construction-handler/route.test.ts。
 */

const h = vi.hoisted(() => ({
  listRows: [] as unknown[],
  listThrows: false,
  listCalls: [] as Array<{ query?: string }>,
}));

vi.mock("@/lib/atpocket", () => ({
  apiKeyForCalendarPocket1: () => "read-key",
  apiKeyForCalendarWrite: () => "write-key",
  fetchAppFields: async () => [],
  fetchRecordsList: async (_appId: string, params?: { query?: string }) => {
    h.listCalls.push({ query: params?.query });
    if (h.listThrows) throw new Error("429 Too Many Requests");
    return { records: h.listRows };
  },
}));

const { listConstructionRecordsByTNumber, findConstructionRecordByTNumber } =
  await import("@/lib/customer-info-construction-link");
const { applyConstructionHandlerNameByTNumberLocal } = await import(
  "@/lib/calendar-apply-patch"
);

beforeEach(() => {
  h.listRows = [];
  h.listThrows = false;
  h.listCalls = [];
});

const OPTS = {
  calAppId: "34",
  tNumberFieldId: "field-1",
  tNumber: "T0001",
  fieldsCsv: "field-1",
};

describe("工事登録アプリを T番号 で探す", () => {
  it("★ 一致したレコードをすべて返す（1回の呼び出し）", async () => {
    h.listRows = [
      { recordId: "11", record: { "field-1": "T0001" } },
      { recordId: "12", record: { "field-1": "T0001" } },
      { recordId: "13", record: { "field-1": "T0002" } },
    ];
    const r = await listConstructionRecordsByTNumber(OPTS);
    expect(r.kind).toBe("ok");
    expect(r.kind === "ok" ? r.matched.map((m) => m.recordId) : []).toEqual([
      "11",
      "12",
    ]);
    expect(h.listCalls).toHaveLength(1);
  });

  it("★ 無ければ空、探せなければ error", async () => {
    expect(await listConstructionRecordsByTNumber(OPTS)).toEqual({
      kind: "ok",
      matched: [],
    });
    h.listThrows = true;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await listConstructionRecordsByTNumber(OPTS)).kind).toBe("error");
  });

  it("★ 既存の1件探し（割り当て用）の振る舞いは変えない", async () => {
    h.listRows = [
      { recordId: "11", record: { "field-1": "T0001" } },
      { recordId: "12", record: { "field-1": "T0001" } },
    ];
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await findConstructionRecordByTNumber(OPTS);
    expect(r).toMatchObject({ kind: "error", reason: "lookup-ambiguous" });
  });
});

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
    contractorKey: "",
    recordId: null,
    accessEditUrl: "",
    pinpointAddress: "",
    normalAddress: "",
    ...over,
  };
}

describe("変更直後の表示（画面の名前を差し替える）", () => {
  const data = {
    byDay: {
      "2026-11-05": [
        item({
          zanko: true,
          tNumber: "T0001",
          constructionHandlerName: "前の担当者",
          line2: "工事対応: 前の担当者｜『メーカー』｜施工: A社",
        }),
        item({
          recordId: "777",
          tNumber: "T0001",
          constructionHandlerName: "前の担当者",
          line2: "工事対応: 前の担当者｜施工: A社",
        }),
        item({
          zanko: true,
          tNumber: "T0002",
          constructionHandlerName: "別の人",
          line2: "工事対応: 別の人",
        }),
      ],
      "2026-11-20": [
        item({ zanko: true, tNumber: "Ｔ０００１", line2: "施工: A社" }),
      ],
    },
  } as unknown as CalendarApiPayload;

  it("★ 同じ T番号 のカードに新しい名前が出る（2行目も）", () => {
    const next = applyConstructionHandlerNameByTNumberLocal(data, "T0001", "工事太郎");
    const [z, normal, other] = next.byDay["2026-11-05"]!;
    expect(z!.constructionHandlerName).toBe("工事太郎");
    expect(z!.line2).toBe("工事対応: 工事太郎｜『メーカー』｜施工: A社");
    expect(normal!.constructionHandlerName).toBe("工事太郎");
    expect(normal!.line2).toBe("工事対応: 工事太郎｜施工: A社");
    // 別の T番号 は触らない
    expect(other).toBe(data.byDay["2026-11-05"]![2]);
    // 未設定だったカードは先頭に足す（全角の T番号 も同じ案件）
    const late = next.byDay["2026-11-20"]![0]!;
    expect(late.constructionHandlerName).toBe("工事太郎");
    expect(late.line2).toBe("工事対応: 工事太郎｜施工: A社");
  });

  it("★ T番号・名前が空なら何もしない", () => {
    expect(applyConstructionHandlerNameByTNumberLocal(data, "", "工事太郎")).toBe(data);
    expect(applyConstructionHandlerNameByTNumberLocal(data, "T0001", " ")).toBe(data);
  });
});

describe("画面の配線", () => {
  const ROOT = process.cwd();
  const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
  const PAGE = read("src/components/liff-calendar-month-page.tsx");

  it("★ 残工カードにも「工事対応者の変更」を出す（出す条件は普通のカードと同じ）", () => {
    expect(PAGE).not.toContain("{item.zanko ? null : handlerFromStaff ? (");
    const at = PAGE.indexOf("<CaseConstructionHandlerEditor");
    const before = PAGE.slice(Math.max(0, at - 300), at);
    expect(before).toContain("{handlerFromStaff ? (");
    expect(before).not.toContain("item.zanko");
  });

  it("★ 残工カードは T番号 で残工用の API を呼ぶ", () => {
    expect(PAGE).toContain('"/api/calendar/update-zanko-construction-handler"');
    expect(PAGE).toContain("tNumber: zankoTNumber");
  });

  it("★ 変更後は同じ T番号 のカードの名前をその場で差し替える", () => {
    expect(PAGE).toContain("applyConstructionHandlerNameByTNumberLocal(");
  });

  it("★ 権限：API の入口は普通のカードと同じ確認をする", () => {
    const normal = read("src/app/api/calendar/update-construction-handler/route.ts");
    const zanko = read("src/app/api/calendar/update-zanko-construction-handler/route.ts");
    for (const gate of [
      "resolveCallerLineAuth(request)",
      "constructionHandlerStaffConfigReady()",
      "resolveConstructionHandlerNameForActiveStaff(",
      "calendarConstructionHandlerFieldIdFromEnv()",
    ]) {
      expect(normal).toContain(gate);
      expect(zanko).toContain(gate);
    }
  });

  it("★ 書き込みは既存の部品を使う", () => {
    const zanko = read("src/app/api/calendar/update-zanko-construction-handler/route.ts");
    expect(zanko).toContain("writeConstructionHandlerToCustomerInfo(");
    expect(zanko).toContain("updateRecord(");
    expect(zanko).toContain("listConstructionRecordsByTNumber(");
  });
});
