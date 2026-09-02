/** ランキング棒グラフの幅（%）。1位を100%とした割合 */
export function barRatio(value: number, top: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(top) || top <= 0) return 0;
  return Math.min(100, Math.max(0, (value / top) * 100));
}
