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
  /** ピンポイント住所（@pocket） */
  pinpointAddress: string;
  /** 通常住所（見出し「住所」または都道府県+市区郡+町村+番地） */
  normalAddress: string;
};

/** 1件の工事レコードを表示月カレンダーに即時反映するための差分 */
export type CalendarRecordMonthPatch = {
  recordId: string;
  dayKeys: string[];
  byDay: Record<string, CalendarMonthApiItem[]>;
};

export type CalendarApiPayload = {
  year: number;
  month: number;
  holidayKeys: string[];
  byDay: Record<string, CalendarMonthApiItem[]>;
  /**
   * 工事対応者フィールド設定時、スタッフ名簿＋工事対応稼働でリスト取得できるか。
   * false のときは STAFF_CONSTRUCTION_AVAILABILITY_FIELD_ID 等が未設定。
   */
  emptyFillConstructionHandlerUsesStaffDirectory?: boolean;
  /** @deprecated emptyFillConstructionHandlerUsesStaffDirectory を参照してください */
  emptyFillConstructionRegistrantUsesStaffDirectory?: boolean;
  /** 429 時に古いキャッシュを返したとき */
  rateLimited?: boolean;
  calendarStale?: boolean;
  rosterMessage?: string;
};
