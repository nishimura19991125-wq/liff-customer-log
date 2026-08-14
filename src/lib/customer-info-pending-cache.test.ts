import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 未入力一覧の全社共通キャッシュ（バースト対策・タスクO-3 と同じ形）。
 *
 * 見たいのは
 *   1. 担当者が違っても @pocket への走査は1回にまとまること
 *   2. キャッシュに入るのが絞り込み前の候補だけであること（Phase 0 §6）
 *   3. 担当者ごとの絞り込みが従来どおり効くこと
 */

const h = vi.hoisted(() => ({
  scanCalls: 0,
  snapshot: {
    candidates: [] as Array<{
      recordId: string;
      customerName: string;
      subtitleRaw: string;
      audience: Record<string, unknown>;
    }>,
    apFieldId: "field-3" as string | null,
    clFieldId: "field-4" as string | null,
    creatorFieldId: "field-7" as string | null,
  },
}));

const AP = "field-3";
const CL = "field-4";
const CREATOR = "field-7";

vi.mock("@/lib/customer-info-continue-shortcut", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/lib/customer-info-continue-shortcut")
    >();
  return {
    ...actual,
    // 走査だけ差し替える。絞り込み（filterCustomerInfoPendingForStaff）は本物を使う
    fetchCustomerInfoPendingSnapshot: async () => {
      h.scanCalls++;
      return h.snapshot;
    },
  };
});

const {
  findCustomerInfoPendingRecordsCached,
  invalidateCustomerInfoPendingCache,
} = await import("@/lib/customer-info-pending-cache");

function candidate(
  recordId: string,
  customerName: string,
  audience: Record<string, unknown>,
  subtitleRaw = "",
) {
  return { recordId, customerName, subtitleRaw, audience };
}

beforeEach(() => {
  h.scanCalls = 0;
  h.snapshot = {
    candidates: [
      candidate("1", "顧客A", { [AP]: "山田太郎", [CL]: "" }),
      candidate("2", "顧客B", { [AP]: "", [CL]: "鈴木一郎" }),
      candidate("3", "顧客C", { [AP]: "", [CL]: "", [CREATOR]: "山田太郎" }),
      candidate("4", "顧客D", { [AP]: "冨田菜摘", [CL]: "" }),
    ],
    apFieldId: AP,
    clFieldId: CL,
    creatorFieldId: CREATOR,
  };
  invalidateCustomerInfoPendingCache();
  delete process.env.CUSTOMER_INFO_PENDING_CACHE_TTL_MS;
  delete process.env.CUSTOMER_INFO_CONTINUE_MAX_RESULTS;
});

describe("全社共通キャッシュ", () => {
  it("★ 担当者が違っても走査は1回だけ", async () => {
    await findCustomerInfoPendingRecordsCached("山田太郎");
    await findCustomerInfoPendingRecordsCached("鈴木一郎");
    await findCustomerInfoPendingRecordsCached("冨田菜摘");

    expect(h.scanCalls).toBe(1);
  });

  it("★ 同時に呼んでも走査は1回だけ（single-flight）", async () => {
    const [a, b, c] = await Promise.all([
      findCustomerInfoPendingRecordsCached("山田太郎"),
      findCustomerInfoPendingRecordsCached("鈴木一郎"),
      findCustomerInfoPendingRecordsCached("山田太郎"),
    ]);

    expect(h.scanCalls).toBe(1);
    expect(a.map((x) => x.recordId).sort()).toEqual(["1", "3"]);
    expect(b.map((x) => x.recordId)).toEqual(["2"]);
    expect(c.map((x) => x.recordId).sort()).toEqual(["1", "3"]);
  });

  it("invalidate すると取り直す", async () => {
    await findCustomerInfoPendingRecordsCached("山田太郎");
    invalidateCustomerInfoPendingCache();
    await findCustomerInfoPendingRecordsCached("山田太郎");

    expect(h.scanCalls).toBe(2);
  });
});

describe("担当者ごとの絞り込み（判定ロジックは変更していない）", () => {
  it("★ AP担当者一致で出る", async () => {
    const hits = await findCustomerInfoPendingRecordsCached("山田太郎");
    expect(hits.some((x) => x.recordId === "1")).toBe(true);
  });

  it("★ CL担当者一致で出る", async () => {
    const hits = await findCustomerInfoPendingRecordsCached("鈴木一郎");
    expect(hits.map((x) => x.recordId)).toEqual(["2"]);
  });

  it("★ 担当者未設定＋作成者一致のときは creatorOnly が立つ", async () => {
    const hits = await findCustomerInfoPendingRecordsCached("山田太郎");
    const c = hits.find((x) => x.recordId === "3");
    expect(c?.creatorOnly).toBe(true);
    expect(c?.audienceReason).toBe("creator");
    expect(c?.subtitle).toContain("担当者未設定");
  });

  it("担当者一致で出た分には「担当者未設定」を付けない", async () => {
    const hits = await findCustomerInfoPendingRecordsCached("山田太郎");
    const a = hits.find((x) => x.recordId === "1");
    expect(a?.creatorOnly).toBeFalsy();
    expect(a?.subtitle).toBe("");
  });

  it("無関係な担当者には何も出さない", async () => {
    const hits = await findCustomerInfoPendingRecordsCached("無関係な人");
    expect(hits).toEqual([]);
  });

  it("お客様名の五十音順で並び、件数上限で切る", async () => {
    process.env.CUSTOMER_INFO_CONTINUE_MAX_RESULTS = "1";
    const hits = await findCustomerInfoPendingRecordsCached("山田太郎");
    // 顧客A / 顧客C のうち先頭だけ
    expect(hits.map((x) => x.customerName)).toEqual(["顧客A"]);
  });
});

describe("Phase 0 §6: 絞り込み済みの結果を共有キーで保存しないこと", () => {
  it("★ 同じキャッシュから取り出しても、人によって結果が違う", async () => {
    const yamada = await findCustomerInfoPendingRecordsCached("山田太郎");
    const suzuki = await findCustomerInfoPendingRecordsCached("鈴木一郎");

    // 走査は1回＝同じキャッシュを共有しているのに、中身は別
    expect(h.scanCalls).toBe(1);
    expect(yamada.map((x) => x.recordId)).not.toEqual(
      suzuki.map((x) => x.recordId),
    );
  });

  it("★ 先に呼んだ人の結果が後の人に漏れない（キーが担当者別でない証明）", async () => {
    await findCustomerInfoPendingRecordsCached("山田太郎");
    const suzuki = await findCustomerInfoPendingRecordsCached("鈴木一郎");

    // 山田の分（1・3）が混ざっていないこと
    expect(suzuki.map((x) => x.recordId)).toEqual(["2"]);
  });
});
