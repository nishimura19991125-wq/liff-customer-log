/**
 * ランキングの並び順（総合PT・アポ件数で共通）。
 *
 *   1. 実績（PT／アポ件数）の降順
 *   2. 実績が同じなら、目標の降順
 *   3. それでも同じなら、氏名の五十音順
 *
 * 実績が 0 の人が複数いるとき、目標が高い人から並ぶ。目標が未設定の人は
 * 目標が 0 なので、実績も目標も 0 の人同士は氏名の順になる。
 *
 * 支社別の個人の並び（sales-progress-aggregate.ts の
 * sortSalesProgressStaffRows）と**同じ規則**にしてある。同じ画面で並びが
 * 食い違うと読み手が混乱するため。式を変えるならあちらも合わせること。
 *
 * ■ 順位は付けない
 * ここは並べるだけ。rank を振るのは呼び出し側（buildRanking）で、同点でも
 * 連番のまま。並び順を変えても順位の付け方は変わらない。
 */

export type RankingSortItem = {
  /** 正規化担当者名 */
  name: string;
};

/**
 * 総合PT・アポ件数のどちらからも呼ぶ。見る値（PT／件数）だけが違い、規則は
 * 同じなので、valueOf で取り出す形にして実装を1つにしてある。
 */
export function sortByValueThenTarget<T extends RankingSortItem>(
  items: T[],
  /** 実績の値。総合PTなら pt、アポ件数なら apoCount */
  valueOf: (item: T) => number,
  /** 正規化担当者名 → 目標。引けない担当者は 0 として扱う */
  targetByStaff: Map<string, number>,
): T[] {
  const targetOf = (name: string) => targetByStaff.get(name) ?? 0;
  return [...items].sort((a, b) => {
    const av = valueOf(a);
    const bv = valueOf(b);
    if (av !== bv) return bv - av;
    const at = targetOf(a.name);
    const bt = targetOf(b.name);
    if (at !== bt) return bt - at;
    return a.name.localeCompare(b.name, "ja");
  });
}
