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

/**
 * 所属会社（AP所属会社・CL所属会社）。
 *
 * 所属支店とまったく同じ仕組みで、判定関数も書き込み可否の関数も**共用**する。
 * 分けて書くと、片方だけ直したときに気づけない。
 * ここで固定するのは「支店と会社が独立して欠けても、引けたほうだけ書く」こと。
 */
describe("所属会社（支店と同じ判定を共用する）", () => {
  /** 名簿の1行ぶん。片方だけ入っている担当者もいる */
  const ROSTER: Record<string, { workplace: string | null; company: string | null }> = {
    山田太郎: { workplace: "奈良本社", company: "トゥルーアーチ" },
    鈴木一郎: { workplace: "京都支社", company: null },
    佐藤花子: { workplace: null, company: "トゥルーアーチ" },
  };
  const lookup = (name: string | undefined) =>
    ROSTER[(name ?? "").trim()] ?? { workplace: null, company: null };

  /** put-payload の applyStaffAssignmentsToPayload と同じ順序で判定する */
  function decide(loaded: string | undefined, current: string | undefined) {
    if (!staffBranchNeedsRefresh(loaded, current)) {
      return { branch: null, company: null };
    }
    const assignment = lookup(current);
    return {
      branch: staffBranchValueToWrite(assignment.workplace),
      company: staffBranchValueToWrite(assignment.company),
    };
  }

  it("★ 担当者が変わらなければ支店も会社も書かない", () => {
    expect(decide("山田太郎", "山田太郎")).toEqual({
      branch: null,
      company: null,
    });
  });

  it("★ 担当者を変えたら支店と会社の両方が追随する", () => {
    expect(decide("鈴木一郎", "山田太郎")).toEqual({
      branch: "奈良本社",
      company: "トゥルーアーチ",
    });
  });

  it("★ 会社が引けなければ会社だけ書かない（支店は書く）", () => {
    expect(decide("山田太郎", "鈴木一郎")).toEqual({
      branch: "京都支社",
      company: null,
    });
  });

  it("★ 支店が引けなければ支店だけ書かない（会社は書く）", () => {
    expect(decide("山田太郎", "佐藤花子")).toEqual({
      branch: null,
      company: "トゥルーアーチ",
    });
  });

  it("★ どちらも引けなければ両方書かない（'-' で潰さない）", () => {
    const decided = decide("山田太郎", "退職太郎");
    expect(decided).toEqual({ branch: null, company: null });
    expect(Object.values(decided)).not.toContain("-");
  });

  it("★ 名簿に '-' と登録されていればそれは尊重する", () => {
    // 「引けない」と「'-' が登録されている」は別（支店側と同じ扱い）
    expect(staffBranchValueToWrite("-")).toBe("-");
  });
});
