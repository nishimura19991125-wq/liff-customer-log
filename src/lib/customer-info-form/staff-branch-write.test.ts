import { describe, expect, it } from "vitest";

import {
  staffBranchNeedsRefresh,
  staffBranchValueToWrite,
} from "@/lib/customer-info-form/staff-branch-write";

describe("staffBranchNeedsRefresh（担当者を触ったか）", () => {
  it("★ 担当者を触っていなければ引き直さない＝支店を送らない", () => {
    expect(staffBranchNeedsRefresh("山田太郎", "山田太郎")).toBe(false);
  });

  it("★ 名簿に無い担当者でも、触っていなければ引き直さない", () => {
    // 退職者・AP/CL稼働を外した人。以前は毎回引き直して "-" で潰していた
    expect(staffBranchNeedsRefresh("退職太郎", "退職太郎")).toBe(false);
  });

  it("担当者を変更したら引き直す", () => {
    expect(staffBranchNeedsRefresh("山田太郎", "鈴木一郎")).toBe(true);
  });

  it("担当者を入れたら引き直す（空→氏名）", () => {
    expect(staffBranchNeedsRefresh("", "鈴木一郎")).toBe(true);
    expect(staffBranchNeedsRefresh(undefined, "鈴木一郎")).toBe(true);
  });

  it("両方空なら引き直さない", () => {
    expect(staffBranchNeedsRefresh("", "")).toBe(false);
    expect(staffBranchNeedsRefresh(undefined, undefined)).toBe(false);
    expect(staffBranchNeedsRefresh(undefined, "")).toBe(false);
  });

  it("全角半角・空白のゆれだけなら同じ担当者とみなす", () => {
    expect(staffBranchNeedsRefresh("山田 太郎", "山田　太郎")).toBe(false);
    expect(staffBranchNeedsRefresh("山田太郎 ", "山田太郎")).toBe(false);
  });

  it("読み込み値が取れなかったときは引き直す（従来どおり追随させる）", () => {
    expect(staffBranchNeedsRefresh(undefined, "山田太郎")).toBe(true);
  });
});

describe("staffBranchValueToWrite（引けた値だけ書く）", () => {
  it("引けた勤務場所はそのまま書く", () => {
    expect(staffBranchValueToWrite("奈良本社")).toBe("奈良本社");
  });

  it("前後の空白は落とす", () => {
    expect(staffBranchValueToWrite("  京都支社  ")).toBe("京都支社");
  });

  it("★ 引けなかったら null。'-' を書かない", () => {
    expect(staffBranchValueToWrite(null)).toBeNull();
    expect(staffBranchValueToWrite(undefined)).toBeNull();
    expect(staffBranchValueToWrite("")).toBeNull();
    expect(staffBranchValueToWrite("   ")).toBeNull();
  });

  it("名簿の値が '-' ならその値として書く（引けたことに変わりはない）", () => {
    // 「引けない」と「支店が '-' と登録されている」は別。後者は尊重する
    expect(staffBranchValueToWrite("-")).toBe("-");
  });
});

describe("組み合わせ（実際の保存の流れ）", () => {
  /** 名簿。ここに無い担当者は勤務場所を引けない */
  const ROSTER: Record<string, string> = {
    山田太郎: "奈良本社",
    鈴木一郎: "京都支社",
  };
  const lookup = (name: string | undefined) => ROSTER[(name ?? "").trim()] ?? null;

  /** put-payload の applyStaffBranchesToPayload と同じ順序で判定する */
  function decide(loaded: string | undefined, current: string | undefined) {
    if (!staffBranchNeedsRefresh(loaded, current)) return { write: false } as const;
    const value = staffBranchValueToWrite(lookup(current));
    if (value === null) return { write: false } as const;
    return { write: true, value } as const;
  }

  it("担当者を触らずに保存 → 支店は送らない（保持される）", () => {
    expect(decide("山田太郎", "山田太郎")).toEqual({ write: false });
  });

  it("★ 名簿に無い担当者で保存 → 支店を送らない（'-' にならない）", () => {
    expect(decide("退職太郎", "退職太郎")).toEqual({ write: false });
  });

  it("担当者を変更 → 支店が追随する", () => {
    expect(decide("山田太郎", "鈴木一郎")).toEqual({
      write: true,
      value: "京都支社",
    });
  });

  it("名簿に無い担当者へ変更 → 追随できないが '-' で潰さない", () => {
    expect(decide("山田太郎", "退職太郎")).toEqual({ write: false });
  });

  it("担当者を空にした → 引けないので支店は触らない", () => {
    expect(decide("山田太郎", "")).toEqual({ write: false });
  });

  it("★ カレンダー連携の新規作成（M-2）: 引けなければ書かない", () => {
    // 新規作成には「前の担当者」が無いので needsRefresh は使わず、
    // 引けた値だけを書く（sync-construction-to-customer-info と同じ形）
    const writeOnCreate = (staffName: string) =>
      staffBranchValueToWrite(lookup(staffName));

    expect(writeOnCreate("山田太郎")).toBe("奈良本社");
    expect(writeOnCreate("勤務場所が無い人")).toBeNull();
  });

  it("新規に担当者を入れた（読み込み値なし） → 支店が入る", () => {
    expect(decide(undefined, "奈良本社の人がいない場合")).toEqual({
      write: false,
    });
    expect(decide(undefined, "山田太郎")).toEqual({
      write: true,
      value: "奈良本社",
    });
  });
});
