import type { CalendarRecordMonthPatch } from "@/lib/calendar-api-types";

/**
 * 「お客様情報の案件を工事カレンダーへ載せる」割り当ての、画面側の取り決め
 * （第3段階 3-3・案B で削除の文言を追加）。
 *
 * 送信先と成功時の文言をここに置くのは、呼び出し元が2箇所あるため
 * （空き枠カード・新規登録タブ）。文言を書き分けると、片方だけ
 * **もう嘘になった説明**が残る。実際 3-3 で「空き枠は残します」と
 * 書いた説明が、案B で嘘になった。
 */

/** 3-2 で追加した割り当て API。旧経路（assign-case-to-slot）ではない */
export const ASSIGN_CUSTOMER_CASE_PATH = "/api/calendar/assign-customer-case";

/**
 * サーバがどこへ書いたか。
 *   existing … T番号 の工事レコードが既にあったので、そちらへ書いた
 *              空き枠には書かないので、選ばれた枠は**削除する**（案B）
 *   slot     … 空き枠のレコードを案件に変えた（枠は削除しない）
 *   new      … 工事登録アプリに新規作成した
 */
export type AssignedCaseTarget = "existing" | "slot" | "new";

export type AssignCustomerCaseResponse = {
  ok?: boolean;
  error?: string;
  customerInfoSynced?: boolean;
  constructionSaved?: boolean;
  calendarPatch?: CalendarRecordMonthPatch;
  slotConflict?: boolean;
  warning?: string;
  assignedTo?: AssignedCaseTarget;
  /** 空き枠のレコードを案件に変えたか（existing 経路では常に false） */
  slotUsed?: boolean;
  /** 空き枠を物理削除したか（existing 経路でだけ true になりうる） */
  slotDeleted?: boolean;
  /** 利用者が選んだ空き枠。指定していれば返る */
  slotRecordId?: string;
  /**
   * 空き枠を消せなかった理由（「〜のため」の形）。
   * 割り当て自体は成立しているので、成功メッセージの中で伝える。
   * finalize が返す warning（Dropbox 等）とは別の項目にしてある
   */
  slotDeleteWarning?: string;
};

/**
 * 成功時の文言。**どこへ書いたかを必ず伝える。**
 *
 * とくに existing は、利用者が空き枠を選んだのに枠が使われていない。
 * そのうえ案B では、選んだ空き枠が削除される。
 * 黙って成功だけ返すと「押したのにカレンダーが変わっていない」に見える。
 *
 * ■ 事前ダイアログを出さない理由（案B で削除が復活しても変えない）
 * 削除されるかは「工事登録アプリに同じ案件があるか」で決まり、**画面では
 * 事前に分からない**。「削除されるかもしれません」という同意は同意に
 * ならない。消えるのも中身の無い空き枠で、失敗しても残るだけ。
 * 押す前の説明は画面上部の固定文で行い、結果はここで伝える。
 */
export function assignedCaseSuccessMessage(
  data: AssignCustomerCaseResponse,
): string {
  const synced = data.customerInfoSynced
    ? "お客様情報の施工予定日・施工業者・Aki番号も更新しました。"
    : "";

  switch (data.assignedTo) {
    case "existing": {
      /**
       * 空き枠を選んで押したのに、書いたのは別のレコード。
       * そのうえ選んだ枠は消える。**両方とも必ず伝える。**
       * 枠を選んでいないとき（枠が無い日）は枠の話をしない
       */
      const slotLine = !data.slotRecordId
        ? ""
        : data.slotDeleted
          ? "同じ日に案件と空き枠が二重に残らないよう、選んだ空き枠は削除しました。"
          : `選んだ空き枠は削除していません（${
              data.slotDeleteWarning ?? "削除の条件を満たさなかったため"
            }）。カレンダーを確認してください。`;
      return [
        "工事登録アプリに同じ案件が既にあったため、そちらに施工予定日を設定しました。",
        "同じ案件が2件にならないよう、空き枠には書き込んでいません。",
        slotLine,
        synced,
      ]
        .filter(Boolean)
        .join("\n");
    }
    case "slot":
      return [
        "空き枠を案件に変えました。カレンダーに反映済みです。",
        "空き枠は削除していません（Aki番号はそのまま引き継いでいます）。",
        synced,
      ]
        .filter(Boolean)
        .join("\n");
    case "new":
      return [
        "工事登録アプリに新しく登録しました。カレンダーに反映済みです。",
        synced,
      ]
        .filter(Boolean)
        .join("\n");
    default:
      return ["割り当てました。カレンダーに反映済みです。", synced]
        .filter(Boolean)
        .join("\n");
  }
}
