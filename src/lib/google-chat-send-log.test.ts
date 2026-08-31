import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 新規案件通知が **fetch まで到達したか**を追えるようにした分。
 *
 * 「通知が届かない」の切り分けで、送信処理まで来ているのか、来ていて
 * 何が返ったのかが分からなかった。ここで固定するのは次の3つ。
 *   - 送信の前後が1行ずつ残る
 *   - 失敗の理由（応答本文）が残る。ステータスだけでは直せない
 *   - どの行にも Webhook URL が出ない
 *
 * 既存の送信（契約速報・出勤打刻・定時リスト）は logLabel を渡さない
 * ので、行が増えないことも見る。
 */

const WEBHOOK = "https://chat.googleapis.com/v1/spaces/AAA/messages?key=SECRET";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const {
  sendGoogleChatNewCaseMessage,
  sendGoogleChatContractMessage,
} = await import("@/lib/google-chat");

function loggedText(): string {
  const spies = [console.info, console.error] as unknown as {
    mock: { calls: unknown[][] };
  }[];
  return spies.flatMap((s) => s.mock.calls.flat()).join(" ");
}

beforeEach(() => {
  fetchMock.mockReset();
  process.env.GOOGLE_CHAT_NEW_CASE_WEBHOOK_URL = WEBHOOK;
  process.env.GOOGLE_CHAT_CONTRACT_WEBHOOK_URL = WEBHOOK;
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.GOOGLE_CHAT_NEW_CASE_WEBHOOK_URL;
  delete process.env.GOOGLE_CHAT_CONTRACT_WEBHOOK_URL;
});

describe("新規案件通知の送信ログ", () => {
  it("★ fetch を呼んだことと応答が1行ずつ残る", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 200 }));

    const result = await sendGoogleChatNewCaseMessage("本文");

    expect(result).toEqual({ kind: "sent" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const logged = loggedText();
    expect(logged).toContain("fetch を呼びます");
    expect(logged).toContain("応答を受け取りました");
    expect(logged).toContain('"status":200');
  });

  it("★ 失敗したら応答本文を detail に載せる（400 の理由は本文にしかない）", async () => {
    fetchMock.mockResolvedValue(
      new Response('{"error":{"message":"Invalid webhook"}}', { status: 400 }),
    );

    const result = await sendGoogleChatNewCaseMessage("本文");

    expect(result).toMatchObject({
      kind: "failed",
      reason: "http",
      status: 400,
    });
    expect((result as { detail?: string }).detail).toContain("Invalid webhook");
  });

  it("★ 応答本文に URL が混ざっていても落として返す", async () => {
    fetchMock.mockResolvedValue(
      new Response(`sent to ${WEBHOOK} and failed`, { status: 403 }),
    );

    const result = await sendGoogleChatNewCaseMessage("本文");
    const detail = (result as { detail?: string }).detail ?? "";

    expect(detail).toContain("[url]");
    expect(detail).not.toContain("SECRET");
    expect(detail).not.toContain("chat.googleapis.com");
  });

  it("★ ログのどこにも Webhook URL を出さない", async () => {
    fetchMock.mockResolvedValue(new Response("ng", { status: 500 }));

    await sendGoogleChatNewCaseMessage("本文");

    const logged = loggedText();
    expect(logged).not.toContain("SECRET");
    expect(logged).not.toContain(WEBHOOK);
  });

  it("送信先には本文だけを POST する", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 200 }));

    await sendGoogleChatNewCaseMessage("本文");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(WEBHOOK);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ text: "本文" });
  });

  it("★ 既存の送信（契約速報）は行を増やさない", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 200 }));

    const result = await sendGoogleChatContractMessage("本文");

    expect(result).toEqual({ kind: "sent" });
    expect(loggedText()).toBe("");
  });

  it("★ 既存の送信は失敗しても応答本文を読まない（従来どおり）", async () => {
    const res = new Response("boom", { status: 500 });
    const textSpy = vi.spyOn(res, "text");
    fetchMock.mockResolvedValue(res);

    const result = await sendGoogleChatContractMessage("本文");

    expect(result).toEqual({ kind: "failed", reason: "http", status: 500 });
    expect(textSpy).not.toHaveBeenCalled();
  });
});
