import { describe, expect, it } from "vitest";

import {
  matchDropboxFoldersByTNumber,
  normalizeTNumber,
  tNumberFromFolderName,
} from "@/lib/dropbox-link-migration-match";

/** 実物のフォルダ名（確認済みの命名規則） */
const REAL_FOLDERS = [
  "T00002214_三宅　隆文様",
  "T00002215_本多　天汰様",
  "T00002216_竹中　満理様",
];

describe("normalizeTNumber", () => {
  it("前後の空白と英字の大小を揃える", () => {
    expect(normalizeTNumber(" t00002214 ")).toBe("T00002214");
  });

  it("全角の数字・英字を半角にする", () => {
    expect(normalizeTNumber("Ｔ００００２２１４")).toBe("T00002214");
  });

  it("途中の空白も落とす", () => {
    expect(normalizeTNumber("T0000 2214")).toBe("T00002214");
  });

  it("未設定は空文字", () => {
    expect(normalizeTNumber(undefined)).toBe("");
    expect(normalizeTNumber("")).toBe("");
  });
});

describe("tNumberFromFolderName", () => {
  it("実物のフォルダ名から取り出せる", () => {
    expect(tNumberFromFolderName("T00002214_三宅　隆文様")).toBe("T00002214");
    expect(tNumberFromFolderName("T00002215_本多　天汰様")).toBe("T00002215");
  });

  it("T番号だけのフォルダ名も許す", () => {
    expect(tNumberFromFolderName("T00002214")).toBe("T00002214");
  });

  it("桁数は決め打ちしない（突合は完全一致で行うため）", () => {
    expect(tNumberFromFolderName("T0000221_三宅様")).toBe("T0000221");
    expect(tNumberFromFolderName("T000022145_三宅様")).toBe("T000022145");
  });

  it("数字が無ければ取り出さない", () => {
    expect(tNumberFromFolderName("T_三宅様")).toBe("");
  });

  it("T で始まらないフォルダは取り出さない", () => {
    expect(tNumberFromFolderName("その他")).toBe("");
    expect(tNumberFromFolderName("_T00002214_三宅様")).toBe("");
  });

  it("区切りがアンダースコア以外なら取り出さない（誤突合を避ける）", () => {
    expect(tNumberFromFolderName("T00002214-三宅様")).toBe("");
  });
});

describe("matchDropboxFoldersByTNumber", () => {
  it("★ T番号だけで突合する（顧客名は使わない）", () => {
    const r = matchDropboxFoldersByTNumber({
      tNumbers: ["T00002214", "T00002215"],
      folderNames: REAL_FOLDERS,
    });
    expect(r.matched).toEqual([
      { tNumber: "T00002214", folderName: "T00002214_三宅　隆文様" },
      { tNumber: "T00002215", folderName: "T00002215_本多　天汰様" },
    ]);
  });

  it("★ フォルダ名の顧客名が違っていても突合できる（改名・表記ゆれ）", () => {
    const r = matchDropboxFoldersByTNumber({
      tNumbers: ["T00002214"],
      folderNames: ["T00002214_旧姓　隆文様"],
    });
    expect(r.matched).toHaveLength(1);
    expect(r.matched[0]?.folderName).toBe("T00002214_旧姓　隆文様");
  });

  it("フォルダが無い顧客を列挙する", () => {
    const r = matchDropboxFoldersByTNumber({
      tNumbers: ["T00002214", "T00009999"],
      folderNames: REAL_FOLDERS,
    });
    expect(r.missingFolderTNumbers).toEqual(["T00009999"]);
  });

  it("顧客に対応の無いフォルダを列挙する", () => {
    const r = matchDropboxFoldersByTNumber({
      tNumbers: ["T00002214"],
      folderNames: REAL_FOLDERS,
    });
    expect(r.orphanFolderNames).toEqual([
      "T00002215_本多　天汰様",
      "T00002216_竹中　満理様",
    ]);
  });

  it("T番号で始まらないフォルダは別枠にし、突合を壊さない", () => {
    const r = matchDropboxFoldersByTNumber({
      tNumbers: ["T00002214"],
      folderNames: [...REAL_FOLDERS, "移行前", ".DS_Store"],
    });
    expect(r.matched).toHaveLength(1);
    expect(r.unparsableFolderNames).toEqual(["移行前", ".DS_Store"]);
    expect(r.orphanFolderNames).not.toContain("移行前");
  });

  it("★ 同じT番号のフォルダが複数あったら選ばない", () => {
    const r = matchDropboxFoldersByTNumber({
      tNumbers: ["T00002214"],
      folderNames: ["T00002214_三宅　隆文様", "T00002214_三宅隆文様"],
    });
    expect(r.matched).toHaveLength(0);
    expect(r.ambiguous).toEqual([
      {
        tNumber: "T00002214",
        folderNames: ["T00002214_三宅　隆文様", "T00002214_三宅隆文様"],
      },
    ]);
    // 迷った分は「フォルダが無い」には入れない（別の対応が要るため）
    expect(r.missingFolderTNumbers).toHaveLength(0);
  });

  it("★ 桁数が違うT番号は一致しない（完全一致で突合する）", () => {
    const r = matchDropboxFoldersByTNumber({
      tNumbers: ["T00002214"],
      folderNames: ["T0000221_三宅　隆文様"],
    });
    expect(r.matched).toHaveLength(0);
    expect(r.missingFolderTNumbers).toEqual(["T00002214"]);
    expect(r.orphanFolderNames).toEqual(["T0000221_三宅　隆文様"]);
  });

  it("全角・小文字のT番号でも突合する", () => {
    const r = matchDropboxFoldersByTNumber({
      tNumbers: ["ｔ００００２２１４"],
      folderNames: ["T00002214_三宅　隆文様"],
    });
    expect(r.matched).toHaveLength(1);
  });

  it("同じT番号の顧客が二重に来ても一度だけ扱う", () => {
    const r = matchDropboxFoldersByTNumber({
      tNumbers: ["T00002214", "T00002214"],
      folderNames: REAL_FOLDERS,
    });
    expect(r.matched).toHaveLength(1);
  });

  it("空のT番号・空のフォルダ名は無視する", () => {
    const r = matchDropboxFoldersByTNumber({
      tNumbers: ["", "  ", "T00002214"],
      folderNames: ["", "  ", ...REAL_FOLDERS],
    });
    expect(r.matched).toHaveLength(1);
    expect(r.missingFolderTNumbers).toHaveLength(0);
    expect(r.unparsableFolderNames).toHaveLength(0);
  });

  it("★ 二度実行しても同じ結果になる（冪等）", () => {
    const input = {
      tNumbers: ["T00002214", "T00009999"],
      folderNames: REAL_FOLDERS,
    };
    expect(matchDropboxFoldersByTNumber(input)).toEqual(
      matchDropboxFoldersByTNumber(input),
    );
  });
});
