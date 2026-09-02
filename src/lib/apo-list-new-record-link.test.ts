import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * アポ情報一覧から「新規登録」ボタンを消した件。
 *
 * 6011ef6 で /apo-acquisition（アポ取得時入力）へ案内していたが、アポの
 * 新規登録は別のウェブページで行う運用に変わり、この画面から使わなくなった。
 *
 * ⚠ /apo-acquisition の画面とコードは**残す**。使わないことが確定してから
 *    消すほうが安全で、Dropbox 連携・監査ログ・自動採番に繋がっているため。
 *    導線が消えたことが次に読む人へ伝わっているかも、ここで固定する。
 */

const ROOT = process.cwd();
const LIST = "src/app/apo-list/page.tsx";
const ACQUISITION = "src/app/apo-acquisition/page.tsx";

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

describe("アポ情報一覧の「新規登録」", () => {
  it("★ ボタンが無い", () => {
    const src = read(LIST);

    expect(src).not.toContain('href="/apo-acquisition"');
    // 画面に出る文字としての「新規登録」が無い（経緯のコメントには残る）
    const label = src
      .split("\n")
      .some((line) => line.trim() === "新規登録");
    expect(label).toBe(false);
  });

  it("★ 使わなくなった import も残さない", () => {
    const src = read(LIST);

    expect(src).not.toContain('from "next/link"');
    expect(src).not.toContain("<Link");
  });

  it("★ 「進行中 / すべて」の切り替えは残っている", () => {
    const src = read(LIST);

    expect(src).toContain("<ApoListScopeTabs value={scope} onChange={setScope} />");
  });

  it("★ タブは横並びの器から出して元の形へ戻す（余白が崩れない）", () => {
    const src = read(LIST);

    // ボタンと横に並べるための flex 行は要らない
    expect(src).toContain(
      '<div className="mb-4">\n          <ApoListScopeTabs',
    );
    expect(src).not.toContain('className="mb-4 flex items-center gap-2"');
    expect(src).not.toContain('className="min-w-0 flex-1"');
  });

  it("★ 一覧の中身は触っていない", () => {
    const src = read(LIST);

    /*
     * 渡す値は段階C（商談ステータス編集）で増えたので、1行の丸ごと一致では
     * 見なくなった。ここで守りたいのは「絞り込み後の行と idToken を
     * そのまま渡していること」だけ
     */
    expect(src).toContain("<ApoListRows");
    expect(src).toContain("rows={visibleRows}");
    expect(src).toContain("idToken={idToken}");
    expect(src).toContain('id="apo-list-panel"');
    expect(src).toContain('role="tabpanel"');
  });

  it("★ 消した経緯がその場に残っている", () => {
    const src = read(LIST);

    expect(src).toContain("6011ef6");
    expect(src).toContain("別のウェブページで行う運用に変わり");
  });
});

describe("/apo-acquisition は残す", () => {
  it("★ 画面が消えていない", () => {
    expect(() => read(ACQUISITION)).not.toThrow();
    expect(read(ACQUISITION)).toContain('"use client"');
  });

  it("★ 導線が無いことが冒頭に書いてある", () => {
    const src = read(ACQUISITION);
    const head = src.slice(0, src.indexOf("const LIFF_ID"));

    expect(head).toContain("アプリ内にこの画面への導線は無い");
    expect(head).toContain("別のウェブページで行う運用に変更された");
    expect(head).toContain("画面とコードは残してある");
  });

  it("★ 消すときに一緒に見る場所が書いてある", () => {
    const src = read(ACQUISITION);
    const head = src.slice(0, src.indexOf("const LIFF_ID"));

    expect(head).toContain("apo-attachment-upload");
    expect(head).toContain("apo-record-lookup");
    // 一覧が使っているものは巻き添えにしない
    expect(head).toContain("apo-detail-fields");
  });
});

describe("アプリ内の導線", () => {
  it("★ /apo-acquisition へのリンクがどこにも無い", () => {
    for (const rel of [
      LIST,
      "src/app/page.tsx",
      "src/app/apo-acquisition/page.tsx",
    ]) {
      expect(read(rel), rel).not.toContain('href="/apo-acquisition"');
    }
  });
});
