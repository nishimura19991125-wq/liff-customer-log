import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 工事日の変更を止める切り替えの配線（ソースを直接見る）。
 *
 * 画面は描画せずに確かめる流儀（calendar-move-case-wiring.test.ts と同じ）。
 * 「出すかどうか」の判定そのものは calendar-construction-move-flag.test.ts、
 * API の挙動は calendar-construction-move-gate.test.ts で固定している。
 */

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

const PAGE = "src/components/liff-calendar-month-page.tsx";
const PANEL = "src/components/calendar-move-case-panel.tsx";
const CALENDAR_GET = "src/app/api/calendar/route.ts";
const GATE = "rejectWhenConstructionMoveDisabled()";

const BLOCKED_ROUTES = [
  "src/app/api/calendar/move-construction-case/route.ts",
  "src/app/api/calendar/assign-case-to-slot/route.ts",
  "src/app/api/calendar/schedule-undated-case/route.ts",
] as const;

const KEPT_ROUTES = [
  "src/app/api/calendar/create-record/route.ts",
  "src/app/api/calendar/fill-empty-slot/route.ts",
  "src/app/api/calendar/assign-customer-case/route.ts",
  "src/app/api/calendar/update-construction-handler/route.ts",
  "src/app/api/customer-info/records/[recordId]/route.ts",
] as const;

/** 案件カードで「工事日を変更」パネルを出している箇所 */
function movePanelBlock(src: string): string {
  const at = src.indexOf("<CalendarMoveCasePanel");
  expect(at, "CalendarMoveCasePanel を出す箇所が無い").toBeGreaterThan(0);
  return src.slice(Math.max(0, at - 400), at);
}

describe("画面：「工事日を変更」", () => {
  it("★ フラグで出し分けている（押せないボタンではなく出さない）", () => {
    const before = movePanelBlock(read(PAGE));

    expect(before).toContain("shouldShowConstructionMovePanel(");
    expect(before).toContain(
      "constructionMoveEnabled: data?.constructionMoveEnabled",
    );
    expect(before).toContain("enableEmptySlotFill: config.enableEmptySlotFill");
  });

  it("★ 「工事対応者の変更」はフラグで隠さない", () => {
    const src = read(PAGE);
    const at = src.indexOf("<CaseConstructionHandlerEditor");
    expect(at).toBeGreaterThan(0);
    const before = src.slice(Math.max(0, at - 200), at);

    expect(before).toContain("handlerFromStaff ? (");
    expect(before).not.toContain("constructionMoveEnabled");
    expect(before).not.toContain("shouldShowConstructionMovePanel");
  });

  it("★ パネルのコードは残してある", () => {
    expect(existsSync(path.join(ROOT, PANEL))).toBe(true);
    expect(read(PANEL)).toContain("工事日を変更");
    expect(read(PAGE)).toContain("<CalendarMoveCasePanel");
  });

  it("★ 月データにフラグを載せる（キャッシュの外で毎回読む）", () => {
    const src = read(CALENDAR_GET);

    expect(src).toContain(
      "constructionMoveEnabled: isCalendarConstructionMoveEnabled()",
    );
    // キャッシュの中で作るとフラグを変えても最大でキャッシュの時間だけ残る
    const computeAt = src.indexOf("getOrComputeCalendarPayload(");
    const flagAt = src.indexOf(
      "constructionMoveEnabled: isCalendarConstructionMoveEnabled()",
    );
    const builtAt = src.indexOf("return buildCalendarPayload(");
    expect(computeAt).toBeGreaterThan(0);
    expect(flagAt).toBeGreaterThan(builtAt);
  });
});

describe("サーバ：止める3本・残す5本", () => {
  it.each(BLOCKED_ROUTES)("★ %s は入口で止める", (rel) => {
    const src = read(rel);
    const post = src.indexOf("export async function POST(");
    const gate = src.indexOf(GATE, post);
    const auth = src.indexOf("resolveCallerLineAuth(request)", post);

    expect(post).toBeGreaterThan(0);
    expect(gate, `${rel} に止める処理が無い`).toBeGreaterThan(post);
    // 認証より前＝何も読まないうちに止める
    expect(gate).toBeLessThan(auth);
  });

  it.each(KEPT_ROUTES)("★ %s は止めない", (rel) => {
    expect(read(rel)).not.toContain("rejectWhenConstructionMoveDisabled");
  });
});

describe(".env.local.example", () => {
  it("★ 変数と説明が書いてある（既定は false）", () => {
    const src = read(".env.local.example");

    expect(src).toContain("# CALENDAR_CONSTRUCTION_MOVE_ENABLED=false");
    expect(src).toContain("工事日を変更");
    expect(src).toContain("move-construction-case");
    expect(src).toContain("assign-case-to-slot");
    expect(src).toContain("schedule-undated-case");
  });
});
