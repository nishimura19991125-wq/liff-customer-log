import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 工事対応者をお客様情報アプリへ書き込む部分（タスクP）。
 *
 * 対象レコードの特定は T番号（取込キー）で、突合は既存の
 * findCustomerInfoRecordIdByUniqueKeyCached を使う。新しい突合は書かない。
 */

const h = vi.hoisted(() => ({
  appId: "35" as string | null,
  importKeyEnv: "field-1" as string | null,
  foundRecordId: null as string | null,
  /** fetchRecordById が返す更新前レコード */
  existingRecord: {} as Record<string, unknown>,
  writes: [] as Array<{
    appId: string;
    recordId?: string;
    payload: Record<string, unknown>;
    importKeyFieldId?: string;
  }>,
  auditCalls: [] as Array<Record<string, unknown>>,
  /** writePocketRecordWithImportKey を失敗させる */
  writeShouldThrow: false,
}));

const CUSTOMER_FIELDS = [
  { uniqueId: "field-1", caption: "T番号" },
  { uniqueId: "field-2", caption: "お客様名" },
  { uniqueId: "field-9", caption: "工事対応者" },
];

vi.mock("@/lib/atpocket", () => ({
  fetchAppFields: async () => CUSTOMER_FIELDS,
  fetchRecordById: async () => ({ record: h.existingRecord }),
}));

vi.mock("@/lib/atpocket-write-with-import-key", () => ({
  writePocketRecordWithImportKey: async (opts: {
    appId: string;
    recordId?: string;
    payload: Record<string, unknown>;
    importKeyFieldId?: string;
  }) => {
    if (h.writeShouldThrow) throw new Error("update record failed: 502");
    h.writes.push({
      appId: opts.appId,
      recordId: opts.recordId,
      payload: opts.payload,
      importKeyFieldId: opts.importKeyFieldId,
    });
  },
}));

vi.mock("@/lib/customer-info-config", () => ({
  customerInfoAppId: () => h.appId,
  customerInfoImportKeyFieldId: () => h.importKeyEnv,
  customerInfoPocketAuth1: () => ({ apiKey: "read" }),
  customerInfoPocketAuthWrite: () => ({ apiKey: "write" }),
}));

vi.mock("@/lib/customer-info-key-lookup-cache", () => ({
  findCustomerInfoRecordIdByUniqueKeyCached: async () => h.foundRecordId,
}));

vi.mock("@/lib/audit-log", () => ({
  auditLogEnabled: () => true,
  recordAuditLog: async (entry: Record<string, unknown>) => {
    h.auditCalls.push(entry);
    return { ok: true, written: 1 };
  },
}));

const { writeConstructionHandlerToCustomerInfo } = await import(
  "@/lib/customer-info-construction-handler"
);

const T_NUMBER_FIELD = "field-1";
const HANDLER_FIELD = "field-9";

function run(handlerName = "工事太郎") {
  return writeConstructionHandlerToCustomerInfo({
    tNumber: "T00001691",
    handlerName,
    lineUserId: "U-operator",
  });
}

beforeEach(() => {
  h.appId = "35";
  h.importKeyEnv = "field-1";
  h.foundRecordId = "1483";
  h.existingRecord = {};
  h.writes = [];
  h.auditCalls = [];
  h.writeShouldThrow = false;
  delete process.env.CUSTOMER_INFO_CONSTRUCTION_HANDLER_FIELD_ID;
});

describe("お客様情報アプリの工事対応者を更新する", () => {
  it("★ T番号で引いたレコードへ、工事対応者と取込キーを書く", async () => {
    const result = await run();

    expect(result).toEqual({ kind: "written", recordId: "1483" });
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0].appId).toBe("35");
    expect(h.writes[0].recordId).toBe("1483");
    expect(h.writes[0].importKeyFieldId).toBe(T_NUMBER_FIELD);
    expect(h.writes[0].payload[HANDLER_FIELD]).toBe("工事太郎");
    // 取込キーは payload に載せる（PUT でキー欠落の 400 を防ぐ）
    expect(h.writes[0].payload[T_NUMBER_FIELD]).toBe("T00001691");
  });

  it("★ 既存値があっても常に上書きする（AP/CL担当者と違い保護しない）", async () => {
    h.existingRecord = { [HANDLER_FIELD]: "前の担当者" };

    await run("工事太郎");

    expect(h.writes[0].payload[HANDLER_FIELD]).toBe("工事太郎");
  });

  it("工事対応者の列は見出し完全一致でも解決できる（環境変数なし）", async () => {
    await run();
    expect(h.writes[0].payload).toHaveProperty(HANDLER_FIELD);
  });

  it("環境変数が設定されていればそちらを優先する", async () => {
    process.env.CUSTOMER_INFO_CONSTRUCTION_HANDLER_FIELD_ID = "field-2";

    await run();

    expect(h.writes[0].payload["field-2"]).toBe("工事太郎");
    expect(h.writes[0].payload).not.toHaveProperty(HANDLER_FIELD);
  });

  it("★ 監査ログをお客様情報アプリ宛で記録する", async () => {
    h.existingRecord = { [HANDLER_FIELD]: "前の担当者" };

    await run();

    expect(h.auditCalls).toHaveLength(1);
    const entry = h.auditCalls[0];
    expect(entry.operation).toBe("update");
    expect(entry.targetAppId).toBe("35");
    expect(entry.targetRecordId).toBe("1483");
    expect(entry.targetTNumber).toBe("T00001691");
    expect(entry.lineUserId).toBe("U-operator");

    const changes = entry.changes as Array<{
      label: string;
      before: string;
      after: string;
    }>;
    const handler = changes.find((c) => c.label === "工事対応者");
    expect(handler?.before).toBe("前の担当者");
    expect(handler?.after).toBe("工事太郎");
  });
});

describe("書けないときの返し方", () => {
  it("★ T番号で見つからなければ skipped（業務は止めない）", async () => {
    h.foundRecordId = null;

    const result = await run();

    expect(result.kind).toBe("skipped");
    if (result.kind !== "skipped") throw new Error("unreachable");
    expect(result.reason).toBe("not-found");
    expect(result.warning).toContain("お客様情報の該当レコードが見つかりません");
    expect(h.writes).toHaveLength(0);
  });

  it("★ 書き込みが失敗したら failed（呼び出し側はカレンダーも書かない）", async () => {
    h.writeShouldThrow = true;

    const result = await run();

    expect(result.kind).toBe("failed");
    expect(h.auditCalls).toHaveLength(0);
  });

  it("アプリ ID が未設定なら skipped（設定漏れで業務を止めない）", async () => {
    h.appId = null;

    const result = await run();

    expect(result.kind).toBe("skipped");
    if (result.kind !== "skipped") throw new Error("unreachable");
    expect(result.reason).toBe("not-configured");
  });

  it("取込キーが未設定なら skipped", async () => {
    h.importKeyEnv = null;

    const result = await run();

    expect(result.kind).toBe("skipped");
    if (result.kind !== "skipped") throw new Error("unreachable");
    expect(result.reason).toBe("not-configured");
  });

  it("工事対応者名が空なら何も書かない", async () => {
    const result = await run("");

    expect(result.kind).toBe("skipped");
    expect(h.writes).toHaveLength(0);
  });
});
