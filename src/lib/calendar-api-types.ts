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
  /** true のとき工事対応者は入力氏名のみ転記（一覧取得・レコード解決をしない。連携項目でも直接入力可能な環境向け） */
  emptyFillConstructionHandlerNameOnly?: boolean;
};
