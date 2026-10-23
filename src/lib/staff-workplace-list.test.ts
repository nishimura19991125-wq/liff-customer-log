import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 名簿の実データから勤務場所（支店）の一覧を作る（施工管理タブ向け）。
 *
 * 支店の一覧をコードに固定すると、@pocket 側で改称されたときに追随できない
 * （9/9 に支社の既定値が改称に追随せず、全員が「その他」に落ちた）。
 * ここでは名簿に実在する値だけを、名簿の順で返すことを固定する。
 */

const NAME_ID = "field-1";
const WORKPLACE_ID = "field-2";
const COMPANY_ID = "field-3";

const h = vi.hoisted(() => ({
  rows: [] as { record: Record<string, unknown> }[],
  rosterCalls: 0,
  fields: [] as { uniqueId: string; caption: string }[],
}));

vi.mock("@/lib/atpocket", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/atpocket")>("@/lib/atpocket");
  return {
    ...actual,
    apiKeyForStaffPocketReadApClList: () => "read-key",
    fetchAppFields: async () => h.fields,
  };
});

vi.mock("@/lib/staff-roster-cache", () => ({
  fetchStaffRosterRowsCached: async () => {
    h.rosterCalls += 1;
    return h.rows;
  },
  registerStaffRosterDerivedCache: () => {},
}));

const {
  invalidateStaffAssignmentLookupCache,
  listStaffWorkplacesInRosterOrder,
  lookupStaffAssignmentByStaffName,
  resolveStaffAssignmentLookupConfig,
} = await import("@/lib/staff-workplace-lookup");

const ENV_KEYS = [
  "STAFF_APP_ID",
  "STAFF_NAME_FIELD_ID",
  "STAFF_WORKPLACE_FIELD_ID",
  "STAFF_COMPANY_FIELD_ID",
] as const;
const savedEnv: Record<string, string | undefined> = {};

function staff(
  name: string,
  workplace?: string,
  company?: string,
): { record: Record<string, unknown> } {
  const record: Record<string, unknown> = { [NAME_ID]: name };
  if (workplace !== undefined) record[WORKPLACE_ID] = workplace;
  if (company !== undefined) record[COMPANY_ID] = company;
  return { record };
}

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.STAFF_APP_ID = "staff-app";
  process.env.STAFF_NAME_FIELD_ID = NAME_ID;
  process.env.STAFF_WORKPLACE_FIELD_ID = WORKPLACE_ID;
  process.env.STAFF_COMPANY_FIELD_ID = COMPANY_ID;
  h.rows = [];
  h.rosterCalls = 0;
  h.fields = [
    { uniqueId: NAME_ID, caption: "氏名" },
    { uniqueId: WORKPLACE_ID, caption: "勤務場所" },
    { uniqueId: COMPANY_ID, caption: "所属会社" },
  ];
  invalidateStaffAssignmentLookupCache();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = savedEnv[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("勤務場所の一覧", () => {
  it("★ 名簿の順で返る", async () => {
    h.rows = [
      staff("スタッフA", "支店C"),
      staff("スタッフB", "支店A"),
      staff("スタッフC", "支店B"),
    ];

    expect(await listStaffWorkplacesInRosterOrder()).toEqual([
      "支店C",
      "支店A",
      "支店B",
    ]);
  });

  it("★ 同じ勤務場所は1回だけ返る（最初に出た位置）", async () => {
    h.rows = [
      staff("スタッフA", "支店A"),
      staff("スタッフB", "支店B"),
      staff("スタッフC", "支店A"),
      staff("スタッフD", " 支店B "),
    ];

    expect(await listStaffWorkplacesInRosterOrder()).toEqual([
      "支店A",
      "支店B",
    ]);
  });

  it("★ 勤務場所が空の人は一覧に入れない（「その他」なども作らない）", async () => {
    h.rows = [
      staff("スタッフA", ""),
      staff("スタッフB", "支店A"),
      staff("スタッフC", "   "),
      staff("スタッフD", undefined, "会社A"),
      staff("スタッフE"),
    ];

    expect(await listStaffWorkplacesInRosterOrder()).toEqual(["支店A"]);
  });

  it("★ コードに無い名前もそのまま返す（改称に追随する）", async () => {
    h.rows = [staff("スタッフA", "改称後の支店")];

    expect(await listStaffWorkplacesInRosterOrder()).toEqual(["改称後の支店"]);
  });

  it("勤務場所の列が無い環境では空の一覧を返す", async () => {
    delete process.env.STAFF_WORKPLACE_FIELD_ID;
    h.fields = h.fields.filter((f) => f.uniqueId !== WORKPLACE_ID);
    h.rows = [staff("スタッフA", undefined, "会社A")];

    expect(await listStaffWorkplacesInRosterOrder()).toEqual([]);
  });

  it("名簿の設定が無ければ空の一覧を返す", async () => {
    delete process.env.STAFF_APP_ID;

    expect(await listStaffWorkplacesInRosterOrder()).toEqual([]);
    expect(h.rosterCalls).toBe(0);
  });

  it("★ 担当者ごとの支店と同じ対応表を使う（名簿の取得は増えない）", async () => {
    h.rows = [staff("スタッフA", "支店A"), staff("スタッフB", "支店B")];
    const cfg = await resolveStaffAssignmentLookupConfig();

    const list = await listStaffWorkplacesInRosterOrder();
    const a = await lookupStaffAssignmentByStaffName("スタッフA", cfg!);

    expect(list).toContain(a.workplace);
    expect(h.rosterCalls).toBe(1);
  });
});
