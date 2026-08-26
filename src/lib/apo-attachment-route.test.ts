import { beforeEach, describe, expect, it, vi } from "vitest";

import { APO_ATTACHMENT_MAX_BYTES } from "@/lib/apo-attachment";

/**
 * タスクT: アポ資料の添付の受け口。
 *
 * 添付は @pocket の添付列ではなく Dropbox に置く。
 * 1リクエスト1ファイルの multipart で受ける（base64 で本文に載せると
 * 5MB×5件で 33MB ほどになり本文の上限に当たるため）。
 *
 * ここで見るのは受け口の門番だけ。
 *   - 未認証・未紐付けは通さない
 *   - 上限超過は 413
 *   - 拡張子・MIME・先頭バイトが揃わないものは 415（accept 属性は当てにしない）
 *   - 弾いたものは Dropbox まで到達しない
 */

const h = vi.hoisted(() => ({
  auth: { ok: true as boolean, lineUserId: "U1" },
  boundStaffName: "西村 直也" as string | null,
  storeCalls: [] as { recordId: string; extension: string; bytes: number }[],
  linkCalls: [] as string[],
  storeResult: {
    ok: true,
    fileName: "立面図・平面図_山田　太郎_20260826_1430_01.pdf",
    linkSaved: true,
  } as Record<string, unknown>,
  linkResult: { ok: true } as Record<string, unknown>,
}));

vi.mock("@/lib/request-auth", () => ({
  resolveCallerLineAuth: async () =>
    h.auth.ok
      ? { ok: true, lineUserId: h.auth.lineUserId }
      : { ok: false, reason: "invalid" },
  lineAuthUnauthorizedResponse: () =>
    new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
}));

vi.mock("@/lib/staff-bound-lookup", () => ({
  resolveBoundStaffNameForLineUser: async () => h.boundStaffName,
}));

vi.mock("@/lib/apo-attachment-upload", () => ({
  storeApoAttachmentFile: async (opts: {
    recordId: string;
    extension: string;
    bytes: Uint8Array;
  }) => {
    h.storeCalls.push({
      recordId: opts.recordId,
      extension: opts.extension,
      bytes: opts.bytes.length,
    });
    return h.storeResult;
  },
  saveApoAttachmentSharedLink: async (opts: { recordId: string }) => {
    h.linkCalls.push(opts.recordId);
    return h.linkResult;
  },
}));

const { POST, PUT } = await import(
  "@/app/api/apo-acquisition/records/[recordId]/attachments/route"
);

const URL_BASE = "https://example.test/api/apo-acquisition/records/r1/attachments";

const PDF_HEAD = [0x25, 0x50, 0x44, 0x46];
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function fileOf(name: string, mime: string, head: number[], size = 32): File {
  const bytes = new Uint8Array(size);
  bytes.set(head.slice(0, size));
  return new File([bytes], name, { type: mime });
}

function post(file: File | null, recordId = "r1") {
  const body = new FormData();
  if (file) body.append("file", file);
  return POST(new Request(URL_BASE, { method: "POST", body }), {
    params: Promise.resolve({ recordId }),
  });
}

beforeEach(() => {
  h.auth = { ok: true, lineUserId: "U1" };
  h.boundStaffName = "西村 直也";
  h.storeCalls = [];
  h.linkCalls = [];
  h.storeResult = {
    ok: true,
    fileName: "立面図・平面図_山田　太郎_20260826_1430_01.pdf",
    linkSaved: true,
  };
  h.linkResult = { ok: true };
});

describe("認証と紐付け", () => {
  it("未認証は 401。Dropbox まで到達しない", async () => {
    h.auth = { ok: false, lineUserId: "" };
    const res = await post(fileOf("a.pdf", "application/pdf", PDF_HEAD));

    expect(res.status).toBe(401);
    expect(h.storeCalls).toHaveLength(0);
  });

  it("スタッフ未紐付けは 403", async () => {
    h.boundStaffName = null;
    const res = await post(fileOf("a.pdf", "application/pdf", PDF_HEAD));

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ needsStaffBind: true });
    expect(h.storeCalls).toHaveLength(0);
  });
});

describe("受け取り方", () => {
  it("ファイルが無ければ 400", async () => {
    const res = await post(null);

    expect(res.status).toBe(400);
    expect(h.storeCalls).toHaveLength(0);
  });

  it("recordId が空なら 400", async () => {
    const res = await post(fileOf("a.pdf", "application/pdf", PDF_HEAD), "  ");

    expect(res.status).toBe(400);
    expect(h.storeCalls).toHaveLength(0);
  });

  it("空のファイルは 400", async () => {
    const res = await post(new File([], "a.pdf", { type: "application/pdf" }));

    expect(res.status).toBe(400);
    expect(h.storeCalls).toHaveLength(0);
  });
});

describe("★ サイズ上限は 413", () => {
  it("5MB を超えたら 413。Dropbox には送らない", async () => {
    const big = new File(
      [new Uint8Array(APO_ATTACHMENT_MAX_BYTES + 1)],
      "a.pdf",
      { type: "application/pdf" },
    );
    const res = await post(big);

    expect(res.status).toBe(413);
    expect(h.storeCalls).toHaveLength(0);
  });

  it("ちょうど上限までは通す", async () => {
    const bytes = new Uint8Array(APO_ATTACHMENT_MAX_BYTES);
    bytes.set(PDF_HEAD);
    const res = await post(
      new File([bytes], "a.pdf", { type: "application/pdf" }),
    );

    expect(res.status).toBe(200);
    expect(h.storeCalls).toHaveLength(1);
  });
});

describe("★ ファイル形式は 415", () => {
  it("PDF・JPEG・PNG は通す", async () => {
    for (const f of [
      fileOf("a.pdf", "application/pdf", PDF_HEAD),
      fileOf("a.jpg", "image/jpeg", [0xff, 0xd8, 0xff, 0xe0]),
      fileOf("a.png", "image/png", PNG_HEAD),
    ]) {
      const res = await post(f);
      expect(res.status).toBe(200);
    }
    expect(h.storeCalls.map((c) => c.extension)).toEqual(["pdf", "jpg", "png"]);
  });

  it("扱わない拡張子は 415", async () => {
    const res = await post(
      fileOf("a.exe", "application/octet-stream", [0x4d, 0x5a]),
    );

    expect(res.status).toBe(415);
    expect(h.storeCalls).toHaveLength(0);
  });

  it("拡張子と MIME が食い違えば 415", async () => {
    const res = await post(fileOf("a.pdf", "image/png", PDF_HEAD));

    expect(res.status).toBe(415);
    expect(h.storeCalls).toHaveLength(0);
  });

  it("中身が偽られていれば 415（先頭バイトを見る）", async () => {
    // 拡張子も MIME も PDF を名乗るが、中身は実行ファイル
    const res = await post(
      fileOf("evil.pdf", "application/pdf", [0x4d, 0x5a, 0x90, 0x00]),
    );

    expect(res.status).toBe(415);
    expect(h.storeCalls).toHaveLength(0);
  });
});

describe("応答", () => {
  it("保存できたらファイル名とリンクの保存可否を返す", async () => {
    const res = await post(fileOf("a.pdf", "application/pdf", PDF_HEAD));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      fileName: "立面図・平面図_山田　太郎_20260826_1430_01.pdf",
      linkSaved: true,
    });
  });

  it("リンクだけ落ちてもファイルは保存済み。linkSaved:false で伝える", async () => {
    h.storeResult = { ok: true, fileName: "x.pdf", linkSaved: false };
    const res = await post(fileOf("a.pdf", "application/pdf", PDF_HEAD));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, linkSaved: false });
  });

  it("保存先が未設定なら 503。内部の設定名は応答に出さない", async () => {
    h.storeResult = {
      ok: false,
      status: 503,
      error: "アポ資料の保存先が未設定のため、添付できません。管理者にご連絡ください。",
    };
    const res = await post(fileOf("a.pdf", "application/pdf", PDF_HEAD));
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(503);
    expect(body.error).not.toMatch(/DROPBOX|field-|APP_ID/i);
  });
});

describe("★ 共有リンクの貼り直し（PUT）", () => {
  function put(recordId = "r1") {
    return PUT(new Request(URL_BASE, { method: "PUT" }), {
      params: Promise.resolve({ recordId }),
    });
  }

  it("ファイルを送らずにリンクだけ保存し直せる", async () => {
    const res = await put();

    expect(res.status).toBe(200);
    expect(h.linkCalls).toEqual(["r1"]);
    // 貼り直しでファイルが増えないこと
    expect(h.storeCalls).toHaveLength(0);
  });

  it("未認証は 401", async () => {
    h.auth = { ok: false, lineUserId: "" };
    const res = await put();

    expect(res.status).toBe(401);
    expect(h.linkCalls).toHaveLength(0);
  });

  it("保存できなければその status を返す", async () => {
    h.linkResult = {
      ok: false,
      status: 502,
      error: "共有リンクを保存できませんでした",
    };
    const res = await put();

    expect(res.status).toBe(502);
  });
});
