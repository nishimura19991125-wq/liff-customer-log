import type { CalendarRecordMonthPatch } from "@/lib/calendar-api-types";

/**
 * 「お客様情報の案件を工事カレンダーへ載せる」割り当ての、画面側の取り決め
 * （第3段階 3-3）。
 *
 * 送信先と成功時の文言をここに置くのは、呼び出し元が2箇所あるため
 * （空き枠カード・新規登録タブ）。文言を書き分けると、片方だけ
 * 「空き枠が削除されます」のような**もう嘘になった説明**が残る。
 */

/** 3-2 で追加した割り当て API。旧経路（削除する assign-case-to-slot）ではない */
export const ASSIGN_CUSTOMER_CASE_PATH = "/api/calendar/assign-customer-case";

/**
 * サーバがどこへ書いたか。
 *   existing … T番号 の工事レコードが既にあったので、そちらへ書いた
 *              （空き枠は使わず残っている）
 *   slot     … 空き枠のレコードを案件に変えた（削除していない）
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
  slotUsed?: boolean;
  slotDeleted?: boolean;
};

/**
 * 成功時の文言。**どこへ書いたかを必ず伝える。**
 *
 * とくに existing は、利用者が空き枠を選んだのに枠が使われていない。
 * 黙って成功だけ返すと「押したのにカレンダーが変わっていない」に見える。
 */
export function assignedCaseSuccessMessage(
  data: AssignCustomerCaseResponse,
): string {
  const synced = data.customerInfoSynced
    ? "お客様情報の施工予定日・施工業者・Aki番号も更新しました。"
    : "";

  switch (data.assignedTo) {
    case "existing":
      return [
        "工事登録アプリに同じ案件が既にあったため、そちらに施工予定日を設定しました。",
        "同じ案件が2件にならないよう、空き枠は使わずに残しています。",
        synced,
      ]
        .filter(Boolean)
        .join("\n");
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
