import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { safeHttpsUrl } from "@/lib/safe-external-url";

/**
 * アポ情報一覧の Dropbox リンク（画面側）。
 *
 * ここで固定するのは
 *   ・開閉トグルの**外**に置くこと（button の入れ子を作らない）
 *   ・href に置く直前でもう一度 https を確かめること
 *   ・通らなければリンクにせず「Dropbox: 未設定」と出すこと
 * の3つ。DOM を組めないので配線はソースで見る（このリポジトリの流儀）。
 */

const ROOT = process.cwd();
const CARD = "src/components/apo-list-rows.tsx";

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

describe("置き場所", () => {
  it("★ 予定日時の下、開閉トグルの外にある", () => {
    const src = read(CARD);
    const dateAt = src.indexOf("商談・資料送付予定日時:");
    const toggleEndAt = src.indexOf("</button>", dateAt);
    const dropboxAt = src.indexOf("safeHttpsUrl(row.dropboxUrl)");

    expect(dateAt).toBeGreaterThan(-1);
    // トグルの button より後ろ＝入れ子になっていない
    expect(dropboxAt).toBeGreaterThan(toggleEndAt);
  });

  it("★ 詳細（アコーディオン）より前にある", () => {
    const src = read(CARD);

    expect(src.indexOf("safeHttpsUrl(row.dropboxUrl)")).toBeLessThan(
      src.indexOf("{open ? ("),
    );
  });
});

describe("リンクの出し方", () => {
  it("★ 外部へ開くことが分かる形にする", () => {
    const src = read(CARD);

    expect(src).toContain('target="_blank"');
    expect(src).toContain('rel="noopener noreferrer"');
    expect(src).toContain("Dropbox を開く");
  });

  it("★ href に置く直前でも https を確かめる", () => {
    const src = read(CARD);

    expect(src).toContain('from "@/lib/safe-external-url"');
    expect(src).toContain("const href = safeHttpsUrl(row.dropboxUrl);");
    expect(src).toContain("href={href}");
  });

  it("★ 通らなければ押せないボタンではなくテキストで出す", () => {
    const src = read(CARD);

    expect(src).toContain("Dropbox: 未設定");
    // disabled なボタンを置いていない
    const block = src.slice(
      src.indexOf("const href = safeHttpsUrl(row.dropboxUrl);"),
      src.indexOf("const href = safeHttpsUrl(row.dropboxUrl);") + 900,
    );
    expect(block).not.toContain("disabled");
  });
});

describe("URL の判定（safeHttpsUrl）", () => {
  it("★ https だけ通す", () => {
    expect(safeHttpsUrl("https://www.dropbox.com/scl/fo/abc")).toBe(
      "https://www.dropbox.com/scl/fo/abc",
    );
  });

  it("★ http・javascript・スキーム無しは通さない", () => {
    expect(safeHttpsUrl("http://www.dropbox.com/x")).toBeNull();
    expect(safeHttpsUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpsUrl("www.dropbox.com/x")).toBeNull();
  });

  it("★ 空・未入力表現は通さない", () => {
    expect(safeHttpsUrl("")).toBeNull();
    expect(safeHttpsUrl("   ")).toBeNull();
    expect(safeHttpsUrl("-")).toBeNull();
    expect(safeHttpsUrl(null)).toBeNull();
  });
});
