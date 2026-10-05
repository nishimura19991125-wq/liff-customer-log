import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  customerCancelDeletesConstructionRecordEnabled,
  decideCancelConstructionDeletion,
} from "@/lib/customer-cancel-delete-guard";

/**
 * キャンセル時に工事レコードを削除してよいかの判定。
 *
 * 物理削除は元に戻せないので、**すべての条件を満たしたときだけ ok** に
 * なることを固定する。呼び出し側（customer-cancel-server.ts）は、
 * この関数が ok を返したときだけ削除へ進む。
 */

const T_ID = "field-1";
const AKI_ID = "field-101";

const KEYS = [
  { fieldId: AKI_ID, value: "A9001" },
  { fieldId: T_ID, value: "T99990001" },
];

const FRESH = { [T_ID]: "T99990001", [AKI_ID]: "A9001", "field-2": "試験 太郎" };

function decide(
  override: Partial<Parameters<typeof decideCancelConstructionDeletion>[0]> = {},
) {
  return decideCancelConstructionDeletion({
    enabled: true,
    constructionRecordId: "5001",
    matchedRecordCount: 1,
    freshRecord: FRESH,
    keys: KEYS,
    ...override,
  });
}

describe("★ 削除してよい条件", () => {
  it("★ 有効・1件に決まる・取り直せた・今もこの案件、なら ok", () => {
    expect(decide()).toEqual({ ok: true });
  });

  it("Aki番号 だけが一致していても ok（T番号 が未転記の案件）", () => {
    expect(decide({ freshRecord: { [AKI_ID]: "A9001", [T_ID]: "" } })).toEqual({
      ok: true,
    });
  });

  it("T番号 だけが一致していても ok（Aki番号 が無い移行前の案件）", () => {
    expect(decide({ freshRecord: { [T_ID]: "T99990001" } })).toEqual({
      ok: true,
    });
  });

  it("全角半角・空白のゆれは同じ値として扱う（照合と同じ正規化）", () => {
    expect(
      decide({ freshRecord: { [T_ID]: " Ｔ９９９９０００１ " } }),
    ).toEqual({ ok: true });
  });

  it("値が { value } の形でも読める", () => {
    expect(
      decide({ freshRecord: { [T_ID]: { value: "T99990001" } } }),
    ).toEqual({ ok: true });
  });
});

describe("★ 削除しない条件", () => {
  it("★ 止められていれば disabled", () => {
    expect(decide({ enabled: false })).toEqual({
      ok: false,
      reason: "disabled",
    });
  });

  it("削除する相手のIDが無ければ unknown_record", () => {
    expect(decide({ constructionRecordId: " " })).toEqual({
      ok: false,
      reason: "unknown_record",
    });
  });

  it("一致が0件なら unknown_record", () => {
    expect(decide({ matchedRecordCount: 0 })).toEqual({
      ok: false,
      reason: "unknown_record",
    });
  });

  it("★ 一致が2件以上なら ambiguous", () => {
    expect(decide({ matchedRecordCount: 2 })).toEqual({
      ok: false,
      reason: "ambiguous",
    });
    expect(decide({ matchedRecordCount: 5 })).toEqual({
      ok: false,
      reason: "ambiguous",
    });
  });

  it("★ 取り直せなければ not_found", () => {
    expect(decide({ freshRecord: null })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("★ 取り直したレコードがどの列でも一致しなければ mismatch", () => {
    expect(
      decide({ freshRecord: { [T_ID]: "T00000001", [AKI_ID]: "A0001" } }),
    ).toEqual({ ok: false, reason: "mismatch" });
  });

  it("★ 両方とも空のレコードは一致とみなさない", () => {
    expect(decide({ freshRecord: { [T_ID]: "", [AKI_ID]: "" } })).toEqual({
      ok: false,
      reason: "mismatch",
    });
  });

  it("★ 探す値が空の列は、空同士でも一致とみなさない", () => {
    // Aki番号 の控えが無い案件で、Aki番号 が空のレコードを掴まない
    expect(
      decide({
        keys: [
          { fieldId: AKI_ID, value: "" },
          { fieldId: T_ID, value: "T99990001" },
        ],
        freshRecord: { [AKI_ID]: "", [T_ID]: "T00000001" },
      }),
    ).toEqual({ ok: false, reason: "mismatch" });
  });

  it("列を解決できていないキーは一致の根拠にしない", () => {
    expect(
      decide({
        keys: [{ fieldId: null, value: "A9001" }],
        freshRecord: FRESH,
      }),
    ).toEqual({ ok: false, reason: "mismatch" });
  });

  it("複数一致は、取り直しの成否より先に判定する（@pocket を触らずに止められる）", () => {
    expect(decide({ matchedRecordCount: 2, freshRecord: null })).toEqual({
      ok: false,
      reason: "ambiguous",
    });
  });
});

describe("★ CUSTOMER_CANCEL_DELETE_CONSTRUCTION_RECORD", () => {
  const KEY = "CUSTOMER_CANCEL_DELETE_CONSTRUCTION_RECORD";
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env[KEY];
    delete process.env[KEY];
  });

  afterEach(() => {
    if (saved === undefined) delete process.env[KEY];
    else process.env[KEY] = saved;
  });

  it("★ 未設定なら有効（既定は削除する）", () => {
    expect(customerCancelDeletesConstructionRecordEnabled()).toBe(true);
  });

  it("★ false / 0 で止まる", () => {
    process.env[KEY] = "false";
    expect(customerCancelDeletesConstructionRecordEnabled()).toBe(false);
    process.env[KEY] = "0";
    expect(customerCancelDeletesConstructionRecordEnabled()).toBe(false);
    process.env[KEY] = " false ";
    expect(customerCancelDeletesConstructionRecordEnabled()).toBe(false);
  });

  it("それ以外の値は有効（他の2つの削除スイッチと同じ形）", () => {
    for (const v of ["true", "1", "yes", ""]) {
      process.env[KEY] = v;
      expect(customerCancelDeletesConstructionRecordEnabled(), v).toBe(true);
    }
  });
});
