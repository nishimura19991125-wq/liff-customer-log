/**
 * 「引けなかった」を警告として出すかの判定。
 *
 * ■ なぜ要るか
 * PT目標も所属支社も、**一部の人が引けないのは正常**。集計元をお客様情報へ
 * 移してから、顧客の AP/CL 担当者は全員ランキングに載るようになり、そこには
 * 役員・経理など目標を持たない方も含まれる。名簿の勤務場所も同じで、未入力の
 * 人が数人いる。これを毎回警告に出すと、本当の異常に気づけなくなる。
 *
 * ■ 警告にするのは設定・権限の問題だけ
 *   ・参照元そのものを読めていない（available === false）
 *   ・1人も引けていない（missing >= total）
 * このどちらかだけを警告にし、一部が未登録なだけのときは情報として残す。
 *
 * 件数そのものは呼び出し側が info で必ず残すので、後から追える。
 */
export function isLookupConfigFailure(params: {
  /** 引けなかった人数 */
  missing: number;
  /** 対象の人数 */
  total: number;
  /** 参照元を読めたか。読めていなければ人数によらず異常 */
  available?: boolean;
}): boolean {
  if (params.available === false) return true;
  // そもそも対象が居なければ「引けなかった」も無い
  if (params.total <= 0) return false;
  return params.missing >= params.total;
}
