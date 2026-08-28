import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 既存レコードで Dropbox のフォルダ確認を省く（第1段階の速度改善）。
 *
 * ensureCustomerFolderLink は毎回3往復する
 * （create_folder_v2 → create_shared_link_with_settings → list_shared_links。
 *  既存フォルダでは前2つが必ず衝突エラーになる）。
 * フォルダ名は T番号＋お客様名で決まり、更新のたびに変わるものではない。
 * リンクが既にあるなら作り直す理由が無い。
 *
 * ⚠ この経路は全ルート共通（新規登録・空き枠入力・割り当て・移動・
 *    キャンセル後の連携）。**リンクが空のときは従来どおり作る**ことを
 *    落とさないよう、両方を固定する。
 */

const T_ID = "field-268";
const AKI_ID = "field-267";
const NAME_ID = "field-2";
const LINK_ID = "field-300";

const CUSTOMER_FIELDS = [
  { uniqueId: T_ID, caption: "T番号" },
  { uniqueId: AKI_ID, caption: "Aki番号" },
  { uniqueId: NAME_ID, caption: "お客様名" },
  { uniqueId: LINK_ID, caption: "Dropboxリンク" },
];

const CONSTRUCTION_FIELDS = [
  { uniqueId: "field-1", caption: "T番号" },
  { uniqueId: "field-101", caption: "Aki番号" },
  { uniqueId: "field-2", caption: "お客様名" },
];

const h = vi.hoisted(() => ({
  customerRecords: {} as Record<string, Record<string, unknown>>,
  lookup: {} as Record<string, Record<string, string>>,
  updated: [] as { recordId: string; payload: Record<string, unknown> }[],
  constructionRecord: {} as Record<string, unknown>,
  /** Dropbox のフォルダ確認が呼ばれた回数 */
  folderCalls: 0,
}));

vi.mock("@/lib/atpocket", () => ({
  apiKeyForCustomerInfoWrite: () => "customer-write",
  fetchAppFields: async () => CUSTOMER_FIELDS,
  fetchRecordById: async (_appId: string, recordId: string) => {
    if (recordId === "con-1") return { record: h.constructionRecord };
    const rec = h.customerRecords[recordId];
    return rec ? { record: rec } : null;
  },
  createRecord: async () => ({
    recordIdHint: "cust-new",
    row: null,
    location: null,
  }),
  updateRecord: async (
    _appId: string,
    recordId: string,
    payload: Record<string, unknown>,
  ) => {
    h.updated.push({ recordId, payload });
  },
}));

vi.mock("@/lib/atpocket-write-with-import-key", () => ({
  writePocketRecordWithImportKey: async (opts: {
    recordId?: string;
    payload: Record<string, unknown>;
  }) => {
    if (opts.recordId) {
      h.updated.push({ recordId: opts.recordId, payload: opts.payload });
    }
    return undefined;
  },
}));

vi.mock("@/lib/customer-info-key-lookup-cache", () => ({
  findCustomerInfoRecordIdByUniqueKeyCached: async (
    fieldId: string,
    value: string,
  ) => h.lookup[fieldId]?.[value] ?? null,
  refetchCustomerInfoRecordIdByUniqueKey: async (
    fieldId: string,
    value: string,
  ) => h.lookup[fieldId]?.[value] ?? null,
}));

vi.mock("@/lib/dropbox", () => ({ dropboxConfigured: () => true }));

vi.mock("@/lib/customer-info-dropbox-link", () => ({
  DROPBOX_FOLDER_WARNING: "dropbox-warning",
  resolveCustomerInfoDropboxLinkFieldId: () => LINK_ID,
  ensureCustomerFolderLink: async () => {
    h.folderCalls += 1;
    return { url: "https://example.test/new-folder", warning: null };
  },
}));

vi.mock("@/lib/audit-log", () => ({
  auditLogEnabled: () => false,
  recordAuditLog: async () => ({ ok: true }),
}));

const { syncConstructionRecordToCustomerInfoApp } = await import(
  "@/lib/sync-construction-to-customer-info"
);

function sync() {
  return syncConstructionRecordToCustomerInfoApp({
    calAppId: "app-con",
    constructionRecordId: "con-1",
    customerName: "山田 太郎",
    housingStatus: "既築案件",
    constructionFields: CONSTRUCTION_FIELDS,
    calendarAuth: { apiKey: "cal" },
  });
}

/** 既存のお客様情報レコードを、Dropboxリンク列の値を変えて用意する */
function withLink(link: unknown) {
  h.customerRecords["cust-9"] = {
    [T_ID]: "T00003420",
    ...(link === undefined ? {} : { [LINK_ID]: link }),
  };
  h.lookup[AKI_ID] = { A0001: "cust-9" };
}

beforeEach(() => {
  process.env.CUSTOMER_INFO_APP_ID = "app-cust";
  process.env.CUSTOMER_INFO_CONSTRUCTION_UNIQUE_KEY_FIELD_ID = T_ID;
  process.env.CUSTOMER_INFO_AKI_NUMBER_FIELD_ID = AKI_ID;
  process.env.CUSTOMER_INFO_CUSTOMER_NAME_FIELD_ID = NAME_ID;
  h.customerRecords = {};
  h.lookup = {};
  h.updated = [];
  h.folderCalls = 0;
  h.constructionRecord = { "field-101": "A0001", "field-2": "山田 太郎" };
});

describe("★ Dropbox のフォルダ確認を省く", () => {
  it("★ リンクが既にあれば呼ばない（3往復ぶん省く）", async () => {
    withLink("https://example.test/existing-folder");

    await sync();

    expect(h.folderCalls).toBe(0);
    // 既存のリンクは触らない
    expect(h.updated[0]?.payload).not.toHaveProperty(LINK_ID);
  });

  it("★ リンクが空なら従来どおり作る", async () => {
    withLink("");

    await sync();

    expect(h.folderCalls).toBe(1);
    expect(h.updated[0]?.payload[LINK_ID]).toBe(
      "https://example.test/new-folder",
    );
  });

  it("★ 列そのものが無いレコードでも作る", async () => {
    withLink(undefined);

    await sync();

    expect(h.folderCalls).toBe(1);
  });

  it("★ @pocket の未入力表現「-」は未設定として作る", async () => {
    withLink("-");

    await sync();

    expect(h.folderCalls).toBe(1);
  });

  it("★ https でない値は信じない（壊れた値で永久に止めない）", async () => {
    // 人が触れる列なので任意の文字列が入りうる。
    // これを「リンクあり」と見なすと、フォルダが二度と作られなくなる
    for (const broken of ["未設定", "http://example.test/x", "javascript:1"]) {
      h.folderCalls = 0;
      h.updated = [];
      withLink(broken);

      await sync();

      expect(h.folderCalls, `${broken} を有効なリンクと誤認した`).toBe(1);
    }
  });
});
