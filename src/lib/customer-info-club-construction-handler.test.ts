import { describe, expect, it } from "vitest";

import {
  CLUB_CONSTRUCTION_HANDLER_NAME,
  apClStaffAfterSave,
  isClubApClPair,
  shouldAutoFillClubConstructionHandler,
} from "@/lib/customer-info-club-construction-handler";

const CLUB = "トラーチ倶楽部";

describe("isClubApClPair", () => {
  it("定数はトラーチ倶楽部", () => {
    expect(CLUB_CONSTRUCTION_HANDLER_NAME).toBe(CLUB);
  });

  it("★ AP・CL が両方トラーチ倶楽部なら true", () => {
    expect(isClubApClPair(CLUB, CLUB)).toBe(true);
  });

  it("AP だけ・CL だけなら false", () => {
    expect(isClubApClPair(CLUB, "担当B")).toBe(false);
    expect(isClubApClPair("担当A", CLUB)).toBe(false);
  });

  it("両方とも別の人なら false", () => {
    expect(isClubApClPair("担当A", "担当A")).toBe(false);
  });

  it("空・不明なら false", () => {
    expect(isClubApClPair("", CLUB)).toBe(false);
    expect(isClubApClPair(CLUB, "")).toBe(false);
    expect(isClubApClPair(null, CLUB)).toBe(false);
    expect(isClubApClPair(CLUB, undefined)).toBe(false);
  });

  it("前後の空白があっても一致する", () => {
    expect(isClubApClPair(`  ${CLUB}　`, ` ${CLUB} `)).toBe(true);
  });

  it("全角半角の違いがあっても一致する", () => {
    expect(isClubApClPair("ﾄﾗｰﾁ倶楽部", CLUB)).toBe(true);
  });

  it("含むだけでは一致しない（完全一致）", () => {
    expect(isClubApClPair(`${CLUB}A`, CLUB)).toBe(false);
  });
});

describe("apClStaffAfterSave", () => {
  it("payload に載っていればその値", () => {
    expect(
      apClStaffAfterSave({ payload: { f1: CLUB }, fieldId: "f1", loaded: "x" }),
    ).toBe(CLUB);
  });

  it("載っていなければ保存前の値", () => {
    expect(apClStaffAfterSave({ payload: {}, fieldId: "f1", loaded: CLUB })).toBe(
      CLUB,
    );
  });

  it("保存前を読めていなければ null", () => {
    expect(apClStaffAfterSave({ payload: {}, fieldId: "f1", loaded: null })).toBe(
      null,
    );
  });
});

describe("shouldAutoFillClubConstructionHandler", () => {
  it("★ 両方トラーチ倶楽部で工事対応者が空なら入れる", () => {
    expect(
      shouldAutoFillClubConstructionHandler({
        apStaff: CLUB,
        clStaff: CLUB,
        currentHandler: "",
      }),
    ).toBe(true);
  });

  it("★ 工事対応者に値があれば入れない", () => {
    expect(
      shouldAutoFillClubConstructionHandler({
        apStaff: CLUB,
        clStaff: CLUB,
        currentHandler: "担当C",
      }),
    ).toBe(false);
  });

  it("工事対応者を読めていなければ入れない", () => {
    expect(
      shouldAutoFillClubConstructionHandler({
        apStaff: CLUB,
        clStaff: CLUB,
        currentHandler: null,
      }),
    ).toBe(false);
  });

  it("片方だけなら入れない", () => {
    expect(
      shouldAutoFillClubConstructionHandler({
        apStaff: CLUB,
        clStaff: "担当B",
        currentHandler: "",
      }),
    ).toBe(false);
  });
});
