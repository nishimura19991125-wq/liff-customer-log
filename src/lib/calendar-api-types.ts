/** クライアントでも import 可能なカレンダー API の型（server-only にしない） */

export type CalendarMonthApiItem = {
  line1: string;
  line2: string;
  memo: string;
  reportKankoComplete: boolean;
  showKankoCheck: boolean;
  postponedBadge: boolean;
  segmentShort: string;
  housingShort: string;
  category: "empty" | "list";
  contractorKey: string;
  recordId: string | null;
  accessEditUrl: string;
};

export type CalendarApiPayload = {
  year: number;
  month: number;
  holidayKeys: string[];
  byDay: Record<string, CalendarMonthApiItem[]>;
  /**
   * 工事登録者フィールド設定時、スタッフ名簿＋工事対応稼働でリスト取得できるか。
   * false のときは STAFF_CONSTRUCTION_AVAILABILITY_FIELD_ID 等が未設定。
   */
  emptyFillConstructionRegistrantUsesStaffDirectory?: boolean;
};
