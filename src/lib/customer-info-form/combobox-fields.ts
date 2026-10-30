import { REFERRAL_SOURCE_KEY } from "@/lib/customer-info-form/options";

/**
 * お客様情報の欄のうち、スタッフ名のコンボボックス（StaffNameSuggestCombobox）で
 * 入力する項目か。入力すると候補が絞られ、確定時は候補に揃える部品。
 *
 * ■ AP担当者・CL担当者
 * 以前から常にこの部品（一覧の読み込み中・0件でも）。動きは変えていない。
 *
 * ■ 紹介元
 * トラーチ倶楽部の案件で、取引先会社一覧（トラーチ倶楽部加盟店）を
 * 読めたときだけ。referralSourceFieldPresentation がそのとき type: "select"・
 * 選択肢あり にするので、それを目印にする。
 * それ以外（トラーチ倶楽部でない・一覧を読めない・読み込み中）はテキストのまま。
 *
 * ⚠ 部品は確定時に「候補と一致しなければ先頭の候補に置き換え、
 *   当てはまらなければ空にする」。紹介元は加盟店から選ばせるのが目的なので
 *   この動きのまま使う。既存の手入力の値は mergeStaffNameOptions で
 *   選択肢に足してあるので、開いて保存しても置き換わらない。
 *   **選択肢に今の値を足す処理を外すと既存データが壊れる。**
 *
 * ⚠ 部品の赤字（「スタッフ名を候補から選んでください」）は部品の中に
 *   固定で書かれていて、紹介元でもそのまま出る。部品には手を入れない方針。
 */

const AP_CL_STAFF_COMBOBOX_KEYS: ReadonlySet<string> = new Set([
  "apStaff",
  "clStaff",
]);

/** 紹介元をコンボボックスにしたときの入力欄の案内（部品の placeholder で渡せる） */
export const REFERRAL_SOURCE_COMBOBOX_PLACEHOLDER = "会社名を入力または候補から選択";

export function customerInfoFieldUsesStaffNameCombobox(field: {
  key: string;
  type: string;
  options?: readonly string[];
  optionsPending?: boolean;
}): boolean {
  if (AP_CL_STAFF_COMBOBOX_KEYS.has(field.key)) return true;
  if (field.key === REFERRAL_SOURCE_KEY) {
    return (
      field.type === "select" &&
      !field.optionsPending &&
      (field.options?.length ?? 0) > 0
    );
  }
  return false;
}
