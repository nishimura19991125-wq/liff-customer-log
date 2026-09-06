import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 名簿から作った派生キャッシュを、名簿と一緒に捨てる。
 *
 * 氏名→勤務場所・所属会社・部署の Map には**期限が無い**。名簿を捨てても
 * Map が残っていると、名簿で勤務場所や所属会社を直しても、プロセスが
 * 生きている間ずっと古い値が返り続ける。
 * （実際、勤務場所・所属・部署の破棄関数は定義されたまま一度も呼ばれて
 * いなかった。所属会社を足したことで「直したのに反映されない」という形で
 * 表面化した。）
 *
 * ■ なぜ登録制か
 * 派生側は名簿を読むために staff-roster-cache を import している。逆向きに
 * import すると循環参照になるので、名簿側から直接は呼べない。
 * 呼び出し側へ「両方呼ぶ」と書き足す形は、派生が増えるたびに全呼び出し側を
 * 直すことになり必ず抜ける。そこで派生側が破棄関数を預ける。
 *
 * ここで固定するのは**仕組みそのもの**。個々の派生を数え上げるだけだと、
 * 次に増えたときの登録漏れを拾えない。
 */

const ROOT = process.cwd();
const LIB = path.join(ROOT, "src/lib");

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

describe("破棄の仕組み", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("★ 名簿を捨てると、登録した派生キャッシュが捨てられる", async () => {
    const { invalidateStaffRosterCache, registerStaffRosterDerivedCache } =
      await import("@/lib/staff-roster-cache");

    const reset = vi.fn();
    registerStaffRosterDerivedCache(reset);

    invalidateStaffRosterCache();

    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("★ hard=true（完全削除）でも捨てられる", async () => {
    const { invalidateStaffRosterCache, registerStaffRosterDerivedCache } =
      await import("@/lib/staff-roster-cache");

    const reset = vi.fn();
    registerStaffRosterDerivedCache(reset);

    invalidateStaffRosterCache(true);

    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("★ 1つが例外を投げても、残りの派生は捨てる", async () => {
    const { invalidateStaffRosterCache, registerStaffRosterDerivedCache } =
      await import("@/lib/staff-roster-cache");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const broken = vi.fn(() => {
      throw new Error("boom");
    });
    const healthy = vi.fn();
    registerStaffRosterDerivedCache(broken);
    registerStaffRosterDerivedCache(healthy);

    invalidateStaffRosterCache();

    expect(broken).toHaveBeenCalledTimes(1);
    expect(healthy).toHaveBeenCalledTimes(1);
    expect(
      warnSpy.mock.calls.map((c) => c.map((x) => String(x)).join(" ")).join(""),
    ).toContain("派生キャッシュの破棄に失敗");

    warnSpy.mockRestore();
  });

  it("同じ関数を二重に登録しても1回しか呼ばれない", async () => {
    const { invalidateStaffRosterCache, registerStaffRosterDerivedCache } =
      await import("@/lib/staff-roster-cache");

    const reset = vi.fn();
    registerStaffRosterDerivedCache(reset);
    registerStaffRosterDerivedCache(reset);

    invalidateStaffRosterCache();

    expect(reset).toHaveBeenCalledTimes(1);
  });
});

describe("派生の Map が作り直される", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("@/lib/atpocket", () => ({
      apiKeyForStaffPocketReadApClList: () => "dummy",
      fetchAppFields: async () => [
        { uniqueId: "field-1", caption: "氏名" },
        { uniqueId: "field-2", caption: "勤務場所" },
        { uniqueId: "field-3", caption: "所属会社" },
      ],
    }));
  });

  /** 名簿の行。呼ぶたびに違う値を返し、作り直されたかを見る */
  function rosterModuleWith(values: { workplace: string; company: string }[]) {
    let call = 0;
    return () => {
      const v = values[Math.min(call++, values.length - 1)]!;
      return [
        {
          recordId: 1,
          record: {
            "field-1": "山田太郎",
            "field-2": v.workplace,
            "field-3": v.company,
          },
        },
      ];
    };
  }

  it("★ 名簿を捨てたあとは、名簿の新しい値で引き直す", async () => {
    const rows = rosterModuleWith([
      { workplace: "奈良本社", company: "トゥルーアーチ" },
      { workplace: "京都支社", company: "別会社" },
    ]);
    const resets: Array<() => void> = [];
    vi.doMock("@/lib/staff-roster-cache", () => ({
      fetchStaffRosterRowsCached: async () => rows(),
      registerStaffRosterDerivedCache: (r: () => void) => resets.push(r),
    }));

    process.env.STAFF_APP_ID = "1";
    process.env.STAFF_NAME_FIELD_ID = "field-1";
    delete process.env.STAFF_WORKPLACE_FIELD_ID;
    delete process.env.STAFF_COMPANY_FIELD_ID;

    const {
      resolveStaffAssignmentLookupConfig,
      lookupStaffAssignmentByStaffName,
    } = await import("@/lib/staff-workplace-lookup");

    const cfg = await resolveStaffAssignmentLookupConfig();
    expect(cfg).not.toBeNull();

    const before = await lookupStaffAssignmentByStaffName("山田太郎", cfg!);
    expect(before).toEqual({
      workplace: "奈良本社",
      company: "トゥルーアーチ",
    });

    // 捨てなければ古い Map が返る（＝名簿を直しても反映されない）
    const cached = await lookupStaffAssignmentByStaffName("山田太郎", cfg!);
    expect(cached.company).toBe("トゥルーアーチ");

    // 名簿の無効化で呼ばれる破棄関数を実行する
    for (const r of resets) r();

    const after = await lookupStaffAssignmentByStaffName("山田太郎", cfg!);
    expect(after).toEqual({ workplace: "京都支社", company: "別会社" });
  });

  it("★ 勤務場所のマップ（打刻通知が使う入口）も作り直される", async () => {
    const rows = rosterModuleWith([
      { workplace: "奈良本社", company: "トゥルーアーチ" },
      { workplace: "京都支社", company: "別会社" },
    ]);
    const resets: Array<() => void> = [];
    vi.doMock("@/lib/staff-roster-cache", () => ({
      fetchStaffRosterRowsCached: async () => rows(),
      registerStaffRosterDerivedCache: (r: () => void) => resets.push(r),
    }));

    process.env.STAFF_APP_ID = "1";
    process.env.STAFF_NAME_FIELD_ID = "field-1";
    delete process.env.STAFF_WORKPLACE_FIELD_ID;

    const {
      resolveStaffWorkplaceLookupConfig,
      lookupStaffWorkplaceByStaffName,
    } = await import("@/lib/staff-workplace-lookup");

    const cfg = await resolveStaffWorkplaceLookupConfig();
    expect(cfg).not.toBeNull();
    expect(await lookupStaffWorkplaceByStaffName("山田太郎", cfg!)).toBe(
      "奈良本社",
    );

    for (const r of resets) r();

    expect(await lookupStaffWorkplaceByStaffName("山田太郎", cfg!)).toBe(
      "京都支社",
    );
  });
});

/**
 * 登録漏れを仕組みで拾う。
 *
 * 「名簿の行を読んでいて、かつ自前の破棄関数を持つ」モジュールを条件で拾い、
 * **登録しているか、除外理由が書いてあるか**のどちらかを必ず満たさせる。
 * 個々の名前を並べるだけだと、次に派生が増えたときの登録漏れを拾えない。
 * 新しく該当するモジュールができたら、このテストが落ちて判断を迫る。
 */
describe("登録漏れを拾う", () => {
  /**
   * 条件には当たるが、名簿の行から作ったキャッシュを持たないモジュール。
   * 除外するときは**理由を書くこと**。
   */
  const EXCLUDED: Record<string, string> = {
    "src/lib/audit-log.ts":
      "名簿の行は実行者の解決で毎回読み直しており、キャッシュしているのは更新履歴アプリの列定義だけ",
  };

  /** 名簿そのもの。派生ではないので対象外 */
  const ROSTER_MODULE = "src/lib/staff-roster-cache.ts";

  const candidates = readdirSync(LIB)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => ({ file: `src/lib/${f}`, src: read(`src/lib/${f}`) }))
    .filter((m) => m.file !== ROSTER_MODULE)
    .filter(
      (m) =>
        m.src.includes("fetchStaffRosterRowsCached") &&
        /export function invalidate\w*Cache\(/.test(m.src),
    );

  const derived = candidates.filter((m) => !(m.file in EXCLUDED));

  it("条件が空振りしていない（拾えるモジュールがある）", () => {
    expect(candidates.length).toBeGreaterThan(0);
    expect(derived.length).toBeGreaterThan(0);
  });

  it("★ 名簿由来の派生は、登録しているか除外理由があるかのどちらか", () => {
    for (const m of candidates) {
      const registered = m.src.includes("registerStaffRosterDerivedCache(");
      const excluded = m.file in EXCLUDED;
      expect(
        registered || excluded,
        `${m.file}: 名簿と一緒に捨てるなら登録し、不要なら EXCLUDED に理由を書くこと`,
      ).toBe(true);
    }
  });

  it("★ 破棄関数の数だけ登録している（1つ足して登録し忘れない）", () => {
    for (const m of derived) {
      const invalidators =
        m.src.match(/export function invalidate\w*Cache\(/g) ?? [];
      const registrations =
        m.src.match(/^registerStaffRosterDerivedCache\(/gm) ?? [];
      expect(
        registrations.length,
        `${m.file}: 破棄関数 ${invalidators.length} 個に対し登録 ${registrations.length} 件`,
      ).toBe(invalidators.length);
    }
  });

  it("★ 名簿側から派生を直接 import していない（循環参照にしない）", () => {
    const src = read("src/lib/staff-roster-cache.ts");
    for (const m of derived) {
      const mod = m.file.replace("src/lib/", "@/lib/").replace(/\.ts$/, "");
      expect(src, `${mod} を import している`).not.toContain(`from "${mod}"`);
    }
  });

  it("除外したモジュールには理由が書いてある", () => {
    for (const [file, reason] of Object.entries(EXCLUDED)) {
      expect(reason.trim().length, file).toBeGreaterThan(10);
    }
  });
});
