import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { leaveRegistrationWindow } from "@/lib/leave-register-server";
import {
  buildLeaveWeeks,
  formatLeaveDayLabel,
  isLeaveDaySelectable,
  leaveRegisterRequestBody,
  nextLeaveDeadline,
  summarizeLeaveRegisterResult,
  toggleLeaveDate,
} from "@/lib/leave-registration-view";

/**
 * 休みの登録画面（休暇・段階5）。
 * 画面を描くテストの仕組みが無いので、計算と判定を切り出して見る。
 */

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

/** UTC で曜日を出す（端末のタイムゾーンに左右されない） */
function dow(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
}

describe("★ 来週の月曜から2週間（月曜始まり・日曜締め）", () => {
  // 期間はサーバ（登録 API と同じ leaveRegistrationWindow）が決め、
  // 画面はその開始日から週を組み立てる
  function weeksAt(nowIso: string) {
    return buildLeaveWeeks(leaveRegistrationWindow(new Date(nowIso)).start);
  }

  it("★ 第1週・第2週の2つで、それぞれ7日", () => {
    const weeks = weeksAt("2026-10-27T05:00:00Z"); // JST 10/27(火)
    expect(weeks.map((w) => w.label)).toEqual(["第1週", "第2週"]);
    expect(weeks.map((w) => w.days.length)).toEqual([7, 7]);
    expect(weeks[0]!.days[0]).toBe("2026-11-02");
    expect(weeks[1]!.days[6]).toBe("2026-11-15");
  });

  it("★ 各週は月曜に始まり日曜に終わる", () => {
    for (const w of weeksAt("2026-10-27T05:00:00Z")) {
      expect(dow(w.days[0]!)).toBe(1);
      expect(dow(w.days[6]!)).toBe(0);
    }
  });

  it("★ 14日が連続している", () => {
    const all = weeksAt("2026-10-27T05:00:00Z").flatMap((w) => w.days);
    expect(new Set(all).size).toBe(14);
    for (let i = 1; i < all.length; i++) {
      const prev = Date.parse(`${all[i - 1]}T00:00:00Z`);
      expect(Date.parse(`${all[i]}T00:00:00Z`) - prev).toBe(86_400_000);
    }
  });

  it("★ 今日が日曜なら翌日の月曜から", () => {
    const weeks = weeksAt("2026-11-01T01:00:00Z"); // JST 11/1(日)
    expect(weeks[0]!.days[0]).toBe("2026-11-02");
  });

  it("★ 今日が月曜なら翌週の月曜から", () => {
    const weeks = weeksAt("2026-11-02T01:00:00Z"); // JST 11/2(月)
    expect(weeks[0]!.days[0]).toBe("2026-11-09");
  });

  it("★ 月をまたいでも正しく並ぶ", () => {
    const weeks = weeksAt("2026-10-20T05:00:00Z"); // JST 10/20(火) → 10/26〜11/8
    expect(weeks[0]!.days).toEqual([
      "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29",
      "2026-10-30", "2026-10-31", "2026-11-01",
    ]);
    expect(weeks[1]!.days[0]).toBe("2026-11-02");
    expect(weeks[1]!.days[6]).toBe("2026-11-08");
  });

  it("★ 年をまたいでも正しく並ぶ", () => {
    const weeks = buildLeaveWeeks("2026-12-28");
    expect(weeks[0]!.days[4]).toBe("2027-01-01");
    expect(weeks[1]!.days[6]).toBe("2027-01-10");
  });

  it("日付の表示は「11/2(月)」の形", () => {
    expect(formatLeaveDayLabel("2026-11-02")).toBe("11/2(月)");
    expect(formatLeaveDayLabel("2026-11-08")).toBe("11/8(日)");
  });
});

describe("★ 次の締め切り（第一・第三水曜・JST）", () => {
  it("★ 第一水曜より前なら第一水曜", () => {
    // 2026-11 の水曜: 4, 11, 18, 25 → 第一 11/4・第三 11/18
    expect(nextLeaveDeadline(new Date("2026-11-02T01:00:00Z"))).toBe("2026-11-04");
  });

  it("★ 第一水曜の当日は当日", () => {
    expect(nextLeaveDeadline(new Date("2026-11-04T01:00:00Z"))).toBe("2026-11-04");
  });

  it("★ 第一水曜を過ぎたら第三水曜", () => {
    expect(nextLeaveDeadline(new Date("2026-11-05T01:00:00Z"))).toBe("2026-11-18");
  });

  it("★ 第三水曜の当日は当日", () => {
    expect(nextLeaveDeadline(new Date("2026-11-18T01:00:00Z"))).toBe("2026-11-18");
  });

  it("★ 第三水曜を過ぎたら翌月の第一水曜", () => {
    // 2026-12 の第一水曜は 12/2
    expect(nextLeaveDeadline(new Date("2026-11-19T01:00:00Z"))).toBe("2026-12-02");
  });

  it("★ 1日が水曜の月（2026-07 は 7/1 が水曜）", () => {
    expect(nextLeaveDeadline(new Date("2026-06-30T01:00:00Z"))).toBe("2026-07-01");
    expect(nextLeaveDeadline(new Date("2026-07-02T01:00:00Z"))).toBe("2026-07-15");
  });

  it("★ 年をまたぐ（2026-12 の第三水曜 12/16 を過ぎたら 2027-01-06）", () => {
    expect(nextLeaveDeadline(new Date("2026-12-17T01:00:00Z"))).toBe("2027-01-06");
  });

  it("★ JST で判定する（UTC ではまだ前日でも、JST で日付が変わっていれば次へ）", () => {
    // UTC 2026-11-04 15:30 = JST 11/5 00:30 → 第一水曜（11/4）は過ぎている
    expect(nextLeaveDeadline(new Date("2026-11-04T15:30:00Z"))).toBe("2026-11-18");
    // UTC 2026-11-04 14:59 = JST 11/4 23:59 → まだ当日
    expect(nextLeaveDeadline(new Date("2026-11-04T14:59:00Z"))).toBe("2026-11-04");
  });

  it("★ 端末の時計（getDate など）を使っていない", () => {
    expect(read("src/lib/leave-registration-view.ts")).not.toMatch(
      /\.get(Date|Day|Month|FullYear|Hours)\(/,
    );
  });
});

describe("★ 登録済みの日は選べない", () => {
  const days = ["2026-11-02", "2026-11-03", "2026-11-04"];

  it("★ 登録済みの日は選べない", () => {
    const registered = new Set(["2026-11-03"]);
    expect(isLeaveDaySelectable("2026-11-03", days, registered)).toBe(false);
    expect(isLeaveDaySelectable("2026-11-02", days, registered)).toBe(true);
  });

  it("★ 登録済みの日を押しても選択に入らない", () => {
    const registered = new Set(["2026-11-03"]);
    expect(toggleLeaveDate([], "2026-11-03", days, registered)).toEqual([]);
  });

  it("★ 表示している2週間の外の日は選べない", () => {
    expect(isLeaveDaySelectable("2026-11-20", days, new Set())).toBe(false);
    expect(toggleLeaveDate([], "2026-11-20", days, new Set())).toEqual([]);
  });

  it("押すと選択、もう一度押すと外れる", () => {
    const a = toggleLeaveDate([], "2026-11-04", days, new Set());
    const b = toggleLeaveDate(a, "2026-11-02", days, new Set());
    expect(b).toEqual(["2026-11-02", "2026-11-04"]);
    expect(toggleLeaveDate(b, "2026-11-04", days, new Set())).toEqual(["2026-11-02"]);
  });

  it("★ 選んだあとで登録済みになった日は、送る前に外れる", () => {
    expect(
      leaveRegisterRequestBody(["2026-11-02", "2026-11-03"], new Set(["2026-11-03"])),
    ).toEqual({ dates: ["2026-11-02"] });
  });
});

describe("★ API に渡す形", () => {
  it("★ { dates: [YYYY-MM-DD…] } を昇順・重複なしで渡す（氏名は載せない）", () => {
    const body = leaveRegisterRequestBody(
      ["2026-11-05", "2026-11-02", "2026-11-05"],
      new Set(),
    );
    expect(body).toEqual({ dates: ["2026-11-02", "2026-11-05"] });
    expect(Object.keys(body)).toEqual(["dates"]);
  });
});

describe("★ 登録の結果表示", () => {
  it("★ 全部成功", () => {
    const s = summarizeLeaveRegisterResult(200, {
      ok: true,
      created: ["2026-11-02", "2026-11-03"],
      alreadyRegistered: [],
    });
    expect(s.kind).toBe("success");
    expect(s.message).toContain("2日");
  });

  it("★ 途中で失敗したら、どこまで登録できたかと、残りを送り直す案内を出す", () => {
    const s = summarizeLeaveRegisterResult(502, {
      ok: false,
      error: "休みの登録が途中で失敗しました（ID: abcd1234）",
      correlationId: "abcd1234",
      created: ["2026-11-02", "2026-11-03"],
      alreadyRegistered: [],
      failed: "2026-11-04",
      notAttempted: ["2026-11-05"],
    });
    expect(s.kind).toBe("partial");
    expect(s.message).toContain("11/3(火)まで登録しました");
    expect(s.message).toContain("残り2日");
    expect(s.message).toContain("もう一度");
    expect(s.message).toContain("abcd1234");
  });

  it("★ 1日目で失敗したら「登録できませんでした」", () => {
    const s = summarizeLeaveRegisterResult(502, {
      ok: false,
      error: "x",
      correlationId: "abcd1234",
      created: [],
      alreadyRegistered: [],
      failed: "2026-11-02",
      notAttempted: [],
    });
    expect(s.kind).toBe("partial");
    expect(s.message).toContain("登録できませんでした");
  });

  it("書く前に止まったときは、API の文言を出す", () => {
    const s = summarizeLeaveRegisterResult(400, {
      ok: false,
      error: "同じ日付が重複しています",
    });
    expect(s.kind).toBe("error");
    expect(s.message).toBe("同じ日付が重複しています");
  });

  it("登録済みで飛ばした日があれば、その旨も出す", () => {
    const s = summarizeLeaveRegisterResult(200, {
      ok: true,
      created: ["2026-11-02"],
      alreadyRegistered: ["2026-11-03"],
    });
    expect(s.kind).toBe("success");
    expect(s.message).toContain("登録済み");
  });
});

describe("★ 画面と導線", () => {
  it("★ 登録画面は既存の共通部品と初期化の作法で作っている", () => {
    const src = read("src/app/attendance/leave/page.tsx");
    for (const part of [
      "initLiffAndGetToken",
      "LiffScreen",
      "LiffPageHeader",
      "LiffCard",
      "LiffPrimaryButton",
      "LiffLoadingBlock",
      "LiffSessionExpiredPanel",
      "useLiffSwr",
      "/api/attendance/leave/registered",
      "leaveRegisterRequestBody",
    ]) {
      expect(src).toContain(part);
    }
  });

  it("★ トップページでは打刻ページのすぐ下に置く", () => {
    const src = read("src/app/page.tsx");
    const punch = src.indexOf('title="打刻ページ"');
    const leave = src.indexOf('href="/attendance/leave"');
    const close = src.indexOf("</HomeCompactSummaries>");
    expect(punch).toBeGreaterThan(-1);
    expect(leave).toBeGreaterThan(punch);
    expect(close).toBeGreaterThan(leave);
    // 間にほかのカードを挟まない（休みの登録カード自身の開始タグより前を見る）
    const leaveCardStart = src.lastIndexOf("<LiffMenuCard", leave);
    expect(leaveCardStart).toBeGreaterThan(punch);
    expect(src.slice(punch, leaveCardStart).match(/<LiffMenuCard/g)).toBeNull();
  });

  it("★ 勤怠画面からも開ける", () => {
    expect(read("src/app/attendance/page.tsx")).toContain('href="/attendance/leave"');
  });
});
