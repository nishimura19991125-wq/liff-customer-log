import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  COMMUNICATION_BRIDGE_CALENDAR_PAGE_CONFIG,
  CONSTRUCTION_CALENDAR_PAGE_CONFIG,
} from "@/lib/liff-calendar-page-config";

/**
 * 工事カレンダーから @pocket への導線を消した件。
 *
 * 管理者以外は @pocket 側で編集できない設定になっているが、導線があると
 * 参照から編集につながる。アプリ側（工事日を変更・工事対応者の変更）で
 * 操作してもらう。
 *
 * ⚠ 画面部品はコミュニケーションブリッジと共用している。あちらは別の画面
 *    なので従来どおり開ける。ここではその切り分けを固定する。
 */

const ROOT = process.cwd();
const PAGE = "src/components/liff-calendar-month-page.tsx";

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

describe("工事カレンダーの設定", () => {
  it("★ 案件カードから @pocket を開かせない", () => {
    expect(CONSTRUCTION_CALENDAR_PAGE_CONFIG.showCaseAccessLink).toBe(false);
  });

  it("★ 説明文から @pocket の記述が消えている", () => {
    const d = CONSTRUCTION_CALENDAR_PAGE_CONFIG.description;

    expect(d).not.toContain("@pocket");
    expect(d).not.toContain("案件は");
  });

  it("★ 残りの文章はそのまま（日付の見方・空き枠の入力）", () => {
    expect(CONSTRUCTION_CALENDAR_PAGE_CONFIG.description).toBe(
      "日付をタップで下に一覧表示。工事空枠は「情報を入力」からお客様名を登録できます。",
    );
  });

  it("★ 空き枠の入力は残す（今回の対象外）", () => {
    expect(CONSTRUCTION_CALENDAR_PAGE_CONFIG.enableEmptySlotFill).toBe(true);
    expect(CONSTRUCTION_CALENDAR_PAGE_CONFIG.enableNewRecordPanel).toBe(true);
  });
});

describe("他の画面は変えない", () => {
  it("★ コミュニケーションブリッジは従来どおり開ける", () => {
    // 未指定＝既定（開ける）。閉じるなら false を足すだけ
    expect(
      COMMUNICATION_BRIDGE_CALENDAR_PAGE_CONFIG.showCaseAccessLink,
    ).toBeUndefined();
  });

  it("★ ブリッジの説明文は触っていない", () => {
    expect(COMMUNICATION_BRIDGE_CALENDAR_PAGE_CONFIG.description).toBe(
      "日付をタップで下に一覧表示します。添付画像をタップして拡大表示できます。",
    );
  });
});

describe("案件カードの配線", () => {
  it("★ 設定で出し分ける（無条件に消さない）", () => {
    const src = read(PAGE);

    expect(src).toContain(
      "const caseAccessLinkEnabled = config.showCaseAccessLink !== false;",
    );
    expect(src).toContain("{caseAccessLinkEnabled ? (");
  });

  it("★ 開かせないときはボタンにしない（タップしても何も起きない）", () => {
    const src = read(PAGE);
    const block = src.slice(
      src.indexOf("{caseAccessLinkEnabled ? ("),
      src.indexOf("{caseAccessLinkEnabled ? (") + 1200,
    );

    expect(block).toContain(') : (\n                              <div className="w-full px-4 py-4 text-left">');
    expect(block).toContain("{caseCardBody}");
  });

  it("★ 本文はどちらの器でも同じものを出す", () => {
    const src = read(PAGE);

    expect(src).toContain("const caseCardBody = (");
    // 器が2つ、本文の参照も2つ
    expect(src.split("{caseCardBody}").length - 1).toBe(2);
  });

  it("★ 工事日を変更・工事対応者・地図は器の外にある（影響しない）", () => {
    const src = read(PAGE);
    const branchEnd = src.indexOf("                            )}");

    expect(src.indexOf("<CaseConstructionHandlerEditor")).toBeGreaterThan(
      branchEnd,
    );
    expect(src.indexOf("<CalendarMoveCasePanel")).toBeGreaterThan(branchEnd);
    expect(src.indexOf("<MapNavigationButton")).toBeGreaterThan(branchEnd);
  });

  it("★ 空き枠カードの導線は残っている（今回の対象外）", () => {
    const src = read(PAGE);

    // EmptySlotCard の「@pocket で開く」
    expect(src).toContain("@pocket で開く");
    expect(src).toContain("onClick={() => openExternal(item.accessEditUrl)}");
  });
});
