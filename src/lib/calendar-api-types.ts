/** クライアントでも import 可能なカレンダー API の型（server-only にしない） */

export type CalendarAttachmentMeta = {
  index: number;
  name: string;
  mimeType: string;
};

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
  /** 添付画像（コミュニケーションブリッジカレンダー等） */
  attachments?: CalendarAttachmentMeta[];
  /** 工事対応者（@pocket 工事アプリ） */
  constructionHandlerName?: string;
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

/** ホーム：工事対応者として担当する本日以降の案件 */
export type ConstructionHandlerHomeCase = {
  recordId: string;
  customerName: string;
  /** 直近の工事日（YYYY-MM-DD） */
  nextDayKey: string;
  /** 表示用日付（例: 7/18） */
  nextDateLabel: string;
  /** 区分（仕込日・パネル工事日など）。なければ空 */
  segmentLabel: string;
  housingShort: string;
  contractorName: string;
  pinpointAddress: string;
  normalAddress: string;
  accessEditUrl: string;
  /** 本日以降に残っている工事日の件数（次の日を含む） */
  upcomingDayCount: number;
};

export type ConstructionHandlerHomePayload = {
  configured: boolean;
  staffName: string;
  items: ConstructionHandlerHomeCase[];
  needsStaffBind?: boolean;
  disabled?: boolean;
  error?: string;
};

/** 工事日未定の既存案件（空き枠への割り当て候補・全件） */
export type UndatedConstructionCase = {
  recordId: string;
  customerName: string;
  housingShort: string;
  contractorName: string;
  tNumber: string;
  /** ログイン者が AP または CL 担当の案件 */
  isMyApCl?: boolean;
};

export type UndatedConstructionCasesPayload = {
  configured: boolean;
  items: UndatedConstructionCase[];
  /** ログイン者のAP/CL担当の未定案件（検索欄下の候補一覧用） */
  myItems?: UndatedConstructionCase[];
  /** ログイン者のAP/CL担当名（表示用） */
  staffName?: string;
  needsStaffBind?: boolean;
  disabled?: boolean;
  error?: string;
};
