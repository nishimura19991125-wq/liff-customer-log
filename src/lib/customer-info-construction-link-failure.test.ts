import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 工事カレンダーへの反映失敗を、失敗地点ごとの文言で伝える。
 *
 * 以前は全地点で「時間をおいて施工予定日を保存し直すか…」の1文を返していた。
 * 同じ T番号 の工事レコードが2件あるときは再試行しても永久に直らないのに
 * 再試行を促しており、実際に二重登録の事故が起きた。
 *
 * ここで固定するのは次の3つ。
 *   - 失敗地点ごとに文言が違うこと
 *   - 再試行で直らない地点の文言が、再試行を促さないこと
 *   - 作成が成功したあとの失敗は、専用の文言で「再登録しない」と伝えること
 *
 * どの条件で failed になるか（判定）は customer-info-construction-link.test.ts
 * が持っている。ここは文言だけを見る。
 */

/** 実物と同じ形（atpocket.ts の formatPocketHttpError の出力） */
const RAW_500 =
  "@pocket list records failed: 500 Internal Server Error | operation=customer-info:施工予定日入力時の工事レコード照合 | appsId=98765 | appsEnv=CALENDAR_APP_ID | apiKey=CALENDAR_ATPOCKET_API_KEY";

const FIELDS = [
  { uniqueId: "field-1", caption: "T番号" },
  { uniqueId: "field-101", caption: "Aki番号" },
  { uniqueId: "field-2", caption: "お客様名" },
  { uniqueId: "field-3", caption: "施工予定日" },
  { uniqueId: "field-4", caption: "施工会社" },
  { uniqueId: "field-5", caption: "住宅ステータス" },
  { uniqueId: "field-6", caption: "工事対応者" },
];

const h = vi.hoisted(() => ({
  fields: [] as { uniqueId: string; caption: string }[],
  fieldsThrows: null as Error | null,
  listRows: [] as unknown[],
  listThrows: null as Error | null,
  writes: [] as { recordId?: string }[],
  writeThrows: null as Error | null,
  /** 作成成功後の後処理（Aki番号 の取得）を落とす */
  ensureThrows: null as Error | null,
}));

vi.mock("@/lib/atpocket", () => ({
  apiKeyForCalendarPocket1: () => "read-key",
  apiKeyForCalendarWrite: () => "write-key",
  fetchAppFields: async () => {
    if (h.fieldsThrows) throw h.fieldsThrows;
    return h.fields;
  },
  fetchRecordsList: async () => {
    if (h.listThrows) throw h.listThrows;
    return { records: h.listRows };
  },
}));

vi.mock("@/lib/atpocket-write-with-import-key", () => ({
  writePocketRecordWithImportKey: async (opts: { recordId?: string }) => {
    if (h.writeThrows) throw h.writeThrows;
    h.writes.push(opts.recordId ? { recordId: opts.recordId } : {});
    return opts.recordId
      ? undefined
      : { recordIdHint: "con-new", row: {}, location: null };
  },
}));

vi.mock("@/lib/calendar-construction-pocket-common", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/calendar-construction-pocket-common")
  >("@/lib/calendar-construction-pocket-common");
  return {
    ...actual,
    ensureConstructionImportKeyOnRecord: async () => {
      if (h.ensureThrows) throw h.ensureThrows;
      return "A0007";
    },
  };
});

vi.mock("@/lib/calendar-response-cache", () => ({
  invalidateAllCalendarPayloadCache: () => {},
}));

vi.mock("@/lib/audit-log", () => ({
  recordAuditLog: async () => ({ ok: true }),
}));

const { linkCustomerInfoToConstruction } = await import(
  "@/lib/customer-info-construction-link"
);

const BASE = {
  tNumber: "T00003420",
  customerName: "山田 太郎",
  housingStatus: "既築案件",
  constructionDate: "2026-12-01",
  contractor: "ピュアライフ",
  constructionHandler: "西村 直也",
  lineUserId: "U1",
};

const row = (id: number) => ({
  recordId: id,
  record: { "field-1": "T00003420" },
});

/**
 * 再試行を促す言い回し。否定形（「繰り返さず」）でも再試行に触れる語は
 * 入れない取り決めなので、語そのものを禁じる
 */
const RETRY_WORDS = [
  "時間をおいて",
  "もう一度",
  "再度",
  "再試行",
  "お試し",
  "やり直",
  "し直",
  "しばらく",
];

type Scenario = "A" | "B" | "C1" | "C2" | "D" | "post-create";

function arrange(scenario: Scenario) {
  switch (scenario) {
    case "A":
      h.fieldsThrows = new Error(RAW_500);
      return;
    case "B":
      // T番号・お客様名・施工予定日の列が無い
      h.fields = [{ uniqueId: "field-4", caption: "施工会社" }];
      return;
    case "C1":
      h.listThrows = new Error(RAW_500);
      return;
    case "C2":
      h.listRows = [row(55), row(56)];
      return;
    case "D":
      h.writeThrows = new Error(RAW_500);
      return;
    case "post-create":
      h.ensureThrows = new Error(RAW_500);
      return;
  }
}

async function failWith(scenario: Scenario) {
  arrange(scenario);
  const res = await linkCustomerInfoToConstruction(BASE);
  if (res.kind !== "failed") {
    throw new Error(`${scenario}: failed になっていません（${res.kind}）`);
  }
  return res;
}

/** 末尾の相関IDを外した本文 */
function body(warning: string): string {
  return warning.replace(/（ID: [0-9a-f]{8}）$/, "");
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  process.env.CALENDAR_APP_ID = "app-con";
  delete process.env.CALENDAR_EMPTY_FILL_CUSTOMER_NAME_FIELD_ID;
  delete process.env.CALENDAR_EMPTY_FILL_TITLE_FIELD_ID;
  h.fields = FIELDS;
  h.fieldsThrows = null;
  h.listRows = [];
  h.listThrows = null;
  h.writes = [];
  h.writeThrows = null;
  h.ensureThrows = null;
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

function loggedText(): string {
  return errorSpy.mock.calls
    .map((c) => c.map((x) => String(x)).join(" "))
    .join("\n");
}

describe("★ 失敗地点ごとに文言が違う", () => {
  it("★ 5つの失敗地点（A・B・C①・C②・D）で文言がすべて異なる", async () => {
    const texts: string[] = [];
    for (const s of ["A", "B", "C1", "C2", "D"] as const) {
      // 前の地点の仕込みを残さない
      h.fields = FIELDS;
      h.fieldsThrows = null;
      h.listRows = [];
      h.listThrows = null;
      h.writeThrows = null;
      texts.push(body((await failWith(s)).warning));
    }

    expect(new Set(texts).size).toBe(5);
  });

  it("A 列定義の取得に失敗: 時間をおいて再試行する案内", async () => {
    const res = await failWith("A");

    expect(res.reason).toBe("fields-fetch-failed");
    expect(res.warning).toContain("工事カレンダーの設定を読み込めず");
    expect(res.warning).toContain("時間をおいてもう一度お試しください");
  });

  it("★ B 列を解決できない: DX事業部への連絡だけを案内する", async () => {
    const res = await failWith("B");

    expect(res.reason).toBe("fields-unresolved");
    expect(res.warning).toContain("工事カレンダーの項目設定に問題があり");
    expect(res.warning).toContain("DX事業部へ連絡してください");
    for (const w of RETRY_WORDS) expect(res.warning, w).not.toContain(w);
  });

  it("C① 照合が例外: 時間をおいて再試行する案内", async () => {
    const res = await failWith("C1");

    expect(res.reason).toBe("lookup-failed");
    expect(res.warning).toContain("工事レコードの照合ができず");
    expect(res.warning).toContain("時間をおいてもう一度お試しください");
  });

  it("★ C② 同じT番号が複数: 再試行を促す表現を含まない", async () => {
    const res = await failWith("C2");

    expect(res.reason).toBe("lookup-ambiguous");
    expect(res.warning).toContain("同じT番号の工事レコードが複数あるため");
    expect(res.warning).toContain("DX事業部へ連絡してください");
    for (const w of RETRY_WORDS) expect(res.warning, w).not.toContain(w);
    expect(h.writes).toHaveLength(0);
  });

  it("D 書き込みに失敗: 時間をおいて再試行する案内", async () => {
    const res = await failWith("D");

    expect(res.reason).toBe("write-failed");
    expect(res.warning).toContain("工事レコードの書き込みに失敗しました");
    expect(res.warning).toContain("時間をおいてもう一度お試しください");
  });

  it("以前の共有文言（保存し直す）はどの地点でも返らない", async () => {
    for (const s of ["A", "B", "C1", "C2", "D", "post-create"] as const) {
      h.fields = FIELDS;
      h.fieldsThrows = null;
      h.listRows = [];
      h.listThrows = null;
      h.writeThrows = null;
      h.ensureThrows = null;
      const res = await failWith(s);
      expect(res.warning, s).not.toContain("保存し直す");
      expect(res.warning, s).not.toContain("お客様情報は保存しましたが");
    }
  });
});

describe("★ 作成が成功したあとの後処理が失敗したとき", () => {
  it("★ 専用の文言で「再度の登録はしない」と伝える", async () => {
    const res = await failWith("post-create");

    expect(res.reason).toBe("post-create-failed");
    expect(res.warning).toContain("工事レコードは作成されましたが");
    expect(res.warning).toContain("再度の登録はせず");
    expect(res.warning).toContain("DX事業部へ連絡してください");
    // 作成そのものは1回成立している
    expect(h.writes).toEqual([{}]);
  });

  it("★ 書き込みの失敗（D）とは文言が違う", async () => {
    const postCreate = body((await failWith("post-create")).warning);
    h.ensureThrows = null;
    const write = body((await failWith("D")).warning);

    expect(postCreate).not.toBe(write);
  });

  it("★ 再試行の案内を含まない", async () => {
    const res = await failWith("post-create");

    for (const w of RETRY_WORDS.filter((x) => x !== "再度")) {
      expect(res.warning, w).not.toContain(w);
    }
    // 「再度」は「再度の登録はせず」の形でだけ出る
    expect(res.warning.split("再度").length - 1).toBe(1);
  });

  it("★ サーバログに作成済みであることが残る", async () => {
    await failWith("post-create");

    expect(loggedText()).toContain("工事レコードは作成済み");
  });

  it("作成していない失敗（D）のログには作成済みと書かない", async () => {
    await failWith("D");

    expect(loggedText()).not.toContain("作成済み");
  });
});
