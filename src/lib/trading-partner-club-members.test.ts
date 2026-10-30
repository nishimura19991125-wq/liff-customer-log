import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 取引先会社一覧から、紹介元の選択肢（トラーチ倶楽部加盟店・取引中）を作る。
 *
 * 既存の メーカー・信販会社・施工店 と同じ読み込み処理に4つ目として足した。
 * 3種類の一覧が変わっていないことも、同じ行データで確かめる。
 */

const h = vi.hoisted(() => ({
  rows: [] as Array<{ record: Record<string, unknown> }>,
  listCalls: [] as Array<{ appId: string; csv: string }>,
  fieldsCalls: 0,
  fail: false,
}));

vi.mock("@/lib/atpocket", () => ({
  apiKeyForTradingPartnerPocket: () => "dummy",
  apiKeyForTradingPartnerPocket1: () => "dummy1",
  fetchAppFieldsTryKeys: async () => {
    h.fieldsCalls += 1;
    return null;
  },
  fetchAllRecordsPages: async (appId: string, csv: string) => {
    h.listCalls.push({ appId, csv });
    if (h.fail) throw new Error("rate limited");
    return h.rows;
  },
}));

/** 会社種別 field-6・取引状況 field-5・会社名 field-2 */
function row(type: unknown, status: unknown, name: string) {
  return { record: { "field-6": type, "field-5": status, "field-2": name } };
}

const CLUB_MEMBER = "トラーチ倶楽部加盟店";
const ACTIVE = "取引中";

const ROWS = [
  row(CLUB_MEMBER, ACTIVE, "ワタナベ電設"),
  row(CLUB_MEMBER, ACTIVE, "アオイ工業"),
  row(CLUB_MEMBER, ACTIVE, "カトウ商店"),
  row(CLUB_MEMBER, "取引停止", "サトウ建設"),
  row("施工店", ACTIVE, "タナカ施工"),
  row("メーカー", ACTIVE, "メーカーA"),
  row("信販会社", ACTIVE, "信販B"),
  row(["施工店", CLUB_MEMBER], ACTIVE, "イシダ設備"),
  row(CLUB_MEMBER, ACTIVE, ""),
  row("メーカー", "取引停止", "メーカーC"),
];

async function load() {
  vi.resetModules();
  return import("@/lib/trading-partner-manufacturers");
}

beforeEach(() => {
  process.env.TRADING_PARTNER_APP_ID = "11";
  process.env.TRADING_PARTNER_COMPANY_TYPE_FIELD_ID = "field-6";
  process.env.TRADING_PARTNER_TRADE_STATUS_FIELD_ID = "field-5";
  process.env.TRADING_PARTNER_COMPANY_NAME_FIELD_ID = "field-2";
  h.rows = ROWS;
  h.listCalls = [];
  h.fieldsCalls = 0;
  h.fail = false;
});

describe("★ トラーチ倶楽部加盟店（取引中）の会社名", () => {
  it("会社種別=トラーチ倶楽部加盟店 かつ 取引状況=取引中 だけを五十音順で返す", async () => {
    const m = await load();
    expect(await m.fetchTradingPartnerClubMemberOptions()).toEqual([
      "アオイ工業",
      "イシダ設備",
      "カトウ商店",
      "ワタナベ電設",
    ]);
  });

  it("★ 五十音順（取得順ではない）", async () => {
    const m = await load();
    const names = (await m.fetchTradingPartnerClubMemberOptions()) ?? [];
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "ja")));
    expect(names[0]).toBe("アオイ工業");
  });

  it("既存の読み込み処理を使う（同じ3列・同じアプリを読む）", async () => {
    const m = await load();
    await m.fetchTradingPartnerClubMemberOptions();
    expect(h.listCalls).toEqual([{ appId: "11", csv: "field-6,field-5,field-2" }]);
    // 3列とも環境変数で指定済みなら列定義は読まない
    expect(h.fieldsCalls).toBe(0);
  });

  it("10分は覚えておき、続けて呼んでも @pocket を読み直さない", async () => {
    const m = await load();
    await m.fetchTradingPartnerClubMemberOptions();
    await m.fetchTradingPartnerClubMemberOptions();
    expect(h.listCalls).toHaveLength(1);
  });

  it("アプリが未設定なら null（画面はテキスト入力に戻る）", async () => {
    delete process.env.TRADING_PARTNER_APP_ID;
    const m = await load();
    expect(await m.fetchTradingPartnerClubMemberOptions()).toBeNull();
  });

  it("読み込みに失敗したら空（画面はテキスト入力に戻る）", async () => {
    h.fail = true;
    const m = await load();
    expect(await m.fetchTradingPartnerClubMemberOptions()).toEqual([]);
  });
});

describe("★ メーカー・信販会社・施工店の一覧は変わらない", () => {
  it("メーカー", async () => {
    const m = await load();
    expect(await m.fetchTradingPartnerManufacturerOptions()).toEqual(["メーカーA"]);
  });

  it("信販会社", async () => {
    const m = await load();
    expect(await m.fetchTradingPartnerCreditCompanyOptions()).toEqual(["信販B"]);
  });

  it("施工店", async () => {
    const m = await load();
    expect(await m.fetchTradingPartnerConstructionShopOptions()).toEqual([
      "イシダ設備",
      "タナカ施工",
    ]);
  });
});
