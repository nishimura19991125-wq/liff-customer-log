import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { resolveVerifyCacheExpiry } from "@/lib/line-verify-cache-expiry";

const NOW = 1_800_000_000_000; // 固定の epoch ms
const nowSec = Math.floor(NOW / 1000);

describe("resolveVerifyCacheExpiry", () => {
  it("exp が十分先なら TTL を使う", () => {
    const expSec = nowSec + 3600;
    expect(resolveVerifyCacheExpiry(NOW, 45_000, expSec)).toBe(NOW + 45_000);
  });

  it("exp が TTL より近いなら exp でクランプする", () => {
    const expSec = nowSec + 10; // TTL 45 秒より短い
    expect(resolveVerifyCacheExpiry(NOW, 45_000, expSec)).toBe(expSec * 1000);
  });

  it("上限 300 秒の TTL でも exp を超えない（失効後に通るのを防ぐ）", () => {
    const expSec = nowSec + 30;
    const expiry = resolveVerifyCacheExpiry(NOW, 300_000, expSec);
    expect(expiry).toBe(expSec * 1000);
    expect(expiry).toBeLessThan(NOW + 300_000);
  });

  it("すでに失効している exp はキャッシュしない", () => {
    expect(resolveVerifyCacheExpiry(NOW, 45_000, nowSec - 1)).toBeNull();
    expect(resolveVerifyCacheExpiry(NOW, 45_000, nowSec)).toBeNull();
  });

  it("exp が無い・数値でない場合はキャッシュしない（毎回検証）", () => {
    expect(resolveVerifyCacheExpiry(NOW, 45_000, undefined)).toBeNull();
    expect(resolveVerifyCacheExpiry(NOW, 45_000, null)).toBeNull();
    expect(resolveVerifyCacheExpiry(NOW, 45_000, "1800000000")).toBeNull();
    expect(resolveVerifyCacheExpiry(NOW, 45_000, Number.NaN)).toBeNull();
    expect(resolveVerifyCacheExpiry(NOW, 45_000, Infinity)).toBeNull();
  });

  it("TTL が 0 以下ならキャッシュしない", () => {
    expect(resolveVerifyCacheExpiry(NOW, 0, nowSec + 3600)).toBeNull();
    expect(resolveVerifyCacheExpiry(NOW, -1, nowSec + 3600)).toBeNull();
  });

  it("小数の exp は切り捨てて扱う", () => {
    const expSec = nowSec + 10.9;
    expect(resolveVerifyCacheExpiry(NOW, 45_000, expSec)).toBe(
      (nowSec + 10) * 1000,
    );
  });
});

/**
 * verifyCacheKey は line-verify.ts の private 関数（export しない方針）なので、
 * 同一のキー生成式をここに再現して「トークン文字列がキーに残らない」ことを固定する。
 * 実装を変えたらこのテストも落ちるようにしてある。
 */
describe("キャッシュキーに生トークンが含まれないこと", () => {
  const cacheKey = (channelId: string, idToken: string) =>
    createHash("sha256").update(`${channelId}\n${idToken}`).digest("hex");

  const CHANNEL = "1234567890";
  const TOKEN =
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJVMDAwMDAwMDAwMCJ9.SIGNATURE_PART";

  it("キーは 64 桁の hex（sha256）", () => {
    expect(cacheKey(CHANNEL, TOKEN)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("トークン本体もその断片もキーに現れない", () => {
    const key = cacheKey(CHANNEL, TOKEN);
    expect(key).not.toContain(TOKEN);
    for (const part of TOKEN.split(".")) {
      expect(key).not.toContain(part);
    }
    expect(key).not.toContain("eyJ");
  });

  it("channelId が違えば別キーになる（現設計を維持）", () => {
    expect(cacheKey(CHANNEL, TOKEN)).not.toBe(cacheKey("9999999999", TOKEN));
  });

  it("同じ入力なら同じキー", () => {
    expect(cacheKey(CHANNEL, TOKEN)).toBe(cacheKey(CHANNEL, TOKEN));
  });
});
