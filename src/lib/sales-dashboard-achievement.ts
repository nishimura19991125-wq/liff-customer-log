/**
 * 目標に対する達成率（%・小数第1位まで）。
 *
 * 営業進捗の computeAchievement（sales-progress-aggregate.ts）と同じ式だが、
 * 目標が無いときの表し方が違う。あちらは null を返して画面に「—」を出す。
 * こちらはランキングの行に必ず数値を載せる（0 = 目標未設定）ので 0 を返す。
 * 100% を超えても丸めない。棒を止めるのは表示側の仕事。
 */
export function achievementRate(actual: number, target: number): number {
  if (!Number.isFinite(actual) || !Number.isFinite(target)) return 0;
  if (target <= 0) return 0;
  return Math.round((actual / target) * 1000) / 10;
}
