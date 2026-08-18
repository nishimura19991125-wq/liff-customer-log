import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CustomerInfoFormValues } from "@/lib/customer-info-form/types";

/**
 * 契約速報（タスクR）の送信判定・列解決・失敗時の扱い。
 *
 * 本文そのものは contract-notification.test.ts で見る。
 * ここは「送るか」「送れないときどうするか」だけを見る。
 */

const h = vi.hoisted(() => ({
  configured: true,
  result: { kind: "sent" } as
    | { kind: "sent" }
    | { kind: "skipped"; reason: string }
    | { kind: "failed"; reason: string; status?: number },
  sentTexts: [] as string[],
}));

vi.mock("@/lib/google-chat", () => ({
  googleChatContractWebhookConfigured: () => h.configured,
  sendGoogleChatContractMessage: async (text: string) => {
    h.sentTexts.push(text);
    return h.result;
  },
}));

const {
  contractNotificationExtraFieldIdList,
  notifyContractCompleted,
  readContractNotificationExtraValues,
  resolveContractNotificationExtraFieldIds,
  CONTRACT_NOTIFICATION_FAILURE_WARNING,
} = await import("@/lib/contract-notification-server");

const APP_FIELDS = [
  { uniqueId: "field-1", caption: "T番号" },
  { uniqueId: "field-2", caption: "お客様名" },
  { uniqueId: "field-77", caption: "蓄電池設置箇所" },
];

const VALUES = { inputStatus: "入力完了", customerName: "山田太郎" };
const EXTRAS = { tNumber: "T-1483", batteryLocation: "屋内" };

beforeEach(() => {
  h.configured = true;
  h.result = { kind: "sent" };
  h.sentTexts = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("R-3: フォームに無い列の解決", () => {
  it("見出し完全一致で T番号・蓄電池設置箇所 を解決する", () => {
    const ids = resolveContractNotificationExtraFieldIds(APP_FIELDS);
    expect(ids).toEqual({ tNumber: "field-1", batteryLocation: "field-77" });
    expect(contractNotificationExtraFieldIdList(ids)).toEqual([
      "field-1",
      "field-77",
    ]);
  });

  it("解決できない列は null になり、fields= にも入れない", () => {
    const ids = resolveContractNotificationExtraFieldIds([APP_FIELDS[0]]);
    expect(ids).toEqual({ tNumber: "field-1", batteryLocation: null });
    expect(contractNotificationExtraFieldIdList(ids)).toEqual(["field-1"]);
  });

  it("レコードから値を読む。列が無ければ空文字", () => {
    const ids = resolveContractNotificationExtraFieldIds(APP_FIELDS);
    expect(
      readContractNotificationExtraValues(
        { "field-1": "T-1483", "field-77": "屋外" },
        ids,
      ),
    ).toEqual({ tNumber: "T-1483", batteryLocation: "屋外" });

    expect(readContractNotificationExtraValues(null, ids)).toEqual({
      tNumber: "",
      batteryLocation: "",
    });
  });
});

describe("送信するかどうか", () => {
  it("★「未入力」→「入力完了」で送る", async () => {
    const out = await notifyContractCompleted({
      values: VALUES,
      beforeInputStatus: "未入力",
      extras: EXTRAS,
    });

    expect(out).toEqual({ kind: "sent" });
    expect(h.sentTexts).toHaveLength(1);
    expect(h.sentTexts[0]).toContain("【契約速報】");
    expect(h.sentTexts[0]).toContain("T番号：T-1483");
  });

  it("★ 既に「入力完了」なら再保存しても送らない", async () => {
    const out = await notifyContractCompleted({
      values: VALUES,
      beforeInputStatus: "入力完了",
      extras: EXTRAS,
    });

    expect(out).toEqual({ kind: "skipped", reason: "not-triggered" });
    expect(h.sentTexts).toHaveLength(0);
  });

  it("★「入力完了」→「未入力」でも送らない", async () => {
    const out = await notifyContractCompleted({
      values: { ...VALUES, inputStatus: "未入力" },
      beforeInputStatus: "入力完了",
      extras: EXTRAS,
    });

    expect(out).toEqual({ kind: "skipped", reason: "not-triggered" });
    expect(h.sentTexts).toHaveLength(0);
  });

  it("★ 環境変数が未設定なら送信をスキップし、警告も出さない", async () => {
    h.configured = false;

    const out = await notifyContractCompleted({
      values: VALUES,
      beforeInputStatus: "未入力",
      extras: EXTRAS,
    });

    expect(out).toEqual({ kind: "skipped", reason: "not-configured" });
    expect(h.sentTexts).toHaveLength(0);
  });
});

describe("R-4: 送信に失敗したとき", () => {
  it("★ 例外を投げず、画面へ出す警告を返す", async () => {
    h.result = { kind: "failed", reason: "http", status: 500 };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const out = await notifyContractCompleted({
      values: VALUES,
      beforeInputStatus: "未入力",
      extras: EXTRAS,
    });

    expect(out).toEqual({
      kind: "failed",
      warning: CONTRACT_NOTIFICATION_FAILURE_WARNING,
    });
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("ログに出すのは T番号・種類・ステータスまで（本文や顧客名は出さない）", async () => {
    h.result = { kind: "failed", reason: "timeout" };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await notifyContractCompleted({
      values: VALUES,
      beforeInputStatus: "未入力",
      extras: EXTRAS,
    });

    const logged = errorSpy.mock.calls[0].join(" ");
    expect(logged).toContain("T-1483");
    expect(logged).toContain("timeout");
    expect(logged).not.toContain("山田太郎");
    expect(logged).not.toContain("【契約速報】");
  });

  it("想定外の例外でも投げ返さず警告に落とす（保存は成功のまま）", async () => {
    h.result = { kind: "sent" };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // 本文の組み立てより手前で壊す。values は必ず読まれる
    const broken = new Proxy(
      { inputStatus: "入力完了" },
      {
        get(target, key) {
          if (key === "customerName") throw new Error("山田太郎 boom");
          return Reflect.get(target, key);
        },
      },
    ) as CustomerInfoFormValues;

    const out = await notifyContractCompleted({
      values: broken,
      beforeInputStatus: "未入力",
      extras: EXTRAS,
    });

    expect(out).toEqual({
      kind: "failed",
      warning: CONTRACT_NOTIFICATION_FAILURE_WARNING,
    });
    // 例外メッセージ（レコードの中身が載りうる）は出さない
    expect(errorSpy.mock.calls[0].join(" ")).not.toContain("山田太郎");
  });
});
