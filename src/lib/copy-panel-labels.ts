import { CONSTRUCTION_REQUEST_STATUS_DONE } from "@/lib/construction-request-template";

/**
 * お客様情報のコピーパネル3つ（新規施工依頼 / タイムツリー登録用 /
 * KANNA案件名登録）で共通の文言。
 *
 * 3つとも同じ「コピー」に統一する。パネルごとに文字列を書くと、
 * どれか1つだけ直したときに揃わなくなるため定数で持つ。
 *
 * 外側の開閉トグル（「送る」「閉じる」）はこれとは別物。
 * あちらはコピーを実行せず、パネルを開閉するだけ
 */
export const COPY_BUTTON_LABEL = "コピー";

/**
 * 新規施工依頼のボタン下に出す補足文。
 *
 * ボタンの文言を「コピー」に統一した結果、このパネルだけにある
 * 「@pocket のステータスを更新する」という副作用がラベルから読み取れなく
 * なった。補足文で補い、aria-describedby でボタンと結び付ける。
 */
export const CONSTRUCTION_REQUEST_STATUS_HINT =
  "施工依頼ステータスが「済」になります";

/**
 * 補足文を出すか。
 *
 * 既に「済」なら更新は起きないので出さない。
 * 判定は既存の alreadyDone と同じ「現在のステータスが済か」。
 */
export function showsConstructionRequestStatusHint(
  currentStatus: string | undefined,
): boolean {
  return (currentStatus ?? "").trim() !== CONSTRUCTION_REQUEST_STATUS_DONE;
}
