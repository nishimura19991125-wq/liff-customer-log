import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 工事カレンダー連携が、既存のお客様情報レコードの
 * AP/CL担当者・所属支店・案件作成者を書き換えないことを確認する（修正1／案A）。
 *
 * 以前は「payload に載せてから @pocket を読み直して値があれば消す」方式で
 * 防いでいた。読み直しが空を返すと消し損ねるため、ここでは
 * **@pocket の応答がどうであれ payload に載っていない**ことを見る。
 * 読み直しの結果に依存しないことこそが今回の修正点なので、
 * fetchRecordById は常に空レコードを返すようにしてある。
 */

const h = vi.hoisted(() => ({
  /** findCustomerInfoRecordIdByUniqueKeyCached の戻り */
  cachedId: null as string | null,
  /** refetchCustomerInfoRecordIdByUniqueKey の戻り */
  refetchedId: null as string | null,
  refetchCalls: 0,
  updateCalls: [] as Array<{
    recordId: string;
    payload: Record<string, unknown>;
  }>,
  createCalls: [] as Array<Record<string, unknown>>,
  auditCalls: [] as Array<Record<string, unknown>>,
  /** fetchRecordById が返すレコード。既定は「1列も返らない」状態 */
  fetchedRecord: {} as Record<string, unknown>,
  /** 名簿から引ける勤務場所・所属会社。null で「引けない」を作る */
  workplace: "本社" as string | null,
  company: "トゥルーアーチ" as string | null,
}));

const CUSTOMER_FIELDS = [
  { uniqueId: "field-1", caption: "T番号" },
  { uniqueId: "field-2", caption: "お客様名" },
  { uniqueId: "field-3", caption: "AP担当者" },
  { uniqueId: "field-4", caption: "CL担当者" },
  { uniqueId: "field-5", caption: "AP所属支店" },
  { uniqueId: "field-6", caption: "CL所属支店" },
  { uniqueId: "field-7", caption: "案件作成者" },
  { uniqueId: "field-8", caption: "入力ステータス" },
  { uniqueId: "field-9", caption: "AP所属会社" },
  { uniqueId: "field-10", caption: "CL所属会社" },
];

const CONSTRUCTION_FIELDS = [{ uniqueId: "field-90", caption: "T番号" }];

vi.mock("@/lib/atpocket", () => ({
  apiKeyForCustomerInfoWrite: () => "dummy",
  fetchAppFields: async () => CUSTOMER_FIELDS,
  fetchRecordById: async () => ({ record: h.fetchedRecord }),
  updateRecord: async (
    _appId: string,
    recordId: string,
    payload: Record<string, unknown>,
  ) => {
    h.updateCalls.push({ recordId, payload });
  },
  createRecord: async (_appId: string, payload: Record<string, unknown>) => {
    h.createCalls.push(payload);
    return { row: {}, location: null, recordIdHint: "999", rawBody: null };
  },
}));

vi.mock("@/lib/atpocket-record-id", () => ({
  atPocketRecordIdFromCreateResult: () => "999",
  pollConstructionTNumberByRecordId: async () => null,
  SYNC_TNUMBER_POLL_DELAYS_MS: [],
}));

vi.mock("@/lib/customer-info-key-lookup-cache", () => ({
  findCustomerInfoRecordIdByUniqueKeyCached: async () => h.cachedId,
  refetchCustomerInfoRecordIdByUniqueKey: async () => {
    h.refetchCalls++;
    return h.refetchedId;
  },
}));

vi.mock("@/lib/staff-ap-cl-candidates", () => ({
  defaultApClStaffNamesForLineUser: async () => ({
    apStaff: "操作者太郎",
    clStaff: "操作者太郎",
  }),
}));

vi.mock("@/lib/staff-roster-cache", () => ({
  boundStaffFromRosterRows: () => ({ name: "操作者太郎" }),
  fetchStaffRosterRowsCached: async () => [],
}));

vi.mock("@/lib/staff-workplace-lookup", () => ({
  resolveStaffAssignmentLookupConfig: async () => ({ staffAppId: "1" }),
  // 名簿は所属支店・所属会社をまとめて返す（片方だけ引けない状況も作る）
  lookupStaffAssignmentByStaffName: async () => ({
    workplace: h.workplace,
    company: h.company,
  }),
}));

vi.mock("@/lib/dropbox", () => ({
  dropboxConfigured: () => false,
}));

vi.mock("@/lib/customer-info-dropbox-link", () => ({
  DROPBOX_FOLDER_WARNING: "dropbox-warning",
  ensureCustomerFolderLink: async () => ({ url: null }),
  resolveCustomerInfoDropboxLinkFieldId: () => null,
}));

vi.mock("@/lib/audit-log", () => ({
  auditLogEnabled: () => true,
  recordAuditLog: async (entry: Record<string, unknown>) => {
    h.auditCalls.push(entry);
    return { ok: true, written: 1 };
  },
}));

const { syncConstructionRecordToCustomerInfoApp } = await import(
  "@/lib/sync-construction-to-customer-info"
);

const AP_STAFF = "field-3";
const CL_STAFF = "field-4";
const AP_BRANCH = "field-5";
const CL_BRANCH = "field-6";
const CREATOR = "field-7";
const INPUT_STATUS = "field-8";
const AP_COMPANY = "field-9";
const CL_COMPANY = "field-10";

function runSync() {
  return syncConstructionRecordToCustomerInfoApp({
    calAppId: "12",
    constructionUniqueKey: "T00001691",
    customerName: "山田太郎",
    constructionFields: CONSTRUCTION_FIELDS,
    calendarAuth: { apiKey: "dummy" },
    lineUserId: "U-operator",
  });
}

beforeEach(() => {
  h.cachedId = null;
  h.refetchedId = null;
  h.refetchCalls = 0;
  h.updateCalls = [];
  h.createCalls = [];
  h.auditCalls = [];
  h.fetchedRecord = {};
  h.workplace = "本社";
  h.company = "トゥルーアーチ";

  process.env.CUSTOMER_INFO_APP_ID = "35";
  process.env.CUSTOMER_INFO_CONSTRUCTION_UNIQUE_KEY_FIELD_ID = "field-1";
  process.env.CALENDAR_CONSTRUCTION_UNIQUE_KEY_FIELD_ID = "field-90";
  // 列の解決は見出し一致に任せる（env が残っていると別列を指す）
  delete process.env.CUSTOMER_INFO_CUSTOMER_NAME_FIELD_ID;
  delete process.env.CUSTOMER_INFO_FIELD_AP_STAFF;
  delete process.env.CUSTOMER_INFO_FIELD_CL_STAFF;
  delete process.env.CUSTOMER_INFO_FIELD_AP_BRANCH;
  delete process.env.CUSTOMER_INFO_FIELD_CL_BRANCH;
  delete process.env.CUSTOMER_INFO_FIELD_AP_COMPANY;
  delete process.env.CUSTOMER_INFO_FIELD_CL_COMPANY;
  delete process.env.CUSTOMER_INFO_FIELD_INPUT_STATUS;
  delete process.env.CUSTOMER_INFO_CREATOR_FIELD_ID;
});

describe("修正1: 既存レコードには担当者・支店・作成者を載せない", () => {
  it("★ 既存レコードの更新 payload に AP/CL担当者・所属支店・案件作成者が含まれない", async () => {
    h.cachedId = "1483";

    const result = await runSync();

    expect(result.kind).toBe("synced");
    expect(h.updateCalls).toHaveLength(1);
    const payload = h.updateCalls[0].payload;
    expect(payload).not.toHaveProperty(AP_STAFF);
    expect(payload).not.toHaveProperty(CL_STAFF);
    expect(payload).not.toHaveProperty(AP_BRANCH);
    expect(payload).not.toHaveProperty(CL_BRANCH);
    expect(payload).not.toHaveProperty(AP_COMPANY);
    expect(payload).not.toHaveProperty(CL_COMPANY);
    expect(payload).not.toHaveProperty(CREATOR);
  });

  it("★ @pocket の読み直しが1列も返さなくても書き換えない（旧方式の破綻条件）", async () => {
    h.cachedId = "1483";
    // 旧方式ではここで「現在値が空」と誤判定し、操作者名が通っていた
    h.fetchedRecord = {};

    await runSync();

    const payload = h.updateCalls[0].payload;
    expect(payload).not.toHaveProperty(AP_STAFF);
    expect(payload).not.toHaveProperty(CL_STAFF);
  });

  it("既存レコードで AP/CL担当者が空欄でも操作者の名前を入れない", async () => {
    h.cachedId = "1483";
    h.fetchedRecord = { [AP_STAFF]: "", [CL_STAFF]: "" };

    await runSync();

    const payload = h.updateCalls[0].payload;
    expect(payload).not.toHaveProperty(AP_STAFF);
    expect(payload).not.toHaveProperty(CL_STAFF);
  });

  it("入力ステータスは従来どおり「空欄なら入れる／値があれば触らない」", async () => {
    h.cachedId = "1483";
    h.fetchedRecord = {};
    await runSync();
    expect(h.updateCalls[0].payload).toHaveProperty(INPUT_STATUS);

    h.updateCalls = [];
    h.fetchedRecord = { [INPUT_STATUS]: "入力済" };
    await runSync();
    expect(h.updateCalls[0].payload).not.toHaveProperty(INPUT_STATUS);
  });

  it("新規作成では従来どおり初期値が入る", async () => {
    h.cachedId = null;
    h.refetchedId = null;

    const result = await runSync();

    expect(result.kind).toBe("synced");
    expect(h.updateCalls).toHaveLength(0);
    expect(h.createCalls).toHaveLength(1);
    const payload = h.createCalls[0];
    expect(payload[AP_STAFF]).toBe("操作者太郎");
    expect(payload[CL_STAFF]).toBe("操作者太郎");
    expect(payload[AP_BRANCH]).toBe("本社");
    expect(payload[CL_BRANCH]).toBe("本社");
    expect(payload[AP_COMPANY]).toBe("トゥルーアーチ");
    expect(payload[CL_COMPANY]).toBe("トゥルーアーチ");
    expect(payload[CREATOR]).toBe("操作者太郎");
  });

  it("★ 会社が引けなければ会社だけ書かない（支店は書く）", async () => {
    h.company = null;

    await runSync();

    const payload = h.createCalls[0]!;
    expect(payload[AP_BRANCH]).toBe("本社");
    expect(payload[CL_BRANCH]).toBe("本社");
    expect(payload).not.toHaveProperty(AP_COMPANY);
    expect(payload).not.toHaveProperty(CL_COMPANY);
  });

  it("★ 支店が引けなければ支店だけ書かない（会社は書く）", async () => {
    h.workplace = null;

    await runSync();

    const payload = h.createCalls[0]!;
    expect(payload[AP_COMPANY]).toBe("トゥルーアーチ");
    expect(payload[CL_COMPANY]).toBe("トゥルーアーチ");
    expect(payload).not.toHaveProperty(AP_BRANCH);
    expect(payload).not.toHaveProperty(CL_BRANCH);
  });

  it("★ どちらも引けなければ \"-\" で潰さない", async () => {
    h.workplace = null;
    h.company = null;

    await runSync();

    const payload = h.createCalls[0]!;
    for (const fieldId of [AP_BRANCH, CL_BRANCH, AP_COMPANY, CL_COMPANY]) {
      expect(payload).not.toHaveProperty(fieldId);
    }
    expect(Object.values(payload)).not.toContain("-");
  });
});

describe("修正2: existingId が引けないときはキャッシュを外して引き直す", () => {
  it("★ キャッシュが null を返したらキャッシュ無しで1回引き直す", async () => {
    h.cachedId = null;
    h.refetchedId = "1483";

    await runSync();

    expect(h.refetchCalls).toBe(1);
    // 引き直しで見つかったので新規作成しない（重複レコードを作らない）
    expect(h.createCalls).toHaveLength(0);
    expect(h.updateCalls).toHaveLength(1);
    expect(h.updateCalls[0].recordId).toBe("1483");
  });

  it("引き直しでも見つからなければ新規作成する", async () => {
    h.cachedId = null;
    h.refetchedId = null;

    await runSync();

    expect(h.refetchCalls).toBe(1);
    expect(h.createCalls).toHaveLength(1);
  });

  it("キャッシュで見つかったときは引き直さない", async () => {
    h.cachedId = "1483";

    await runSync();

    expect(h.refetchCalls).toBe(0);
  });
});

describe("修正4: 工事カレンダー連携を監査ログに記録する", () => {
  it("★ 既存更新を「お客様情報アプリ」宛で記録する", async () => {
    h.cachedId = "1483";

    await runSync();

    expect(h.auditCalls).toHaveLength(1);
    const entry = h.auditCalls[0];
    expect(entry.operation).toBe("update");
    expect(entry.targetAppId).toBe("35");
    expect(entry.targetRecordId).toBe("1483");
    expect(entry.targetTNumber).toBe("T00001691");
    expect(entry.lineUserId).toBe("U-operator");
  });

  it("★ 新規作成も記録する", async () => {
    h.cachedId = null;
    h.refetchedId = null;

    await runSync();

    expect(h.auditCalls).toHaveLength(1);
    const entry = h.auditCalls[0];
    expect(entry.operation).toBe("create");
    expect(entry.targetAppId).toBe("35");
    expect(entry.targetRecordId).toBe("999");
  });

  it("新規作成の記録には担当者の変更行が含まれる（経路の判別材料になる）", async () => {
    h.cachedId = null;
    h.refetchedId = null;

    await runSync();

    const changes = h.auditCalls[0].changes as Array<{
      label: string;
      after: string;
    }>;
    const ap = changes.find((c) => c.label === "AP担当者");
    expect(ap?.after).toBe("操作者太郎");
  });
});

/**
 * 引けなかったことをログに残す（put-payload 側と同じ理由・同じ形）。
 * 残すのは取れなかった事実だけで、氏名や引けた値は出さない。
 */
describe("所属を引けなかったときのログ（新規作成）", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  function warned(): string {
    return warnSpy.mock.calls
      .map((c) => c.map((x) => String(x)).join(" "))
      .join(" | ");
  }

  it("★ 会社が引けなければ、どのロールの何が取れなかったかを残す", async () => {
    h.company = null;

    await runSync();

    const logged = warned();
    expect(logged).toContain("担当者の所属を名簿から引けませんでした");
    expect(logged).toContain('"role":"AP"');
    expect(logged).toContain('"role":"CL"');
    expect(logged).toContain('"company"');
    expect(logged).not.toContain('"branch"');
  });

  it("★ 支店が引けなければ支店を残す", async () => {
    h.workplace = null;

    await runSync();

    expect(warned()).toContain('"branch"');
  });

  it("★ 氏名・引けた値をログに含めない", async () => {
    h.company = null;

    await runSync();

    const logged = warned();
    for (const secret of ["操作者太郎", "山田太郎", "本社"]) {
      expect(logged, secret).not.toContain(secret);
    }
  });

  it("★ 両方引けたときは出さない", async () => {
    await runSync();

    expect(warned()).not.toContain("担当者の所属を名簿から引けませんでした");
  });
});
