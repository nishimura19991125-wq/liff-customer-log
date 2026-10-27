import { describe, expect, it } from "vitest";

import { buildContractRecordMap } from "@/lib/contract-records";
import { buildZankoCaseEntries } from "@/lib/zanko-cards";
import { buildZankoIndex } from "@/lib/zanko-index";
import {
  decideCaseCardZankoMarks,
  zankoLatestDay,
} from "@/lib/zanko-postpone";

/**
 * 【延期】の印とグレー表示の判定（残工 段階3）。両タブがこの部品を使う。
 *
 *   【延期】 186 に同じ T番号 があれば付ける（残工日が空でも）。
 *           新築案件・産業用案件・【残工】カードには付けない
 *   グレー   【延期】が付くカードは全部（POSTPONED_ALWAYS_GRAY = true 相当）
 *           新築・産業用のカードは、最新日より前ならグレー。
 *           ただし完了報告がある工程は除く（POSTPONED_GRAY_SKIP_REPORTED 相当）
 *           【残工】カードは、同じ T番号 の最新の残工日でなければグレー
 *   最新日   186 の残工日のうち一番新しい日（全件から決めるので、表示月に
 *           よらない）
 */

const FIDS = { tNumberFieldId: "z-3", dateFieldId: "z-7" };

function index(rows: Array<[string, string]>) {
  return buildZankoIndex(
    rows.map(([t, d], i) => ({ recordId: i + 1, record: { "z-3": t, "z-7": d } })),
    FIDS,
  );
}

const IDX = index([
  ["T0001", "2026-11-10"],
  ["T0001", "2026-12-15"],
  ["T0002", ""],
]);

function decide(
  tKey: string,
  housingStatusKey: string,
  lastDayKey: string,
  reported = false,
) {
  return decideCaseCardZankoMarks(IDX, {
    tKey,
    housingStatusKey,
    lastDayKey,
    reported,
  });
}

describe("zankoLatestDay", () => {
  it("★ 186 の残工日のうち一番新しい日", () => {
    expect(zankoLatestDay(IDX, "T0001")).toBe("2026-12-15");
  });

  it("★ 残工日が無ければ null", () => {
    expect(zankoLatestDay(IDX, "T0002")).toBeNull();
    expect(zankoLatestDay(IDX, "T9999")).toBeNull();
  });
});

describe("【延期】", () => {
  it("★ 186 に T番号 があれば付く", () => {
    expect(decide("T0001", "既築案件", "2026-11-01").postponed).toBe(true);
  });

  it("★ 残工日が空でも付く", () => {
    expect(decide("T0002", "既築案件", "2026-11-01").postponed).toBe(true);
  });

  it("★ 186 に無ければ付かない", () => {
    expect(decide("T9999", "既築案件", "2026-11-01")).toEqual({
      postponed: false,
      gray: false,
    });
  });

  it.each(["新築案件", "産業用案件"])("★ %s には付かない", (hk) => {
    expect(decide("T0001", hk, "2026-11-01").postponed).toBe(false);
  });

  it.each(["既築案件", "トラーチ倶楽部案件", "__HS_OTHER__"])(
    "★ %s には付く",
    (hk) => {
      expect(decide("T0001", hk, "2026-11-01").postponed).toBe(true);
    },
  );

  it("★ T番号 が空なら付かない", () => {
    expect(decide("", "既築案件", "2026-11-01").postponed).toBe(false);
  });
});

describe("グレー", () => {
  it("★ 【延期】が付くカードは、最新日より後でも全部グレー", () => {
    expect(decide("T0001", "既築案件", "2027-01-10").gray).toBe(true);
    expect(decide("T0001", "既築案件", "2026-11-01").gray).toBe(true);
    // 残工日が空の案件も
    expect(decide("T0002", "既築案件", "2026-11-01").gray).toBe(true);
  });

  it("★ 新築・産業用は、最新の残工日より前ならグレー", () => {
    expect(decide("T0001", "新築案件", "2026-11-01").gray).toBe(true);
    expect(decide("T0001", "産業用案件", "2026-12-14").gray).toBe(true);
  });

  it("★ 新築・産業用で、最新日以降ならグレーにしない", () => {
    expect(decide("T0001", "新築案件", "2026-12-15").gray).toBe(false);
    expect(decide("T0001", "新築案件", "2027-01-05").gray).toBe(false);
  });

  it("★ 新築・産業用で、完了報告がある工程はグレーにしない", () => {
    expect(decide("T0001", "新築案件", "2026-11-01", true).gray).toBe(false);
    expect(decide("T0001", "産業用案件", "2026-11-01", true).gray).toBe(false);
  });

  it("★ 完了報告があっても、【延期】のカードはグレー（除外は新築・産業用だけ）", () => {
    expect(decide("T0001", "既築案件", "2026-11-01", true).gray).toBe(true);
  });

  it("★ 新築・産業用で、残工日が無ければグレーにしない（比べる日が無い）", () => {
    expect(decide("T0002", "新築案件", "2026-11-01").gray).toBe(false);
  });
});

describe("【残工】カードのグレー（buildZankoCaseEntries）", () => {
  it("★ 同じ T番号 の最新の残工日でなければグレー、最新ならグレーにしない", () => {
    const nov = buildZankoCaseEntries(IDX, buildContractRecordMap([]), 2026, 11);
    const dec = buildZankoCaseEntries(IDX, buildContractRecordMap([]), 2026, 12);

    expect(nov.map((e) => [e.dayKey, e.gray])).toEqual([["2026-11-10", true]]);
    expect(dec.map((e) => [e.dayKey, e.gray])).toEqual([["2026-12-15", false]]);
  });
});
