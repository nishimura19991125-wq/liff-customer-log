import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 休みの登録（休暇・段階4）。
 *
 * 休暇アプリ（199）への読み取り・作成を数え、作成の失敗を日付ごとに起こせる
 * ようにしてある。429 の入れ直しの待ちはテストでは 0 にする。
 */

const h = vi.hoisted(() => ({
  bound: new Map<string, string>(),
  existingRows: [] as unknown[],
  readFail: null as unknown,
  reads: [] as Array<{ query: string | null; apiKey: string | undefined }>,
  creates: [] as Array<{ payload: Record<string, unknown>; apiKey: string | undefined }>,
  /** 作成を失敗させる日付（@pocket 形式 YYYY/MM/DD）→ 失敗の回数と status */
  createFail: new Map<string, { times: number; status: number }>(),
  deletes: 0,
  updates: 0,
}));

const LEAVE_FIELDS = [
  { uniqueId: "field-1", caption: "従業員名", fieldType: "Text" },
  { uniqueId: "field-2", caption: "休暇種別", fieldType: "Text" },
  { uniqueId: "field-3", caption: "kyukaID", fieldType: "AutoNumber", primaryKey: true },
  { uniqueId: "field-4", caption: "休暇予定日", fieldType: "Date" },
];

vi.mock("@/lib/atpocket", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/atpocket")>();
  return {
    ...actual,
    fetchAppFields: async () => LEAVE_FIELDS,
    fetchAllRecordsPages: async (
      _appId: string,
      _csv: string,
      auth: { apiKey?: string } | undefined,
      query: string | null,
    ) => {
      h.reads.push({ query, apiKey: auth?.apiKey });
      if (h.readFail) throw h.readFail;
      return h.existingRows;
    },
    createRecord: async (
      _appId: string,
      payload: Record<string, unknown>,
      auth: { apiKey?: string } | undefined,
    ) => {
      const date = String(payload["field-4"]);
      const fail = h.createFail.get(date);
      if (fail && fail.times > 0) {
        fail.times--;
        const e = new Error(
          `@pocket create record failed: ${fail.status} appsId=199 operation=leave:作成 env=LEAVE_ATPOCKET_API_KEY`,
        ) as Error & { status: number };
        e.status = fail.status;
        throw e;
      }
      h.creates.push({ payload, apiKey: auth?.apiKey });
      return { row: { recordId: 1000 + h.creates.length } };
    },
    deleteRecord: async () => {
      h.deletes++;
    },
    updateRecord: async () => {
      h.updates++;
    },
  };
});

vi.mock("@/lib/staff-bound-lookup", () => ({
  resolveBoundStaffNameForLineUser: async (lineUserId: string) =>
    h.bound.get(lineUserId) ?? null,
}));

vi.mock("@/lib/request-auth", () => ({
  resolveCallerLineAuth: async (req: Request) => {
    const id = req.headers.get("x-test-user");
    return id ? { ok: true, lineUserId: id } : { ok: false, status: 401 };
  },
  lineAuthUnauthorizedResponse: () =>
    new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
}));

const invalidated: Array<[number | undefined, number | undefined]> = [];
vi.mock("@/lib/leave-server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/leave-server")>();
  return {
    ...actual,
    invalidateLeaveCache: (year?: number, month?: number) => {
      invalidated.push([year, month]);
      actual.invalidateLeaveCache(year, month);
    },
  };
});

const {
  registerLeavesForLineUser,
  leaveRegistrationWindow,
  validateLeaveDates,
  LEAVE_TYPE_FIXED,
} = await import("@/lib/leave-register-server");
const { POST } = await import("@/app/api/attendance/leave/route");

const ME = "社員A";
/** JST 2026-10-27(火) 14:00 → 登録できるのは 11/2(月)〜11/15(日) */
const NOW = new Date("2026-10-27T05:00:00Z");
const noWait = { now: NOW, sleep: async () => {} };

function existing(name: string, date: string) {
  return {
    recordId: 1,
    record: { "field-1": name, "field-2": "休み", "field-3": "1", "field-4": date },
  };
}

beforeEach(() => {
  process.env.LEAVE_APP_ID = "199";
  process.env.LEAVE_ATPOCKET_API_KEY = "leave-key";
  process.env.API_ERROR_DETAIL = "0";
  delete process.env.LEAVE_ATPOCKET_API_KEY_1;
  delete process.env.LEAVE_ATPOCKET_API_KEY_2;
  h.bound = new Map([["U-me", ME]]);
  h.existingRows = [];
  h.readFail = null;
  h.reads = [];
  h.creates = [];
  h.createFail = new Map();
  h.deletes = 0;
  h.updates = 0;
  invalidated.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("★ 何を書くか", () => {
  it("★ 従業員名はサーバ側（名簿の紐付け）で決まる", async () => {
    const res = await registerLeavesForLineUser("U-me", ["2026-11-02"], noWait);
    expect(res.ok).toBe(true);
    expect(h.creates[0]!.payload["field-1"]).toBe(ME);
  });

  it("★ 画面から氏名を送っても使わない（受け取るのは日付だけ）", async () => {
    const req = new Request("http://x/api/attendance/leave", {
      method: "POST",
      headers: { "x-test-user": "U-me", "content-type": "application/json" },
      body: JSON.stringify({ dates: ["2026-11-02"], staffName: "社員Z" }),
    });
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    try {
      const res = await POST(req);
      expect(res.status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
    expect(h.creates[0]!.payload["field-1"]).toBe(ME);
  });

  it("★ 休暇種別は「休み」固定", async () => {
    await registerLeavesForLineUser("U-me", ["2026-11-02"], noWait);
    expect(LEAVE_TYPE_FIXED).toBe("休み");
    expect(h.creates[0]!.payload["field-2"]).toBe("休み");
  });

  it("★ 取込キー（kyukaID）に空文字が載る", async () => {
    await registerLeavesForLineUser("U-me", ["2026-11-02"], noWait);
    expect(h.creates[0]!.payload["field-3"]).toBe("");
  });

  it("休暇予定日は @pocket の日付形式で書く", async () => {
    await registerLeavesForLineUser("U-me", ["2026-11-02"], noWait);
    expect(h.creates[0]!.payload["field-4"]).toBe("2026/11/02");
  });

  it("★ キーは LEAVE_ATPOCKET_API_KEY の1本で、読み取りにも書き込みにも使う", async () => {
    await registerLeavesForLineUser("U-me", ["2026-11-02"], noWait);
    expect(h.reads[0]!.apiKey).toBe("leave-key");
    expect(h.creates[0]!.apiKey).toBe("leave-key");
  });

  it("★ 紐付けが無ければエラーで、何も書かない", async () => {
    const res = await registerLeavesForLineUser("U-none", ["2026-11-02"], noWait);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(403);
    expect(h.creates).toHaveLength(0);
  });

  it("休暇アプリが未設定なら 503 で、何も読まない", async () => {
    delete process.env.LEAVE_APP_ID;
    const res = await registerLeavesForLineUser("U-me", ["2026-11-02"], noWait);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(503);
    expect(h.reads).toHaveLength(0);
  });
});

describe("★ 先に読んで、登録済みの日は飛ばす", () => {
  it("★ その場で1回読む（期間で絞る）", async () => {
    await registerLeavesForLineUser("U-me", ["2026-11-02", "2026-11-05"], noWait);
    expect(h.reads).toHaveLength(1);
    // 週2日の制限で登録済みの日を数えるため、選んだ日を含む週の月曜〜日曜を読む
    expect(h.reads[0]!.query).toBe(
      'field-4 >= "2026-11-02" and field-4 <= "2026-11-08"',
    );
  });

  it("★ 2回続けて登録しても、2回とも読む（キャッシュを使わない）", async () => {
    await registerLeavesForLineUser("U-me", ["2026-11-02"], noWait);
    await registerLeavesForLineUser("U-me", ["2026-11-03"], noWait);
    expect(h.reads).toHaveLength(2);
  });

  it("★ 登録済みの日は作らず、alreadyRegistered に入る", async () => {
    h.existingRows = [existing(ME, "2026/11/02")];
    const res = await registerLeavesForLineUser(
      "U-me",
      ["2026-11-02", "2026-11-03"],
      noWait,
    );
    expect(h.creates.map((c) => c.payload["field-4"])).toEqual(["2026/11/03"]);
    expect(res.ok && res.alreadyRegistered).toEqual(["2026-11-02"]);
    expect(res.ok && res.created).toEqual(["2026-11-03"]);
  });

  it("★ 氏名の空白・全角半角の違いがあっても登録済みと分かる", async () => {
    h.existingRows = [existing(` 社員Ａ　`, "2026/11/02")];
    await registerLeavesForLineUser("U-me", ["2026-11-02"], noWait);
    expect(h.creates).toHaveLength(0);
  });

  it("★ 他人の休みは登録済みに数えない", async () => {
    h.existingRows = [existing("社員B", "2026/11/02")];
    await registerLeavesForLineUser("U-me", ["2026-11-02"], noWait);
    expect(h.creates).toHaveLength(1);
  });

  it("★ 読み取りが失敗したら1件も書かない", async () => {
    h.readFail = new Error("@pocket 500 appsId=199");
    const res = await registerLeavesForLineUser("U-me", ["2026-11-02"], noWait);
    expect(res.ok).toBe(false);
    expect(h.creates).toHaveLength(0);
  });
});

describe("★ 途中で失敗したとき", () => {
  it("★ 登録できた日・失敗した日・試していない日に分かれて返る", async () => {
    h.createFail.set("2026/11/03", { times: 9, status: 500 });
    // 週2日の制限の内側（第1週 11/2・11/3、第2週 11/9・11/10）
    const res = await registerLeavesForLineUser(
      "U-me",
      ["2026-11-02", "2026-11-03", "2026-11-09", "2026-11-10"],
      noWait,
    );
    expect(res.ok).toBe(false);
    if (res.ok || !("created" in res)) throw new Error("breakdown expected");
    expect(res.created).toEqual(["2026-11-02"]);
    expect(res.failed).toBe("2026-11-03");
    expect(res.notAttempted).toEqual(["2026-11-09", "2026-11-10"]);
    expect(res.correlationId).toMatch(/^[0-9a-f]{8}$/);
  });

  it("★ 失敗しても自動で消さない（削除も更新も呼ばない）", async () => {
    h.createFail.set("2026/11/03", { times: 9, status: 500 });
    await registerLeavesForLineUser("U-me", ["2026-11-02", "2026-11-03"], noWait);
    expect(h.deletes).toBe(0);
    expect(h.updates).toBe(0);
    expect(h.creates).toHaveLength(1);
  });

  it("★ 429 は1回だけ入れ直し、通れば登録できる", async () => {
    h.createFail.set("2026/11/02", { times: 1, status: 429 });
    const res = await registerLeavesForLineUser("U-me", ["2026-11-02"], noWait);
    expect(res.ok && res.created).toEqual(["2026-11-02"]);
  });

  it("★ 429 が2回続いたらそこで止める", async () => {
    h.createFail.set("2026/11/02", { times: 2, status: 429 });
    const res = await registerLeavesForLineUser(
      "U-me",
      ["2026-11-02", "2026-11-03"],
      noWait,
    );
    expect(res.ok).toBe(false);
    if (res.ok || !("created" in res)) throw new Error("breakdown expected");
    expect(res.status).toBe(429);
    expect(res.failed).toBe("2026-11-02");
    expect(res.notAttempted).toEqual(["2026-11-03"]);
    expect(h.creates).toHaveLength(0);
  });

  it("★ 429 以外は入れ直さない", async () => {
    h.createFail.set("2026/11/02", { times: 1, status: 500 });
    const res = await registerLeavesForLineUser("U-me", ["2026-11-02"], noWait);
    expect(res.ok).toBe(false);
    expect(h.creates).toHaveLength(0);
  });

  it("★ やり直すと、登録済みの日は飛ばして残りだけ作る", async () => {
    h.createFail.set("2026/11/03", { times: 1, status: 500 });
    await registerLeavesForLineUser("U-me", ["2026-11-02", "2026-11-03"], noWait);
    // 1回目で 11/02 が入った状態を @pocket 側に再現する
    h.existingRows = [existing(ME, "2026/11/02")];
    const res = await registerLeavesForLineUser(
      "U-me",
      ["2026-11-02", "2026-11-03"],
      noWait,
    );
    expect(res.ok && res.created).toEqual(["2026-11-03"]);
    expect(h.creates.map((c) => c.payload["field-4"])).toEqual([
      "2026/11/02",
      "2026/11/03",
    ]);
  });
});

describe("★ 入力の検証", () => {
  it("★ 登録できる期間は JST の来週月曜から2週間", () => {
    expect(leaveRegistrationWindow(NOW)).toEqual({
      start: "2026-11-02",
      end: "2026-11-15",
    });
  });

  it("★ 今日が月曜なら翌週の月曜から", () => {
    // JST 2026-11-02(月) 10:00
    expect(leaveRegistrationWindow(new Date("2026-11-02T01:00:00Z"))).toEqual({
      start: "2026-11-09",
      end: "2026-11-22",
    });
  });

  it("★ 今日が日曜なら翌日の月曜から", () => {
    // JST 2026-11-01(日) 10:00
    expect(leaveRegistrationWindow(new Date("2026-11-01T01:00:00Z"))).toEqual({
      start: "2026-11-02",
      end: "2026-11-15",
    });
  });

  it("★ JST で判定する（UTC ではまだ日曜でも、JST で月曜なら翌週から）", () => {
    // UTC 2026-11-01(日) 15:30 = JST 2026-11-02(月) 00:30
    const now = new Date("2026-11-01T15:30:00Z");
    expect(leaveRegistrationWindow(now).start).toBe("2026-11-09");
    expect(validateLeaveDates(["2026-11-02"], now).ok).toBe(false);
    expect(validateLeaveDates(["2026-11-22"], now).ok).toBe(true);
  });

  it("★ 過去の日付は弾く", () => {
    expect(validateLeaveDates(["2026-10-20"], NOW).ok).toBe(false);
  });

  it("★ 今週（来週の月曜より前）の日付は弾く", () => {
    expect(validateLeaveDates(["2026-11-01"], NOW).ok).toBe(false);
  });

  it("★ 2週間より先は弾く", () => {
    expect(validateLeaveDates(["2026-11-15"], NOW).ok).toBe(true);
    expect(validateLeaveDates(["2026-11-16"], NOW).ok).toBe(false);
  });

  it("★ 1回の上限（14日）を超えたら弾く", () => {
    const fourteen = Array.from(
      { length: 14 },
      (_, i) => `2026-11-${String(i + 2).padStart(2, "0")}`,
    );
    expect(validateLeaveDates(fourteen, NOW).ok).toBe(true);
    expect(validateLeaveDates([...fourteen, "2026-11-16"], NOW).ok).toBe(false);
  });

  it("★ 重複した日付は弾く", () => {
    expect(validateLeaveDates(["2026-11-02", "2026-11-02"], NOW).ok).toBe(false);
  });

  it("★ 形式が不正なら弾く", () => {
    for (const bad of ["2026/11/02", "2026-11-2", "20261102", "2026-02-30", "", 20261102]) {
      expect(validateLeaveDates([bad], NOW).ok).toBe(false);
    }
    expect(validateLeaveDates("2026-11-02", NOW).ok).toBe(false);
    expect(validateLeaveDates([], NOW).ok).toBe(false);
  });

  it("★ 検証で弾いたら @pocket を呼ばない", async () => {
    const res = await registerLeavesForLineUser("U-me", ["2026-10-20"], noWait);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(400);
    expect(h.reads).toHaveLength(0);
    expect(h.creates).toHaveLength(0);
  });

  it("日付は昇順に並べ替えて作る", async () => {
    await registerLeavesForLineUser("U-me", ["2026-11-05", "2026-11-02"], noWait);
    expect(h.creates.map((c) => c.payload["field-4"])).toEqual([
      "2026/11/02",
      "2026/11/05",
    ]);
  });
});

describe("★ 登録後にキャッシュを捨てる", () => {
  it("★ 登録した月のキャッシュを捨てる", async () => {
    await registerLeavesForLineUser("U-me", ["2026-11-02"], noWait);
    expect(invalidated).toEqual([[2026, 11]]);
  });

  it("★ 月をまたぐときは両方の月を捨てる", async () => {
    // JST 2026-10-20(火) → 10/26(月)〜11/8(日)
    const now = new Date("2026-10-20T05:00:00Z");
    await registerLeavesForLineUser("U-me", ["2026-10-30", "2026-11-02"], {
      now,
      sleep: async () => {},
    });
    expect(invalidated).toEqual(
      expect.arrayContaining([
        [2026, 10],
        [2026, 11],
      ]),
    );
    expect(invalidated).toHaveLength(2);
  });

  it("★ 途中で失敗しても、書きにいった月は捨てる", async () => {
    h.createFail.set("2026/11/02", { times: 9, status: 500 });
    await registerLeavesForLineUser("U-me", ["2026-11-02"], noWait);
    expect(invalidated).toEqual([[2026, 11]]);
  });
});

describe("★ 応答に内部の情報を出さない", () => {
  async function post(body: unknown) {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    try {
      const res = await POST(
        new Request("http://x/api/attendance/leave", {
          method: "POST",
          headers: { "x-test-user": "U-me", "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
      return { status: res.status, text: await res.text() };
    } finally {
      vi.useRealTimers();
    }
  }

  it("★ 書き込みが失敗しても appsId・operation・環境変数名が応答に出ない", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.createFail.set("2026/11/02", { times: 9, status: 500 });
    const { status, text } = await post({ dates: ["2026-11-02"] });
    expect(status).toBe(502);
    expect(text).not.toContain("appsId");
    expect(text).not.toContain("operation");
    expect(text).not.toContain("LEAVE_");
    expect(text).not.toContain("199");
    expect(JSON.parse(text).correlationId).toMatch(/^[0-9a-f]{8}$/);
  });

  it("★ 読み取りが失敗しても出ない", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.readFail = new Error("@pocket 500 appsId=199 operation=leave:登録前 LEAVE_ATPOCKET_API_KEY");
    const { text } = await post({ dates: ["2026-11-02"] });
    expect(text).not.toContain("appsId");
    expect(text).not.toContain("operation");
    expect(text).not.toContain("LEAVE_");
  });

  it("★ 応答とログに氏名を出さない", async () => {
    const logs: string[] = [];
    const cap = (...a: unknown[]) => logs.push(a.map(String).join(" "));
    vi.spyOn(console, "info").mockImplementation(cap);
    vi.spyOn(console, "warn").mockImplementation(cap);
    vi.spyOn(console, "error").mockImplementation(cap);
    h.createFail.set("2026/11/03", { times: 1, status: 429 });
    const { text } = await post({ dates: ["2026-11-02", "2026-11-03"] });
    expect(text).not.toContain(ME);
    expect(logs.join("\n")).not.toContain(ME);
  });

  it("JSON が不正なら 400", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    try {
      const res = await POST(
        new Request("http://x/api/attendance/leave", {
          method: "POST",
          headers: { "x-test-user": "U-me" },
          body: "{",
        }),
      );
      expect(res.status).toBe(400);
    } finally {
      vi.useRealTimers();
    }
  });

  it("LINE 認証が無ければ 401", async () => {
    const res = await POST(
      new Request("http://x/api/attendance/leave", {
        method: "POST",
        body: JSON.stringify({ dates: ["2026-11-02"] }),
      }),
    );
    expect(res.status).toBe(401);
  });
});

describe("★ 週2日までの制限（サーバ側）", () => {
  it("★ 1つの週に3日を送ったら全部拒否し、1日も登録しない", async () => {
    const res = await registerLeavesForLineUser(
      "U-me",
      ["2026-11-02", "2026-11-03", "2026-11-04"],
      noWait,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(400);
    expect(h.creates).toHaveLength(0);
  });

  it("★ 登録済みを含めて3日以上になる登録は全部拒否する", async () => {
    h.existingRows = [existing(ME, "2026/11/07")];
    const res = await registerLeavesForLineUser(
      "U-me",
      ["2026-11-02", "2026-11-03"],
      noWait,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(400);
    expect(h.creates).toHaveLength(0);
  });

  it("★ 拒否の文言で、どの週が超えているか分かる", async () => {
    h.existingRows = [existing(ME, "2026/11/10")];
    const res = await registerLeavesForLineUser(
      "U-me",
      ["2026-11-02", "2026-11-09", "2026-11-11"],
      noWait,
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("第2週");
    expect(res.error).toContain("11/9(月)〜11/15(日)");
    expect(res.error).not.toContain("第1週");
  });

  it("★ 2日ちょうどは登録できる", async () => {
    const res = await registerLeavesForLineUser(
      "U-me",
      ["2026-11-02", "2026-11-03"],
      noWait,
    );
    expect(res.ok && res.created).toEqual(["2026-11-02", "2026-11-03"]);
  });

  it("★ 登録済み1日＋新しく1日の2日ちょうども登録できる", async () => {
    h.existingRows = [existing(ME, "2026/11/07")];
    const res = await registerLeavesForLineUser("U-me", ["2026-11-02"], noWait);
    expect(res.ok && res.created).toEqual(["2026-11-02"]);
  });

  it("★ 登録済みの日をもう一度送っても二重に数えない", async () => {
    h.existingRows = [existing(ME, "2026/11/02")];
    const res = await registerLeavesForLineUser(
      "U-me",
      ["2026-11-02", "2026-11-03"],
      noWait,
    );
    expect(res.ok && res.created).toEqual(["2026-11-03"]);
  });

  it("★ 第1週と第2週は別々に数える（2日＋2日は登録できる）", async () => {
    const res = await registerLeavesForLineUser(
      "U-me",
      ["2026-11-02", "2026-11-03", "2026-11-09", "2026-11-10"],
      noWait,
    );
    expect(res.ok && res.created).toHaveLength(4);
  });

  it("★ 他人の登録済みは数えない", async () => {
    h.existingRows = [existing("社員B", "2026/11/04"), existing("社員B", "2026/11/05")];
    const res = await registerLeavesForLineUser(
      "U-me",
      ["2026-11-02", "2026-11-03"],
      noWait,
    );
    expect(res.ok).toBe(true);
  });
});

describe("★ 休暇種別で分ける（サーバ側）", () => {
  function existingT(name: string, date: string, type: string, recordId = 1) {
    return {
      recordId,
      record: { "field-1": name, "field-2": type, "field-3": String(recordId), "field-4": date },
    };
  }

  it("★ 「休み」以外が入っている日を含む送信は全体を拒否し、1日も書かない", async () => {
    h.existingRows = [existingT(ME, "2026/11/05", "有給")];
    const res = await registerLeavesForLineUser(
      "U-me",
      ["2026-11-02", "2026-11-05"],
      noWait,
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);
    expect(res.error).toContain("11/5(木)");
    expect(res.error).toContain("有給");
    expect(h.creates).toHaveLength(0);
  });

  it("★ 忌引き・欠勤・知らない種別も同じく拒否する", async () => {
    for (const type of ["忌引き", "欠勤", "特別休暇"]) {
      h.existingRows = [existingT(ME, "2026/11/05", type)];
      h.creates = [];
      const res = await registerLeavesForLineUser("U-me", ["2026-11-05"], noWait);
      expect(res.ok).toBe(false);
      expect(h.creates).toHaveLength(0);
    }
  });

  it("★ 同じ日に「休み」と「有給」があれば有給として扱い、拒否する", async () => {
    h.existingRows = [
      existingT(ME, "2026/11/05", "休み", 1),
      existingT(ME, "2026/11/05", "有給", 2),
    ];
    const res = await registerLeavesForLineUser("U-me", ["2026-11-05"], noWait);
    expect(res.ok).toBe(false);
  });

  it("★ 「休み」が入っている日は従来どおり飛ばす（送り直しても二重にならない）", async () => {
    h.existingRows = [existingT(ME, "2026/11/05", "休み")];
    const res = await registerLeavesForLineUser(
      "U-me",
      ["2026-11-02", "2026-11-05"],
      noWait,
    );
    expect(res.ok && res.alreadyRegistered).toEqual(["2026-11-05"]);
    expect(res.ok && res.created).toEqual(["2026-11-02"]);
  });

  it("★ 他人の有給がある日は拒否しない", async () => {
    h.existingRows = [existingT("社員B", "2026/11/05", "有給")];
    const res = await registerLeavesForLineUser("U-me", ["2026-11-05"], noWait);
    expect(res.ok && res.created).toEqual(["2026-11-05"]);
  });

  it("★ 週2日の制限は「休み」だけを数える（有給2日の週でも休みを2日登録できる）", async () => {
    h.existingRows = [
      existingT(ME, "2026/11/05", "有給", 1),
      existingT(ME, "2026/11/06", "有給", 2),
    ];
    const res = await registerLeavesForLineUser(
      "U-me",
      ["2026-11-02", "2026-11-03"],
      noWait,
    );
    expect(res.ok && res.created).toEqual(["2026-11-02", "2026-11-03"]);
  });

  it("★ 休み1日＋有給1日の週は、休みをあと1日しか登録できない", async () => {
    h.existingRows = [
      existingT(ME, "2026/11/05", "休み", 1),
      existingT(ME, "2026/11/06", "有給", 2),
    ];
    const ok = await registerLeavesForLineUser("U-me", ["2026-11-02"], noWait);
    expect(ok.ok).toBe(true);
    h.existingRows.push(existingT(ME, "2026/11/02", "休み", 3));
    const ng = await registerLeavesForLineUser("U-me", ["2026-11-03"], noWait);
    expect(ng.ok).toBe(false);
  });
});
