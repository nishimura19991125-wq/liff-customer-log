import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * タスクS-2: 指定日・指定施工会社の空き枠を返す API。
 *
 * レコードは一切変更しない。ここで見るのは「返すか返さないか」だけ。
 */

const h = vi.hoisted(() => ({
  /** @pocket 一覧を実際に読みに行った回数 */
  listCalls: 0,
  rows: [] as Array<{ recordId: string; record: Record<string, unknown> }>,
}));

const APP_FIELDS = [
  { uniqueId: "field-1", caption: "T番号" },
  { uniqueId: "field-2", caption: "お客様名" },
  { uniqueId: "field-3", caption: "施工予定日" },
  { uniqueId: "field-4", caption: "施工会社" },
];

vi.mock("@/lib/request-auth", () => ({
  resolveCallerLineAuth: async () => ({ ok: true, lineUserId: "U-test" }),
  lineAuthUnauthorizedResponse: () => new Response(null, { status: 401 }),
}));

vi.mock("@/lib/atpocket", () => ({
  apiKeyForCalendarPocket: () => "k",
  fetchAppFields: async () => APP_FIELDS,
}));

vi.mock("@/lib/calendar-construction-records-cache", () => ({
  fetchCalendarConstructionRecordsCached: async () => {
    h.listCalls++;
    return h.rows;
  },
}));

const { GET } = await import("@/app/api/calendar/empty-slots-for-day/route");

function emptySlotRow(
  recordId: string,
  dayKey: string,
  contractorName: string,
) {
  return {
    recordId,
    record: {
      "field-2": "",
      "field-3": dayKey,
      "field-4": contractorName,
    },
  };
}

async function get(dayKey: string, contractor: string) {
  const params = new URLSearchParams({ dayKey, contractor });
  const res = await GET(
    new Request(`https://example.test/empty-slots-for-day?${params}`),
  );
  return {
    status: res.status,
    body: (await res.json()) as {
      slot: { recordId: string } | null;
      matchCount: number;
      error?: string;
    },
  };
}

beforeEach(() => {
  process.env.CALENDAR_APP_ID = "77";
  h.listCalls = 0;
  h.rows = [
    emptySlotRow("101", "2026-09-05", "ピュアライフ"),
    emptySlotRow("102", "2026-09-05", "別会社"),
    // 案件（お客様名あり）は空き枠ではない
    {
      recordId: "103",
      record: {
        "field-2": "山田太郎",
        "field-3": "2026-09-05",
        "field-4": "ピュアライフ",
      },
    },
  ];
});

describe("タスクS-2: 空き枠の照合 API", () => {
  it("★ 同じ日・同じ施工店の空き枠を返す", async () => {
    const { status, body } = await get("2026-09-05", "ピュアライフ");

    expect(status).toBe(200);
    expect(body.slot?.recordId).toBe("101");
    expect(body.matchCount).toBe(1);
  });

  it("★ 施工店が違えば返さない", async () => {
    const { status, body } = await get("2026-09-05", "ほかの施工店");

    expect(status).toBe(200);
    expect(body.slot).toBeNull();
    expect(body.matchCount).toBe(0);
  });

  it("★ 空き枠が無い日は返さない", async () => {
    const { body } = await get("2026-09-30", "ピュアライフ");

    expect(body.slot).toBeNull();
    expect(body.matchCount).toBe(0);
  });

  it("★ 複数あるときはレコードID昇順の先頭を1つだけ返す", async () => {
    h.rows = [
      emptySlotRow("310", "2026-09-05", "ピュアライフ"),
      emptySlotRow("9", "2026-09-05", "ピュアライフ"),
      emptySlotRow("42", "2026-09-05", "ピュアライフ"),
    ];

    const { body } = await get("2026-09-05", "ピュアライフ");

    expect(body.slot?.recordId).toBe("9");
    expect(body.matchCount).toBe(3);
  });

  it("★ 防御: 施工会社が空なら @pocket を読まずに空を返す", async () => {
    const { status, body } = await get("2026-09-05", "");

    expect(status).toBe(200);
    expect(body.slot).toBeNull();
    expect(body.matchCount).toBe(0);
    // 削除は不可逆なので、照合の入口で止める
    expect(h.listCalls).toBe(0);
  });

  it("日付が無ければ 400", async () => {
    const { status, body } = await get("", "ピュアライフ");

    expect(status).toBe(400);
    expect(body.slot).toBeNull();
    expect(h.listCalls).toBe(0);
  });
});
