/**
 * Dropbox の顧客フォルダ名を組み立てる純粋関数。
 * Dropbox にも Next にも依存しないのでそのまま単体テストできる。
 *
 * 形式: `<T番号>_<お客様名>様`   例: T00001691_山田太郎様
 */

/**
 * Dropbox のファイル名に使えない文字 → 全角への置換表。
 *
 * 除去ではなく置換にしている。顧客名から文字を落とすと
 * 「山田/太郎」と「山田太郎」が同じフォルダ名になり、別の顧客が
 * 同じフォルダを共有してしまうため。
 */
const FORBIDDEN_CHAR_MAP: ReadonlyMap<string, string> = new Map([
  ["/", "／"],
  ["\\", "＼"],
  ["?", "？"],
  ["*", "＊"],
  [":", "："],
  ["|", "｜"],
  ['"', "＂"],
  ["<", "＜"],
  [">", "＞"],
]);

/**
 * 制御文字を落とす。フォルダ名に入ると Dropbox が 400 を返すため。
 *
 * ただしタブ・改行類（0x09〜0x0D）は**空白に変換**して残す。
 * 単純に落とすと「山田(改行)太郎」が「山田太郎」になり姓名の区切りが消える。
 * 空白へ寄せておけば後段の畳み込みで半角スペース1つになり、
 * audit-log-changes.ts の foldWhitespace と同じ扱いに揃う。
 *
 * 正規表現の文字クラスに生の制御文字を書くと編集・パッチ経由で壊れやすいため
 * コードポイントで判定する。
 */
function normalizeControlChar(ch: string): string {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp >= 0x09 && cp <= 0x0d) return " ";
  if (cp < 0x20 || cp === 0x7f) return "";
  return ch;
}

/**
 * Dropbox のフォルダ名として安全な文字列にする。
 *
 * 1. 制御文字を除去（置換しても意味を持たないため）
 * 2. 禁止文字を全角へ置換
 * 3. 連続する空白を1つに畳む
 * 4. 前後の空白をトリム
 * 5. 末尾のピリオド・空白を落とす（Dropbox が末尾ピリオドを嫌う）
 */
export function sanitizeDropboxName(raw: string): string {
  const mapped = [...(raw ?? "")]
    .map((ch) => normalizeControlChar(ch))
    .map((ch) => FORBIDDEN_CHAR_MAP.get(ch) ?? ch)
    .join("");
  return mapped.replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "");
}

/**
 * 顧客フォルダ名を作る。
 *
 * T番号・お客様名のどちらかが（サニタイズ後に）空なら null を返す。
 * 呼び出し側はフォルダを作らずサーバログに記録すること。
 */
export function buildCustomerFolderName(
  tNumber: string,
  customerName: string,
): string | null {
  const t = sanitizeDropboxName(tNumber ?? "");
  const name = sanitizeDropboxName(customerName ?? "");
  if (!t || !name) return null;
  return `${t}_${name}様`;
}

/** ルートパスとフォルダ名から Dropbox のフルパスを作る（末尾スラッシュは落とす） */
export function joinDropboxPath(rootPath: string, folderName: string): string {
  const root = rootPath.replace(/\/+$/, "");
  return `${root}/${folderName}`;
}

/** フルパスから親ディレクトリを取り出す（リネーム時に同じ階層へ移すため） */
export function dropboxParentPath(fullPath: string): string {
  const trimmed = fullPath.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  if (idx <= 0) return "";
  return trimmed.slice(0, idx);
}
