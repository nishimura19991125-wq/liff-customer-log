import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * タスクV: 顧客ステータスを「キャンセル」にしたときの保存。
 *
 * 元に戻せない処理なので、「実行されない側」に倒れることを厚めに見る。
 */

const h = vi.hoisted(() => ({
  updateCalls: [] as Array<Record<string, unknown>>,
  /** 保存前レコードの顧客ステータス */
  beforeCustomerStatus: "工事待ち",
  /** 保存前レコードの Aki番号（工事アプリの取込キー） */
  beforeAkiNumber: "A0042",
  /** runCustomerCancelSideEffects の呼び出し引数 */
  sideEffectCalls: [] as Array<Record<string, unknown>>,
  sideEffectWarnings: [] as string[],
}));

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
      "field-1": "T00003372",
      "field-6": h.beforeCustomerStatus,
      "field-7": "2026-12-01",
      "field-9": "ピュアライフ",
      "field-14": h.beforeAkiNumber,
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
    // payload への反映（PT=0・工事対応者を消す）は本物を使って検証する
    applyCustomerCancelToPayload: actual.applyCustomerCancelToPayload,
    runCustomerCancelSideEffects: async (opts: Record<string, unknown>) => {
      h.sideEffectCalls.push(opts);
      return {
        warnings: h.sideEffectWarnings,
        constructionUpdated: true,
        emptySlotCreated: false,
        emptySlotRecordId: null,
        plan: {
          createsEmptySlot: false,
          emptySlotDayKey: "",
          emptySlotContractor: "",
          skipReason: "too-soon" as const,
          businessDays: 0,
        },
      };
    },
  };
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
    body: (await res.json()) as { ok?: boolean; error?: string; warning?: string },
  };
}

/** キャンセルにする保存。必須項目は意図的に入れない */
const CANCEL_VALUES = {
  customerStatus: "キャンセル",
  constructionDate: "2026-12-01",
  firstConstructionDate: "2026-11-01",
  constructionContractor: "ピュアライフ",
  pt: "1200",
  apStaff: "西村太郎",
  clStaff: "冨田菜摘",
};

beforeEach(() => {
  h.updateCalls = [];
  h.sideEffectCalls = [];
  h.sideEffectWarnings = [];
  h.beforeCustomerStatus = "工事待ち";
  h.beforeAkiNumber = "A0042";
});

describe("★ ① キャンセル以外 → キャンセル で処理が実行される", () => {
  it("後段の処理が呼ばれ、保存前の施工予定日・施工会社が渡る", async () => {
    const { status, body } = await put(CANCEL_VALUES);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(h.sideEffectCalls).toHaveLength(1);
    expect(h.sideEffectCalls[0]).toMatchObject({
      tNumber: "T00003372",
      // 消す**前**の値で空き枠を判定する
      constructionDate: "2026-12-01",
      contractor: "ピュアライフ",
    });
  });

  it("顧客ステータスが空だった案件でも実行される", async () => {
    h.beforeCustomerStatus = "";

    await put(CANCEL_VALUES);

    expect(h.sideEffectCalls).toHaveLength(1);
  });
});

describe("★ ② 既にキャンセルなら実行されない", () => {
  it("再保存しても後段の処理を呼ばない", async () => {
    h.beforeCustomerStatus = "キャンセル";

    const { status, body } = await put(CANCEL_VALUES);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(h.sideEffectCalls).toHaveLength(0);
    /*
     * 施工予定日（field-7）は payload に載らない。
     * 期待値を変えたのは意図した変更。施工予定日・施工業者は
     * 工事カレンダーからのみ変更する方針になり、/customer-info の保存では
     * 列ごと落とすようにした（customer-info-construction-locked-fields.ts）。
     * キャンセルが動く保存では従来どおり通る（④ のテストで確認している）
     */
    expect(h.updateCalls[0]).not.toHaveProperty("field-7");
  });

  it("★ 「キャンセル」を含むだけの値では実行されない", async () => {
    h.beforeCustomerStatus = "工事待ち";

    await put({ ...CANCEL_VALUES, customerStatus: "キャンセル保留" });

    expect(h.sideEffectCalls).toHaveLength(0);
  });

  it("キャンセルにしない保存では実行されない", async () => {
    await put({ ...CANCEL_VALUES, customerStatus: "工事待ち", phone: "090-1111-2222" });

    expect(h.sideEffectCalls).toHaveLength(0);
  });
});

describe("★ ③ PT・APPT・CLPT が 0 になる", () => {
  it("APPT・CLPT に 0 が書き込まれる", async () => {
    await put(CANCEL_VALUES);

    expect(h.updateCalls).toHaveLength(1);
    expect(h.updateCalls[0]["field-11"]).toBe("0"); // APPT
    expect(h.updateCalls[0]["field-12"]).toBe("0"); // CLPT
  });

  it("PT に値が入っていても 0 になる（計算結果に依存しない）", async () => {
    await put({ ...CANCEL_VALUES, pt: "99999" });

    expect(h.updateCalls[0]["field-11"]).toBe("0");
    expect(h.updateCalls[0]["field-12"]).toBe("0");
  });

  it("処理が走らない保存では PT の計算が従来どおり働く", async () => {
    // 既にキャンセル＝必須チェックは通るが、キャンセル処理は起動しない
    h.beforeCustomerStatus = "キャンセル";

    await put({ ...CANCEL_VALUES, pt: "1200" });

    // AP と CL が別人なので折半（600 / 600）
    expect(h.updateCalls[0]["field-11"]).toBe("600");
    expect(h.updateCalls[0]["field-12"]).toBe("600");
  });
});

describe("★ ④ 4項目が空になる", () => {
  it("施工予定日・初回施工予定日・施工会社・工事対応者が空文字になる", async () => {
    await put(CANCEL_VALUES);

    const payload = h.updateCalls[0];
    expect(payload["field-7"]).toBe(""); // 施工予定日
    expect(payload["field-8"]).toBe(""); // 初回施工予定日
    expect(payload["field-9"]).toBe(""); // 施工業者
    expect(payload["field-10"]).toBe(""); // 工事対応者
  });

  it("処理が走らない保存では、施工予定日・施工業者は payload に載らない", async () => {
    h.beforeCustomerStatus = "キャンセル";

    await put(CANCEL_VALUES);

    const payload = h.updateCalls[0];
    /*
     * 期待値を変えたのは意図した変更。
     * 施工予定日・施工業者は工事カレンダーからのみ変更する方針になり、
     * キャンセルが動かない保存では列ごと落とすようにした。
     * 「そのまま入る」から「載らない」へ。どちらも値は消えない
     */
    expect(payload).not.toHaveProperty("field-7");
    expect(payload).not.toHaveProperty("field-9");
    // 工事対応者はロックの対象外。従来どおり通る
    expect(payload["field-10"]).not.toBe("");
  });
});

describe("★ ⑩⑪ 必須チェック", () => {
  it("★ ⑩ キャンセルなら未入力でも保存できる", async () => {
    // 必須項目（お客様名・電話番号など）を一切入れていない
    const { status, body } = await put(CANCEL_VALUES);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it("★ ⑪ キャンセル以外では必須チェックが従来どおり働く", async () => {
    const { status, body } = await put({
      ...CANCEL_VALUES,
      customerStatus: "工事待ち",
    });

    expect(status).toBe(400);
    expect(body.error).toContain("未入力の必須項目があります");
    expect(h.updateCalls).toHaveLength(0);
  });

  it("★ 「キャンセル」を含むだけの値では必須チェックが緩まない", async () => {
    const { status } = await put({
      ...CANCEL_VALUES,
      customerStatus: "キャンセル保留",
    });

    expect(status).toBe(400);
    expect(h.updateCalls).toHaveLength(0);
  });
});

describe("★ V-7 失敗時の扱い", () => {
  it("工事登録アプリの更新に失敗しても保存は成功し、warning を返す", async () => {
    h.sideEffectWarnings = [
      "キャンセル処理は完了しましたが、工事登録アプリの更新に失敗しました。DX事業部へ連絡してください。",
    ];

    const { status, body } = await put(CANCEL_VALUES);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.warning).toContain("工事登録アプリの更新に失敗");
    expect(h.updateCalls).toHaveLength(1);
  });

  it("後段が成功すれば warning は出ない", async () => {
    const { body } = await put(CANCEL_VALUES);

    expect(body.warning).toBeUndefined();
  });
});

/**
 * 実機で「キャンセルしても案件が工事カレンダーに残る」が出た件。
 *
 * 工事レコードは Aki番号（工事アプリの自動採番）でしか確実に引けない。
 * T番号 はお客様情報が採番して転記されてくる値で、転記が済んでいない
 * 案件では工事側が空になっている。T番号 だけを渡すと後段が
 * 「工事アプリに該当レコードが無い」と判断して何もしない。
 */
describe("★ 工事レコードを引くキーを渡す", () => {
  it("★ 保存前レコードの Aki番号 を後段へ渡す", async () => {
    await put(CANCEL_VALUES);

    expect(h.sideEffectCalls[0]).toMatchObject({
      tNumber: "T00003372",
      akiNumber: "A0042",
    });
  });

  it("Aki番号 が空でも T番号 は渡す（移行前の案件）", async () => {
    h.beforeAkiNumber = "";

    await put(CANCEL_VALUES);

    expect(h.sideEffectCalls[0]).toMatchObject({
      tNumber: "T00003372",
      akiNumber: "",
    });
  });
});
