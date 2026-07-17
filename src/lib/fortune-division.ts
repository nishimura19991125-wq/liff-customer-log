/** おみくじ文言の部署カテゴリ */

export type FortuneDepartmentKey =
  | "ap"
  | "cl"
  | "office"
  | "accounting"
  | "dx"
  | "construction"
  | "hr"
  | "club";

/** @deprecated 互換用。FortuneDepartmentKey と同義 */
export type FortuneDivision = FortuneDepartmentKey;

export type FortuneDivisionContext = {
  department?: string | null;
  /** 名簿の AP/CL 稼働状況から判定（営業系部署の補助） */
  staffRole?: "ap" | "cl" | null;
};

function nfkcLower(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

function isApRoleLabel(d: string): boolean {
  return (
    /アポ|ａｐ|ap事|ap部|ap担当|アポイン|テレアポ|テレマ|天下|件数部門/.test(d) ||
    d === "ap" ||
    d.startsWith("ap ") ||
    d.endsWith(" ap")
  );
}

function isClRoleLabel(d: string): boolean {
  return /cl|ｃｌ|クロ|クローザ|営業|セールス|リフォーム|訪問|field|売上|dc事|アライアンス/.test(
    d,
  );
}

/** スタッフ名簿の「部署」「事業部」等のラベルからカテゴリを推定 */
export function resolveFortuneDepartmentFromLabel(
  department?: string | null,
  staffRole?: "ap" | "cl" | null,
): FortuneDepartmentKey | null {
  const d = nfkcLower(department ?? "");
  if (!d) return null;

  if (/人事/.test(d)) return "hr";
  if (/経理|会計|財務/.test(d)) return "accounting";
  if (/dx|ＤＸ|システム|推進課/.test(d)) return "dx";
  if (/工事|施工|工務|現場/.test(d)) return "construction";
  if (/トラーチ|倶楽部|パーソナルトラーチ|ｐｔ|pt部/.test(d)) return "club";
  if (/事務|内勤|バック|総務|受付|サポート|カスタマー|cs|管理部|管理/.test(d)) {
    return "office";
  }

  if (isApRoleLabel(d)) return "ap";

  if (isClRoleLabel(d)) {
    if (staffRole === "ap") return "ap";
    return "cl";
  }

  return null;
}

export function resolveFortuneDepartment(
  ctx: FortuneDivisionContext = {},
): FortuneDepartmentKey {
  const fromLabel = resolveFortuneDepartmentFromLabel(
    ctx.department,
    ctx.staffRole,
  );
  if (fromLabel) return fromLabel;

  if (ctx.staffRole === "ap") return "ap";
  if (ctx.staffRole === "cl") return "cl";

  return "cl";
}

/** @deprecated resolveFortuneDepartment を使用 */
export function resolveFortuneDivisionFromLabel(
  department?: string | null,
): FortuneDepartmentKey | null {
  return resolveFortuneDepartmentFromLabel(department);
}

/** @deprecated resolveFortuneDepartment を使用 */
export function resolveFortuneDivision(
  ctx: FortuneDivisionContext = {},
): FortuneDepartmentKey {
  return resolveFortuneDepartment(ctx);
}
