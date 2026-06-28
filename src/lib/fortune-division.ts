/** おみくじ文言の事業部カテゴリ（CL営業・アポ取得・内勤） */

export type FortuneDivision = "cl" | "ap" | "office";

export type FortuneDivisionContext = {
  department?: string | null;
  /** 名簿の AP/CL 稼働状況から判定（部署未設定時の補助） */
  staffRole?: "ap" | "cl" | null;
};

function nfkcLower(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

/** スタッフ名簿の「部署」「事業部」等のラベルからカテゴリを推定 */
export function resolveFortuneDivisionFromLabel(
  department?: string | null,
): FortuneDivision | null {
  const d = nfkcLower(department ?? "");
  if (!d) return null;

  if (
    /アポ|ａｐ|ap事|ap部|ap担当|アポイン|テレアポ|テレマ|天下|件数部門/.test(d) ||
    d === "ap" ||
    d.startsWith("ap ") ||
    d.endsWith(" ap")
  ) {
    return "ap";
  }

  if (
    /事務|内勤|バック|経理|総務|受付|サポート|カスタマー|cs|管理部|管理/.test(d)
  ) {
    return "office";
  }

  if (
    /cl|ｃｌ|クロ|クローザ|営業|セールス|リフォーム|訪問|field|売上/.test(d)
  ) {
    return "cl";
  }

  return null;
}

export function resolveFortuneDivision(
  ctx: FortuneDivisionContext = {},
): FortuneDivision {
  const fromLabel = resolveFortuneDivisionFromLabel(ctx.department);
  if (fromLabel) return fromLabel;

  if (ctx.staffRole === "ap") return "ap";
  if (ctx.staffRole === "cl") return "cl";

  return "cl";
}
