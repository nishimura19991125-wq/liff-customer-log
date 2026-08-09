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
/**
 * 全角スペース U+3000。
 * ソース上に生の文字を書くと半角と見分けが付かず、編集で壊れても気付けないため
 * コードポイントから作る。
 */
const IDEOGRAPHIC_SPACE = String.fromCharCode(0x3000);

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
 * 3. 連続する空白を1つに畳む（**全角スペースは全角のまま維持**）
 * 4. 前後の空白をトリム
 * 5. 末尾のピリオド・空白を落とす（Dropbox が末尾ピリオドを嫌う）
 *
 * ⚠ 3 で全角スペース（U+3000）を維持するのが要点。
 *   JavaScript の `\s` は U+3000 にマッチするため、素朴に
 *   `.replace(/\s+/g, " ")` と書くと「山田　太郎」が「山田 太郎」になり、
 *   @pocket の顧客名（全角スペース区切り）とフォルダ名がずれていた。
 *   U+3000 は Dropbox の禁止文字ではないのでそのまま使える。
 */
export function sanitizeDropboxName(raw: string): string {
  const mapped = [...(raw ?? "")]
    .map((ch) => normalizeControlChar(ch))
    .map((ch) => FORBIDDEN_CHAR_MAP.get(ch) ?? ch)
    .join("");
  return (
    mapped
      // 連続する空白は1つに畳む。全角スペースを含む並びは全角のまま残す
      .replace(/\s+/g, (run) =>
        run.includes(IDEOGRAPHIC_SPACE) ? IDEOGRAPHIC_SPACE : " ",
      )
      // trim は U+3000 も空白として落とす（前後の全角スペースは除去される）
      .trim()
      .replace(/[.\s]+$/, "")
  );
}

/**
 * **顧客名専用**のサニタイズ。
 *
 * sanitizeDropboxName に加えて、空白（半角・全角・タブ・改行）を
 * **すべて全角スペース1つに統一**する。@pocket の顧客名が全角スペース区切りで
 * 格納されているため、フォルダ名・ファイル名の表記をそこへ揃える。
 *
 * ⚠ 適用するのは顧客名だけ。書類の**項目名には適用しない**。
 *   項目名（@pocket の列見出し）に現状は半角スペースが無いが、将来増えたときに
 *   意図せず全角化されると、見出しとファイル名の表記がずれてしまう。
 *   そのため sanitizeDropboxName とは別関数に分けている。
 */
export function sanitizeCustomerNameForDropbox(raw: string): string {
  // sanitizeDropboxName の時点で空白の並びは1文字に畳まれている。
  // 残った半角スペースを全角へ寄せれば、混在も含めて全角1つに揃う。
  return sanitizeDropboxName(raw ?? "").replace(/\s+/g, IDEOGRAPHIC_SPACE);
}

/**
 * 顧客フォルダ名を作る。
 *
 * T番号・お客様名のどちらかが（サニタイズ後に）空なら null を返す。
 * 呼び出し側はフォルダを作らずサーバログに記録すること。
 *
 * お客様名だけ空白を全角へ統一する（T番号に空白は入らない想定）。
 */
export function buildCustomerFolderName(
  tNumber: string,
  customerName: string,
): string | null {
  const t = sanitizeDropboxName(tNumber ?? "");
  const name = sanitizeCustomerNameForDropbox(customerName ?? "");
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
