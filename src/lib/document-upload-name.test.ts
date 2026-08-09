import { describe, expect, it } from "vitest";

import {
  buildDocumentFileName,
  documentExtensionFromFileName,
  documentFileNamePrefix,
  jstFileNameStamp,
  nextDocumentSequence,
} from "@/lib/document-upload-name";

describe("documentExtensionFromFileName", () => {
  it("許可された拡張子を小文字で返す", () => {
    expect(documentExtensionFromFileName("a.pdf")).toBe("pdf");
    expect(documentExtensionFromFileName("a.JPG")).toBe("jpg");
    expect(documentExtensionFromFileName("a.jpeg")).toBe("jpeg");
    expect(documentExtensionFromFileName("a.PNG")).toBe("png");
    expect(documentExtensionFromFileName("a.HEIC")).toBe("heic");
  });

  it("許可されていない拡張子は null", () => {
    expect(documentExtensionFromFileName("a.exe")).toBeNull();
    expect(documentExtensionFromFileName("a.svg")).toBeNull();
    expect(documentExtensionFromFileName("a.pdf.exe")).toBeNull();
  });

  it("拡張子が無い・壊れているときは null", () => {
    expect(documentExtensionFromFileName("a")).toBeNull();
    expect(documentExtensionFromFileName("a.")).toBeNull();
    expect(documentExtensionFromFileName("")).toBeNull();
  });

  it("複数ドットは最後のものを見る", () => {
    expect(documentExtensionFromFileName("2026.08.09.pdf")).toBe("pdf");
  });
});

describe("documentFileNamePrefix", () => {
  it("<項目名>_<お客様名>_<日付>_<時分>_ を組み立てる", () => {
    expect(
      documentFileNamePrefix({
        caption: "本人確認書類",
        customerName: "山田太郎",
        ymd: "20260809",
        hm: "1430",
      }),
    ).toBe("本人確認書類_山田太郎_20260809_1430_");
  });

  it("項目名の中点・括弧はそのまま残す（Dropbox の禁止文字ではない）", () => {
    expect(
      documentFileNamePrefix({
        caption: "委任状(ID・パスワード開示用)",
        customerName: "山田太郎",
        ymd: "20260809",
        hm: "1430",
      }),
    ).toBe("委任状(ID・パスワード開示用)_山田太郎_20260809_1430_");
  });

  it("お客様名の空白は全角スペースに統一される", () => {
    const FULL = String.fromCharCode(0x3000);
    const TAB = String.fromCharCode(9);
    for (const input of [
      `山田${FULL}太郎`,
      "山田 太郎",
      "山田   太郎",
      `山田 ${FULL} 太郎`,
      `山田${TAB}太郎`,
    ]) {
      expect(
        documentFileNamePrefix({
          caption: "本人確認書類",
          customerName: input,
          ymd: "20260809",
          hm: "1430",
        }),
      ).toBe(`本人確認書類_山田${FULL}太郎_20260809_1430_`);
    }
  });

  it("項目名の半角スペースは全角化しない（顧客名だけが対象）", () => {
    const FULL = String.fromCharCode(0x3000);
    const prefix = documentFileNamePrefix({
      caption: "テスト 項目",
      customerName: "山田 太郎",
      ymd: "20260809",
      hm: "1430",
    });
    expect(prefix).toBe(`テスト 項目_山田${FULL}太郎_20260809_1430_`);

    // 項目名の空白は半角のまま、顧客名の空白だけが全角であることを
    // 位置ではなく区切りで取り出して確認する
    const [captionPart, namePart] = (prefix ?? "").split("_");
    expect(captionPart).toBe("テスト 項目");
    expect(captionPart?.charCodeAt(3)).toBe(0x20);
    expect(namePart).toBe(`山田${FULL}太郎`);
    expect(namePart?.charCodeAt(2)).toBe(0x3000);
  });

  it("禁止文字はタスクEのサニタイズで全角へ置換される", () => {
    expect(
      documentFileNamePrefix({
        caption: "商品売買・工事請負契約書",
        customerName: "山田/太郎",
        ymd: "20260809",
        hm: "1430",
      }),
    ).toBe("商品売買・工事請負契約書_山田／太郎_20260809_1430_");
  });

  it("項目名・お客様名が空なら null", () => {
    expect(
      documentFileNamePrefix({
        caption: "本人確認書類",
        customerName: "  ",
        ymd: "20260809",
        hm: "1430",
      }),
    ).toBeNull();
  });
});

describe("nextDocumentSequence", () => {
  const prefix = "本人確認書類_山田太郎_20260809_1430_";

  it("該当ファイルが無ければ 1", () => {
    expect(nextDocumentSequence([], prefix)).toBe(1);
    expect(nextDocumentSequence(["別の書類_山田太郎_20260809_1430_01.pdf"], prefix)).toBe(1);
  });

  it("最大連番の次を返す", () => {
    expect(nextDocumentSequence([`${prefix}01.pdf`], prefix)).toBe(2);
    expect(
      nextDocumentSequence([`${prefix}01.pdf`, `${prefix}02.jpg`], prefix),
    ).toBe(3);
  });

  it("順不同でも最大を見る", () => {
    expect(
      nextDocumentSequence([`${prefix}03.pdf`, `${prefix}01.pdf`], prefix),
    ).toBe(4);
  });

  it("欠番があっても最大の次（既存を上書きしない）", () => {
    expect(
      nextDocumentSequence([`${prefix}01.pdf`, `${prefix}05.pdf`], prefix),
    ).toBe(6);
  });

  it("拡張子違いは同じ連番として扱う", () => {
    expect(
      nextDocumentSequence([`${prefix}01.pdf`, `${prefix}01.jpg`], prefix),
    ).toBe(2);
  });

  it("別の分・別の顧客・別の項目は数えない", () => {
    expect(
      nextDocumentSequence(
        [
          "本人確認書類_山田太郎_20260809_1431_01.pdf",
          "本人確認書類_佐藤花子_20260809_1430_09.pdf",
          "登記簿_山田太郎_20260809_1430_07.pdf",
        ],
        prefix,
      ),
    ).toBe(1);
  });

  it("連番として読めない名前は無視する", () => {
    expect(
      nextDocumentSequence(
        [`${prefix}01.pdf`, `${prefix}メモ.pdf`, `${prefix}2x.pdf`],
        prefix,
      ),
    ).toBe(2);
  });
});

describe("buildDocumentFileName", () => {
  const prefix = "本人確認書類_山田太郎_20260809_1430_";

  it("2桁ゼロ埋めで組み立てる", () => {
    expect(buildDocumentFileName(prefix, 1, "pdf")).toBe(`${prefix}01.pdf`);
    expect(buildDocumentFileName(prefix, 2, "jpg")).toBe(`${prefix}02.jpg`);
  });

  it("100以上は桁が増える", () => {
    expect(buildDocumentFileName(prefix, 100, "pdf")).toBe(`${prefix}100.pdf`);
  });
});

describe("jstFileNameStamp", () => {
  it("UTC から JST へ変換する", () => {
    // 2026-08-09T05:30:00Z = JST 2026-08-09 14:30
    const stamp = jstFileNameStamp(new Date("2026-08-09T05:30:00Z"));
    expect(stamp.ymd).toBe("20260809");
    expect(stamp.hm).toBe("1430");
  });

  it("日付をまたぐ時刻でも JST の日付になる", () => {
    // 2026-08-09T16:00:00Z = JST 2026-08-10 01:00
    const stamp = jstFileNameStamp(new Date("2026-08-09T16:00:00Z"));
    expect(stamp.ymd).toBe("20260810");
    expect(stamp.hm).toBe("0100");
  });
});
