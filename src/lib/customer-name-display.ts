/**
 * お客様名の表示用整形。
 *
 * @pocket に保存されている値は変更しない。**画面に出すときだけ**整える。
 *
 * 運用上は「様なし」で入力するが、入力ミスや別経路からの登録で
 * 既に「様」が付いたレコードが存在する（例:「杉原 正敏様」）。
 * また姓名の区切りが半角スペースと全角スペースで混在している。
 */

/** 姓名の区切りに使う全角スペース U+3000。半角と見分けが付かないので定数にする */
const IDEOGRAPHIC_SPACE = String.fromCharCode(0x3000);

const HONORIFIC = "様";

/**
 * 空白の並びを全角スペース1つに揃える。
 *
 * 半角・全角・タブ・改行のいずれもまとめて全角へ寄せる。
 * 前後の空白はトリムする。
 */
export function normalizeCustomerNameSpacing(
  raw: string | undefined | null,
): string {
  const t = (raw ?? "").trim();
  // @pocket の「未入力」表現
  if (!t || t === "-") return "";
  return t.replace(/\s+/g, IDEOGRAPHIC_SPACE).trim();
}

/**
 * 表示用のお客様名。空白を全角へ揃え、末尾に「様」を付ける。
 *
 * - 既に「様」で終わっていれば二重に付けない
 * - 名前が空なら「様」も付けず空文字を返す
 */
export function formatCustomerNameForDisplay(
  raw: string | undefined | null,
): string {
  const name = normalizeCustomerNameSpacing(raw);
  if (!name) return "";
  return name.endsWith(HONORIFIC) ? name : `${name}${HONORIFIC}`;
}

/**
 * 姓名の間の空白を**詰めた**表示名（タスクU の一行サマリ用）。
 *
 * 一行サマリは項目の区切りに半角スペースを使うため、名前の中に空白が
 * 残っていると項目の切れ目が分からなくなる。そのため
 * formatCustomerNameForDisplay（全角スペースに揃える）とは別扱いにする。
 * 新規施工依頼（タスクH）の表記は従来どおりで、こちらは使わない。
 *
 * - 全角・半角どちらの空白も落とす
 * - 既に「様」で終わっていれば二重に付けない
 * - 名前が空なら「様」も付けず空文字を返す
 */
export function formatCustomerNameCompactWithHonorific(
  raw: string | undefined | null,
): string {
  const t = (raw ?? "").trim();
  // @pocket の「未入力」表現
  if (!t || t === "-") return "";
  const compact = t.replace(/\s+/g, "");
  if (!compact) return "";
  return compact.endsWith(HONORIFIC) ? compact : `${compact}${HONORIFIC}`;
}
