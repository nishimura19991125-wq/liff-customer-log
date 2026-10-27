import { describe, expect, it } from "vitest";

import { buildContractRecordMap } from "@/lib/contract-records";
import { buildZankoCaseEntries } from "@/lib/zanko-cards";
import { buildZankoIndex } from "@/lib/zanko-index";

/**
 * 表示月の【残工】を決める部品（残工 段階2）。両タブがこれを使う。
 *
 *   - 186 の残工日が表示月にあるものだけ
 *   - 中身は契約情報入力から T番号（NFKC）で引く。無ければ null
 *   - 顧客ステータスがキャンセルなら出さない
 *   - 日付・T番号 の順に並べる
 */

const FIDS = { tNumberFieldId: "field-3", dateFieldId: "field-7" };

function zanko(rows: Array<[string, string]>) {
  return buildZankoIndex(
    rows.map(([t, d], i) => ({
      recordId: i + 1,
      record: { "field-3": t, "field-7": d },
    })),
    FIDS,
  );
}

function contracts(
  items: Array<{
    recordId: string;
    tNumber: string;
    customerName?: string;
    isCancelled?: boolean;
  }>,
) {
  return buildContractRecordMap(
    items.map((i) => ({
      recordId: i.recordId,
      tNumber: i.tNumber,
      customerName: i.customerName ?? `顧客${i.recordId}`,
      isCancelled: i.isCancelled ?? false,
    })),
  );
}

describe("buildZankoCaseEntries", () => {
  it("★ 186 の残工日が表示月にあるものだけを出す", () => {
    const entries = buildZankoCaseEntries(
      zanko([
        ["T0001", "2026-11-05"],
        ["T0001", "2026-12-01"],
        ["T0002", "2026-10-31"],
      ]),
      contracts([{ recordId: "1", tNumber: "T0001" }]),
      2026,
      11,
    );

    expect(entries.map((e) => [e.tKey, e.dayKey])).toEqual([
      ["T0001", "2026-11-05"],
    ]);
  });

  it("★ 中身は契約情報入力から T番号（NFKC）で引く", () => {
    const entries = buildZankoCaseEntries(
      zanko([["Ｔ０００１", "2026-11-05"]]),
      contracts([{ recordId: "7", tNumber: "T0001", customerName: "山田 太郎" }]),
      2026,
      11,
    );

    expect(entries[0]?.contract?.customerName).toBe("山田 太郎");
    expect(entries[0]?.contract?.recordId).toBe("7");
  });

  it("★ 契約情報入力に該当が無ければ contract は null（カードは出す）", () => {
    const entries = buildZankoCaseEntries(
      zanko([["T0009", "2026-11-05"]]),
      contracts([]),
      2026,
      11,
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]?.contract).toBeNull();
  });

  it("★ 顧客ステータスがキャンセルなら出さない", () => {
    const entries = buildZankoCaseEntries(
      zanko([["T0001", "2026-11-05"]]),
      contracts([{ recordId: "1", tNumber: "T0001", isCancelled: true }]),
      2026,
      11,
    );

    expect(entries).toEqual([]);
  });

  it("★ 残工日が無い T番号 はカードにならない", () => {
    const entries = buildZankoCaseEntries(
      zanko([["T0001", ""]]),
      contracts([{ recordId: "1", tNumber: "T0001" }]),
      2026,
      11,
    );

    expect(entries).toEqual([]);
  });

  it("★ 日付・T番号 の順に並ぶ", () => {
    const entries = buildZankoCaseEntries(
      zanko([
        ["T0003", "2026-11-20"],
        ["T0002", "2026-11-05"],
        ["T0001", "2026-11-05"],
      ]),
      contracts([]),
      2026,
      11,
    );

    expect(entries.map((e) => `${e.dayKey}:${e.tKey}`)).toEqual([
      "2026-11-05:T0001",
      "2026-11-05:T0002",
      "2026-11-20:T0003",
    ]);
  });
});
