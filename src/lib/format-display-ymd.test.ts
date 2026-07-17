import { describe, expect, it } from "vitest";

import { formatDisplayYmd } from "@/lib/format-display-ymd";

describe("formatDisplayYmd", () => {
  it("formats YYYY-MM-DD with zero padding", () => {
    expect(formatDisplayYmd("2026-07-18")).toBe("2026/07/18");
  });

  it("formats datetime strings", () => {
    expect(formatDisplayYmd("2026-07-18 09:30:00")).toBe("2026/07/18");
  });

  it("formats slash input with single-digit month/day", () => {
    expect(formatDisplayYmd("2026/7/8")).toBe("2026/07/08");
  });

  it("returns empty for invalid or empty input", () => {
    expect(formatDisplayYmd("")).toBe("");
    expect(formatDisplayYmd("   ")).toBe("");
    expect(formatDisplayYmd("not-a-date")).toBe("");
    expect(formatDisplayYmd("2026-13-01")).toBe("");
  });
});
