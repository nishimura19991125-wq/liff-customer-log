import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { safePocketErrorText } from "@/lib/api-error-response";

/**
 * @pocket の生メッセージを画面へ出さない（段階4）。
 *
 * 生メッセージには応答本文・appsId・operation・**使用した環境変数名**まで
 * 載っている（atpocket.ts の formatPocketHttpError）。集計や一覧のように
 * 「取得は失敗したが他の項目は返す」payload は `{ items: [], error: "…" }`
 * の形で文言を本文に持つため、pocketErrorResponse（応答そのものを作る）が
 * 使えず、各所で `error: msg` のまま素通ししていた。
 *
 * ここで固定するのは2つ。
 *   1. 画面へ出る文字列に内部情報が入らないこと
 *   2. 生メッセージは相関ID付きでサーバログに残ること
 */

/** 実物と同じ形（formatPocketHttpError の出力） */
const RAW =
  "@pocket list records failed: 500 Internal Server Error | operation=sales-dashboard:apo一覧 | appsId=12345 | appsEnv=SALES_DASHBOARD_APO_APP_ID | apiKey=SALES_DASHBOARD_APO_ATPOCKET_API_KEY_LIST_3";

const RAW_429 =
  "@pocket list records failed: 429 Too Many Requests | operation=apo-list | appsId=12345 | apiKey=SALES_DASHBOARD_APO_ATPOCKET_API_KEY";

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // 本番と同じ扱い（API_ERROR_DETAIL は NODE_ENV より先に効く）
  process.env.API_ERROR_DETAIL = "0";
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

function loggedText(): string {
  return errorSpy.mock.calls
    .map((c) => c.map((x) => String(x)).join(" "))
    .join("\n");
}

describe("safePocketErrorText", () => {
  it("★ 固定文言＋相関IDだけを返す", () => {
    const text = safePocketErrorText(new Error(RAW), {
      scope: "sales-dashboard:apo",
      message: "アポ件数ランキングの取得に失敗しました",
    });

    expect(text).toMatch(
      /^アポ件数ランキングの取得に失敗しました（ID: [0-9a-f]{8}）$/,
    );
  });

  it("★ appsId・環境変数名・operation・応答本文が画面へ出ない", () => {
    const text = safePocketErrorText(new Error(RAW), {
      scope: "sales-dashboard:apo",
      message: "アポ件数ランキングの取得に失敗しました",
    });

    for (const leak of [
      "appsId",
      "12345",
      "apiKey",
      "SALES_DASHBOARD_APO_ATPOCKET_API_KEY_LIST_3",
      "appsEnv",
      "operation",
      "@pocket",
      "Internal Server Error",
    ]) {
      expect(text, leak).not.toContain(leak);
    }
  });

  it("★ 429 は上限の文言になる", () => {
    const text = safePocketErrorText(new Error(RAW_429), {
      scope: "apo-list",
      message: "アポ情報一覧の取得に失敗しました",
    });

    expect(text).toContain("データ取得の利用上限に達しました");
    expect(text).not.toContain("429");
  });

  it("★ 生メッセージは相関IDと一緒にサーバログへ残る", () => {
    const text = safePocketErrorText(new Error(RAW), {
      scope: "sales-dashboard:apo",
      message: "アポ件数ランキングの取得に失敗しました",
    });

    const id = text.match(/ID: ([0-9a-f]{8})/)?.[1];
    expect(id).toBeTruthy();

    const logged = loggedText();
    // ログの形は pocketErrorResponse と同じ（Netlify で同じ絞り込みが効く）
    expect(logged).toContain(`[sales-dashboard:apo] correlationId=${id}`);
    expect(logged).toContain("rateLimited=false");
    expect(logged).toContain("appsId=12345");
  });

  it("429 のログは rateLimited=true で絞り込める", () => {
    safePocketErrorText(new Error(RAW_429), {
      scope: "apo-list",
      message: "アポ情報一覧の取得に失敗しました",
    });

    expect(loggedText()).toContain("rateLimited=true");
  });

  it("API_ERROR_DETAIL=1 のときだけ詳細を添える（切り分け用）", () => {
    process.env.API_ERROR_DETAIL = "1";

    const text = safePocketErrorText(new Error(RAW), {
      scope: "sales-dashboard:apo",
      message: "アポ件数ランキングの取得に失敗しました",
    });

    expect(text).toContain("appsId=12345");
  });

  it("Error でない値でも落ちない", () => {
    const text = safePocketErrorText("boom", {
      scope: "apo-list",
      message: "アポ情報一覧の取得に失敗しました",
    });

    expect(text).toMatch(
      /^アポ情報一覧の取得に失敗しました（ID: [0-9a-f]{8}）$/,
    );
  });
});

/**
 * 素通しの形が残っていないか、ソースを直接見る。
 *
 * `msg || "…に失敗しました"` は、msg が空にならないため**フォールバックが
 * 実質デッドコード**だった（常に生メッセージ側が出ていた）。同じ形を
 * 書き戻さないよう固定する。
 */
describe("素通しの形を残さない", () => {
  const ROOT = process.cwd();
  const FILES = [
    "src/lib/sales-dashboard-apo-aggregate.ts",
    "src/lib/sales-dashboard-tenka-aggregate.ts",
    "src/lib/sales-dashboard-apo-tenka-bundle.ts",
    "src/lib/apo-list.ts",
    "src/lib/meeting-schedule.ts",
  ] as const;

  function read(rel: string): string {
    return readFileSync(path.join(ROOT, rel), "utf8");
  }

  it("★ 更新の失敗も素通ししない（取込キーの案内だけ残す）", () => {
    const src = read("src/lib/meeting-schedule.ts");

    // 素通し（生メッセージをそのまま返す）を書き戻さない
    expect(src).not.toContain("  return msg;");
    // 受け取った人が対処できる案内は残す
    expect(src).toContain("取込キー「アポ通番(仮)」を認識できませんでした");
    expect(src).toContain("商談ステータスの更新に失敗しました");
    expect(src).toContain("商談・資料送付予定日時の更新に失敗しました");
  });

  it("★ 画面へ返す error に生メッセージを入れていない", () => {
    for (const rel of FILES) {
      const src = read(rel);
      expect(src, `${rel}: error: msg が残っている`).not.toMatch(
        /error:\s*msg\b/,
      );
      expect(src, `${rel}: error に msg のフォールバックが残っている`).not.toMatch(
        /error:\s*msg\s*\|\|/,
      );
    }
  });

  it("★ 取得の失敗はすべて safePocketErrorText を通す", () => {
    for (const rel of FILES) {
      expect(read(rel), `${rel} が遮蔽を通していない`).toContain(
        "safePocketErrorText(",
      );
    }
  });
});
