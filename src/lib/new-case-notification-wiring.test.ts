import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 新規案件通知の配線（ソースを直接見る）。
 *
 * 挙動ではなく**どのルートが通知を頼むか**を固定する。通知は
 * 「T番号 が新規発行されたときだけ」で、採番するのはお客様情報アプリ。
 * 既存の T番号 を使い回す操作にまで広がると、同じ案件の通知が何度も飛ぶ。
 * 逆に頼み忘れると黙って届かなくなる（実機で空き枠の新規入力が落ちていた）。
 *
 * レンダリングやモックを組まずに済む代わり、対象は文字列一致に限っている。
 */

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

const FINALIZE = "src/lib/calendar-after-construction-save.ts";

/** 通知を頼まないルート。いずれも入口で既存の T番号 を必須にしている */
const NO_NOTIFY_ROUTES = [
  "src/app/api/calendar/assign-customer-case/route.ts",
  "src/app/api/calendar/assign-case-to-slot/route.ts",
  "src/app/api/calendar/schedule-undated-case/route.ts",
  "src/app/api/calendar/move-construction-case/route.ts",
] as const;

describe("通知を頼むルート", () => {
  it("★ 空き枠の新規入力は連携の結果で決めさせる", () => {
    const route = read("src/app/api/calendar/fill-empty-slot/route.ts");
    expect(route).toContain('notifyNewCase: "when-customer-info-created"');
    // 常に送ると、既存のお客様情報を引き当てた更新でも飛ぶ
    expect(route).not.toContain("notifyNewCase: true");
  });

  it("★ 新規登録は呼び出し側が新規発行だと知っている", () => {
    expect(read("src/app/api/calendar/create-record/route.ts")).toContain(
      "notifyNewCase: true",
    );
  });

  it("★ 既存の T番号 を使い回すルートは頼まない", () => {
    for (const rel of NO_NOTIFY_ROUTES) {
      expect(read(rel), `${rel} が通知を頼んでいる`).not.toContain(
        "notifyNewCase",
      );
    }
  });
});

describe("送るかどうかの判定", () => {
  it("★ 連携の結果を見るのは後処理の1箇所だけ", () => {
    const finalize = read(FINALIZE);
    // 説明のための言及ではなく、実際に値を読んでいる箇所を数える
    expect(finalize.split("customerSync.customerInfoCreated").length - 1).toBe(
      1,
    );
  });

  it("★ ルート側は連携の結果を見て判定し直さない", () => {
    for (const rel of [
      "src/app/api/calendar/fill-empty-slot/route.ts",
      "src/app/api/calendar/create-record/route.ts",
      ...NO_NOTIFY_ROUTES,
    ]) {
      expect(read(rel), `${rel} が判定を写している`).not.toContain(
        "customerInfoCreated",
      );
    }
  });
});
