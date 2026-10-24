import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * トップページの「打刻ページ」リンク。
 *
 * 社内共通の中の勤怠管理は気づかれにくかったため、ダッシュボードの
 * 工事対応の下へ移した。置くのはリンクだけで、打刻も勤怠状態の取得も
 * トップページでは行わない。
 *
 * このリポジトリにはコンポーネントを描画する仕組みが無いため、
 * ソースの文字列で配線を確かめる。
 */

const PAGE = "src/app/page.tsx";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

/** `title="打刻ページ"` を含む `<LiffMenuCard ... />` の開始タグ全体 */
function punchLinkElement(src: string): string | null {
  const titleAt = src.indexOf('title="打刻ページ"');
  if (titleAt < 0) return null;
  const start = src.lastIndexOf("<LiffMenuCard", titleAt);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start + 1; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (depth === 0 && ch === ">") return src.slice(start, i + 1);
  }
  return null;
}

/** 社内共通の開閉ボタンから、展開されるメニューの終わりまで */
function internalCommonSection(src: string): string {
  const start = src.indexOf('aria-controls="internal-common-menu"');
  const menuAt = src.indexOf('id="internal-common-menu"');
  const end = src.indexOf(") : null}", menuAt);
  expect(start).toBeGreaterThan(-1);
  expect(menuAt).toBeGreaterThan(start);
  expect(end).toBeGreaterThan(menuAt);
  return src.slice(start, end);
}

describe("★ トップページに打刻ページへのリンクがある", () => {
  it("★ 既存のメニューカードで「打刻ページ」を置いている", () => {
    const el = punchLinkElement(read(PAGE));
    expect(el).not.toBeNull();
    expect(el!.startsWith("<LiffMenuCard")).toBe(true);
  });

  it("★ リンク先は勤怠画面", () => {
    const el = punchLinkElement(read(PAGE));
    expect(el).toContain('href="/attendance"');
  });

  it("★ 紐付けが済むまで押せない条件は旧メニューと同じ", () => {
    const el = punchLinkElement(read(PAGE));
    expect(el).toContain("disabled={needsStaffBind}");
  });
});

describe("★ 置き場所はダッシュボードの中、工事対応の後ろ", () => {
  it("★ HomeCompactSummaries の children で、HomeConstructionHandlerCases より後ろ", () => {
    const src = read(PAGE);
    const open = src.indexOf("<HomeCompactSummaries");
    const cases = src.indexOf("<HomeConstructionHandlerCases");
    const link = src.indexOf('title="打刻ページ"');
    const close = src.indexOf("</HomeCompactSummaries>");

    expect(open).toBeGreaterThan(-1);
    expect(cases).toBeGreaterThan(open);
    expect(link).toBeGreaterThan(cases);
    expect(close).toBeGreaterThan(link);
  });
});

describe("★ 社内共通に勤怠管理は無い", () => {
  it("★ 社内共通のメニューに勤怠管理のカードも勤怠画面へのリンクも無い", () => {
    const section = internalCommonSection(read(PAGE));
    expect(section).not.toContain("勤怠管理");
    expect(section).not.toContain('href="/attendance"');
  });

  it("稼働終了報告と社内イベントは社内共通に残っている", () => {
    const section = internalCommonSection(read(PAGE));
    expect(section).toContain('href="/work-end-report"');
    expect(section).toContain('href="/internal-events"');
  });

  it("勤怠画面へのリンクはトップページに1つだけ", () => {
    const src = read(PAGE);
    expect(src.split('href="/attendance"').length - 1).toBe(1);
  });
});

describe("★ トップページは打刻も勤怠状態の取得もしない", () => {
  it("★ 勤怠の API を呼んでいない", () => {
    const src = read(PAGE);
    expect(src).not.toContain("/api/attendance");
  });
});
