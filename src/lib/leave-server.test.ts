import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AtPocketFieldRow, AtPocketRecordRow } from "@/lib/atpocket";

/**
 * 休暇アプリ（段階1・読み取りのみ）。
 *
 * @pocket の取得はテスト側で好きな順に終わらせられるよう、
 * 呼び出しごとに解決・失敗の関数を控えておく。
 */
const h = vi.hoisted(() => {
  type Pending = {
    query: string | null;
    resolve: (rows: unknown[]) => void;
    reject: (e: unknown) => void;
  };
  return {
    pending: [] as Pending[],
    fields: [] as unknown[],
    fieldsError: null as unknown,
    rateLimited: false,
  };
});

vi.mock("@/lib/atpocket", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/atpocket")>();
  return {
    ...actual,
    fetchAppFields: async () => {
      if (h.fieldsError) throw h.fieldsError;
      return h.fields;
    },
    fetchAllRecordsPages: (
      _appId: string,
      _fields: string,
      _auth: unknown,
      query: string | null,
    ) =>
      new Promise<unknown[]>((resolve, reject) => {
        h.pending.push({ query: query ?? null, resolve, reject });
      }),
    isPocketHttpRateLimitError: () => h.rateLimited,
  };
});

import {
  fetchLeaveMonth,
  invalidateLeaveCache,
  leaveMonthCacheKey,
  resolveLeaveConfig,
  resolveLeaveFieldIds,
} from "@/lib/leave-server";

const FIELDS: AtPocketFieldRow[] = [
  { uniqueId: "field-1", caption: "従業員名", fieldType: "Text" },
  { uniqueId: "field-2", caption: "休暇種別", fieldType: "Text" },
  { uniqueId: "field-3", caption: "kyukaID", fieldType: "AutoNumber", primaryKey: true },
  { uniqueId: "field-4", caption: "休暇予定日", fieldType: "Date" },
];

const ENV_KEYS = [
  "LEAVE_APP_ID",
  "LEAVE_ATPOCKET_API_KEY",
  "LEAVE_ATPOCKET_API_KEY_1",
  "LEAVE_ATPOCKET_API_KEY_2",
  "LEAVE_ATPOCKET_API_KEY_FIELDS",
  "LEAVE_STAFF_NAME_FIELD_ID",
  "LEAVE_TYPE_FIELD_ID",
  "LEAVE_DATE_FIELD_ID",
  "LEAVE_IMPORT_KEY_FIELD_ID",
];
const saved: Record<string, string | undefined> = {};

function row(id: number, name: string, type: string, date: string): AtPocketRecordRow {
  return {
    id,
    record: {
      "field-1": name,
      "field-2": type,
      "field-3": String(id),
      "field-4": date,
    },
  } as unknown as AtPocketRecordRow;
}

/** 非同期関数の中で取得が始まるまで待つ */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

/** いちばん新しい取得を rows で終わらせて、結果を返す */
async function answer<T>(p: Promise<T>, rows: unknown[]): Promise<T> {
  await flush();
  const last = h.pending.at(-1);
  expect(last).toBeDefined();
  last!.resolve(rows);
  return p;
}

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  // 設定されているキーは1本だけ（0番）
  process.env.LEAVE_APP_ID = "199";
  process.env.LEAVE_ATPOCKET_API_KEY = "key-0";
  h.pending.length = 0;
  h.fields = FIELDS;
  h.fieldsError = null;
  h.rateLimited = false;
  invalidateLeaveCache();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

describe("★ 環境変数が未設定なら無効として扱う", () => {
  it("★ LEAVE_APP_ID が無ければ無効", () => {
    delete process.env.LEAVE_APP_ID;
    expect(resolveLeaveConfig().enabled).toBe(false);
  });

  it("★ LEAVE_ATPOCKET_API_KEY が無ければ無効", () => {
    delete process.env.LEAVE_ATPOCKET_API_KEY;
    expect(resolveLeaveConfig().enabled).toBe(false);
  });

  it("★ キーが0番の1本だけでも有効（_1・_2 は要らない）", () => {
    const cfg = resolveLeaveConfig();
    expect(cfg.enabled).toBe(true);
  });

  it("★ 無効のときはエラーにせず disabled を返し、@pocket を呼ばない", async () => {
    delete process.env.LEAVE_APP_ID;
    const res = await fetchLeaveMonth(2026, 10);
    expect(res.status).toBe("disabled");
    expect(h.pending.length).toBe(0);
  });
});

describe("★ 列が解決できる", () => {
  it("★ 見出しから4列を解決する", () => {
    expect(resolveLeaveFieldIds(FIELDS)).toEqual({
      staffName: "field-1",
      leaveType: "field-2",
      importKey: "field-3",
      leaveDate: "field-4",
    });
  });

  it("★ 環境変数があればそちらを使う", () => {
    const fields: AtPocketFieldRow[] = [
      { uniqueId: "field-11", caption: "名前", fieldType: "Text" },
      { uniqueId: "field-12", caption: "種別", fieldType: "Text" },
      { uniqueId: "field-13", caption: "番号", fieldType: "AutoNumber" },
      { uniqueId: "field-14", caption: "日", fieldType: "Date" },
    ];
    process.env.LEAVE_STAFF_NAME_FIELD_ID = "field-11";
    process.env.LEAVE_TYPE_FIELD_ID = "field-12";
    process.env.LEAVE_IMPORT_KEY_FIELD_ID = "field-13";
    process.env.LEAVE_DATE_FIELD_ID = "field-14";
    expect(resolveLeaveFieldIds(fields)).toEqual({
      staffName: "field-11",
      leaveType: "field-12",
      importKey: "field-13",
      leaveDate: "field-14",
    });
  });

  it("★ 従業員名・休暇予定日が解決できなければ失敗として返す（無効ではない）", async () => {
    h.fields = FIELDS.filter((f) => f.uniqueId !== "field-4");
    const res = await fetchLeaveMonth(2026, 10);
    expect(res.status).toBe("error");
    expect(h.pending.length).toBe(0);
  });
});

describe("★ 月ごとのキャッシュ", () => {
  it("★ その月の休みを全員分返す", async () => {
    const res = await answer(fetchLeaveMonth(2026, 10), [
      row(1, "社員A", "有給", "2026/10/05"),
      row(2, "社員B", "特休", "2026/10/20"),
    ]);
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.entries).toEqual([
      { recordId: "1", staffName: "社員A", leaveType: "有給", date: "2026-10-05" },
      { recordId: "2", staffName: "社員B", leaveType: "特休", date: "2026-10-20" },
    ]);
  });

  it("★ 2回目は @pocket を呼ばずキャッシュから返す", async () => {
    await answer(fetchLeaveMonth(2026, 10), [row(1, "社員A", "有給", "2026/10/05")]);
    const second = await fetchLeaveMonth(2026, 10);
    expect(second.status).toBe("ok");
    expect(h.pending.length).toBe(1);
  });

  it("★ TTL（5分）を過ぎたら取り直す", async () => {
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(1_000_000);
    await answer(fetchLeaveMonth(2026, 10), []);
    now.mockReturnValue(1_000_000 + 299_000);
    await fetchLeaveMonth(2026, 10);
    expect(h.pending.length).toBe(1);
    now.mockReturnValue(1_000_000 + 301_000);
    await answer(fetchLeaveMonth(2026, 10), []);
    expect(h.pending.length).toBe(2);
  });

  it("★ 月の外の行は（query が効かなくても）結果に入れない", async () => {
    const res = await answer(fetchLeaveMonth(2026, 10), [
      row(1, "社員A", "有給", "2026/10/31"),
      row(2, "社員A", "有給", "2026/11/01"),
      row(3, "社員A", "有給", "2026/09/30"),
    ]);
    expect(res.status === "ok" && res.entries.map((e) => e.date)).toEqual([
      "2026-10-31",
    ]);
  });

  it("問い合わせは休暇予定日の月内で絞る", async () => {
    await answer(fetchLeaveMonth(2026, 2), []);
    expect(h.pending[0]!.query).toBe(
      'field-4 >= "2026-02-01" and field-4 <= "2026-02-28"',
    );
  });
});

describe("★ キーは年月だけ（利用者ごとに分かれない）", () => {
  it("★ キャッシュのキーは年月だけでできている", () => {
    expect(leaveMonthCacheKey(2026, 1)).toBe("2026-01");
    expect(leaveMonthCacheKey(2026, 12)).toBe("2026-12");
  });

  it("★ 取得の関数は利用者を受け取らない", () => {
    // 年と月だけ。氏名や LINE の ID を受け取ると、人数分のキャッシュになる
    expect(fetchLeaveMonth.length).toBe(2);
  });

  it("★ 何人が続けて開いても @pocket への問い合わせは月に1回", async () => {
    await answer(fetchLeaveMonth(2026, 10), [row(1, "社員A", "有給", "2026/10/05")]);
    for (let i = 0; i < 20; i++) await fetchLeaveMonth(2026, 10);
    expect(h.pending.length).toBe(1);
  });
});

describe("★ 取得中の共有", () => {
  it("★ 同じ月の同時要求は1回の取得にまとまる", async () => {
    const a = fetchLeaveMonth(2026, 10);
    const b = fetchLeaveMonth(2026, 10);
    const c = fetchLeaveMonth(2026, 10);
    await flush();
    expect(h.pending.length).toBe(1);
    h.pending[0]!.resolve([row(1, "社員A", "有給", "2026/10/05")]);
    const [ra, rb, rc] = await Promise.all([a, b, c]);
    expect(ra).toEqual(rb);
    expect(rb).toEqual(rc);
  });

  it("★ 違う月の同時要求は別々に取得し、それぞれ自分の月を受け取る", async () => {
    const oct = fetchLeaveMonth(2026, 10);
    const nov = fetchLeaveMonth(2026, 11);
    await flush();
    expect(h.pending.length).toBe(2);
    // 後から始まった11月を先に終わらせても取り違えない
    const pNov = h.pending.find((p) => p.query?.includes("2026-11-01"))!;
    const pOct = h.pending.find((p) => p.query?.includes("2026-10-01"))!;
    pNov.resolve([row(2, "社員B", "有給", "2026/11/03")]);
    pOct.resolve([row(1, "社員A", "有給", "2026/10/05")]);
    const [ro, rn] = await Promise.all([oct, nov]);
    expect(ro.status === "ok" && ro.entries.map((e) => e.date)).toEqual(["2026-10-05"]);
    expect(rn.status === "ok" && rn.entries.map((e) => e.date)).toEqual(["2026-11-03"]);
  });
});

describe("★ invalidate", () => {
  it("★ invalidate するとキャッシュが消えて取り直す", async () => {
    await answer(fetchLeaveMonth(2026, 10), []);
    invalidateLeaveCache();
    await answer(fetchLeaveMonth(2026, 10), []);
    expect(h.pending.length).toBe(2);
  });

  it("月を指定すると、その月だけ消える", async () => {
    await answer(fetchLeaveMonth(2026, 10), []);
    await answer(fetchLeaveMonth(2026, 11), []);
    invalidateLeaveCache(2026, 10);
    await fetchLeaveMonth(2026, 11);
    expect(h.pending.length).toBe(2);
    await answer(fetchLeaveMonth(2026, 10), []);
    expect(h.pending.length).toBe(3);
  });
});

describe("★ 取得に失敗したら、空ではなく失敗として返す", () => {
  it("★ 一覧の取得が失敗したら status は error（entries を持たない）", async () => {
    const p = fetchLeaveMonth(2026, 10);
    await flush();
    h.pending[0]!.reject(new Error("@pocket 500"));
    const res = await p;
    expect(res.status).toBe("error");
    expect("entries" in res).toBe(false);
  });

  it("★ 429 なら rateLimited が立つ", async () => {
    h.rateLimited = true;
    const p = fetchLeaveMonth(2026, 10);
    await flush();
    h.pending[0]!.reject(new Error("429"));
    const res = await p;
    expect(res.status === "error" && res.rateLimited).toBe(true);
  });

  it("★ 列定義の取得が失敗しても error", async () => {
    h.fieldsError = new Error("fields failed");
    const res = await fetchLeaveMonth(2026, 10);
    expect(res.status).toBe("error");
  });

  it("★ 失敗はキャッシュしない（次は取り直す）", async () => {
    const p = fetchLeaveMonth(2026, 10);
    await flush();
    h.pending[0]!.reject(new Error("@pocket 500"));
    await p;
    await answer(fetchLeaveMonth(2026, 10), []);
    expect(h.pending.length).toBe(2);
  });

  it("★ ページの上限に届いたら（取り切れていないので）error", async () => {
    const many = Array.from({ length: 3000 }, (_, i) =>
      row(i + 1, "社員A", "有給", "2026/10/05"),
    );
    const res = await answer(fetchLeaveMonth(2026, 10), many);
    expect(res.status).toBe("error");
  });

  it("★ ログに氏名を出さない", async () => {
    const logs: string[] = [];
    const capture = (...args: unknown[]) => {
      logs.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    };
    vi.spyOn(console, "info").mockImplementation(capture);
    vi.spyOn(console, "warn").mockImplementation(capture);
    vi.spyOn(console, "error").mockImplementation(capture);
    await answer(fetchLeaveMonth(2026, 10), [row(1, "社員A", "有給", "2026/10/05")]);
    const p = fetchLeaveMonth(2026, 11);
    await flush();
    h.pending.at(-1)!.reject(new Error("@pocket 500"));
    await p;
    expect(logs.join("\n")).not.toContain("社員A");
  });
});
