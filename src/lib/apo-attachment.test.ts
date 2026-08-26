import { describe, expect, it } from "vitest";

import {
  APO_ATTACHMENT_CAPTION,
  APO_ATTACHMENT_MAX_BYTES,
  APO_ATTACHMENT_MAX_FILES,
  apoAcquisitionFeedbackIsError,
  apoAttachmentExtension,
  apoAttachmentFolderName,
  apoAttachmentMimeMatchesExtension,
  apoAttachmentSignatureMatches,
  apoAttachmentYearFolderName,
  buildApoAttachmentPaths,
  checkApoAttachmentType,
} from "@/lib/apo-attachment";
import {
  buildDocumentFileName,
  documentFileNamePrefix,
  nextDocumentSequence,
} from "@/lib/document-upload-name";

/**
 * アポ資料（立面図・平面図）の保存先とファイル形式の検証。
 *
 * 添付は @pocket の添付列ではなく Dropbox に置く。
 * 置き場所とファイル名の規則が崩れると、あとから資料を探せなくなるので
 * ここで固定する。
 */

const ROOT = "/BY/2.商談資料一覧";

describe("apoAttachmentYearFolderName", () => {
  it("アポ取得日の年で決まる（登録した日ではない）", () => {
    expect(apoAttachmentYearFolderName("2026-08-26")).toBe(
      "2026年商談資料一式",
    );
    // 年またぎで登録が遅れても、取得年の棚に入る
    expect(apoAttachmentYearFolderName("2025-12-31")).toBe(
      "2025年商談資料一式",
    );
  });

  it("区切り文字が違っても読む", () => {
    expect(apoAttachmentYearFolderName("2026/08/26")).toBe(
      "2026年商談資料一式",
    );
    expect(apoAttachmentYearFolderName("2026年8月26日")).toBe(
      "2026年商談資料一式",
    );
  });

  it("読めなければ null。推測で今年にしない", () => {
    expect(apoAttachmentYearFolderName("")).toBeNull();
    expect(apoAttachmentYearFolderName(undefined)).toBeNull();
    expect(apoAttachmentYearFolderName("未定")).toBeNull();
    expect(apoAttachmentYearFolderName("1999-01-01")).toBeNull();
  });
});

describe("apoAttachmentFolderName", () => {
  it("{アポ通番}_{顧客名}様", () => {
    expect(apoAttachmentFolderName("A00001603", "山田 太郎")).toBe(
      "A00001603_山田　太郎様",
    );
  });

  it("姓名の区切りは全角スペースに揃える", () => {
    const name = apoAttachmentFolderName("A00001603", "山田　太郎");
    expect(name).toBe("A00001603_山田　太郎様");
    expect(name).toContain("　");
    expect(name).not.toContain(" ");
  });

  it("パス区切りや禁止文字を名前に持ち込まない", () => {
    const name = apoAttachmentFolderName("A1", "山田/太郎");
    expect(name).not.toBeNull();
    expect(name).not.toContain("/");
    expect(name).not.toContain("\\");
  });

  it("材料が欠けたら null。中途半端な名前のフォルダを作らない", () => {
    expect(apoAttachmentFolderName("", "山田 太郎")).toBeNull();
    expect(apoAttachmentFolderName("A00001603", "")).toBeNull();
    expect(apoAttachmentFolderName(undefined, undefined)).toBeNull();
  });
});

describe("buildApoAttachmentPaths", () => {
  it("年フォルダとアポフォルダの両方を返す", () => {
    expect(
      buildApoAttachmentPaths({
        rootPath: ROOT,
        apoAcquiredDate: "2026-08-26",
        apoNumber: "A00001603",
        customerName: "山田 太郎",
      }),
    ).toEqual({
      yearPath: `${ROOT}/2026年商談資料一式`,
      folderPath: `${ROOT}/2026年商談資料一式/A00001603_山田　太郎様`,
    });
  });

  it("末尾のスラッシュがあっても二重にならない", () => {
    const paths = buildApoAttachmentPaths({
      rootPath: `${ROOT}/`,
      apoAcquiredDate: "2026-08-26",
      apoNumber: "A1",
      customerName: "山田 太郎",
    });
    expect(paths?.yearPath).toBe(`${ROOT}/2026年商談資料一式`);
    expect(paths?.folderPath).not.toContain("//");
  });

  it("材料が欠けたら null（保存先を推測で埋めない）", () => {
    const base = {
      rootPath: ROOT,
      apoAcquiredDate: "2026-08-26",
      apoNumber: "A1",
      customerName: "山田 太郎",
    };
    expect(buildApoAttachmentPaths({ ...base, rootPath: "" })).toBeNull();
    expect(
      buildApoAttachmentPaths({ ...base, apoAcquiredDate: "" }),
    ).toBeNull();
    expect(buildApoAttachmentPaths({ ...base, apoNumber: "" })).toBeNull();
    expect(buildApoAttachmentPaths({ ...base, customerName: "" })).toBeNull();
  });
});

describe("ファイル名の規則", () => {
  it("項目名_顧客名_日付_時分_連番.拡張子", () => {
    const prefix = documentFileNamePrefix({
      caption: APO_ATTACHMENT_CAPTION,
      customerName: "山田　太郎",
      ymd: "20260826",
      hm: "1430",
    });
    expect(prefix).not.toBeNull();
    expect(buildDocumentFileName(prefix!, 1, "pdf")).toBe(
      "立面図・平面図_山田　太郎_20260826_1430_01.pdf",
    );
  });

  it("同じ時分に複数送っても連番でぶつからない", () => {
    const prefix = documentFileNamePrefix({
      caption: APO_ATTACHMENT_CAPTION,
      customerName: "山田　太郎",
      ymd: "20260826",
      hm: "1430",
    })!;
    const existing = [buildDocumentFileName(prefix, 1, "pdf")];
    expect(nextDocumentSequence(existing, prefix)).toBe(2);
  });
});

describe("apoAttachmentExtension", () => {
  it("PDF・JPG・JPEG・PNG だけ通す", () => {
    expect(apoAttachmentExtension("a.pdf")).toBe("pdf");
    expect(apoAttachmentExtension("a.PDF")).toBe("pdf");
    expect(apoAttachmentExtension("a.jpg")).toBe("jpg");
    expect(apoAttachmentExtension("a.jpeg")).toBe("jpeg");
    expect(apoAttachmentExtension("a.png")).toBe("png");
  });

  it("それ以外は null", () => {
    expect(apoAttachmentExtension("a.exe")).toBeNull();
    expect(apoAttachmentExtension("a.svg")).toBeNull();
    expect(apoAttachmentExtension("noext")).toBeNull();
    expect(apoAttachmentExtension("a.")).toBeNull();
    expect(apoAttachmentExtension("")).toBeNull();
  });

  it("二重拡張子は最後だけを見る", () => {
    expect(apoAttachmentExtension("a.pdf.exe")).toBeNull();
    expect(apoAttachmentExtension("a.exe.pdf")).toBe("pdf");
  });
});

describe("apoAttachmentMimeMatchesExtension", () => {
  it("拡張子と MIME が合っていれば通す", () => {
    expect(apoAttachmentMimeMatchesExtension("pdf", "application/pdf")).toBe(
      true,
    );
    expect(apoAttachmentMimeMatchesExtension("jpg", "image/jpeg")).toBe(true);
    expect(apoAttachmentMimeMatchesExtension("png", "image/png")).toBe(true);
  });

  it("charset 付きでも見る", () => {
    expect(
      apoAttachmentMimeMatchesExtension("pdf", "application/pdf; charset=utf-8"),
    ).toBe(true);
  });

  it("食い違っていれば弾く", () => {
    expect(apoAttachmentMimeMatchesExtension("pdf", "image/png")).toBe(false);
    expect(
      apoAttachmentMimeMatchesExtension("png", "application/octet-stream"),
    ).toBe(false);
  });

  it("MIME が空で届く端末があるので、空は拒否理由にしない", () => {
    // 空のときは拡張子と先頭バイトで判断する
    expect(apoAttachmentMimeMatchesExtension("pdf", "")).toBe(true);
  });
});

describe("apoAttachmentSignatureMatches", () => {
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const png = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);

  it("先頭バイトが形式と合っていれば通す", () => {
    expect(apoAttachmentSignatureMatches("pdf", pdf)).toBe(true);
    expect(apoAttachmentSignatureMatches("jpg", jpeg)).toBe(true);
    expect(apoAttachmentSignatureMatches("jpeg", jpeg)).toBe(true);
    expect(apoAttachmentSignatureMatches("png", png)).toBe(true);
  });

  it("中身が違えば弾く", () => {
    expect(apoAttachmentSignatureMatches("pdf", png)).toBe(false);
    expect(apoAttachmentSignatureMatches("png", pdf)).toBe(false);
  });

  it("短すぎる中身も弾く", () => {
    expect(apoAttachmentSignatureMatches("png", new Uint8Array([0x89]))).toBe(
      false,
    );
    expect(apoAttachmentSignatureMatches("pdf", new Uint8Array())).toBe(false);
  });
});

describe("checkApoAttachmentType", () => {
  const pdfHead = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

  it("拡張子・MIME・先頭バイトが揃えば通す", () => {
    expect(
      checkApoAttachmentType({
        fileName: "立面図.pdf",
        mimeType: "application/pdf",
        head: pdfHead,
      }),
    ).toEqual({ ok: true, extension: "pdf" });
  });

  it("拡張子を偽った実行ファイルを弾く（中身が PDF でない）", () => {
    expect(
      checkApoAttachmentType({
        fileName: "evil.pdf",
        mimeType: "application/pdf",
        head: new Uint8Array([0x4d, 0x5a, 0x90, 0x00]),
      }),
    ).toEqual({ ok: false, reason: "signature" });
  });

  it("MIME が拡張子と食い違えば弾く", () => {
    expect(
      checkApoAttachmentType({
        fileName: "a.pdf",
        mimeType: "image/png",
        head: pdfHead,
      }),
    ).toEqual({ ok: false, reason: "mime" });
  });

  it("そもそも扱わない拡張子は先に弾く", () => {
    expect(
      checkApoAttachmentType({
        fileName: "a.exe",
        mimeType: "application/pdf",
        head: pdfHead,
      }),
    ).toEqual({ ok: false, reason: "extension" });
  });
});

describe("上限値", () => {
  it("1ファイル5MB・最大5件", () => {
    expect(APO_ATTACHMENT_MAX_BYTES).toBe(5 * 1024 * 1024);
    expect(APO_ATTACHMENT_MAX_FILES).toBe(5);
  });
});

describe("apoAcquisitionFeedbackIsError", () => {
  it("登録は通ったが添付が落ちた文面は失敗として見せる", () => {
    expect(
      apoAcquisitionFeedbackIsError(
        "アポ取得情報を登録しました。添付1件の送信に失敗しました。",
      ),
    ).toBe(true);
  });

  it("成功の文面は成功のまま", () => {
    expect(apoAcquisitionFeedbackIsError("アポ取得情報を登録しました")).toBe(
      false,
    );
    expect(apoAcquisitionFeedbackIsError("共有リンクを保存しました")).toBe(
      false,
    );
  });

  it("入力の差し戻しも失敗扱い", () => {
    expect(apoAcquisitionFeedbackIsError("添付は5件までです")).toBe(true);
    expect(apoAcquisitionFeedbackIsError("通信に失敗しました")).toBe(true);
  });

  it("文面が無いときは失敗にしない", () => {
    expect(apoAcquisitionFeedbackIsError("")).toBe(false);
  });
});
