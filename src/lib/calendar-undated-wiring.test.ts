import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 第3段階 3-3 の配線（ソースを直接見る）。
 *
 * 挙動ではなく**どこへ繋がっているか**を固定する。ここが狂うと、
 * 画面が「空き枠を削除する旧ルート」へ戻ったことに誰も気づけない。
 * レンダリングを組まずに済む代わり、対象は文字列一致に限っている。
 *
 * 3-4 で旧ルートを撤去したら、このファイルの「残っている」側の
 * 確認も一緒に外すこと。
 */

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

const CALL_SITES = [
  "src/components/calendar-assign-undated-case-form.tsx",
  "src/components/liff-calendar-month-page.tsx",
] as const;

const OLD_ROUTE_PATHS = [
  "/api/calendar/assign-case-to-slot",
  "/api/calendar/schedule-undated-case",
] as const;

describe("画面の送信先（3-3）", () => {
  it("★ 2箇所とも新ルートへ送っている", () => {
    for (const rel of CALL_SITES) {
      const src = read(rel);
      expect(
        src.includes("ASSIGN_CUSTOMER_CASE_PATH") ||
          src.includes("/api/calendar/assign-customer-case"),
        `${rel} が新ルートを参照していない`,
      ).toBe(true);
    }
  });

  it("★ 旧ルートを呼んでいない", () => {
    for (const rel of CALL_SITES) {
      const src = read(rel);
      for (const oldPath of OLD_ROUTE_PATHS) {
        expect(src.includes(oldPath), `${rel} が ${oldPath} を呼んでいる`).toBe(
          false,
        );
      }
    }
  });

  it("★ 空き枠の確認ダイアログを使っていない", () => {
    const src = read("src/components/calendar-assign-undated-case-form.tsx");
    expect(src).not.toContain("CalendarEmptySlotConfirmDialog");
  });

  it("★ 「空き枠は削除されます」の文言が残っていない", () => {
    for (const rel of CALL_SITES) {
      expect(read(rel), `${rel} に削除前提の文言が残っている`).not.toContain(
        "空き枠は削除されます",
      );
    }
  });
});

describe("旧経路は残してある（撤去は 3-4）", () => {
  it("★ 旧ルートのファイルを消していない", () => {
    for (const rel of [
      "src/app/api/calendar/assign-case-to-slot/route.ts",
      "src/app/api/calendar/schedule-undated-case/route.ts",
    ]) {
      expect(existsSync(path.join(ROOT, rel)), `${rel} が無い`).toBe(true);
    }
  });

  it("★ 旧の抽出処理を消していない", () => {
    const src = read("src/lib/calendar-undated-cases.ts");
    expect(src).toContain("export function buildUndatedConstructionCases");
  });

  it("空き枠入力（fill-empty-slot）はそのまま残っている", () => {
    expect(
      existsSync(
        path.join(ROOT, "src/app/api/calendar/fill-empty-slot/route.ts"),
      ),
    ).toBe(true);
    // 空き枠カードの「新規入力」は従来どおりこちらへ送る
    expect(read("src/components/liff-calendar-month-page.tsx")).toContain(
      "/api/calendar/fill-empty-slot",
    );
  });

  it("新規登録（create-record）はそのまま残っている", () => {
    expect(read("src/components/liff-calendar-month-page.tsx")).toContain(
      "/api/calendar/create-record",
    );
  });
});

/**
 * 3-3 では「deleteRecord を呼ぶのは assign-case-to-slot だけ」を固定していた。
 * 案B で assign-customer-case にも削除が入ったため、**呼んでよい経路の一覧**
 * を固定する形へ置き換える。増えたことに誰も気づけない状態にはしない。
 */
describe("物理削除の呼び出し口（案B）", () => {
  /** deleteRecord を呼んでよい経路。ここを増やすときは必ず理由を書くこと */
  const DELETE_ALLOWED = [
    "src/app/api/calendar/assign-case-to-slot/route.ts",
    "src/app/api/calendar/assign-customer-case/route.ts",
  ] as const;

  /** 削除を1件も増やさない設計にした経路 */
  const DELETE_FORBIDDEN = [
    "src/app/api/calendar/move-construction-case/route.ts",
    "src/app/api/calendar/fill-empty-slot/route.ts",
    "src/app/api/calendar/schedule-undated-case/route.ts",
    "src/app/api/calendar/create-record/route.ts",
  ] as const;

  it("★ 削除を呼ぶのは許可した2経路だけ", () => {
    for (const rel of DELETE_FORBIDDEN) {
      const src = read(rel);
      expect(src, `${rel} が deleteRecord を呼んでいる`).not.toContain(
        "deleteRecord(",
      );
    }
    for (const rel of DELETE_ALLOWED) {
      expect(read(rel), `${rel} が deleteRecord を呼んでいない`).toContain(
        "deleteRecord(",
      );
    }
  });

  it("★ assign-customer-case の削除は判定関数と削除ログを通る", () => {
    const route = read("src/app/api/calendar/assign-customer-case/route.ts");
    // 可否判定を素通しして消していない
    expect(route).toContain("decideEmptySlotDeletion");
    // A-4: 全項目を記録できたときだけ消す
    expect(route).toContain("formatDeletionContent");
    expect(route).toContain("if (!deletionLog.ok)");
    // 止められる形になっている
    expect(route).toContain("assignDeletesEmptySlotEnabled");
  });

  it("★ 空き枠を案件に変える経路では消さない", () => {
    const route = read("src/app/api/calendar/assign-customer-case/route.ts");
    // 削除は「既存レコードへ書いたあと」の1箇所だけ
    expect(route.split("await deleteRecord(").length - 1).toBe(1);
    expect(route).toContain("deleteEmptySlotAfterExistingWrite");
  });
});
