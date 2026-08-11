/**
 * 既存顧客の Dropbox フォルダ突合（タスクN・純粋関数）。
 *
 * 書類の移行で作られた既存フォルダを、お客様情報の Dropboxリンク 列へ
 * 一括で紐付けるための照合。
 *
 * ■ T番号だけで突合する
 * フォルダ名は `T00002214_三宅　隆文様` の形だが、**顧客名は照合に使わない**。
 * 表記ゆれや改名があると一致しなくなるため。T番号は一意なのでこれで足りる。
 *
 * ■ 同じT番号のフォルダが複数あったら選ばない
 * どちらが正しいか機械的に決められない。推測で選ぶと誤ったフォルダの
 * リンクが顧客に紐付き、他人の書類が見える事故になりうる。ambiguous として
 * 返し、人が直すまで手を付けない。
 */

/**
 * T + 数字 で始まり、区切りは半角アンダースコア（末尾なしも許す）。
 *
 * 桁数は固定しない。実物は `T00002214`（T + 数字8桁）だが、突合は
 * @pocket 側のT番号との**完全一致**で行うので、桁数を決め打ちする必要がない。
 * 決め打ちにすると、桁数の違うT番号が黙って対象から外れる。
 */
const FOLDER_T_NUMBER = /^(T\d+)(?:_|$)/;

/**
 * T番号の正規化。全角数字・空白のゆれを吸収し、英字は大文字へ。
 * @pocket 側の値とフォルダ名の両方に同じものを掛ける。
 */
export function normalizeTNumber(raw: string | undefined): string {
  return (raw ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .trim()
    .toUpperCase();
}

/** フォルダ名の先頭からT番号を取り出す。取れなければ空文字 */
export function tNumberFromFolderName(name: string | undefined): string {
  const normalized = normalizeTNumber(name);
  const m = FOLDER_T_NUMBER.exec(normalized);
  return m?.[1] ?? "";
}

export type DropboxFolderMatchInput = {
  /** Dropboxリンクが空で、T番号が入っている顧客のT番号 */
  tNumbers: readonly string[];
  /** ルート直下のフォルダ名（files/list_folder の結果） */
  folderNames: readonly string[];
};

export type DropboxFolderMatch = {
  tNumber: string;
  folderName: string;
};

export type DropboxFolderMatchResult = {
  matched: DropboxFolderMatch[];
  /** フォルダが見つからなかった顧客のT番号（移行漏れの調査用） */
  missingFolderTNumbers: string[];
  /** @pocket 側に対応が無いフォルダ名（移行漏れの調査用） */
  orphanFolderNames: string[];
  /** 同じT番号のフォルダが複数。人が直すまで触らない */
  ambiguous: Array<{ tNumber: string; folderNames: string[] }>;
  /** T番号で始まっていないフォルダ名（集計にだけ使う） */
  unparsableFolderNames: string[];
};

export function matchDropboxFoldersByTNumber(
  input: DropboxFolderMatchInput,
): DropboxFolderMatchResult {
  const byTNumber = new Map<string, string[]>();
  const unparsableFolderNames: string[] = [];

  for (const raw of input.folderNames) {
    const name = (raw ?? "").trim();
    if (!name) continue;
    const t = tNumberFromFolderName(name);
    if (!t) {
      unparsableFolderNames.push(name);
      continue;
    }
    const list = byTNumber.get(t) ?? [];
    list.push(name);
    byTNumber.set(t, list);
  }

  const matched: DropboxFolderMatch[] = [];
  const missingFolderTNumbers: string[] = [];
  const ambiguous: Array<{ tNumber: string; folderNames: string[] }> = [];
  const usedTNumbers = new Set<string>();
  const seenCustomers = new Set<string>();

  for (const rawT of input.tNumbers) {
    const t = normalizeTNumber(rawT);
    if (!t || seenCustomers.has(t)) continue;
    seenCustomers.add(t);

    const folders = byTNumber.get(t);
    if (!folders || folders.length === 0) {
      missingFolderTNumbers.push(t);
      continue;
    }
    usedTNumbers.add(t);
    if (folders.length > 1) {
      ambiguous.push({ tNumber: t, folderNames: [...folders] });
      continue;
    }
    matched.push({ tNumber: t, folderName: folders[0]! });
  }

  const orphanFolderNames: string[] = [];
  for (const [t, names] of byTNumber) {
    if (usedTNumbers.has(t)) continue;
    orphanFolderNames.push(...names);
  }

  return {
    matched,
    missingFolderTNumbers,
    orphanFolderNames,
    ambiguous,
    unparsableFolderNames,
  };
}
