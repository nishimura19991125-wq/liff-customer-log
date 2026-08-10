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

/**
 * 表示する支社（環境変数が未設定でも動くよう既定値を持つ）。
 *
 * **この配列の順序が画面の表示順になる。** 環境変数
 * SALES_PROGRESS_VISIBLE_BRANCHES を設定した場合も、その並び順を
 * そのまま表示順として使う。実績の大小では並べ替えない。
 */
export const SALES_PROGRESS_DEFAULT_VISIBLE_BRANCHES: readonly string[] = [
  "奈良本社",
  "京都支社",
  "名古屋支社",
  "埼玉支社",
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
  /** 表示する支社。**この並び順がそのまま画面の表示順になる** */
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

/**
 * 表示順。設定に並んでいる順 → 最後に「その他」。
 * データが無い支社も行として残すため、ここで全部の見出しを列挙する。
 *
 * 設定側に「その他」や重複が紛れていても、寄せ先が途中に現れたり
 * 同じ見出しが二度出たりしないよう取り除く。
 */
export function salesProgressBranchOrder(
  config: SalesProgressBranchConfig,
): string[] {
  const otherKey = nfkc(config.otherLabel);
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of config.visibleBranches) {
    const label = raw.trim();
    if (!label) continue;
    const key = nfkc(label);
    // 寄せ先は必ず末尾に置くので、途中に出てきたら飛ばす
    if (key === otherKey || seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }

  out.push(config.otherLabel);
  return out;
}
