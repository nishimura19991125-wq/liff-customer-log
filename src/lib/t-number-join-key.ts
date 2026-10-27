import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";
import { coerceCustomerInfoDisplayString } from "@/lib/customer-info-record";

/**
 * 残工案件・契約情報入力と突き合わせるときの T番号 のキー。
 *
 * NFKC（全角半角をそろえる）＋連続空白を1つ＋前後の空白を落とす。
 * 施工管理タブ（construction-management.ts の tNumberKey）と同じ正規化。
 *
 * ⚠ 工事カレンダーの既存の突き合わせ（工事報告・✅・【延期】の判定）は
 *    calendar-kojo.ts の normalizeTNumberKey（NFKC しない）のまま。
 *    全体を NFKC に変えると ✅ の結果まで変わるので、残工の突き合わせ
 *    だけをこちらで行う（残工 段階1・案A）。
 */
export function tNumberJoinKey(raw: unknown): string {
  return normApClStaffName(coerceCustomerInfoDisplayString(raw));
}
