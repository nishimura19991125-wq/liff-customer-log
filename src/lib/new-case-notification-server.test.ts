import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 新規案件通知の「送るか」「送れないときどうするか」。
 *
 * 本文そのものは new-case-notification.test.ts で見る。
 */

const h = vi.hoisted(() => ({
  configured: true,
  result: { kind: "sent" } as
    | { kind: "sent" }
    | { kind: "skipped"; reason: string }
    | { kind: "failed"; reason: string; status?: number },
  sentTexts: [] as string[],
  staffName: "西村" as string | null,
  staffLookupError: false,
  lookedUpLineUserIds: [] as string[],
}));

vi.mock("@/lib/google-chat", () => ({
  googleChatNewCaseWebhookConfigured: () => h.configured,
  sendGoogleChatNewCaseMessage: async (text: string) => {
    h.sentTexts.push(text);
    return h.result;
  },
}));

vi.mock("@/lib/staff-bound-lookup", () => ({
  resolveBoundStaffNameForLineUser: async (lineUserId: string) => {
    h.lookedUpLineUserIds.push(lineUserId);
    if (h.staffLookupError) throw new Error("名簿の取得に失敗");
    return h.staffName;
  },
}));

const { notifyNewCaseCreated } = await import(
  "@/lib/new-case-notification-server"
);

beforeEach(() => {
  h.configured = true;
  h.result = { kind: "sent" };
  h.sentTexts = [];
  h.staffName = "西村";
  h.staffLookupError = false;
  h.lookedUpLineUserIds = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("notifyNewCaseCreated", () => {
  it("T番号があれば送る。案件作成者は操作した人の名前", async () => {
    const outcome = await notifyNewCaseCreated({
      tNumber: "T-1234",
      customerName: "山田太郎",
      lineUserId: "U-line-1",
    });

    expect(outcome).toEqual({ kind: "sent" });
    expect(h.lookedUpLineUserIds).toEqual(["U-line-1"]);
    expect(h.sentTexts).toHaveLength(1);
    expect(h.sentTexts[0]).toContain("🐣新規案件が追加されました🐣");
    expect(h.sentTexts[0]).toContain("T番号　 　 ：T-1234");
    expect(h.sentTexts[0]).toContain("お客様名　 ：山田太郎");
    expect(h.sentTexts[0]).toContain("案件作成者：西村");
  });

  it("T番号が空なら送らない", async () => {
    const outcome = await notifyNewCaseCreated({
      tNumber: "  ",
      customerName: "山田太郎",
      lineUserId: "U-line-1",
    });

    expect(outcome).toEqual({ kind: "skipped", reason: "no-t-number" });
    expect(h.sentTexts).toHaveLength(0);
    // 送らないと決めた時点で名簿も引かない
    expect(h.lookedUpLineUserIds).toEqual([]);
  });

  it("T番号が未取得（undefined）でも送らない", async () => {
    const outcome = await notifyNewCaseCreated({
      tNumber: undefined,
      customerName: "山田太郎",
    });

    expect(outcome).toEqual({ kind: "skipped", reason: "no-t-number" });
    expect(h.sentTexts).toHaveLength(0);
  });

  it("Webhook 未設定なら送らずスキップ（エラーにしない）", async () => {
    h.configured = false;

    const outcome = await notifyNewCaseCreated({
      tNumber: "T-1234",
      customerName: "山田太郎",
      lineUserId: "U-line-1",
    });

    expect(outcome).toEqual({ kind: "skipped", reason: "not-configured" });
    expect(h.sentTexts).toHaveLength(0);
  });

  it("名簿を引けなくても案件作成者を空にして送る", async () => {
    h.staffLookupError = true;

    const outcome = await notifyNewCaseCreated({
      tNumber: "T-1234",
      customerName: "山田太郎",
      lineUserId: "U-line-1",
    });

    expect(outcome).toEqual({ kind: "sent" });
    expect(h.sentTexts[0]).toContain("案件作成者：");
    expect(h.sentTexts[0]).not.toContain("西村");
  });

  it("lineUserId が無ければ名簿を引かず案件作成者を空にする", async () => {
    const outcome = await notifyNewCaseCreated({
      tNumber: "T-1234",
      customerName: "山田太郎",
    });

    expect(outcome).toEqual({ kind: "sent" });
    expect(h.lookedUpLineUserIds).toEqual([]);
    expect(h.sentTexts[0]).toContain("案件作成者：");
  });

  it("紐付けが無いスタッフ（名簿に該当なし）でも送る", async () => {
    h.staffName = null;

    const outcome = await notifyNewCaseCreated({
      tNumber: "T-1234",
      customerName: "山田太郎",
      lineUserId: "U-line-1",
    });

    expect(outcome).toEqual({ kind: "sent" });
    expect(h.sentTexts[0]).toContain("案件作成者：");
  });

  it("送信に失敗しても例外にしない。Webhook URL もログに出さない", async () => {
    h.result = { kind: "failed", reason: "http", status: 500 };
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const outcome = await notifyNewCaseCreated({
      tNumber: "T-1234",
      customerName: "山田太郎",
      lineUserId: "U-line-1",
    });

    expect(outcome).toEqual({ kind: "failed" });
    const logged = errorSpy.mock.calls.flat().join(" ");
    expect(logged).toContain("T-1234");
    expect(logged).toContain("500");
    // お客様名・担当者名は出さない
    expect(logged).not.toContain("山田太郎");
    expect(logged).not.toContain("西村");
  });

  it("送信側がスキップを返したらスキップとして返す", async () => {
    h.result = { kind: "skipped", reason: "not-configured" };

    const outcome = await notifyNewCaseCreated({
      tNumber: "T-1234",
      customerName: "山田太郎",
      lineUserId: "U-line-1",
    });

    expect(outcome).toEqual({ kind: "skipped", reason: "send-skipped" });
  });
});

/**
 * 段階ごとのスキップ理由。
 *
 * 「通知が届かない」の切り分けができなかったのは、送らないと決めた分岐が
 * どれも無言だったため。**どの段階で止まっても1行残る**ことを固定する。
 * 同時に、その1行に Webhook URL・お客様名・担当者名を出さないことも見る。
 */
describe("スキップ理由のログ", () => {
  /** console.info / warn / error に出た全文をつなげる */
  function loggedText(): string {
    const spies = [console.info, console.warn, console.error] as unknown as {
      mock: { calls: unknown[][] };
    }[];
    return spies.flatMap((s) => s.mock.calls.flat()).join(" ");
  }

  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  it("★ notifyNewCase が false（新規発行ではない操作）を残す", async () => {
    const outcome = await notifyNewCaseCreated({
      enabled: false,
      tNumber: "T-1234",
      customerName: "山田太郎",
      lineUserId: "U-line-1",
    });

    expect(outcome).toEqual({ kind: "skipped", reason: "not-requested" });
    expect(h.sentTexts).toHaveLength(0);
    expect(loggedText()).toContain("not-requested");
  });

  it("★ T番号 が空を残す", async () => {
    await notifyNewCaseCreated({
      tNumber: "",
      customerName: "山田太郎",
      lineUserId: "U-line-1",
    });

    expect(loggedText()).toContain("no-t-number");
  });

  it("★ 環境変数が未設定を、変数名ごと残す", async () => {
    h.configured = false;

    await notifyNewCaseCreated({
      tNumber: "T-1234",
      customerName: "山田太郎",
      lineUserId: "U-line-1",
    });

    const logged = loggedText();
    expect(logged).toContain("not-configured");
    expect(logged).toContain("GOOGLE_CHAT_NEW_CASE_WEBHOOK_URL");
  });

  it("★ 案件作成者を引けなかったことを残す（送信は続行）", async () => {
    h.staffLookupError = true;

    const outcome = await notifyNewCaseCreated({
      tNumber: "T-1234",
      customerName: "山田太郎",
      lineUserId: "U-line-1",
    });

    expect(outcome).toEqual({ kind: "sent" });
    expect(loggedText()).toContain("案件作成者を空で送ります");
  });

  it("★ 送信の直前と成功を残す（fetch まで届いたかが分かる）", async () => {
    await notifyNewCaseCreated({
      tNumber: "T-1234",
      customerName: "山田太郎",
      lineUserId: "U-line-1",
    });

    const logged = loggedText();
    expect(logged).toContain("sending");
    expect(logged).toContain("sent");
  });

  it("★ 送信エラーを残す", async () => {
    h.result = { kind: "failed", reason: "timeout" };

    await notifyNewCaseCreated({
      tNumber: "T-1234",
      customerName: "山田太郎",
      lineUserId: "U-line-1",
    });

    expect(loggedText()).toContain("send-failed");
  });

  it("★ どの段階でもお客様名・担当者名は出さない", async () => {
    for (const setup of [
      () => {
        h.configured = false;
      },
      () => {
        h.result = { kind: "failed", reason: "http", status: 404 };
      },
      () => {
        h.result = { kind: "sent" };
      },
    ]) {
      vi.clearAllMocks();
      h.configured = true;
      h.result = { kind: "sent" };
      setup();

      await notifyNewCaseCreated({
        tNumber: "T-1234",
        customerName: "山田太郎",
        lineUserId: "U-line-1",
      });

      const logged = loggedText();
      expect(logged).not.toContain("山田太郎");
      expect(logged).not.toContain("西村");
      expect(logged).not.toContain("U-line-1");
    }
  });
});
