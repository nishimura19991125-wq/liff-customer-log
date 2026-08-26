/**
 * 希望メーカー（@pocket 側はテキスト型・field-61）の値の組み立て。
 *
 * 画面はチェックボックス（複数選択）だが、@pocket は選択肢型ではなく
 * テキスト型なので、保存時は半角カンマ区切りの文字列にする。
 * 既存データがこの形式のため、それに揃える。
 *
 *   例: SHARP,XSOL,Panasonic
 *
 * - 区切りは半角カンマ。スペースは入れない
 * - 並び順は下の定義順に固定する。選んだ順に左右されると、
 *   同じ内容でも案件ごとに表記が変わってしまう
 */

export const APO_DESIRED_MANUFACTURER_OPTIONS: readonly string[] = [
  "SHARP",
  "XSOL",
  "Panasonic",
  "その他",
];

/** 「その他メーカー」を出す条件になる選択肢 */
export const APO_DESIRED_MANUFACTURER_OTHER = "その他";

/** 半角カンマ区切り。スペースを入れない */
const SEPARATOR = ",";

/**
 * 画面が持っている値（カンマ区切りの文字列）を選択肢の配列にする。
 * 区切りは半角カンマ・読点・改行のいずれも受ける（保存済みデータの揺れ対策）。
 */
export function parseApoDesiredManufacturers(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/[,、\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * @pocket へ送る文字列にする。
 *
 * 定義順に並べ替え、半角カンマで連結する。定義に無い値は落とさず
 * 末尾へ回す（@pocket 側で選択肢が増えたときに情報を消さないため）。
 */
export function formatApoDesiredManufacturers(raw: string | undefined): string {
  const selected = parseApoDesiredManufacturers(raw);
  if (selected.length === 0) return "";

  const options = APO_DESIRED_MANUFACTURER_OPTIONS;
  const orderOf = (value: string): number => {
    const i = options.indexOf(value);
    return i === -1 ? options.length : i;
  };

  return [...selected]
    .sort((a, b) => orderOf(a) - orderOf(b))
    .join(SEPARATOR);
}

/** 「その他」が選ばれているか。その他メーカーの表示・必須の条件になる */
export function hasApoDesiredManufacturerOther(
  raw: string | undefined,
): boolean {
  return parseApoDesiredManufacturers(raw).includes(
    APO_DESIRED_MANUFACTURER_OTHER,
  );
}
