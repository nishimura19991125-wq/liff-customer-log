import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * キャンセル日（お客様情報・フォームに無い日付列）。
 *
 *   キャンセル以外 → キャンセル   キャンセルした日（JST）を YYYY/MM/DD で書く
 *   キャンセル → キャンセル以外   空にする（それ以外は何もしない）
 *
 * 時刻は固定して見る。実行時の現在時刻には依存させない。
 */

const h = vi.hoisted(() => ({
  updateCalls: [] as Array<Record<string, unknown>>,
  /** 保存前レコードの顧客ステータス */
  beforeCustomerStatus: "工事待ち",
  /** 保存前レコードのキャンセル日 */
  beforeCancelDate: "",
  /** runCustomerCancelSideEffects の呼び出し引数 */
  sideEffectCalls: [] as Array<Record<string, unknown>>,
  /** 後段が工事レコードを削除したと返すか */
  sideEffectDeleted: false,
}));

/** キャンセル日の列（APP_FIELDS に足してある） */
const CANCEL_DATE_FIELD = "field-309";

const APP_FIELDS = [
  { uniqueId: "field-1", caption: "T番号" },
  { uniqueId: "field-2", caption: "お客様名" },
  { uniqueId: "field-3", caption: "AP担当者" },
  { uniqueId: "field-4", caption: "CL担当者" },
  { uniqueId: "field-5", caption: "入力ステータス" },
  { uniqueId: "field-6", caption: "顧客ステータス" },
  { uniqueId: "field-7", caption: "施工予定日" },
  { uniqueId: "field-8", caption: "初回施工予定日" },
  { uniqueId: "field-9", caption: "施工業者" },
  { uniqueId: "field-10", caption: "工事対応者" },
  { uniqueId: "field-11", caption: "APPT" },
  { uniqueId: "field-12", caption: "CLPT" },
  { uniqueId: "field-13", caption: "電話番号" },
  { uniqueId: "field-14", caption: "Aki番号" },
  { uniqueId: CANCEL_DATE_FIELD, caption: "キャンセル日", fieldType: "Date" },
];

vi.mock("@/lib/request-auth", () => ({
  resolveCallerLineAuth: async () => ({ ok: true, lineUserId: "U-test" }),
  lineAuthUnauthorizedResponse: () => new Response(null, { status: 401 }),
}));

vi.mock("@/lib/customer-info-config", () => ({
  customerInfoConfigReady: () => ({
    ok: true,
    appId: "35",
    nameFieldId: "field-2",
  }),
  customerInfoEditableFieldIds: () => [],
  customerInfoPocketAuth: () => ({ apiKey: "dummy" }),
  customerInfoPocketAuth1: () => ({ apiKey: "dummy" }),
  customerInfoPocketAuthWrite: () => ({ apiKey: "dummy" }),
  customerInfoSubtitleFieldId: () => "",
  customerInfoUsesLegacyEditableList: () => false,
  customerInfoImportKeyFieldId: () => "",
  customerInfoImportKeySourceFieldIds: () => [],
  customerInfoNameFieldId: () => "field-2",
  customerInfoAppId: () => "35",
  customerInfoCustomerStatusFieldId: () => "",
}));

vi.mock("@/lib/atpocket", () => ({
  fetchAppFields: async () => APP_FIELDS,
  fetchRecordById: async () => ({
    record: {
      "field-1": "T99990001",
      "field-6": h.beforeCustomerStatus,
      "field-7": "2026-12-01",
      "field-9": "試験施工",
      "field-14": "A9001",
      [CANCEL_DATE_FIELD]: h.beforeCancelDate,
    },
  }),
  updateRecord: async (
    _appId: string,
    _recordId: string,
    payload: Record<string, unknown>,
  ) => {
    h.updateCalls.push(payload);
  },
}));

vi.mock("@/lib/customer-cancel-server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/customer-cancel-server")>();
  return {
    // payload への反映（PT=0・工事対応者・キャンセル日）は本物を使って検証する
    applyCustomerCancelToPayload: actual.applyCustomerCancelToPayload,
    runCustomerCancelSideEffects: async (opts: Record<string, unknown>) => {
      h.sideEffectCalls.push(opts);
      return {
        warnings: [],
        constructionUpdated: !h.sideEffectDeleted,
        constructionDeleted: h.sideEffectDeleted,
      };
    },
  };
});

/**
 * 必須チェックはこのテストの対象外（customer-cancel.test.ts が見ている）。
 * 解除の保存はキャンセル以外なので、通さないと必須項目を全部並べることになる
 */
vi.mock("@/lib/customer-info-form/validate", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/customer-info-form/validate")>();
  return { ...actual, findMissingRequiredCustomerInfoFields: () => [] };
});

vi.mock("@/lib/audit-log", () => ({
  auditLogEnabled: () => false,
  recordAuditLog: async () => ({ ok: true, written: 0 }),
}));

vi.mock("@/lib/dropbox", () => ({ dropboxConfigured: () => false }));

vi.mock("@/lib/customer-info-dropbox-link", () => ({
  applyDropboxFolderRenameToPayload: async () => undefined,
  resolveCustomerInfoDropboxLinkFieldId: () => null,
}));

vi.mock("@/lib/customer-info-pending-cache", () => ({
  invalidateCustomerInfoPendingCache: () => {},
}));

vi.mock("@/lib/customer-info-key-lookup-cache", () => ({
  invalidateCustomerInfoKeyLookupCache: () => {},
}));

vi.mock("@/lib/staff-workplace-lookup", () => ({
  resolveStaffWorkplaceLookupConfig: async () => null,
  lookupStaffWorkplaceByStaffName: async () => null,
}));

vi.mock("@/lib/product-catalog-models", () => ({
  lookupBatteryModelNumberByCapacity: async () => null,
}));

vi.mock("@/lib/google-chat", () => ({
  googleChatContractWebhookConfigured: () => false,
  sendGoogleChatContractMessage: async () => ({ kind: "sent" as const }),
}));

const { PUT } = await import(
  "@/app/api/customer-info/records/[recordId]/route"
);

const ctx = { params: Promise.resolve({ recordId: "1483" }) };

async function put(formValues: Record<string, unknown>) {
  const res = await PUT(
    new Request("https://example.test/records/1483", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ formValues }),
    }),
    ctx,
  );
  return {
    status: res.status,
    body: (await res.json()) as {
      ok?: boolean;
      error?: string;
      warning?: string;
      cancelled?: {
        constructionUpdated?: boolean;
        constructionDeleted?: boolean;
      };
    },
  };
}

const CANCEL_VALUES = {
  customerStatus: "キャンセル",
  constructionDate: "2026-12-01",
  firstConstructionDate: "2026-11-01",
  constructionContractor: "試験施工",
  pt: "1200",
  apStaff: "試験一郎",
  clStaff: "試験二郎",
};

/** キャンセルを解除する保存 */
const RELEASE_VALUES = { ...CANCEL_VALUES, customerStatus: "工事待ち" };

/** JST 2026-03-10 12:00（UTC でも同じ日） */
const NOON_JST = new Date("2026-03-10T03:00:00Z");

let infoSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  h.updateCalls = [];
  h.sideEffectCalls = [];
  h.sideEffectDeleted = false;
  h.beforeCustomerStatus = "工事待ち";
  h.beforeCancelDate = "";
  vi.stubEnv("CUSTOMER_INFO_CANCEL_DATE_FIELD_ID", CANCEL_DATE_FIELD);
  // Date だけ固定する（タイマーは本物のまま。止めると保存の await が進まない）
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOON_JST);
  infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  infoSpy.mockRestore();
});

describe("★ キャンセルにした日を書く", () => {
  it("★ YYYY/MM/DD（スラッシュ区切り・ゼロ埋め）で書かれる", async () => {
    const { status, body } = await put(CANCEL_VALUES);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(h.updateCalls[0][CANCEL_DATE_FIELD]).toBe("2026/03/10");
  });

  it("★ @pocket への書き込みは増えない（キャンセルの保存1回に載る）", async () => {
    await put(CANCEL_VALUES);

    expect(h.updateCalls).toHaveLength(1);
  });

  it("★ 既存の値があっても新しい日で上書きする", async () => {
    h.beforeCancelDate = "2025/01/05";

    await put(CANCEL_VALUES);

    expect(h.updateCalls[0][CANCEL_DATE_FIELD]).toBe("2026/03/10");
  });

  it("顧客ステータスが空だった案件でも書かれる", async () => {
    h.beforeCustomerStatus = "";

    await put(CANCEL_VALUES);

    expect(h.updateCalls[0][CANCEL_DATE_FIELD]).toBe("2026/03/10");
  });
});

describe("★ JST の日付で書く（サーバは UTC）", () => {
  it("★ UTC ではまだ前日の深夜でも、JST の日付になる", async () => {
    // UTC 3/9 15:30 ＝ JST 3/10 00:30
    vi.setSystemTime(new Date("2026-03-09T15:30:00Z"));

    await put(CANCEL_VALUES);

    expect(h.updateCalls[0][CANCEL_DATE_FIELD]).toBe("2026/03/10");
  });

  it("JST で日付が変わる直前は前の日のまま", async () => {
    // UTC 3/9 14:59:59 ＝ JST 3/9 23:59:59
    vi.setSystemTime(new Date("2026-03-09T14:59:59Z"));

    await put(CANCEL_VALUES);

    expect(h.updateCalls[0][CANCEL_DATE_FIELD]).toBe("2026/03/09");
  });

  it("年をまたぐ深夜でも JST の日付になる", async () => {
    // UTC 12/31 15:00 ＝ JST 1/1 00:00
    vi.setSystemTime(new Date("2026-12-31T15:00:00Z"));

    await put(CANCEL_VALUES);

    expect(h.updateCalls[0][CANCEL_DATE_FIELD]).toBe("2027/01/01");
  });
});

describe("★ 発動しない保存ではキャンセル日に触らない", () => {
  it("★ キャンセル済みの再保存では書かない（日付を上書きしない）", async () => {
    h.beforeCustomerStatus = "キャンセル";
    h.beforeCancelDate = "2025/01/05";

    const { status } = await put(CANCEL_VALUES);

    expect(status).toBe(200);
    expect(h.updateCalls).toHaveLength(1);
    expect(h.updateCalls[0]).not.toHaveProperty(CANCEL_DATE_FIELD);
  });

  it("★ 「キャンセル保留」にする保存では書かない", async () => {
    await put({ ...CANCEL_VALUES, customerStatus: "キャンセル保留" });

    expect(h.updateCalls).toHaveLength(1);
    expect(h.updateCalls[0]).not.toHaveProperty(CANCEL_DATE_FIELD);
    expect(h.sideEffectCalls).toHaveLength(0);
  });

  it("★ 「キャンセル保留」からの変更は解除として扱わない", async () => {
    h.beforeCustomerStatus = "キャンセル保留";
    h.beforeCancelDate = "2025/01/05";

    await put(RELEASE_VALUES);

    expect(h.updateCalls).toHaveLength(1);
    expect(h.updateCalls[0]).not.toHaveProperty(CANCEL_DATE_FIELD);
  });

  it("キャンセルに関わらない保存では触らない", async () => {
    await put(RELEASE_VALUES);

    expect(h.updateCalls[0]).not.toHaveProperty(CANCEL_DATE_FIELD);
  });
});

describe("★ キャンセルを解除したらキャンセル日を空にする", () => {
  beforeEach(() => {
    h.beforeCustomerStatus = "キャンセル";
    h.beforeCancelDate = "2025/01/05";
  });

  it("★ キャンセル → キャンセル以外 で空文字を書く", async () => {
    const { status, body } = await put(RELEASE_VALUES);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(h.updateCalls).toHaveLength(1);
    expect(h.updateCalls[0][CANCEL_DATE_FIELD]).toBe("");
    // 顧客ステータスそのものは保存した値で書かれる
    expect(h.updateCalls[0]["field-6"]).toBe("工事待ち");
  });

  it("★ 保存前の表記ゆれ（前後の空白・全角空白）も同じ判定を通る", async () => {
    h.beforeCustomerStatus = "　キャンセル ";

    await put(RELEASE_VALUES);

    expect(h.updateCalls[0][CANCEL_DATE_FIELD]).toBe("");
  });

  it("★ 解除時は工事レコードを触らない", async () => {
    const { body } = await put(RELEASE_VALUES);

    expect(h.sideEffectCalls).toHaveLength(0);
    expect(body.cancelled).toBeUndefined();
    // Aki番号 を空にする2回目の書き込みも起きない
    expect(h.updateCalls).toHaveLength(1);
    expect(h.updateCalls[0]).not.toHaveProperty("field-14");
  });

  it("★ 解除時は PT を 0 にせず、工事対応者も消さない", async () => {
    await put(RELEASE_VALUES);

    // AP と CL が別人なので折半（600 / 600）。キャンセル時の 0 にはならない
    expect(h.updateCalls[0]["field-11"]).toBe("600");
    expect(h.updateCalls[0]["field-12"]).toBe("600");
    expect(h.updateCalls[0]).not.toHaveProperty("field-10");
  });

  /**
   * 顧客ステータスを送ってこない保存は、既存の仕組みで顧客ステータスが
   * 空文字で書かれる（＝キャンセルではなくなる）。ステータスが実際に
   * キャンセル以外へ書き換わるので、キャンセル日も一緒に空にする
   */
  it("顧客ステータスが空で書かれる保存も解除として扱う", async () => {
    const { customerStatus: _omit, ...withoutStatus } = RELEASE_VALUES;
    void _omit;

    await put(withoutStatus);

    expect(h.updateCalls).toHaveLength(1);
    expect(h.updateCalls[0]["field-6"]).toBe("");
    expect(h.updateCalls[0][CANCEL_DATE_FIELD]).toBe("");
  });
});

describe("★ 環境変数が未設定なら書かない", () => {
  beforeEach(() => {
    vi.stubEnv("CUSTOMER_INFO_CANCEL_DATE_FIELD_ID", "");
  });

  it("★ キャンセル日を書かない（見出し「キャンセル日」では解決しない）", async () => {
    await put(CANCEL_VALUES);

    expect(h.updateCalls).toHaveLength(1);
    expect(h.updateCalls[0]).not.toHaveProperty(CANCEL_DATE_FIELD);
  });

  it("★ それでもキャンセル処理は成立する", async () => {
    const { status, body } = await put(CANCEL_VALUES);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.warning).toBeUndefined();
    expect(h.updateCalls[0]["field-11"]).toBe("0"); // APPT
    expect(h.updateCalls[0]["field-12"]).toBe("0"); // CLPT
    expect(h.updateCalls[0]["field-7"]).toBe(""); // 施工予定日
    expect(h.updateCalls[0]["field-10"]).toBe(""); // 工事対応者
    expect(h.sideEffectCalls).toHaveLength(1);
  });

  it("★ スキップを真偽値だけでログに残す", async () => {
    await put(CANCEL_VALUES);

    const skipLogs = infoSpy.mock.calls.filter((c) =>
      String(c[0]).includes("キャンセル日"),
    );
    expect(skipLogs).toHaveLength(1);
    expect(JSON.parse(String(skipLogs[0][1]))).toEqual({
      action: "write",
      configured: false,
      resolved: false,
    });
  });

  it("解除の保存でも書かず、保存は成立する", async () => {
    h.beforeCustomerStatus = "キャンセル";

    const { status } = await put(RELEASE_VALUES);

    expect(status).toBe(200);
    expect(h.updateCalls[0]).not.toHaveProperty(CANCEL_DATE_FIELD);
  });

  it("列定義に無い識別名が設定されているときも書かず、保存は成立する", async () => {
    vi.stubEnv("CUSTOMER_INFO_CANCEL_DATE_FIELD_ID", "field-99999");

    const { status } = await put(CANCEL_VALUES);

    expect(status).toBe(200);
    expect(h.updateCalls[0]).not.toHaveProperty(CANCEL_DATE_FIELD);
    expect(h.updateCalls[0]).not.toHaveProperty("field-99999");
  });
});

describe("★ キャンセル日を足しても、ほかのキャンセル処理は変わらない", () => {
  it("★ APPT・CLPT は 0 のまま", async () => {
    await put({ ...CANCEL_VALUES, pt: "99999" });

    expect(h.updateCalls[0]["field-11"]).toBe("0");
    expect(h.updateCalls[0]["field-12"]).toBe("0");
  });

  it("★ 施工予定日・初回施工予定日・施工業者・工事対応者は空のまま", async () => {
    await put(CANCEL_VALUES);

    expect(h.updateCalls[0]["field-7"]).toBe("");
    expect(h.updateCalls[0]["field-8"]).toBe("");
    expect(h.updateCalls[0]["field-9"]).toBe("");
    expect(h.updateCalls[0]["field-10"]).toBe("");
  });

  it("★ 後段（工事レコードの処理）は1回だけ、同じ引数で呼ばれる", async () => {
    await put(CANCEL_VALUES);

    expect(h.sideEffectCalls).toEqual([
      { tNumber: "T99990001", akiNumber: "A9001", lineUserId: "U-test" },
    ]);
  });

  it("★ 工事レコードを削除したときの動き（Aki番号 を空にする2回目の書き込み）は変わらない", async () => {
    h.sideEffectDeleted = true;

    const { body } = await put(CANCEL_VALUES);

    expect(body.cancelled).toEqual({
      constructionUpdated: false,
      constructionDeleted: true,
    });
    expect(h.updateCalls).toHaveLength(2);
    expect(h.updateCalls[0][CANCEL_DATE_FIELD]).toBe("2026/03/10");
    // 2回目は Aki番号 だけ。キャンセル日を書き直さない
    expect(h.updateCalls[1]).toEqual({ "field-14": "" });
  });
});
