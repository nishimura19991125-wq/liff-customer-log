import { describe, expect, it } from "vitest";

import {
  parseSalesDashboardRecordYm,
  parseSalesDashboardRecordYmFromField,
} from "@/lib/sales-dashboard-record-date";

describe("★ 年月日（YYYY年M月D日）を読む", () => {
  it("月が1桁の「2026年9月8日」を 2026/9 として読む", () => {
    // 数字だけを見る経路に落ちると 202698 → 月が「98」で null になっていた
    expect(parseSalesDashboardRecordYm("2026年9月8日")).toEqual({
      year: 2026,
      month1: 9,
    });
  });

  it("月が2桁の「2026年10月8日」は従来どおり読める", () => {
    expect(parseSalesDashboardRecordYm("2026年10月8日")).toEqual({
      year: 2026,
      month1: 10,
    });
  });

  it("1月から12月まですべて読める", () => {
    for (let m = 1; m <= 12; m++) {
      expect(parseSalesDashboardRecordYm(`2026年${m}月8日`)).toEqual({
        year: 2026,
        month1: m,
      });
    }
  });

  it("月が2桁ゼロ埋めの「2026年09月08日」も読める", () => {
    expect(parseSalesDashboardRecordYm("2026年09月08日")).toEqual({
      year: 2026,
      month1: 9,
    });
  });

  it("日が無い「2026年9月」も読める（目標月の表記）", () => {
    expect(parseSalesDashboardRecordYm("2026年9月")).toEqual({
      year: 2026,
      month1: 9,
    });
  });

  it("年月の前後に空白があっても読める", () => {
    expect(parseSalesDashboardRecordYm("2026 年 9 月 8 日")).toEqual({
      year: 2026,
      month1: 9,
    });
  });

  it("時刻が付いていても日付だけを読む", () => {
    expect(parseSalesDashboardRecordYm("2026年9月8日 10:30")).toEqual({
      year: 2026,
      month1: 9,
    });
  });

  it("月が範囲外なら年月日の分岐では読まない", () => {
    // 13月は数字だけを見る経路でも「13」が月として不正になり null
    expect(parseSalesDashboardRecordYm("2026年13月8日")).toBeNull();
  });

  it("「2026年0月8日」は従来どおり数字経路に落ちる（挙動を変えない）", () => {
    // 年月日の分岐は月0を弾き、下の数字経路が 202608 を 2026/8 と読む。
    // 修正前と同じ結果なので、ここは意図して現状のまま残している
    expect(parseSalesDashboardRecordYm("2026年0月8日")).toEqual({
      year: 2026,
      month1: 8,
    });
  });
});

describe("★ 既存の形式の挙動を変えない", () => {
  it("YYYY-MM-DD", () => {
    expect(parseSalesDashboardRecordYm("2026-09-08")).toEqual({
      year: 2026,
      month1: 9,
    });
  });

  it("YYYY/M/D（月日が1桁）", () => {
    expect(parseSalesDashboardRecordYm("2026/9/8")).toEqual({
      year: 2026,
      month1: 9,
    });
  });

  it("YYYY/MM/DD", () => {
    expect(parseSalesDashboardRecordYm("2026/09/08")).toEqual({
      year: 2026,
      month1: 9,
    });
  });

  it("YYYYMMDD（数字だけ）", () => {
    expect(parseSalesDashboardRecordYm("20260908")).toEqual({
      year: 2026,
      month1: 9,
    });
  });

  it("YYYY-MM-DD に時刻が付く形", () => {
    expect(parseSalesDashboardRecordYm("2026-09-08T10:30:00+09:00")).toEqual({
      year: 2026,
      month1: 9,
    });
  });

  it("数値・オブジェクト（@pocket の値の形）も従来どおり", () => {
    expect(parseSalesDashboardRecordYm(20260908)).toEqual({
      year: 2026,
      month1: 9,
    });
    expect(parseSalesDashboardRecordYm({ value: "2026-09-08" })).toEqual({
      year: 2026,
      month1: 9,
    });
  });
});

describe("★ 防御: 読めない値", () => {
  it("空・null・undefined は null", () => {
    expect(parseSalesDashboardRecordYm("")).toBeNull();
    expect(parseSalesDashboardRecordYm("   ")).toBeNull();
    expect(parseSalesDashboardRecordYm(null)).toBeNull();
    expect(parseSalesDashboardRecordYm(undefined)).toBeNull();
  });

  it("日付でない文字列は null", () => {
    expect(parseSalesDashboardRecordYm("未定")).toBeNull();
    expect(parseSalesDashboardRecordYm("-")).toBeNull();
  });

  it("桁が足りない数字は null", () => {
    expect(parseSalesDashboardRecordYm("2026")).toBeNull();
    expect(parseSalesDashboardRecordYm("20269")).toBeNull();
  });

  it("月が範囲外の数字列は null", () => {
    expect(parseSalesDashboardRecordYm("20269908")).toBeNull();
  });
});

describe("★ レコードの列から読む", () => {
  it("uniqueId の列を読んで年月を返す", () => {
    expect(
      parseSalesDashboardRecordYmFromField(
        { "field-12": "2026年9月8日" },
        "field-12",
      ),
    ).toEqual({ year: 2026, month1: 9 });
  });

  it("列が無ければ null", () => {
    expect(
      parseSalesDashboardRecordYmFromField({ "field-12": "2026年9月8日" }, "field-99"),
    ).toBeNull();
  });
});
