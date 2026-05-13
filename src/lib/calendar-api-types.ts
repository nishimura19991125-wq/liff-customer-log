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
  /** 工事空枠入力で工事対応者を必須にする（CALENDAR_EMPTY_FILL_CONSTRUCTION_HANDLER_FIELD_ID 設定時） */
  emptyFillConstructionHandlerRequired?: boolean;
};
