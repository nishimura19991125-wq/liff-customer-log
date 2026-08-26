import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * タスクT: アポ資料（立面図・平面図）を Dropbox に置く経路。
 *
 * 見るところ。
 *   - 置き場所が {root}/{年}年商談資料一式/{アポ通番}_{顧客名}様 になること
 *   - 年が**アポ取得日**基準であること（登録日ではない）
 *   - 年フォルダ → アポフォルダの順に作ること
 *   - 共有リンクが「ドロップボックスURL」（field-59）に入ること
 *   - DROPBOX_APO_ROOT_PATH 未設定なら何もしない（フェイルクローズ）
 *   - 他人の案件には添付できないこと
 *   - リンクの保存だけ落ちても、ファイルは保存済みとして返すこと
 */

const h = vi.hoisted(() => ({
  fields: [] as { uniqueId: string; caption: string; fieldType?: string }[],
  record: {} as Record<string, unknown>,
  updates: [] as Record<string, unknown>[],
  ensured: [] as string[],
  uploaded: [] as { path: string; bytes: number }[],
  listed: [] as string[],
  sharedLink: "https://www.dropbox.com/scl/fo/xxx?dl=0",
  sharedLinkThrows: false,
  configured: true,
}));

vi.mock("@/lib/atpocket", () => ({
  apiKeyForSalesDashboardApoPocket: () => "read-key",
  apiKeyForSalesDashboardApoWrite: () => "write-key",
  fetchAppFields: async () => h.fields,
  fetchRecordById: async () => ({ record: h.record }),
  updateRecord: async (
    _appId: string,
    _recordId: string,
    patch: Record<string, unknown>,
  ) => {
    h.updates.push(patch);
    return { ok: true };
  },
}));

vi.mock("@/lib/dropbox", () => ({
  dropboxApoConfigured: () => h.configured,
  dropboxApoRootPath: () =>
    h.configured ? "/BY/2.商談資料一覧" : null,
  ensureDropboxFolderAtPath: async (path: string) => {
    h.ensured.push(path);
  },
  dropboxSharedLinkForPath: async (path: string) => {
    if (h.sharedLinkThrows) {
      // 公開範囲を確認できないリンクは採用しない（フェイルクローズ）
      throw new Error(`公開範囲を確認できません: ${path}`);
    }
    return h.sharedLink;
  },
  uploadDropboxFile: async (path: string, bytes: Uint8Array) => {
    h.uploaded.push({ path, bytes: bytes.length });
  },
  listCustomerFolderFileNames: async () => h.listed,
}));

vi.mock("@/lib/sales-dashboard-fields", () => ({
  salesDashboardApoAppId: () => "app-apo",
}));

const { storeApoAttachmentFile, saveApoAttachmentSharedLink } = await import(
  "@/lib/apo-attachment-upload"
);

const ROOT = "/BY/2.商談資料一覧";
const FOLDER = `${ROOT}/2026年商談資料一式/A00001603_山田　太郎様`;

/** ドロップボックスURL の列。識別名で引く */
const LINK_FIELD = "field-59";
const IMPORT_KEY_FIELD = "field-5";

function defaultFields() {
  return [
    { uniqueId: "field-1", caption: "CL担当者" },
    { uniqueId: "field-2", caption: "商談・資料送付予定日時" },
    { uniqueId: "field-3", caption: "AP担当者" },
    { uniqueId: "field-4", caption: "お客様名" },
    { uniqueId: IMPORT_KEY_FIELD, caption: "アポ通番" },
    { uniqueId: "field-6", caption: "アポ取得日" },
    { uniqueId: LINK_FIELD, caption: "ドロップボックスURL" },
  ];
}

function defaultRecord() {
  return {
    "field-1": "西村 直也",
    "field-2": "2026-09-01 14:00",
    "field-3": "西村 直也",
    "field-4": "山田 太郎",
    [IMPORT_KEY_FIELD]: "A00001603",
    // 年はここを見る。field-2（商談予定日）が翌年でも 2026 に入る
    "field-6": "2026-08-26",
  };
}

const BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

function store(over: Partial<Parameters<typeof storeApoAttachmentFile>[0]> = {}) {
  return storeApoAttachmentFile({
    recordId: "r1",
    boundStaffName: "西村 直也",
    extension: "pdf",
    bytes: BYTES,
    now: new Date("2026-08-26T14:30:00+09:00"),
    ...over,
  });
}

beforeEach(() => {
  h.fields = defaultFields();
  h.record = defaultRecord();
  h.updates = [];
  h.ensured = [];
  h.uploaded = [];
  h.listed = [];
  h.sharedLink = "https://www.dropbox.com/scl/fo/xxx?dl=0";
  h.sharedLinkThrows = false;
  h.configured = true;
  delete process.env.APO_ACQUISITION_DROPBOX_LINK_FIELD_ID;
});

describe("★ 置き場所", () => {
  it("{root}/{年}年商談資料一式/{アポ通番}_{顧客名}様 に置く", async () => {
    const res = await store();

    expect(res.ok).toBe(true);
    expect(h.uploaded).toHaveLength(1);
    expect(h.uploaded[0]!.path).toBe(
      `${FOLDER}/立面図・平面図_山田　太郎_20260826_1430_01.pdf`,
    );
  });

  it("年フォルダ → アポフォルダの順に作る", async () => {
    await store();

    expect(h.ensured).toEqual([`${ROOT}/2026年商談資料一式`, FOLDER]);
  });

  it("★ 年はアポ取得日で決まる。商談予定日が翌年でも動かない", async () => {
    h.record = { ...defaultRecord(), "field-2": "2027-01-05 10:00" };
    await store();

    expect(h.ensured[0]).toBe(`${ROOT}/2026年商談資料一式`);
  });

  it("同じ時分に2件目を送っても連番でぶつからない", async () => {
    h.listed = ["立面図・平面図_山田　太郎_20260826_1430_01.pdf"];
    await store();

    expect(h.uploaded[0]!.path).toBe(
      `${FOLDER}/立面図・平面図_山田　太郎_20260826_1430_02.pdf`,
    );
  });

  it("アポ通番が無ければ置き場所を決めない（推測で作らない）", async () => {
    h.record = { ...defaultRecord(), [IMPORT_KEY_FIELD]: "" };
    const res = await store();

    expect(res).toMatchObject({ ok: false, status: 400 });
    expect(h.ensured).toHaveLength(0);
    expect(h.uploaded).toHaveLength(0);
  });
});

describe("★ 共有リンク", () => {
  it("ドロップボックスURL（field-59）に入る。取込キーも同送する", async () => {
    const res = await store();

    expect(res).toMatchObject({ ok: true, linkSaved: true });
    expect(h.updates).toHaveLength(1);
    expect(h.updates[0]).toMatchObject({
      [LINK_FIELD]: expect.anything(),
      [IMPORT_KEY_FIELD]: "A00001603",
    });
    expect(JSON.stringify(h.updates[0]![LINK_FIELD])).toContain(h.sharedLink);
  });

  it("リンクはフォルダに対して取る（ファイル単位ではない）", async () => {
    const seen: string[] = [];
    const dropbox = await import("@/lib/dropbox");
    const spy = vi
      .spyOn(dropbox, "dropboxSharedLinkForPath")
      .mockImplementation(async (p: string) => {
        seen.push(p);
        return h.sharedLink;
      });
    await store();
    spy.mockRestore();

    expect(seen).toEqual([FOLDER]);
  });

  it("★ 公開範囲を確認できないリンクは採用しない。ファイルは保存済みとして返す", async () => {
    h.sharedLinkThrows = true;
    const res = await store();

    // 上げたファイルは取り消せない。添付は成功、リンクだけ未保存
    expect(res).toMatchObject({ ok: true, linkSaved: false });
    expect(h.uploaded).toHaveLength(1);
    expect(h.updates).toHaveLength(0);
  });

  it("URL の列が見つからなければ保存しない（別の列に書かない）", async () => {
    h.fields = defaultFields().filter((f) => f.uniqueId !== LINK_FIELD);
    const res = await store();

    expect(res).toMatchObject({ ok: true, linkSaved: false });
    expect(h.updates).toHaveLength(0);
  });
});

describe("★ 保存先が未設定のとき（フェイルクローズ）", () => {
  it("Dropbox を一切触らずに 503 を返す", async () => {
    h.configured = false;
    const res = await store();

    expect(res).toMatchObject({ ok: false, status: 503 });
    expect(h.ensured).toHaveLength(0);
    expect(h.uploaded).toHaveLength(0);
    expect(h.updates).toHaveLength(0);
  });

  it("応答に環境変数名やパスを出さない", async () => {
    h.configured = false;
    const res = await store();
    const error = res.ok ? "" : res.error;

    expect(error).not.toMatch(/DROPBOX_APO_ROOT_PATH/);
    expect(error).not.toContain(ROOT);
  });
});

describe("★ 担当者の制限", () => {
  it("自分の案件でなければ 403。ファイルは上がらない", async () => {
    const res = await store({ boundStaffName: "別人 太郎" });

    expect(res).toMatchObject({ ok: false, status: 403 });
    expect(h.uploaded).toHaveLength(0);
  });

  it("AP担当者が自分でも添付できる", async () => {
    h.record = { ...defaultRecord(), "field-1": "別人 太郎" };
    const res = await store();

    expect(res.ok).toBe(true);
  });
});

describe("★ 共有リンクの貼り直し", () => {
  it("ファイルを上げずにリンクだけ保存し直す", async () => {
    const res = await saveApoAttachmentSharedLink({
      recordId: "r1",
      boundStaffName: "西村 直也",
    });

    expect(res).toEqual({ ok: true });
    expect(h.updates).toHaveLength(1);
    expect(h.uploaded).toHaveLength(0);
    // 貼り直しでフォルダを作り直さない
    expect(h.ensured).toHaveLength(0);
  });

  it("他人の案件では貼り直せない", async () => {
    const res = await saveApoAttachmentSharedLink({
      recordId: "r1",
      boundStaffName: "別人 太郎",
    });

    expect(res).toMatchObject({ ok: false, status: 403 });
    expect(h.updates).toHaveLength(0);
  });
});
