/** 工事アプリ POST /records 失敗時のユーザー向けメッセージ */
export function formatConstructionCreateRecordError(detail: string): string {
  if (detail.includes("T番号") && detail.includes("取込設定")) {
    return (
      "@pocket: 工事アプリの取込設定に「T番号」をキー項目として追加してください。" +
      "T番号は自動採番のままで、LIFF から番号を入力する必要はありません。" +
      " CALENDAR_EMPTY_FILL_TNUMBER_FIELD_ID が管理画面の「T番号」列の識別名（field-1 など）と一致しているかも確認してください。"
    );
  }
  return detail;
}
