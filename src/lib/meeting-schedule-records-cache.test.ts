import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 商談進捗の一覧キャッシュ（バースト対策）。
 *
 * 見たいのは3点。
 *   1. 同一データへの同時リクエストが1回にまとまること（single-flight）
 *   2. キャッシュキーに担当者名が混ざらないこと（Phase 0 §6）
 *   3. 担当者ごとの絞り込みが従来どおり効くこと
 */

const h = vi.hoisted(() => ({
  /** fetchSalesDashboardRecordPages が呼ばれた回数 */
  fetchCalls: 0,
  /** 呼び出し時に渡された引数（キーに氏名が混ざっていないかの確認用） */
  fetchArgs: [] as Array<{ appId: string; fieldsCsv: string }>,
  /** 応答を遅延させて同時実行を作る */
  resolveGate: null as null | (() => void),
  records: [] as Array<Record<string, unknown>>,
  shouldThrow: false,
}));

vi.mock("@/lib/sales-dashboard-list-fetch", () => ({
  fetchSalesDashboardRecordPages: async (
    appId: string,
    fieldsCsv: string,
  ) => {
    h.fetchCalls++;
    h.fetchArgs.push({ appId, fieldsCsv });
    if (h.shouldThrow) throw new Error("pocket down");
    if (h.resolveGate) {
      await new Promise<void>((resolve) => {
        h.resolveGate = resolve;
      });
    }
    return h.records;
  },
}));

const {
  fetchMeetingScheduleRecordsCached,
  invalidateMeetingScheduleRecordsCache,
} = await import("@/lib/meeting-schedule-records-cache");

const CTX = {
  operation: "meeting-schedule:records-list",
  appEnv: "SALES_DASHBOARD_APO_APP_ID",
};

const AUTHS = [{ apiKey: "dummy" }];
const FIELDS = "field-1,field-2,field-3";

beforeEach(() => {
  h.fetchCalls = 0;
  h.fetchArgs = [];
  h.resolveGate = null;
  h.shouldThrow = false;
  h.records = [{ record: { "field-1": "x" } }];
  invalidateMeetingScheduleRecordsCache();
  delete process.env.MEETING_SCHEDULE_CACHE_SECONDS;
});

describe("キャッシュと single-flight", () => {
  it("★ 同時に呼んでも @pocket へは1回だけ（同時実行の合流）", async () => {
    // ゲートを立てて1本目を止め、その間に2本目・3本目を投げる
    h.resolveGate = () => undefined;
    const p1 = fetchMeetingScheduleRecordsCached("18", FIELDS, AUTHS, CTX);
    const p2 = fetchMeetingScheduleRecordsCached("18", FIELDS, AUTHS, CTX);
    const p3 = fetchMeetingScheduleRecordsCached("18", FIELDS, AUTHS, CTX);

    // 1本目が実際に fetch へ入るまで待つ
    await vi.waitFor(() => expect(h.fetchCalls).toBe(1));
    h.resolveGate?.();

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

    expect(h.fetchCalls).toBe(1);
    expect(r1).toBe(r2);
    expect(r2).toBe(r3);
  });

  it("2回目以降はキャッシュから返す", async () => {
    await fetchMeetingScheduleRecordsCached("18", FIELDS, AUTHS, CTX);
    await fetchMeetingScheduleRecordsCached("18", FIELDS, AUTHS, CTX);
    await fetchMeetingScheduleRecordsCached("18", FIELDS, AUTHS, CTX);

    expect(h.fetchCalls).toBe(1);
  });

  it("scope=day と scope=list は同じ列を要求するので1エントリを共有する", async () => {
    await fetchMeetingScheduleRecordsCached("18", FIELDS, AUTHS, {
      operation: "meeting-schedule:records",
      appEnv: "SALES_DASHBOARD_APO_APP_ID",
    });
    await fetchMeetingScheduleRecordsCached("18", FIELDS, AUTHS, {
      operation: "meeting-schedule:records-list",
      appEnv: "SALES_DASHBOARD_APO_APP_ID",
    });

    // operation はキーに含めない（同じデータなので分ける意味がない）
    expect(h.fetchCalls).toBe(1);
  });

  it("列構成が変わったら取り直す", async () => {
    await fetchMeetingScheduleRecordsCached("18", FIELDS, AUTHS, CTX);
    await fetchMeetingScheduleRecordsCached("18", `${FIELDS},field-9`, AUTHS, CTX);

    expect(h.fetchCalls).toBe(2);
  });

  it("アプリIDが変わったら取り直す", async () => {
    await fetchMeetingScheduleRecordsCached("18", FIELDS, AUTHS, CTX);
    await fetchMeetingScheduleRecordsCached("58", FIELDS, AUTHS, CTX);

    expect(h.fetchCalls).toBe(2);
  });

  it("★ 保存後の invalidate で取り直す（古い一覧を出さない）", async () => {
    await fetchMeetingScheduleRecordsCached("18", FIELDS, AUTHS, CTX);
    invalidateMeetingScheduleRecordsCache();
    await fetchMeetingScheduleRecordsCached("18", FIELDS, AUTHS, CTX);

    expect(h.fetchCalls).toBe(2);
  });

  it("★ 失敗しても inflight を残さない（次の呼び出しが道連れにならない）", async () => {
    h.shouldThrow = true;
    await expect(
      fetchMeetingScheduleRecordsCached("18", FIELDS, AUTHS, CTX),
    ).rejects.toThrow("pocket down");

    // 失敗した Promise が居座ると、以降ずっと同じエラーが返り続ける
    h.shouldThrow = false;
    const rows = await fetchMeetingScheduleRecordsCached(
      "18",
      FIELDS,
      AUTHS,
      CTX,
    );
    expect(rows).toHaveLength(1);
    expect(h.fetchCalls).toBe(2);
  });

  it("失敗した結果はキャッシュに残さない", async () => {
    h.shouldThrow = true;
    await expect(
      fetchMeetingScheduleRecordsCached("18", FIELDS, AUTHS, CTX),
    ).rejects.toThrow();
    h.shouldThrow = true;
    await expect(
      fetchMeetingScheduleRecordsCached("18", FIELDS, AUTHS, CTX),
    ).rejects.toThrow();

    expect(h.fetchCalls).toBe(2);
  });
});

describe("Phase 0 §6: キーに個人が混ざらないこと", () => {
  it("★ 担当者名を渡す口が無い（引数はアプリID・列・認証・文脈のみ）", () => {
    // 引数4つ。担当者名を受け取らないことをシグネチャで担保する
    expect(fetchMeetingScheduleRecordsCached.length).toBe(4);
  });

  it("★ @pocket へ渡す引数にも担当者名が入らない", async () => {
    await fetchMeetingScheduleRecordsCached("18", FIELDS, AUTHS, CTX);

    expect(h.fetchArgs).toHaveLength(1);
    expect(h.fetchArgs[0]).toEqual({ appId: "18", fieldsCsv: FIELDS });
  });

  it("★ 保存するのは絞り込み前の生レコードそのまま", async () => {
    h.records = [
      { record: { cl: "山田太郎" } },
      { record: { cl: "鈴木一郎" } },
    ];

    const rows = await fetchMeetingScheduleRecordsCached(
      "18",
      FIELDS,
      AUTHS,
      CTX,
    );

    // 誰かの分だけに絞られていない＝共有して問題ない中身
    expect(rows).toHaveLength(2);
  });
});
