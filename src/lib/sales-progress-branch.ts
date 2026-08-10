/**
 * 営業進捗の支社の振り分け（タスクK）。
 *
 * 表示するのは決まった支社だけで、それ以外と未設定はすべて「その他」へ寄せる。
 * こうすると支社別の合計が必ず全社合計と一致する。捨ててしまうと、
 * 支社別を足しても全社に届かず、数字を信用できなくなる。
 *
 * 「その他」に入るのは、支社が空の行と、業務委託・トラーチ倶楽部・卸案件など
 * 表示対象に含めていない値の行。
 */

/** 表示する支社（環境変数が未設定でも動くよう既定値を持つ） */
export const SALES_PROGRESS_DEFAULT_VISIBLE_BRANCHES: readonly string[] = [
  "埼玉支社",
  "奈良本社",
  "名古屋支社",
  "京都支社",
];

export const SALES_PROGRESS_DEFAULT_OTHER_BRANCH_LABEL = "その他";

function nfkc(s: string): string {
  return (s ?? "").normalize("NFKC").replace(/\s+/g, "").trim();
}

/** `埼玉支社,奈良本社,...` を配列にする。空・未設定なら既定値 */
export function parseSalesProgressVisibleBranches(
  raw: string | undefined,
): string[] {
  const parsed = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : [...SALES_PROGRESS_DEFAULT_VISIBLE_BRANCHES];
}

export type SalesProgressBranchConfig = {
  /** 表示する支社。並び順もこのとおりにする */
  visibleBranches: string[];
  otherLabel: string;
};

/**
 * 支社の生の値を、表示する支社名か「その他」に振り分ける。
 *
 * 表記ゆれ（全角半角・空白）を吸収して突き合わせ、一致したら
 * **設定側の表記**を返す。@pocket 側の細かなゆれで見出しが分裂しないようにする。
 */
export function resolveSalesProgressBranch(
  raw: string | undefined,
  config: SalesProgressBranchConfig,
): string {
  const target = nfkc(raw ?? "");
  if (!target) return config.otherLabel;
  for (const branch of config.visibleBranches) {
    if (nfkc(branch) === target) return branch;
  }
  return config.otherLabel;
}

/** 表示順（表示する支社 → その他）。データが無い支社も行として残す */
export function salesProgressBranchOrder(
  config: SalesProgressBranchConfig,
): string[] {
  return [...config.visibleBranches, config.otherLabel];
}
