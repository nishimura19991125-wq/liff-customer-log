import {
  CONSTRUCTION_SLOT_RESET_FIELDS,
  CONSTRUCTION_SLOT_RESET_FIELD_LABELS,
} from "@/lib/calendar-empty-slot-reset";
import { formatDisplayYmd } from "@/lib/format-display-ymd";

/**
 * 工事日変更（枠の移し替え）の、送信先と文言（M-2）。
 *
 * 文言をサーバのテンプレート文字列へ散らさず1箇所に置くのは、移動が
 * **2つのレコードを書き換える**操作で、途中で止まったときに「今どうなって
 * いて、何をすればよいか」を正確に伝える必要があるため。ここが曖昧だと
 * 案件が2件のまま放置される。
 */

/** M-2 で追加した移動 API。assign-customer-case（案A）とは別物 */
export const MOVE_CONSTRUCTION_CASE_PATH =
  "/api/calendar/move-construction-case";

/** サーバがどこへ書いたか */
export type MovedCaseTarget = "slot" | "new";

export type MoveConstructionCaseResponse = {
  ok?: boolean;
  error?: string;
  /** 移動先への書き込みは済んでいる（＝案件は消えていない） */
  constructionSaved?: boolean;
  slotConflict?: boolean;
  movedTo?: MovedCaseTarget;
  /** 移動元を空き枠へ戻せたか */
  sourceResetToEmptySlot?: boolean;
  /** 戻せなかったときに、利用者が @pocket で直す対象 */
  sourceRecordId?: string;
  sourceDayKey?: string;
};

/** 消す4列の見出しを「・」でつないだもの（文言と定義をずらさない） */
export function movedSourceClearedColumnsLabel(): string {
  return CONSTRUCTION_SLOT_RESET_FIELDS.map(
    (key) => CONSTRUCTION_SLOT_RESET_FIELD_LABELS[key],
  ).join("・");
}

/**
 * 移動元を空き枠へ戻せなかったときの文言。
 *
 * ■ 「2日に重複して表示されている」と言い切る
 * 移動先への書き込みは成功しているので、同じ案件が2件ある。黙って
 * 「失敗しました」とだけ返すと、利用者は移動そのものが無かったと思って
 * 押し直し、3件目を作りかねない。
 *
 * ■ 直すまで他の操作が止まることまで書く
 * 同じ T番号 の工事レコードが2件あると
 * findConstructionRecordByTNumber が「複数一致」で error を返し、
 * 割り当て（案A）もキャンセル処理も**何も書かずに止まる**。
 * 実際にそうなるので、放置されないよう先に伝えておく。
 *
 * ■ 日付は yyyy/mm/dd で出す
 * 月をまたぐ移動があるので「12月1日」だと年が分からない。
 * @pocket でレコードを探す人が迷わないほうを採る。
 */
export function buildMoveSourceResetFailedMessage(input: {
  sourceRecordId: string;
  sourceDayKey: string;
  targetDayKey: string;
}): string {
  const from = formatDisplayYmd(input.sourceDayKey) || input.sourceDayKey;
  const to = formatDisplayYmd(input.targetDayKey) || input.targetDayKey;

  return [
    `移動先（${to}）への登録は完了しましたが、移動元（${from}・レコードID ${input.sourceRecordId}）を空き枠に戻せませんでした。`,
    "現在この案件は2日に重複して表示されています。",
    `@pocket で${from}のレコードから${movedSourceClearedColumnsLabel()}を消してください。`,
    "消すまで、この案件の割り当て・キャンセルはエラーになります。",
  ].join("\n");
}
