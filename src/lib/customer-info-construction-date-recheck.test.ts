import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 未定案件の割り当て前に、お客様情報の施工予定日を @pocket から読み直す。
 *
 * ここで固定するのは次のこと。
 *   - 一覧（customer-undated-cases.ts）と**同じ列・同じ判定**で見る
 *     （resolveCrmConstructionDateFieldId / isCrmConstructionDateUnset）
 *   - 一覧のキャッシュ（スナップショット）は使わず、単票 GET で読み直す
 *   - 単票 GET は1回だけ。列を絞らない（絞ると空の列が返らず「空」と
 *     読み違えるおそれがある）
 *   - 読めなかったときは "error"。「空」とは扱わない（呼び出し側が断る）
 */

const DATE_ID = "ci-date";
const OTHER_DATE_ID = "ci-date-2";

const CUSTOMER_FIELDS = [
  { uniqueId: "ci-name", caption: "お客様名" },
  { uniqueId: DATE_ID, caption: "施工予定日" },
  { uniqueId: OTHER_DATE_ID, caption: "初回施工予定日" },
];

const h = vi.hoisted(() => ({
  appId: "ci-app" as string | null,
  fields: [] as { uniqueId: string; caption: string }[],
  fieldsNull: false,
  row: null as { recordId: unknown; record: Record<string, unknown> } | null,
  getThrows: null as Error | null,
  gets: [] as { appId: string; recordId: string; fieldsCsv?: string }[],
  snapshotCalls: 0,
}));

vi.mock("@/lib/atpocket", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/atpocket")>("@/lib/atpocket");
  return {
    ...actual,
    readAuthsForApp: () => [{ apiKey: "r1" }],
    fetchAppFieldsTryKeys: async () => (h.fieldsNull ? null : h.fields),
    fetchRecordById: async (
      appId: string,
      recordId: string,
      _auth: unknown,
      fieldsCsv?: string,
    ) => {
      h.gets.push({ appId, recordId, ...(fieldsCsv ? { fieldsCsv } : {}) });
      if (h.getThrows) throw h.getThrows;
      return h.row;
    },
  };
});

vi.mock("@/lib/customer-info-config", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/customer-info-config")
  >("@/lib/customer-info-config");
  return {
    ...actual,
    customerInfoAppId: () => h.appId,
    customerInfoPocketAuth: () => ({ apiKey: "c1" }),
  };
});

vi.mock("@/lib/customer-crm-list", () => ({
  getCachedCustomerCrmSnapshot: async () => {
    h.snapshotCalls += 1;
    return { items: [] };
  },
}));

const { recheckCustomerInfoConstructionDate } = await import(
  "@/lib/customer-info-construction-date-recheck"
);

let savedEnv: string | undefined;

beforeEach(() => {
  savedEnv = process.env.CUSTOMER_INFO_CONSTRUCTION_DATE_FIELD_ID;
  delete process.env.CUSTOMER_INFO_CONSTRUCTION_DATE_FIELD_ID;
  h.appId = "ci-app";
  h.fields = [...CUSTOMER_FIELDS];
  h.fieldsNull = false;
  h.row = { recordId: "cus-1", record: { [DATE_ID]: "" } };
  h.getThrows = null;
  h.gets.length = 0;
  h.snapshotCalls = 0;
});

afterEach(() => {
  if (savedEnv === undefined) {
    delete process.env.CUSTOMER_INFO_CONSTRUCTION_DATE_FIELD_ID;
  } else {
    process.env.CUSTOMER_INFO_CONSTRUCTION_DATE_FIELD_ID = savedEnv;
  }
});

describe("施工予定日の判定（一覧と同じ）", () => {
  it.each(["", "-", "  "])("★ %j は空", async (v) => {
    h.row = { recordId: "cus-1", record: { [DATE_ID]: v } };
    expect(await recheckCustomerInfoConstructionDate("cus-1")).toEqual({
      kind: "unset",
    });
  });

  it("★ 列そのものが返ってこなければ空（一覧と同じ扱い）", async () => {
    h.row = { recordId: "cus-1", record: {} };
    expect(await recheckCustomerInfoConstructionDate("cus-1")).toEqual({
      kind: "unset",
    });
  });

  it.each(["2026-11-05", "2026/11/05", "2026年11月05日"])(
    "★ %j は入っている",
    async (v) => {
      h.row = { recordId: "cus-1", record: { [DATE_ID]: v } };
      expect(await recheckCustomerInfoConstructionDate("cus-1")).toEqual({
        kind: "set",
      });
    },
  );

  it("★ 見出し「施工予定日」の列を見る（ほかの日付列は見ない）", async () => {
    h.row = {
      recordId: "cus-1",
      record: { [DATE_ID]: "", [OTHER_DATE_ID]: "2026-11-05" },
    };
    expect(await recheckCustomerInfoConstructionDate("cus-1")).toEqual({
      kind: "unset",
    });
  });

  it("★ CUSTOMER_INFO_CONSTRUCTION_DATE_FIELD_ID があればその列を見る（一覧と同じ解決）", async () => {
    process.env.CUSTOMER_INFO_CONSTRUCTION_DATE_FIELD_ID = OTHER_DATE_ID;
    h.row = {
      recordId: "cus-1",
      record: { [DATE_ID]: "", [OTHER_DATE_ID]: "2026-11-05" },
    };
    expect(await recheckCustomerInfoConstructionDate("cus-1")).toEqual({
      kind: "set",
    });
  });
});

describe("読み直し方", () => {
  it("★ 単票 GET を1回だけ、列を絞らずに呼ぶ", async () => {
    await recheckCustomerInfoConstructionDate("cus-1");

    expect(h.gets).toEqual([{ appId: "ci-app", recordId: "cus-1" }]);
  });

  it("★ 一覧のキャッシュ（スナップショット）は使わない", async () => {
    await recheckCustomerInfoConstructionDate("cus-1");

    expect(h.snapshotCalls).toBe(0);
  });
});

describe("読み直せなかったとき（空とは扱わない）", () => {
  it("★ GET が失敗したら error", async () => {
    h.getThrows = new Error("@pocket get record failed: 500");
    const r = await recheckCustomerInfoConstructionDate("cus-1");
    expect(r.kind).toBe("error");
  });

  it("★ 429 でも error", async () => {
    h.getThrows = new Error("@pocket get record failed: 429 Too Many Requests");
    const r = await recheckCustomerInfoConstructionDate("cus-1");
    expect(r.kind).toBe("error");
  });

  it("★ レコードが無ければ error（not_found）", async () => {
    h.row = null;
    expect(await recheckCustomerInfoConstructionDate("cus-1")).toEqual({
      kind: "error",
      reason: "not_found",
    });
  });

  it("★ 施工予定日の列が分からなければ error（読まずに止める）", async () => {
    h.fields = [{ uniqueId: "ci-name", caption: "お客様名" }];
    const r = await recheckCustomerInfoConstructionDate("cus-1");
    expect(r.kind).toBe("error");
    expect(h.gets).toEqual([]);
  });

  it("★ 列定義が取れなければ error", async () => {
    h.fieldsNull = true;
    const r = await recheckCustomerInfoConstructionDate("cus-1");
    expect(r.kind).toBe("error");
    expect(h.gets).toEqual([]);
  });

  it("★ お客様情報アプリが未設定なら error", async () => {
    h.appId = null;
    const r = await recheckCustomerInfoConstructionDate("cus-1");
    expect(r.kind).toBe("error");
    expect(h.gets).toEqual([]);
  });

  it("★ recordId が空なら error", async () => {
    const r = await recheckCustomerInfoConstructionDate("  ");
    expect(r.kind).toBe("error");
    expect(h.gets).toEqual([]);
  });
});
