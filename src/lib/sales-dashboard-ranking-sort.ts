/**
 * 総合PTランキングの並び順。
 *
 *   1. PT の降順
 *   2. PT が同じなら、目標（targetPt）の降順
 *   3. それでも同じなら、氏名の五十音順
 *
 * PT が 0 の人が複数いるとき、目標が高い人から並ぶ。目標が未設定の人は
 * targetPt が 0 なので、PT も目標も 0 の人同士は氏名の順になる。
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
  pt: number;
};

export function sortByPtThenTarget<T extends RankingSortItem>(
  items: T[],
  /** 正規化担当者名 → 目標 PT。引けない担当者は 0 として扱う */
  targetPtByStaff: Map<string, number>,
): T[] {
  const targetOf = (name: string) => targetPtByStaff.get(name) ?? 0;
  return [...items].sort((a, b) => {
    if (a.pt !== b.pt) return b.pt - a.pt;
    const at = targetOf(a.name);
    const bt = targetOf(b.name);
    if (at !== bt) return bt - at;
    return a.name.localeCompare(b.name, "ja");
  });
}
