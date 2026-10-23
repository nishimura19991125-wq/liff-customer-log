import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AtPocketRecordRow } from "@/lib/atpocket";

/**
 * 実行中の工事レコード取得の使い回し。
 *
 * 取得はテスト側で好きな順に終わらせられるよう、呼び出しごとに
 * 解決・失敗の関数を控えておく。
 */
const h = vi.hoisted(() => {
  type Pending = {
    query: string | null;
    resolve: (rows: AtPocketRecordRow[]) => void;
    reject: (e: unknown) => void;
  };
  return { pending: [] as Pending[] };
});

vi.mock("@/lib/atpocket", () => ({
  fetchAllRecordsPages: (
    _appId: string,
    _fields: string,
    _auth: unknown,
    query: string | null,
  ) =>
    new Promise<AtPocketRecordRow[]>((resolve, reject) => {
      h.pending.push({ query, resolve, reject });
    }),
  isPocketApiRateLimited: () => false,
  isPocketHttpRateLimitError: () => false,
  listAuthsForAppList: () => [{ apiKey: "k" }],
}));

import {
  fetchCalendarConstructionRecordsCached,
  invalidateCalendarConstructionRecordsCache,
} from "@/lib/calendar-construction-records-cache";

const OCT = 'start <= "2026-10-31"';
const NOV = 'start <= "2026-11-30"';

function rowsFor(label: string): AtPocketRecordRow[] {
  return [{ id: label, record: { label } } as unknown as AtPocketRecordRow];
}

/** 取得が始まるまで待つ（非同期関数の中で呼ばれるため） */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

beforeEach(() => {
  invalidateCalendarConstructionRecordsCache();
  h.pending.length = 0;
});

describe("実行中の工事レコード取得をキーごとに分ける", () => {
  it("★ キーが違う2つの要求が同時に来たら、それぞれ自分のデータを受け取る", async () => {
    const oct = fetchCalendarConstructionRecordsCached("cal", "f1", OCT);
    const nov = fetchCalendarConstructionRecordsCached("cal", "f1", NOV);
    await flush();

    // 別々に取得が走っている
    expect(h.pending.map((p) => p.query)).toEqual([OCT, NOV]);

    // 後から始めた方を先に終わらせても、取り違えない
    h.pending[1]!.resolve(rowsFor("nov"));
    h.pending[0]!.resolve(rowsFor("oct"));

    await expect(oct).resolves.toEqual(rowsFor("oct"));
    await expect(nov).resolves.toEqual(rowsFor("nov"));
  });

  it("★ 列が違うだけの要求も、別の取得になる", async () => {
    const a = fetchCalendarConstructionRecordsCached("cal", "f1", OCT);
    const b = fetchCalendarConstructionRecordsCached("cal", "f1,f2", OCT);
    await flush();

    expect(h.pending).toHaveLength(2);
    h.pending[0]!.resolve(rowsFor("a"));
    h.pending[1]!.resolve(rowsFor("b"));

    await expect(a).resolves.toEqual(rowsFor("a"));
    await expect(b).resolves.toEqual(rowsFor("b"));
  });

  it("★ キーが同じ要求が同時に来たら、取得は1回にまとまる", async () => {
    const first = fetchCalendarConstructionRecordsCached("cal", "f1", OCT);
    const second = fetchCalendarConstructionRecordsCached("cal", "f1", OCT);
    await flush();

    expect(h.pending).toHaveLength(1);
    h.pending[0]!.resolve(rowsFor("oct"));

    await expect(first).resolves.toEqual(rowsFor("oct"));
    await expect(second).resolves.toEqual(rowsFor("oct"));
  });

  it("★ 取得に失敗したら、待っていた要求にも失敗が伝わる", async () => {
    const first = fetchCalendarConstructionRecordsCached("cal", "f1", OCT);
    const second = fetchCalendarConstructionRecordsCached("cal", "f1", OCT);
    await flush();

    expect(h.pending).toHaveLength(1);
    h.pending[0]!.reject(new Error("pocket down"));

    await expect(first).rejects.toThrow("pocket down");
    await expect(second).rejects.toThrow("pocket down");
  });

  it("失敗の後に来た要求は、新しく取得し直す", async () => {
    const first = fetchCalendarConstructionRecordsCached("cal", "f1", OCT);
    await flush();
    h.pending[0]!.reject(new Error("pocket down"));
    await expect(first).rejects.toThrow("pocket down");

    const retry = fetchCalendarConstructionRecordsCached("cal", "f1", OCT);
    await flush();
    expect(h.pending).toHaveLength(2);
    h.pending[1]!.resolve(rowsFor("oct"));
    await expect(retry).resolves.toEqual(rowsFor("oct"));
  });

  it("片方の失敗は、キーが違う要求に影響しない", async () => {
    const oct = fetchCalendarConstructionRecordsCached("cal", "f1", OCT);
    const nov = fetchCalendarConstructionRecordsCached("cal", "f1", NOV);
    await flush();

    h.pending[0]!.reject(new Error("pocket down"));
    h.pending[1]!.resolve(rowsFor("nov"));

    await expect(oct).rejects.toThrow("pocket down");
    await expect(nov).resolves.toEqual(rowsFor("nov"));
  });
});
