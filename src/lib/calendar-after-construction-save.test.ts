import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 連携のあとに T番号 を工事アプリへ書き戻す判定。
 *
 * 実機で「工事登録アプリに T番号 が入らない」が出た。原因は書き戻しの
 * 判定が `syncedTNumber !== constructionUniqueKey` だったこと。
 * 従来の呼び出し元は constructionUniqueKey に**工事レコードから読んだ値**を
 * 渡していたので判定できていたが、お客様情報を起点にする経路
 * （assign-customer-case）は突合のために**お客様情報側の T番号**を渡す。
 * それが一致してしまい、書き戻しが丸ごと飛んでいた。
 *
 * ここで固定するのは次の2つ。
 *   - constructionRecordTNumber に空を渡せば必ず書き戻す
 *   - 省略した従来の呼び出しは挙動が変わらない
 */

const T_FIELD = "field-1";
const AKI_FIELD = "field-101";

const h = vi.hoisted(() => ({
  writes: [] as Array<{ recordId?: string; payload: Record<string, unknown> }>,
  syncResult: {} as Record<string, unknown>,
}));

vi.mock("@/lib/sync-construction-to-customer-info", () => ({
  syncConstructionRecordToCustomerInfoApp: async () => h.syncResult,
}));

vi.mock("@/lib/atpocket-write-with-import-key", () => ({
  writePocketRecordWithImportKey: async (opts: {
    recordId?: string;
    payload: Record<string, unknown>;
  }) => {
    h.writes.push({
      ...(opts.recordId ? { recordId: opts.recordId } : {}),
      payload: opts.payload,
    });
  },
}));

vi.mock("@/lib/calendar-record-patch-server", () => ({
  buildCalendarPatchAfterConstructionSave: async () => null,
}));

vi.mock("@/lib/calendar-kojo", () => ({
  resolveConstructionTNumberFieldId: () => T_FIELD,
  resolveConstructionImportKeyFieldId: () => AKI_FIELD,
}));

const { finalizeConstructionCalendarSave } = await import(
  "@/lib/calendar-after-construction-save"
);

const BASE = {
  calAppId: "cal-1",
  constructionRecordId: "con-1",
  customerName: "山田 太郎",
  constructionFields: [],
  calendarAuth: { apiKey: "k" },
};

beforeEach(() => {
  h.writes.length = 0;
  h.syncResult = { kind: "synced", tNumber: "T00003420" };
});

describe("T番号の書き戻し", () => {
  it("★ constructionRecordTNumber が空なら、突合キーと同じでも書き戻す", async () => {
    await finalizeConstructionCalendarSave({
      ...BASE,
      // お客様情報側の T番号（突合用）
      constructionUniqueKey: "T00003420",
      // 工事レコードには入っていない
      constructionRecordTNumber: "",
      constructionImportKey: "A0001",
    });

    expect(h.writes).toHaveLength(1);
    expect(h.writes[0]?.recordId).toBe("con-1");
    expect(h.writes[0]?.payload[T_FIELD]).toBe("T00003420");
    // 取込キー（Aki番号）も同送する
    expect(h.writes[0]?.payload[AKI_FIELD]).toBe("A0001");
  });

  it("★ 工事レコードに同じ T番号 が入っていれば書き戻さない", async () => {
    await finalizeConstructionCalendarSave({
      ...BASE,
      constructionUniqueKey: "T00003420",
      constructionRecordTNumber: "T00003420",
    });

    expect(h.writes).toEqual([]);
  });

  it("★ 省略した従来の呼び出しは挙動が変わらない（一致なら書かない）", async () => {
    await finalizeConstructionCalendarSave({
      ...BASE,
      // 従来の呼び出し元は工事レコードから読んだ値をここへ渡していた
      constructionUniqueKey: "T00003420",
    });

    expect(h.writes).toEqual([]);
  });

  it("省略した呼び出しで値が違えば従来どおり書き戻す", async () => {
    await finalizeConstructionCalendarSave({
      ...BASE,
      constructionUniqueKey: "",
    });

    expect(h.writes).toHaveLength(1);
    expect(h.writes[0]?.payload[T_FIELD]).toBe("T00003420");
  });

  it("連携が失敗したときは書き戻さない", async () => {
    h.syncResult = { kind: "failed", error: "boom" };

    const res = await finalizeConstructionCalendarSave({
      ...BASE,
      constructionUniqueKey: "T00003420",
      constructionRecordTNumber: "",
    });

    expect(res.status).toBe(502);
    expect(h.writes).toEqual([]);
  });

  it("連携が T番号 を返さなければ書き戻さない", async () => {
    h.syncResult = { kind: "synced" };

    await finalizeConstructionCalendarSave({
      ...BASE,
      constructionUniqueKey: "T00003420",
      constructionRecordTNumber: "",
    });

    expect(h.writes).toEqual([]);
  });
});
