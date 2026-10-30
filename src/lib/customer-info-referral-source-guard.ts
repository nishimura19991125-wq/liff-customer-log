/**
 * トラーチ倶楽部の案件で、紹介元が空のままの保存をサーバで拒否する。
 *
 * 画面の必須チェック（validate.ts）は送られてきた値だけを見る。
 * API を直接叩いて AP/CL や紹介元を送らなければ、そこは素通りできる。
 * ここでは **保存後のレコードに入る値**（送った値、送っていなければ
 * 保存前の @pocket の値）で判定し直す。
 *
 * 判定は isReferralSourceRequiredByClub（options.ts）。ここで名前を
 * 比べ直さないこと。
 */

/** 紹介元が空のとき */
export const REFERRAL_SOURCE_REQUIRED_ERROR =
  "AP担当者またはCL担当者がトラーチ倶楽部の案件は、紹介元の入力が必須です。紹介元を入力してから保存してください。";

/**
 * 紹介元の列が見つからないとき（環境変数・見出しのどちらでも解決できない）。
 *
 * 必須にできないまま通すと、空のトラーチ倶楽部案件が保存されてしまう。
 * トラーチ倶楽部の案件に限って保存を止める（それ以外は従来どおり）。
 */
export const REFERRAL_SOURCE_COLUMN_MISSING_ERROR =
  "紹介元の欄が見つからないため保存できません。管理者に連絡してください。";

/** 保存前の紹介元を読めず、空かどうか確かめられないとき */
export const REFERRAL_SOURCE_UNREADABLE_ERROR =
  "紹介元を確認できなかったため保存できません。時間をおいてもう一度お試しください。";

/** 紹介元が未入力か。画面の必須チェック（text の既定）と同じく空白・「-」は未入力 */
export function isReferralSourceBlank(raw: string | null | undefined): boolean {
  const t = (raw ?? "").trim();
  return t === "" || t === "-";
}
