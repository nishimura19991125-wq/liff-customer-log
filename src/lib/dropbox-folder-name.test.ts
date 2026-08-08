import { describe, expect, it } from "vitest";

import {
  buildCustomerFolderName,
  dropboxParentPath,
  joinDropboxPath,
  sanitizeDropboxName,
} from "@/lib/dropbox-folder-name";

describe("sanitizeDropboxName", () => {
  it("Dropbox が受け付けない文字を全角へ置換する", () => {
    expect(sanitizeDropboxName("a/b")).toBe("a／b");
    expect(sanitizeDropboxName("a\\b")).toBe("a＼b");
    expect(sanitizeDropboxName("a?b")).toBe("a？b");
    expect(sanitizeDropboxName("a*b")).toBe("a＊b");
    expect(sanitizeDropboxName("a:b")).toBe("a：b");
    expect(sanitizeDropboxName("a|b")).toBe("a｜b");
    expect(sanitizeDropboxName('a"b')).toBe("a＂b");
    expect(sanitizeDropboxName("a<b")).toBe("a＜b");
    expect(sanitizeDropboxName("a>b")).toBe("a＞b");
  });

  it("除去ではなく置換する（別の顧客が同じフォルダ名にならない）", () => {
    expect(sanitizeDropboxName("山田/太郎")).not.toBe(
      sanitizeDropboxName("山田太郎"),
    );
  });

  it("前後の空白をトリムし、連続する空白を1つに畳む", () => {
    expect(sanitizeDropboxName("  山田　太郎  ")).toBe("山田 太郎");
    expect(sanitizeDropboxName("山田    太郎")).toBe("山田 太郎");
  });

  it("制御文字を除去する", () => {
    // 生の制御文字はソース上で壊れやすいのでコードポイントから組み立てる
    const NUL = String.fromCharCode(0);
    const BELL = String.fromCharCode(7);
    const DEL = String.fromCharCode(127);
    expect(sanitizeDropboxName(`山田${NUL}太郎`)).toBe("山田太郎");
    expect(sanitizeDropboxName(`山田${BELL}太郎`)).toBe("山田太郎");
    expect(sanitizeDropboxName(`山田${DEL}太郎`)).toBe("山田太郎");
  });

  it("改行・タブは空白として畳まれる", () => {
    const LF = String.fromCharCode(10);
    const TAB = String.fromCharCode(9);
    expect(sanitizeDropboxName(`山田${LF}太郎`)).toBe("山田 太郎");
    expect(sanitizeDropboxName(`山田${TAB}太郎`)).toBe("山田 太郎");
  });

  it("末尾のピリオド・空白を落とす（Dropbox が末尾ピリオドを嫌う）", () => {
    expect(sanitizeDropboxName("山田太郎.")).toBe("山田太郎");
    expect(sanitizeDropboxName("山田太郎...")).toBe("山田太郎");
    expect(sanitizeDropboxName("山田太郎. . ")).toBe("山田太郎");
  });

  it("先頭・中間のピリオドは残す", () => {
    expect(sanitizeDropboxName("1.abc")).toBe("1.abc");
    expect(sanitizeDropboxName("A.B.C")).toBe("A.B.C");
  });

  it("空文字・空白のみは空文字になる", () => {
    expect(sanitizeDropboxName("")).toBe("");
    expect(sanitizeDropboxName("   ")).toBe("");
  });
});

describe("buildCustomerFolderName", () => {
  it("<T番号>_<お客様名>様 の形式で組み立てる", () => {
    expect(buildCustomerFolderName("T00001691", "山田太郎")).toBe(
      "T00001691_山田太郎様",
    );
  });

  it("お客様名の禁止文字をサニタイズしてから組み立てる", () => {
    expect(buildCustomerFolderName("T00001691", "山田/太郎")).toBe(
      "T00001691_山田／太郎様",
    );
  });

  it("前後の空白はトリムする", () => {
    expect(buildCustomerFolderName(" T00001691 ", " 山田太郎 ")).toBe(
      "T00001691_山田太郎様",
    );
  });

  it("お客様名が空なら null（フォルダを作らない）", () => {
    expect(buildCustomerFolderName("T00001691", "")).toBeNull();
    expect(buildCustomerFolderName("T00001691", "   ")).toBeNull();
  });

  it("T番号が空なら null", () => {
    expect(buildCustomerFolderName("", "山田太郎")).toBeNull();
  });
});

// パスは実際のチームフォルダ構成に依存させない。
// 実パスを書くと Netlify のシークレットスキャンがビルドを止めるため。
// ここで確かめたいのは「多段パスの連結」と「末尾スラッシュの正規化」なので
// 中身が何であるかは問わない。
describe("joinDropboxPath", () => {
  it("ルートとフォルダ名を連結する", () => {
    expect(joinDropboxPath("/A/B/C", "T1_山田様")).toBe("/A/B/C/T1_山田様");
  });

  it("日本語・ピリオドを含む多段パスでも連結できる", () => {
    expect(joinDropboxPath("/親/1.子/2.孫", "T1_山田様")).toBe(
      "/親/1.子/2.孫/T1_山田様",
    );
  });

  it("ルートの末尾スラッシュを落とす", () => {
    expect(joinDropboxPath("/A/", "T1_山田様")).toBe("/A/T1_山田様");
  });
});

describe("dropboxParentPath", () => {
  it("親ディレクトリを返す", () => {
    expect(dropboxParentPath("/A/B/T1_山田様")).toBe("/A/B");
  });

  it("直下は空文字を返す", () => {
    expect(dropboxParentPath("/T1_山田様")).toBe("");
  });
});
