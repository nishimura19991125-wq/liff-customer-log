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

  it("★ 案件カードの @pocket 呼び出しは分岐の中だけ", () => {
    const src = read(PAGE);

    // 工事カレンダーは showCaseAccessLink: false なのでこの分岐を通らない
    expect(src.indexOf("{caseAccessLinkEnabled ? (")).toBeLessThan(
      src.indexOf("openExternal(item.accessEditUrl)"),
    );
  });
});


/**
 * 空き枠カードの @pocket 導線も消した件。
 *
 * 案件カードと同じ理由（参照から編集につながる）。
 *
 * ⚠ 空き枠のカードは**画面ごとに別の部品**になっている。
 *    enableEmptySlotFill が true なら EmptySlotCard（工事カレンダー）、
 *    false なら CalendarEmptySlotReadOnly（コミュニケーションブリッジ）。
 *    共用ではないので、設定での出し分けは要らない。
 */
describe("空き枠カードの導線", () => {
  /** 関数定義の本体だけを切り出す（次の関数定義の手前まで） */
  function bodyOf(src: string, signature: string): string {
    const from = src.indexOf(signature);
    if (from < 0) throw new Error(`見つからない: ${signature}`);
    const to = src.indexOf("\nfunction ", from + 1);
    return to > from ? src.slice(from, to) : src.slice(from);
  }

  it("★ 画面ごとに別の部品が出る（共用ではない）", () => {
    expect(CONSTRUCTION_CALENDAR_PAGE_CONFIG.enableEmptySlotFill).toBe(true);
    expect(COMMUNICATION_BRIDGE_CALENDAR_PAGE_CONFIG.enableEmptySlotFill).toBe(
      false,
    );

    const src = read(PAGE);
    expect(src).toContain("{config.enableEmptySlotFill ? (");
    expect(src.indexOf("<EmptySlotCard")).toBeLessThan(
      src.indexOf("<CalendarEmptySlotReadOnly"),
    );
  });

  it("★ 工事カレンダー側（EmptySlotCard）から @pocket を開けない", () => {
    const card = bodyOf(read(PAGE), "function EmptySlotCard({");

    expect(card).not.toContain("openExternal(");
    expect(card).not.toContain("@pocket で開く");
  });

  it("★ 「情報を入力」は残っている", () => {
    const card = bodyOf(read(PAGE), "function EmptySlotCard({");

    expect(card).toContain('{open ? "入力を閉じる" : "情報を入力"}');
  });

  it("★ ブリッジ側（CalendarEmptySlotReadOnly）は触っていない", () => {
    const card = bodyOf(read(PAGE), "function CalendarEmptySlotReadOnly({");

    // 添付画像の下のボタンと、カード全体のタップ。どちらも従来どおり
    expect(card).toContain("@pocket で開く →");
    expect(card).toContain("タップして @pocket で開く →");
    expect(card).toContain("onOpenPocket(url)");
  });

  it("★ 工事カレンダーの実行経路に @pocket の導線が残っていない", () => {
    const src = read(PAGE);

    // 残る呼び出しは、どちらも工事カレンダーでは通らない分岐の中にある
    //   renderCaseCard            … showCaseAccessLink: false で通らない
    //   CalendarEmptySlotReadOnly … enableEmptySlotFill: true なので出ない
    expect(CONSTRUCTION_CALENDAR_PAGE_CONFIG.showCaseAccessLink).toBe(false);
    expect(CONSTRUCTION_CALENDAR_PAGE_CONFIG.enableEmptySlotFill).toBe(true);
    expect(src.split("openExternal(item.accessEditUrl)").length - 1).toBe(1);
    expect(src).toContain("onOpenPocket={openExternal}");
  });
});

/**
 * 案件カードからアプリ内のお客様情報（契約情報入力フォーム）を開く導線。
 *
 * @pocket の導線（showCaseAccessLink: false）とは別物で、こちらは
 * 方針が推奨する編集経路なので工事カレンダーで開ける。
 *
 * ⚠ カード本文の器（caseCardBody を包む分岐）には触らない。上の
 *    describe がソース文字列で構造を固定しているため、器に足すと
 *    そちらが落ちる。ボタンは「工事対応者の変更」「工事日を変更」
 *    「地図」と同じく**器の外の兄弟**に置く。
 */
describe("お客様情報への導線", () => {
  it("★ 工事カレンダーでだけ出す（ブリッジは未指定＝出さない）", () => {
    expect(CONSTRUCTION_CALENDAR_PAGE_CONFIG.showCustomerInfoLink).toBe(true);
    expect(
      COMMUNICATION_BRIDGE_CALENDAR_PAGE_CONFIG.showCustomerInfoLink,
    ).toBeUndefined();
  });

  it("★ @pocket の導線は閉じたまま", () => {
    // アプリ内の導線を足したことで、@pocket が開くようになっていないこと
    expect(CONSTRUCTION_CALENDAR_PAGE_CONFIG.showCaseAccessLink).toBe(false);
    expect(read(PAGE).split("openExternal(item.accessEditUrl)").length - 1).toBe(
      1,
    );
  });

  it("★ ボタンは器の外にある（本文の分岐に足していない）", () => {
    const src = read(PAGE);
    const branchEnd = src.indexOf("                            )}");

    expect(src.indexOf("<CaseCustomerInfoLink")).toBeGreaterThan(branchEnd);
    // 器は2つのまま（本文の参照も2つ）
    expect(src.split("{caseCardBody}").length - 1).toBe(2);
  });

  it("★ 出す条件は共有の関数だけで決める", () => {
    const src = read(PAGE);

    expect(src).toContain("if (!shouldShowCustomerInfoLink(config, tNumber)) return null;");
    // 画面側で設定や T番号を見直していない
    expect(src).not.toContain("config.showCustomerInfoLink ===");
  });

  it("★ 遷移するのは変換に成功したときだけ", () => {
    const src = read(PAGE);
    const from = src.indexOf("const outcome = customerInfoLinkOutcome(");
    const block = src.slice(from, from + 300);

    expect(block).toContain('if (outcome.kind === "open") {');
    expect(block).toContain("router.push(outcome.href);");
    // 失敗時は文言を出すだけ。router.push より後ろにある
    expect(block.indexOf("setError(outcome.text);")).toBeGreaterThan(
      block.indexOf("router.push(outcome.href);"),
    );
  });

  it("★ 通信中は押したカードだけが待ち状態になる", () => {
    const card = read(PAGE).slice(
      read(PAGE).indexOf("function CaseCustomerInfoLink({"),
      read(PAGE).indexOf("\nfunction EmptySlotCard({"),
    );

    // 状態はカード部品が自分で持つ（ページ側の共有 state ではない）
    expect(card).toContain("const [loading, setLoading] = useState(false);");
    expect(card).toContain("if (loading) return;");
    expect(card).toContain("disabled={loading}");
  });
});
