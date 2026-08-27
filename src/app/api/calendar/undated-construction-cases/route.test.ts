import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 第3段階 3-3: 未定案件一覧の抽出元をお客様情報アプリへ切り替えた。
 *
 * ここで固定するのは次の3つ。
 *   - 一覧がお客様情報のスナップショットから作られる
 *   - **工事登録アプリを読まない**（全件走査が3系統から1系統へ）
 *   - キャンセル用のT番号全件走査も呼ばない
 */

const h = vi.hoisted(() => ({
  snapshotCalls: 0,
  /** 工事アプリを読んだら設計違反 */
  constructionCalls: 0,
  /** キャンセルT番号の全件走査を呼んだら設計違反 */
  cancelledCalls: 0,
  /** 担当者で絞った一覧を呼んだら設計違反（全件を使うはず） */
  staffListCalls: 0,
  staffName: "山田太郎" as string | null,
  items: [] as Record<string, unknown>[],
}));

const AP = "field-10";

vi.mock("@/lib/request-auth", () => ({
  resolveCallerLineAuth: async () => ({ ok: true, lineUserId: "U-test" }),
  lineAuthUnauthorizedResponse: () => new Response(null, { status: 401 }),
}));

vi.mock("@/lib/staff-bound-lookup", () => ({
  resolveBoundStaffNameForLineUser: async () => h.staffName,
}));

vi.mock("@/lib/customer-info-config", () => ({
  customerInfoConfigReady: () => ({
    ok: true,
    appId: "app-1",
    nameFieldId: "field-1",
  }),
}));

vi.mock("@/lib/customer-crm-list", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/customer-crm-list")
  >("@/lib/customer-crm-list");
  return {
    ...actual,
    getCachedCustomerCrmSnapshot: async () => {
      h.snapshotCalls += 1;
      return {
        items: h.items,
        apFieldId: AP,
        clFieldId: null,
        creatorFieldId: null,
      };
    },
    listCustomerCrmRecords: async () => {
      h.staffListCalls += 1;
      return [];
    },
  };
});

vi.mock("@/lib/calendar-construction-records-cache", () => ({
  fetchCalendarConstructionRecordsCached: async () => {
    h.constructionCalls += 1;
    return [];
  },
  invalidateCalendarConstructionRecordsCache: () => {},
}));

vi.mock("@/lib/customer-cancelled-t-numbers", () => ({
  fetchCancelledCustomerTNumbersCached: async () => {
    h.cancelledCalls += 1;
    return new Set<string>();
  },
  isCustomerTNumberCancelled: async () => false,
}));

const { GET } = await import(
  "@/app/api/calendar/undated-construction-cases/route"
);

type Payload = {
  configured: boolean;
  staffName?: string;
  needsStaffBind?: boolean;
  items: Array<Record<string, unknown>>;
  myItems: Array<Record<string, unknown>>;
  error?: string;
};

async function call(): Promise<{ status: number; body: Payload }> {
  const res = await GET(
    new Request("https://example.test/undated-construction-cases"),
  );
  return { status: res.status, body: (await res.json()) as Payload };
}

function candidate(over: Record<string, unknown> & { recordId: string }) {
  return {
    customerName: `顧客${over.recordId}`,
    subtitle: "",
    tNumber: `T0000${over.recordId}`,
    isDocumentMissing: false,
    isSubsidyTarget: false,
    combinedSubsidyName: null,
    isConstructionDateUnset: true,
    isCancelled: false,
    isCompleted: false,
    housingStatus: "既築案件",
    contractorName: "株式会社アルファ",
    sortKey: 1,
    audience: {},
    ...over,
  };
}

beforeEach(() => {
  h.snapshotCalls = 0;
  h.constructionCalls = 0;
  h.cancelledCalls = 0;
  h.staffListCalls = 0;
  h.staffName = "山田太郎";
  h.items = [];
});

describe("抽出元がお客様情報になった（3-3）", () => {
  it("★ 一覧がスナップショットから作られる", async () => {
    h.items = [
      candidate({ recordId: "1", audience: { [AP]: "山田太郎" } }),
      candidate({ recordId: "2" }),
    ];

    const { status, body } = await call();

    expect(status).toBe(200);
    expect(h.snapshotCalls).toBe(1);
    expect(body.items.map((i) => i.customerInfoRecordId)).toEqual(["1", "2"]);
    expect(body.myItems.map((i) => i.customerInfoRecordId)).toEqual(["1"]);
  });

  it("★ 工事登録アプリを読まない", async () => {
    h.items = [candidate({ recordId: "1" })];
    await call();
    expect(h.constructionCalls).toBe(0);
  });

  it("★ キャンセルT番号の全件走査を呼ばない（ステータスはスナップショットにある）", async () => {
    h.items = [candidate({ recordId: "1" })];
    await call();
    expect(h.cancelledCalls).toBe(0);
  });

  it("★ 担当者で絞った一覧も呼ばない（全件を1回だけ使う）", async () => {
    h.items = [candidate({ recordId: "1" })];
    await call();
    expect(h.staffListCalls).toBe(0);
    expect(h.snapshotCalls).toBe(1);
  });

  it("★ 条件（施工予定日が空・キャンセル以外・T番号あり）が効く", async () => {
    h.items = [
      candidate({ recordId: "1" }),
      candidate({ recordId: "2", isConstructionDateUnset: false }),
      candidate({ recordId: "3", isCancelled: true }),
      candidate({ recordId: "4", tNumber: "" }),
    ];

    const { body } = await call();
    expect(body.items.map((i) => i.customerInfoRecordId)).toEqual(["1"]);
  });

  it("スタッフ未紐付けなら needsStaffBind を返し、一覧は全件出す", async () => {
    h.staffName = null;
    h.items = [candidate({ recordId: "1" })];

    const { body } = await call();
    expect(body.needsStaffBind).toBe(true);
    expect(body.items).toHaveLength(1);
    expect(body.myItems).toEqual([]);
  });
});
