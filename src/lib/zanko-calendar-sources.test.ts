import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { emptyZankoIndex } from "@/lib/zanko-index";

/**
 * 残工の材料（186・契約情報入力）を読む部品（段階1）。
 *
 *   - 契約情報は、お客様情報の全件キャッシュ（施工管理タブと同じ）から作る。
 *     二重に取らない
 *   - 契約情報の設定が無ければ disabled。失敗しても投げない（429 も）
 *   - 2つを並べて読み、どちらが失敗しても投げない
 *   - 取得の部品は1つ（readZankoCalendarSources）。施工管理も段階2以降で
 *     同じ部品を呼ぶ
 */

const h = vi.hoisted(() => ({
  snapshotCalls: 0,
  snapshotError: null as Error | null,
  snapshotItems: [] as unknown[],
  zankoCalls: 0,
  zankoResult: null as unknown,
  /** 並びの確認用。開始・終了の順 */
  events: [] as string[],
  /** これが解決するまで全件キャッシュの読み取りを止める */
  gate: null as Promise<void> | null,
}));

vi.mock("@/lib/customer-crm-list", () => ({
  getCachedCustomerCrmSnapshot: async () => {
    h.snapshotCalls += 1;
    h.events.push("contract:start");
    if (h.gate) await h.gate;
    h.events.push("contract:end");
    if (h.snapshotError) throw h.snapshotError;
    return { items: h.snapshotItems };
  },
}));

vi.mock("@/lib/zanko-records-cache", () => ({
  readZankoIndexCached: async () => {
    h.zankoCalls += 1;
    h.events.push("zanko:start");
    h.events.push("zanko:end");
    return h.zankoResult;
  },
}));

const { readContractRecords } = await import("@/lib/contract-records-server");
const { readZankoCalendarSources, summarizeZankoSources } = await import(
  "@/lib/zanko-calendar-sources"
);

const ENV_KEYS = [
  "CUSTOMER_INFO_APP_ID",
  "CUSTOMER_INFO_CUSTOMER_NAME_FIELD_ID",
] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.CUSTOMER_INFO_APP_ID = "app-1";
  process.env.CUSTOMER_INFO_CUSTOMER_NAME_FIELD_ID = "field-1";
  h.snapshotCalls = 0;
  h.snapshotError = null;
  h.snapshotItems = [
    { recordId: "10", tNumber: "Ｔ０００１", customerName: "山田 太郎" },
  ];
  h.zankoCalls = 0;
  h.zankoResult = { status: "ok", index: emptyZankoIndex() };
  h.events.length = 0;
  h.gate = null;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = savedEnv[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("readContractRecords（契約情報入力）", () => {
  it("★ 全件キャッシュから T番号 → 契約レコード を作る（NFKC）", async () => {
    const r = await readContractRecords();

    expect(r.status).toBe("ok");
    expect(r.byT.get("T0001")?.recordId).toBe("10");
    expect(h.snapshotCalls).toBe(1);
  });

  it.each(["CUSTOMER_INFO_APP_ID", "CUSTOMER_INFO_CUSTOMER_NAME_FIELD_ID"] as const)(
    "★ %s が無ければ disabled。全件キャッシュも読まない",
    async (k) => {
      delete process.env[k];
      const r = await readContractRecords();

      expect(r.status).toBe("disabled");
      expect(r.byT.size).toBe(0);
      expect(h.snapshotCalls).toBe(0);
    },
  );

  it("★ 429 で失敗したら error（rate_limited）・契約情報なし。投げない", async () => {
    h.snapshotError = new Error("@pocket 429 Too Many Requests");
    const r = await readContractRecords();

    expect(r.status).toBe("error");
    expect(r.byT.size).toBe(0);
    if (r.status === "error") expect(r.reason).toBe("rate_limited");
  });

  it("★ それ以外の失敗も error（fetch_failed）。投げない", async () => {
    h.snapshotError = new Error("boom");
    const r = await readContractRecords();

    expect(r.status).toBe("error");
    if (r.status === "error") expect(r.reason).toBe("fetch_failed");
  });
});

describe("readZankoCalendarSources（取得の部品は1つ）", () => {
  it("★ 186 と契約情報の両方を読む", async () => {
    const s = await readZankoCalendarSources();

    expect(h.zankoCalls).toBe(1);
    expect(h.snapshotCalls).toBe(1);
    expect(s.zanko.status).toBe("ok");
    expect(s.contract.status).toBe("ok");
  });

  it("★ 2つを並べて読む（契約情報の終わりを待たずに186を始める）", async () => {
    let open!: () => void;
    h.gate = new Promise<void>((r) => {
      open = r;
    });
    const p = readZankoCalendarSources();
    await new Promise((r) => setTimeout(r, 0));

    expect(h.events).toContain("contract:start");
    expect(h.events).toContain("zanko:start");
    expect(h.events).not.toContain("contract:end");

    open();
    await p;
  });

  it("★ どちらが失敗しても投げない", async () => {
    h.snapshotError = new Error("@pocket 429 Too Many Requests");
    h.zankoResult = {
      status: "error",
      reason: "fetch_failed",
      index: emptyZankoIndex(),
    };

    const s = await readZankoCalendarSources();

    expect(s.zanko.status).toBe("error");
    expect(s.contract.status).toBe("error");
  });

  it("★ 状態の要約（画面には出さない。失敗が分かる情報）", async () => {
    h.snapshotError = new Error("@pocket 429 Too Many Requests");
    h.zankoResult = { status: "ok", stale: true, index: emptyZankoIndex() };

    const s = await readZankoCalendarSources();

    expect(summarizeZankoSources(s)).toEqual({
      zanko: "ok",
      zankoStale: true,
      contract: "error",
      contractReason: "rate_limited",
    });
  });
});

describe("両タブが同じキャッシュを使う（配線）", () => {
  const ROOT = process.cwd();
  const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

  it("★ 契約情報は施工管理タブと同じ全件キャッシュから読む", () => {
    expect(read("src/lib/contract-records-server.ts")).toContain(
      "getCachedCustomerCrmSnapshot(",
    );
    expect(
      read("src/app/api/calendar/construction-management/route.ts"),
    ).toContain("getCachedCustomerCrmSnapshot(");
  });

  it("★ 186 を取りに行くのは zanko-records-cache だけ", () => {
    const src = read("src/lib/zanko-calendar-sources.ts");
    expect(src).toContain("readZankoIndexCached(");
    expect(src).toContain("readContractRecords(");
  });

  it("★ 工事カレンダーは取得の部品を通して読む", () => {
    expect(read("src/app/api/calendar/route.ts")).toContain(
      "readZankoCalendarSources(",
    );
  });
});
