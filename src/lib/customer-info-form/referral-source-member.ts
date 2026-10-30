import { isReferralSourceRequiredByClub } from "@/lib/customer-info-form/options";
import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";
import type { ReferralSourceOptionsState } from "@/lib/customer-info-form/referral-source-options";

/**
 * 紹介元を加盟店リスト（取引先会社一覧の 会社種別=トラーチ倶楽部加盟店・
 * 取引状況=取引中）の値だけに限定するための照合。
 *
 * 画面（保存前に気づけるようにする説明）とサーバ（保存の拒否）が同じ関数で
 * 照合する。トラーチ倶楽部の案件かどうかは isReferralSourceRequiredByClub。
 *
 * referral-source-options.ts（欄の形）とは分けてある。あちらは
 * 名前の比較を書かないことをテストで固定している。
 */

/**
 * 紹介元が加盟店リストにあるか。
 *
 * 比べ方は画面のコンボボックス（isExactStaffName）と同じ normApClStaffName
 * （NFKC・空白の畳み込み・前後の空白除去）の完全一致。画面で候補と一致して
 * 見える値は、サーバの照合でも一致する。
 *
 * ⚠ isExactStaffName は候補が0件だと true を返すが、こちらは false。
 *   0件のときに「ある」とは言えないため（呼び出し側で別に扱う）。
 */
export function isReferralSourceInMemberList(
  options: readonly string[],
  value: string | null | undefined,
): boolean {
  const v = normApClStaffName(value ?? undefined);
  if (!v) return false;
  return options.some((o) => normApClStaffName(o) === v);
}

/** 加盟店リストに無い紹介元が入っているとき（画面に出す） */
export const REFERRAL_SOURCE_NOT_MEMBER_NOTE =
  "この紹介元はトラーチ倶楽部加盟店の一覧にないため、このままでは保存できません。候補から選び直してください。";

/**
 * 加盟店リストに無い紹介元が入っているときの説明。出さないときは null。
 *
 * 既存の値は選択肢に残す（mergeStaffNameOptions）ので、コンボボックスでは
 * 一致して見え、赤字も出ない。そのまま保存するとサーバが拒否するので、
 * 保存前にここで気づけるようにする。
 *
 * 一覧を読めていないとき・0件のときは出さない（リストに無いとは言えない）。
 * 空のときも出さない（必須の表示で足りる）。
 */
export function referralSourceNotMemberNote(
  values: {
    apStaff?: string | null;
    clStaff?: string | null;
    referralSource?: string | null;
  },
  state: ReferralSourceOptionsState,
): string | null {
  if (!isReferralSourceRequiredByClub(values)) return null;
  if (state.status !== "ready" || state.options.length === 0) return null;
  if (!normApClStaffName(values.referralSource ?? undefined)) return null;
  if (isReferralSourceInMemberList(state.options, values.referralSource)) {
    return null;
  }
  return REFERRAL_SOURCE_NOT_MEMBER_NOTE;
}
