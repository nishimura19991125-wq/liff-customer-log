import { describe, expect, it } from "vitest";

import { safeHttpsUrl } from "@/lib/safe-external-url";

describe("safeHttpsUrl", () => {
  it("https:// のURLは通す", () => {
    expect(safeHttpsUrl("https://www.dropbox.com/home/BY")).toBe(
      "https://www.dropbox.com/home/BY",
    );
    expect(safeHttpsUrl("https://example.test/a?b=1#c")).toBe(
      "https://example.test/a?b=1#c",
    );
  });

  it("スキームの大文字・小文字は問わない", () => {
    expect(safeHttpsUrl("HTTPS://example.test/x")).toBe(
      "HTTPS://example.test/x",
    );
  });

  it("前後の空白はトリムして判定する", () => {
    expect(safeHttpsUrl("  https://example.test/x  ")).toBe(
      "https://example.test/x",
    );
  });

  it("危険なスキームは通さない", () => {
    expect(safeHttpsUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpsUrl("JavaScript:alert(1)")).toBeNull();
    expect(safeHttpsUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(safeHttpsUrl("vbscript:msgbox(1)")).toBeNull();
    expect(safeHttpsUrl("file:///etc/passwd")).toBeNull();
  });

  it("http:// は通さない（https のみ）", () => {
    expect(safeHttpsUrl("http://example.test/x")).toBeNull();
  });

  it("スキームが無い値は通さない", () => {
    expect(safeHttpsUrl("www.dropbox.com/home")).toBeNull();
    expect(safeHttpsUrl("/BY/1.顧客情報")).toBeNull();
    expect(safeHttpsUrl("フォルダは共有済み")).toBeNull();
  });

  it("空・未入力は通さない", () => {
    expect(safeHttpsUrl("")).toBeNull();
    expect(safeHttpsUrl("   ")).toBeNull();
    expect(safeHttpsUrl("-")).toBeNull();
    expect(safeHttpsUrl(undefined)).toBeNull();
    expect(safeHttpsUrl(null)).toBeNull();
  });

  it("制御文字を含む値は通さない", () => {
    const LF = String.fromCharCode(10);
    const TAB = String.fromCharCode(9);
    const NUL = String.fromCharCode(0);
    // 改行を挟んで別スキームに見せかける細工を防ぐ
    expect(safeHttpsUrl(`java${LF}script:alert(1)`)).toBeNull();
    expect(safeHttpsUrl(`https://example.test/${LF}x`)).toBeNull();
    expect(safeHttpsUrl(`https://example.test/${TAB}x`)).toBeNull();
    expect(safeHttpsUrl(`https://example.test/${NUL}`)).toBeNull();
  });

  it("URL として解釈できない値は通さない", () => {
    expect(safeHttpsUrl("https://")).toBeNull();
  });

  it("https を含むだけの文字列は通さない（前方一致で判定する）", () => {
    expect(safeHttpsUrl("javascript:void('https://x')")).toBeNull();
    expect(safeHttpsUrl("メモ https://example.test/x")).toBeNull();
  });
});
