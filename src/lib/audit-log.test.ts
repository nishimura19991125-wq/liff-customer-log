import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * タスクT: 監査ログの 429 対策。
 *
 * 待って再試行するが、業務処理を長く止めない。429 以外は再送しない。
 */

const h = vi.hoisted(() => ({
  /** createRecord が呼ばれた時刻（フェイクタイマー上の Date.now()） */
  calls: [] as number[],
  /** 呼び出しごとに投げるエラー。null は成功 */
  responses: [] as Array<Error | null>,
}));

const APP_FIELDS = [
  { uniqueId: "field-1", caption: "実行日時" },
  { uniqueId: "field-2", caption: "実行者" },
  { uniqueId: "field-3", caption: "操作種別" },
  { uniqueId: "field-4", caption: "対象アプリID" },
  { uniqueId: "field-5", caption: "対象レコードID" },
  { uniqueId: "field-6", caption: "対象T番" },
  { uniqueId: "field-7", caption: "変更内容" },
];

vi.mock("@/lib/atpocket", () => ({
  fetchAppFields: async () => APP_FIELDS,
  createRecord: async () => {
    const i = h.calls.length;
    h.calls.push(Date.now());
    const e = h.responses[i] ?? null;
    if (e) throw e;
    return { row: {}, location: null, recordIdHint: null, rawBody: null };
  },
  // 実装と同じ判定
  isPocketHttpRateLimitError: (error: unknown) => {
    const msg = error instanceof Error ? error.message : String(error);
    return msg.includes("429") || msg.includes("Too Many Request");
  },
  pocketRetryAfterMsFromError: (error: unknown) => {
    if (!error || typeof error !== "object") return null;
    const v = (error as { retryAfterMs?: unknown }).retryAfterMs;
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
    return null;
  },
}));

vi.mock("@/lib/staff-roster-cache", () => ({
  fetchStaffRosterRowsCached: async () => [],
  boundStaffEntryFromRosterRows: () => ({
    name: "テスト",
    email: "test@example.test",
    staffCode: "S1",
  }),
}));

const {
  auditLogStats,
  auditLogBackoffMs,
  recordAuditLog,
  resetAuditLogRetryCooldown,
  invalidateAuditLogFieldIdsCache,
} = await import("@/lib/audit-log");

function rateLimitError(retryAfterMs?: number): Error {
  const e = new Error("@pocket create record failed: 429 Too Many Request") as
    Error & { retryAfterMs?: number };
  if (retryAfterMs != null) e.retryAfterMs = retryAfterMs;
  return e;
}

function otherError(): Error {
  return new Error(
    "@pocket create record failed: 400 有効なフィールドではありません",
  );
}

const UPDATE_ENTRY = {
  lineUserId: "U-test",
  operation: "update" as const,
  targetAppId: "35",
  targetRecordId: "1483",
  targetTNumber: "T00001691",
  changes: [
    { fieldId: "field-9", label: "お客様名", before: "旧", after: "新" },
  ],
};

/** 待機を進めて完了させる */
async function run(entry = UPDATE_ENTRY) {
  const promise = recordAuditLog(entry);
  await vi.advanceTimersByTimeAsync(120_000);
  return promise;
}

/** テスト前後の stats 差分 */
function statsDelta(before: ReturnType<typeof auditLogStats>) {
  const after = auditLogStats();
  return {
    succeeded: after.succeeded - before.succeeded,
    failed: after.failed - before.failed,
    succeededAfterRetry:
      after.succeededAfterRetry - before.succeededAfterRetry,
    failedRateLimited: after.failedRateLimited - before.failedRateLimited,
    failedOther: after.failedOther - before.failedOther,
    skippedByCooldown: after.skippedByCooldown - before.skippedByCooldown,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  // ジッターを固定（0.5 + 0.5 = 1.0 倍）
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.env.AUDIT_LOG_APP_ID = "12";
  process.env.AUDIT_LOG_ATPOCKET_API_KEY = "dummy";
  delete process.env.AUDIT_LOG_RETRY_MAX_ATTEMPTS;
  delete process.env.AUDIT_LOG_RETRY_BUDGET_MS;
  delete process.env.AUDIT_LOG_RETRY_COOLDOWN_MS;
  h.calls = [];
  h.responses = [];
  resetAuditLogRetryCooldown();
  invalidateAuditLogFieldIdsCache();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("バックオフの計算", () => {
  it("指数で増え、上限でクランプされる", () => {
    // ジッター 1.0 倍（random()=0.5）で素の値を見る
    const half = () => 0.5;
    expect(auditLogBackoffMs(0, half)).toBe(450);
    expect(auditLogBackoffMs(1, half)).toBe(900);
    expect(auditLogBackoffMs(2, half)).toBe(1_800);
    expect(auditLogBackoffMs(3, half)).toBe(3_600);
    // 上限 14 秒でクランプ
    expect(auditLogBackoffMs(10, half)).toBe(14_000);
  });

  it("フルジッターで 0.5〜1.5 倍に散る", () => {
    expect(auditLogBackoffMs(0, () => 0)).toBe(225);
    expect(auditLogBackoffMs(0, () => 0.5)).toBe(450);
    expect(auditLogBackoffMs(0, () => 1)).toBe(675);
  });
});

describe("★ ① 429 を受けたら待ってから再試行する", () => {
  it("待機してから2回目を投げ、成功したら ok を返す", async () => {
    h.responses = [rateLimitError()];
    const before = auditLogStats();

    const result = await run();

    expect(result).toEqual({ ok: true, written: 1 });
    expect(h.calls).toHaveLength(2);
    // 待機ゼロの即時再送ではない
    expect(h.calls[1] - h.calls[0]).toBe(450);
    expect(statsDelta(before).succeeded).toBe(1);
  });

  it("2回目も 429 なら3回目まで試す（既定は総試行3回）", async () => {
    h.responses = [rateLimitError(), rateLimitError()];

    const result = await run();

    expect(result).toEqual({ ok: true, written: 1 });
    expect(h.calls).toHaveLength(3);
    expect(h.calls[1] - h.calls[0]).toBe(450);
    expect(h.calls[2] - h.calls[1]).toBe(900);
  });
});

describe("★ ② Retry-After があればそれに従う", () => {
  it("自前のバックオフ（450ms）より Retry-After（2秒）を優先する", async () => {
    h.responses = [rateLimitError(2_000)];

    await run();

    expect(h.calls).toHaveLength(2);
    expect(h.calls[1] - h.calls[0]).toBe(2_000);
  });

  it("Retry-After が無ければ自前の計算を使う", async () => {
    h.responses = [rateLimitError()];

    await run();

    expect(h.calls[1] - h.calls[0]).toBe(450);
  });
});

describe("★ ③ 再試行の回数上限に達したら諦める", () => {
  it("総試行2回に設定すると2回で打ち切る", async () => {
    process.env.AUDIT_LOG_RETRY_MAX_ATTEMPTS = "2";
    h.responses = [rateLimitError(), rateLimitError(), rateLimitError()];
    const before = auditLogStats();

    const result = await run();

    expect(result.ok).toBe(false);
    expect(h.calls).toHaveLength(2);
    const d = statsDelta(before);
    expect(d.failed).toBe(1);
    expect(d.failedRateLimited).toBe(1);
    expect(d.failedOther).toBe(0);
  });
});

describe("★ ④ 合計の待機時間の上限に達したら諦める", () => {
  it("Retry-After が予算を超えるなら待たずに諦める", async () => {
    process.env.AUDIT_LOG_RETRY_BUDGET_MS = "1000";
    h.responses = [rateLimitError(5_000), rateLimitError(5_000)];
    const before = auditLogStats();

    const result = await run();

    expect(result.ok).toBe(false);
    // 5秒待つと予算超過。1回投げて終わり
    expect(h.calls).toHaveLength(1);
    expect(statsDelta(before).failedRateLimited).toBe(1);
  });

  it("予算に収まる待機は行う", async () => {
    process.env.AUDIT_LOG_RETRY_BUDGET_MS = "1000";
    h.responses = [rateLimitError(400)];

    await run();

    expect(h.calls).toHaveLength(2);
    expect(h.calls[1] - h.calls[0]).toBe(400);
  });
});

describe("★ ⑤ 429 以外のエラーでは再試行しない", () => {
  it("列の設定ミスは1回で諦める", async () => {
    h.responses = [otherError()];
    const before = auditLogStats();

    const result = await run();

    expect(result.ok).toBe(false);
    expect(h.calls).toHaveLength(1);
    const d = statsDelta(before);
    expect(d.failedOther).toBe(1);
    expect(d.failedRateLimited).toBe(0);
  });
});

describe("★ ⑥ リトライの結果が auditLogStats に出る", () => {
  it("初回で成功した分は succeededAfterRetry に入らない", async () => {
    const before = auditLogStats();

    await run();

    const d = statsDelta(before);
    expect(d.succeeded).toBe(1);
    expect(d.succeededAfterRetry).toBe(0);
  });

  it("再試行して成功した件数が数えられる", async () => {
    h.responses = [rateLimitError()];
    const before = auditLogStats();

    await run();

    const d = statsDelta(before);
    expect(d.succeeded).toBe(1);
    expect(d.succeededAfterRetry).toBe(1);
    expect(d.failed).toBe(0);
  });
});

describe("★ ⑦ 記録に失敗しても業務処理は続く（削除を除く）", () => {
  it("更新は throw せず ok:false を返すだけ", async () => {
    h.responses = [otherError()];

    const result = await run();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("1 件中 0 件");
  });

  it("削除は失敗を呼び出し側へ返す（呼び出し側が削除を止められる）", async () => {
    h.responses = [otherError()];

    const result = await run({
      lineUserId: "U-test",
      operation: "delete",
      targetAppId: "35",
      targetRecordId: "1483",
      deletionContent: "お客様名: 山田太郎",
    } as never);

    expect(result.ok).toBe(false);
  });

  it("削除の本文が空なら @pocket を呼ばずに失敗を返す（従来どおり）", async () => {
    const result = await run({
      lineUserId: "U-test",
      operation: "delete",
      targetAppId: "35",
      targetRecordId: "1483",
      deletionContent: "",
    } as never);

    expect(result.ok).toBe(false);
    expect(h.calls).toHaveLength(0);
  });
});

describe("★ 一括処理向けのサーキットブレーカー", () => {
  it("再試行を使い切ったあとは、しばらく1回だけ投げて即失敗する", async () => {
    process.env.AUDIT_LOG_RETRY_MAX_ATTEMPTS = "2";
    // run() が毎回120秒進めるので、その間は明けない長さにする
    process.env.AUDIT_LOG_RETRY_COOLDOWN_MS = "300000";
    h.responses = [rateLimitError(), rateLimitError(), rateLimitError()];

    // 1件目で使い切る（2回投げる）
    await run();
    expect(h.calls).toHaveLength(2);

    // 2件目はクールダウン中。再試行せず1回だけ
    const before = auditLogStats();
    const result = await run();

    expect(result.ok).toBe(false);
    expect(h.calls).toHaveLength(3);
    const d = statsDelta(before);
    expect(d.skippedByCooldown).toBe(1);
    expect(d.failedRateLimited).toBe(1);
  });

  it("クールダウンが明けたら再試行が戻る", async () => {
    process.env.AUDIT_LOG_RETRY_MAX_ATTEMPTS = "2";
    process.env.AUDIT_LOG_RETRY_COOLDOWN_MS = "30000";
    h.responses = [rateLimitError(), rateLimitError(), rateLimitError()];

    await run();
    expect(h.calls).toHaveLength(2);

    // run() が120秒進めているので、30秒のクールダウンは既に明けている
    h.responses = [];
    h.responses[2] = rateLimitError();
    const result = await run();

    expect(result.ok).toBe(true);
    // 3回目（429）→ 待機 → 4回目（成功）
    expect(h.calls).toHaveLength(4);
  });

  it("クールダウンが 0 なら開かない", async () => {
    process.env.AUDIT_LOG_RETRY_MAX_ATTEMPTS = "2";
    process.env.AUDIT_LOG_RETRY_COOLDOWN_MS = "0";
    h.responses = [rateLimitError(), rateLimitError()];

    await run();
    expect(h.calls).toHaveLength(2);

    h.responses = [];
    h.responses[2] = rateLimitError();
    const before = auditLogStats();
    const result = await run();

    expect(result.ok).toBe(true);
    expect(statsDelta(before).skippedByCooldown).toBe(0);
  });
});
