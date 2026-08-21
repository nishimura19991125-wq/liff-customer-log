import { describe, expect, it } from "vitest";

import type { CrmDocumentCheckItem } from "@/lib/customer-crm-documents";
import {
  crmEffectiveDocumentItems,
  crmEffectiveDocumentMissing,
} from "@/lib/customer-crm-status";

/**
 * キャンセル案件を書類不足のアラートから外す。
 *
 * 総合バッジ（⚠️ 書類未回収）と行ごとのバッジで扱いを揃えるのが要点。
 * 片方だけ消すと「バッジは無いのに行は赤い」状態になる。
 */

function doc(key: string, value: string, isMissing: boolean): CrmDocumentCheckItem {
  return { key, label: key, value, isMissing };
}

const DOCUMENTS: CrmDocumentCheckItem[] = [
  doc("salesConstructionContract", "未回収", true),
  doc("powerCompanyForm", "回収済み", false),
  doc("registryBook", "-", true),
];

describe("★ 総合バッジ（書類未回収）", () => {
  it("キャンセルなら未回収でもアラートにしない", () => {
    expect(crmEffectiveDocumentMissing(true, true)).toBe(false);
  });

  it("キャンセル以外は従来どおりアラートになる", () => {
    expect(crmEffectiveDocumentMissing(true, false)).toBe(true);
  });

  it("そもそも未回収でなければアラートにならない", () => {
    expect(crmEffectiveDocumentMissing(false, false)).toBe(false);
    expect(crmEffectiveDocumentMissing(false, true)).toBe(false);
  });
});

describe("★ 行ごとのバッジ（書類チェックリスト）", () => {
  it("キャンセルなら行の未回収バッジも出さない", () => {
    const items = crmEffectiveDocumentItems(DOCUMENTS, true);

    expect(items.map((d) => d.isMissing)).toEqual([false, false, false]);
  });

  it("★ キャンセル以外は従来どおり未回収のまま", () => {
    const items = crmEffectiveDocumentItems(DOCUMENTS, false);

    expect(items.map((d) => d.isMissing)).toEqual([true, false, true]);
  });

  it("値（value）は書き換えない。実際の回収状況は一覧で見える", () => {
    const items = crmEffectiveDocumentItems(DOCUMENTS, true);

    expect(items.map((d) => d.value)).toEqual(["未回収", "回収済み", "-"]);
    expect(items.map((d) => d.label)).toEqual(DOCUMENTS.map((d) => d.label));
  });

  it("元の配列を書き換えない", () => {
    crmEffectiveDocumentItems(DOCUMENTS, true);

    expect(DOCUMENTS.map((d) => d.isMissing)).toEqual([true, false, true]);
  });

  it("変わらない行は同じオブジェクトのまま返す（無駄な再生成をしない）", () => {
    const items = crmEffectiveDocumentItems(DOCUMENTS, false);

    expect(items[0]).toBe(DOCUMENTS[0]);
    expect(items[1]).toBe(DOCUMENTS[1]);
  });

  it("空の一覧でも壊れない", () => {
    expect(crmEffectiveDocumentItems([], true)).toEqual([]);
  });
});

describe("★ 総合バッジと行バッジの扱いが揃っている", () => {
  it("キャンセルなら、どちらもアラートにならない", () => {
    const isCancelled = true;
    const aggregate = crmEffectiveDocumentMissing(true, isCancelled);
    const items = crmEffectiveDocumentItems(DOCUMENTS, isCancelled);

    expect(aggregate).toBe(false);
    expect(items.some((d) => d.isMissing)).toBe(false);
  });

  it("キャンセル以外なら、どちらもアラートになる", () => {
    const isCancelled = false;
    const aggregate = crmEffectiveDocumentMissing(true, isCancelled);
    const items = crmEffectiveDocumentItems(DOCUMENTS, isCancelled);

    expect(aggregate).toBe(true);
    expect(items.some((d) => d.isMissing)).toBe(true);
  });
});
