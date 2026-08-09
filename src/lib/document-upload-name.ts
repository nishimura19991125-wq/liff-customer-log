/**
 * アップロードする書類のファイル名を組み立てる純粋関数。
 *
 * 形式: `<項目名>_<お客様名>_<日付>_<時分>_<連番>.<拡張子>`
 * 例:   本人確認書類_山田太郎_20260809_1430_01.pdf
 *
 * サニタイズはタスクEの dropbox-folder-name.ts を再利用する（新たに書かない）。
 * 項目名には `・` `(` `)` が含まれる（例: 委任状(ID・パスワード開示用)）。
 * これらは Dropbox の禁止文字ではないのでそのまま残り、
 * 禁止文字（/ \ ? * : | " < >）だけが全角へ置換される。
 */

import { sanitizeDropboxName } from "@/lib/dropbox-folder-name";
import { jstWallParts } from "@/lib/jst-hm";

/**
 * 受け付ける拡張子。クライアントのファイル名から**拡張子だけ**を採り、
 * ここに無いものは拒否する（ファイル名そのものは信用しない）。
 */
export const DOCUMENT_ALLOWED_EXTENSIONS: readonly string[] = [
  "pdf",
  "jpg",
  "jpeg",
  "png",
  "heic",
];

const ALLOWED_EXTENSION_SET = new Set(DOCUMENT_ALLOWED_EXTENSIONS);

/**
 * 元のファイル名から拡張子を取り出す。許可リストに無ければ null。
 * 大文字は小文字へ寄せる（.PDF → pdf）。
 */
export function documentExtensionFromFileName(
  originalName: string,
): string | null {
  const name = (originalName ?? "").trim();
  const dot = name.lastIndexOf(".");
  if (dot < 0 || dot === name.length - 1) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  // 拡張子に使えない文字が混じっていたら弾く（"pdf?x" 等）
  if (!/^[a-z0-9]+$/.test(ext)) return null;
  return ALLOWED_EXTENSION_SET.has(ext) ? ext : null;
}

/** JST の日付・時分（YYYYMMDD / HHmm） */
export function jstFileNameStamp(now: Date = new Date()): {
  ymd: string;
  hm: string;
} {
  const j = jstWallParts(now);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return {
    ymd: `${j.y}${p2(j.m)}${p2(j.d)}`,
    hm: `${p2(j.h)}${p2(j.min)}`,
  };
}

/**
 * 連番の手前までの共通部分。
 * `<項目名>_<お客様名>_<日付>_<時分>_`
 *
 * 項目名・お客様名は個別にサニタイズする。連結後にまとめてかけると
 * 区切りの `_` まで巻き込んで判定が変わりうるため。
 */
export function documentFileNamePrefix(opts: {
  caption: string;
  customerName: string;
  ymd: string;
  hm: string;
}): string | null {
  const caption = sanitizeDropboxName(opts.caption);
  const customerName = sanitizeDropboxName(opts.customerName);
  if (!caption || !customerName) return null;
  return `${caption}_${customerName}_${opts.ymd}_${opts.hm}_`;
}

/** 連番は2桁ゼロ埋め。100以上は桁が増える（ゼロ埋めの意味を保つ） */
export function formatDocumentSequence(seq: number): string {
  return String(Math.max(1, Math.floor(seq))).padStart(2, "0");
}

export function buildDocumentFileName(
  prefix: string,
  seq: number,
  extension: string,
): string {
  return `${prefix}${formatDocumentSequence(seq)}.${extension}`;
}

/**
 * 同じ prefix（＝同じ項目・顧客・分）を持つ既存ファイルの**最大連番の次**を返す。
 *
 * 同じ分内に2回アップロードすると衝突する。取り消し機能が無く、上書きは
 * 復旧不能な事故になるため、必ずフォルダの実在ファイルから採番する。
 *
 * 拡張子は見ない。`..._01.pdf` と `..._01.jpg` は同じ連番なので、
 * 次は 02 になる（人が並べたときに番号が重複しない）。
 */
export function nextDocumentSequence(
  existingNames: readonly string[],
  prefix: string,
): number {
  let max = 0;
  for (const raw of existingNames) {
    const name = (raw ?? "").trim();
    if (!name.startsWith(prefix)) continue;
    const rest = name.slice(prefix.length);
    // 連番は先頭の数字列。直後は「.」（拡張子）である必要がある
    const m = /^(\d+)\./.exec(rest);
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}
