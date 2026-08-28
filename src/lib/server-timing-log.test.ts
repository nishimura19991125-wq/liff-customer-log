import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  serverTimingLogEnabled,
  startServerTimingLog,
} from "@/lib/server-timing-log";

/**
 * 段階ごとの所要時間ログ（第1段階の速度改善）。
 *
 * ここで固定するのは次の3つ。
 *   - 既定では何も出さない（平常時のログを汚さない）
 *   - 有効にしたら1リクエスト1行、JSON で出す
 *   - **個人情報を出さない**（固定の段階名と数値だけ）
 */

const saved = { value: undefined as string | undefined };

beforeEach(() => {
  saved.value = process.env.CALENDAR_TIMING_LOG;
  delete process.env.CALENDAR_TIMING_LOG;
});

afterEach(() => {
  if (saved.value === undefined) delete process.env.CALENDAR_TIMING_LOG;
  else process.env.CALENDAR_TIMING_LOG = saved.value;
  vi.restoreAllMocks();
});

describe("有効・無効の切り替え", () => {
  it("★ 既定では無効", () => {
    expect(serverTimingLogEnabled()).toBe(false);
  });

  it("★ 無効なら何も出さない", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const t = startServerTimingLog("scope");

    t.mark("a");
    t.flush();

    expect(t.enabled).toBe(false);
    expect(info).not.toHaveBeenCalled();
  });

  it("true / 1 で有効になる", () => {
    process.env.CALENDAR_TIMING_LOG = "true";
    expect(serverTimingLogEnabled()).toBe(true);
    process.env.CALENDAR_TIMING_LOG = "1";
    expect(serverTimingLogEnabled()).toBe(true);
    process.env.CALENDAR_TIMING_LOG = "TRUE";
    expect(serverTimingLogEnabled()).toBe(true);
  });

  it("false や空では有効にならない", () => {
    process.env.CALENDAR_TIMING_LOG = "false";
    expect(serverTimingLogEnabled()).toBe(false);
    process.env.CALENDAR_TIMING_LOG = "";
    expect(serverTimingLogEnabled()).toBe(false);
  });
});

describe("出力", () => {
  function captureFlush(
    run: (t: ReturnType<typeof startServerTimingLog>) => void,
  ): { scope: string; totalMs: number; steps: Record<string, number> } {
    process.env.CALENDAR_TIMING_LOG = "true";
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const t = startServerTimingLog("move-construction-case");
    run(t);
    const call = info.mock.calls[0];
    expect(call?.[0]).toBe("[timing]");
    return JSON.parse(String(call?.[1]));
  }

  it("★ 1行に scope・合計・段階ごとの ms を出す", () => {
    const out = captureFlush((t) => {
      t.mark("fields");
      t.mark("source-get");
      t.flush();
    });

    expect(out.scope).toBe("move-construction-case");
    expect(typeof out.totalMs).toBe("number");
    expect(Object.keys(out.steps)).toEqual(["fields", "source-get"]);
    for (const ms of Object.values(out.steps)) {
      expect(typeof ms).toBe("number");
      expect(ms).toBeGreaterThanOrEqual(0);
    }
  });

  it("同じ段階名を複数回 mark したら足し込む", () => {
    const out = captureFlush((t) => {
      t.mark("audit");
      t.mark("audit");
      t.flush();
    });

    expect(Object.keys(out.steps)).toEqual(["audit"]);
  });

  it("extra を足せる（結果の分類など）", () => {
    const out = captureFlush((t) => {
      t.flush({ result: "ok", movedTo: "slot" });
    }) as unknown as Record<string, unknown>;

    expect(out.result).toBe("ok");
    expect(out.movedTo).toBe("slot");
  });

  it("★ 個人情報を出す口が無い（出るのは scope・数値・段階名だけ）", () => {
    const out = captureFlush((t) => {
      t.mark("w1-write");
      t.flush({ result: "ok" });
    }) as unknown as Record<string, unknown>;

    // お客様名・T番号・レコードIDを載せる経路が無いことを、
    // 出力キーの集合で固定する
    expect(Object.keys(out).sort()).toEqual([
      "result",
      "scope",
      "steps",
      "totalMs",
    ]);
  });
});
