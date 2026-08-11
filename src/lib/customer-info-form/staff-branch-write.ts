import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";

/**
 * AP所属支店・CL所属支店を書き込むかどうかの判定（純粋関数）。
 *
 * この2列は hiddenInForm で画面に出ない。担当者名から名簿の勤務場所を引いて
 * 保存時に自動で入れているが、これまでは
 *
 *   payload[apBranchField.fieldId] = workplace?.trim() || "-"
 *
 * と書いており、**保存のたびに引き直し、引けなければ "-" で潰していた**。
 * 退職者・AP/CL稼働を外した人・表記ゆれのある担当者だと毎回 "-" になり、
 * 利用者は見ることも触ることもできないまま値が失われていた。
 * 先に直した AP/CL担当者（ap-cl-staff-commit.ts）と同じ構造。
 *
 * 方針:
 *   1. 担当者名が変わっていなければ引き直さず、payload にも載せない
 *   2. 名簿から引けなかったときは "-" を書かず、payload にも載せない
 *      （「引けない」ことと「支店が無い」ことは別）
 */

/**
 * 担当者が変わったか。変わったときだけ名簿を引き直す。
 *
 * 読み込み値が取れなかった場合（undefined）は「変わった」とみなして引き直す。
 * 今までどおり追随させるためで、引けなければ書かないので潰す心配はない。
 * 比較は normApClStaffName なので、全角半角・空白のゆれは同じ名前として扱う。
 */
export function staffBranchNeedsRefresh(
  loadedStaffName: string | undefined,
  currentStaffName: string | undefined,
): boolean {
  return (
    normApClStaffName(loadedStaffName) !== normApClStaffName(currentStaffName)
  );
}

/**
 * 名簿から引いた勤務場所のうち、実際に書いてよい値。
 * 引けなかった（空・null・undefined）ときは null を返し、呼び出し側は
 * payload に載せない。
 */
export function staffBranchValueToWrite(
  workplace: string | null | undefined,
): string | null {
  const t = (workplace ?? "").trim();
  return t ? t : null;
}
