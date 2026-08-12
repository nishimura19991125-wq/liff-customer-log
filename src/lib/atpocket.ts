import "server-only";

export type AtPocketRecordRow = {
  recordId?: number;
  id?: number;
  uniqueId?: string;
  record?: Record<string, unknown>;
  /** 一覧 API が返す編集画面への URL（環境により付与） */
  accessEditUrl?: string;
  updatedAt?: string;
  createdAt?: string;
};

export type AtPocketCreateRecordResult = {
  row: AtPocketRecordRow;
  /** HTTP Location（…/records/{id} 等） */
  location?: string | null;
  /** Location / Content-Location 等から抽出した recordId */
  recordIdHint?: string | null;
  /** POST 応答の生テキスト（JSON 以外・URL 埋め込み用） */
  rawBody?: string | null;
};

export type AtPocketListResponse = {
  records?: AtPocketRecordRow[];
};

export type AtPocketFieldRow = {
  uniqueId?: string;
  /** GET /fields の fieldId（管理画面の列番号と一致しない場合あり） */
  fieldId?: number;
  caption?: string;
  /** GET /api/apps/{appsId}/fields が返す項目タイプ（連携項目の判定など） */
  fieldType?: string;
  /** 連携項目のとき連携元アプリ ID（API: relation_id） */
  relationId?: number;
  /** キー項目（API: is_primary_key） */
  primaryKey?: boolean;
};

function readAtPocketFieldProp(
  row: Record<string, unknown>,
  ...keys: string[]
): unknown {
  for (const key of keys) {
    const v = row[key];
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

/** GET /fields の生オブジェクトを camelCase に正規化（field_type 等） */
export function normalizeAtPocketFieldRow(raw: unknown): AtPocketFieldRow {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const uniqueId = readAtPocketFieldProp(
    o,
    "uniqueId",
    "field_unique_id",
    "fieldUniqueId",
  );
  const caption = readAtPocketFieldProp(o, "caption");
  const fieldIdRaw = readAtPocketFieldProp(o, "fieldId", "field_id");
  const fieldType = readAtPocketFieldProp(o, "fieldType", "field_type");
  const relationRaw = readAtPocketFieldProp(o, "relationId", "relation_id");
  const primaryKeyRaw = readAtPocketFieldProp(
    o,
    "primaryKey",
    "is_primary_key",
    "isPrimaryKey",
  );
  const relationId =
    typeof relationRaw === "number"
      ? relationRaw
      : typeof relationRaw === "string" && relationRaw.trim()
        ? Number(relationRaw)
        : undefined;
  const primaryKey =
    primaryKeyRaw === true ||
    primaryKeyRaw === 1 ||
    primaryKeyRaw === "1" ||
    primaryKeyRaw === "true";
  const fieldId =
    typeof fieldIdRaw === "number" && Number.isFinite(fieldIdRaw)
      ? fieldIdRaw
      : typeof fieldIdRaw === "string" && fieldIdRaw.trim()
        ? Number(fieldIdRaw)
        : undefined;

  return {
    ...(typeof uniqueId === "string" && uniqueId.trim()
      ? { uniqueId: uniqueId.trim() }
      : {}),
    ...(fieldId != null && Number.isFinite(fieldId) ? { fieldId } : {}),
    ...(typeof caption === "string" && caption.trim()
      ? { caption: caption.trim() }
      : {}),
    ...(typeof fieldType === "string" && fieldType.trim()
      ? { fieldType: fieldType.trim() }
      : {}),
    ...(relationId != null && Number.isFinite(relationId) && relationId > 0
      ? { relationId }
      : {}),
    ...(primaryKey ? { primaryKey: true } : {}),
  };
}

function baseUrl(): string {
  const domain = process.env.ATPOCKET_DOMAIN?.trim();
  if (!domain) {
    throw new Error("ATPOCKET_DOMAIN is not set");
  }
  const normalized = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `https://${normalized}`;
}

/** 相対パスを @pocket サイトの絶対 URL に変換 */
export function atPocketAbsoluteUrl(pathOrUrl: string): string {
  const t = pathOrUrl.trim();
  if (!t) return "";
  if (/^https?:\/\//i.test(t)) return t;
  return `${baseUrl()}${t.startsWith("/") ? t : `/${t}`}`;
}

/** @pocket Web のアプリ一覧（レコード一覧）URL */
export function buildAtPocketAppRecordsPortalUrl(appsId: string): string | null {
  const id = appsId.trim();
  const domain = process.env.ATPOCKET_DOMAIN?.trim();
  if (!id || !domain) return null;
  const normalized = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `https://${normalized}/apps/${encodeURIComponent(id)}/records`;
}

function authHeaderName(): string {
  return (
    process.env.ATPOCKET_AUTH_HEADER?.trim() || "X-At-Pocket-API-Key"
  );
}

/**
 * 環境変数のうち最初に値がある API キー。
 * スタッフ名簿: ATPOCKET_API_KEY / ATPOCKET_API_KEY_1 / ATPOCKET_API_KEY_2（名簿権限のみ）
 * その他アプリ: {PREFIX}_ATPOCKET_API_KEY / _1 / _2（読取①・読取②・更新③・429分散）
 */
function firstEnvApiKey(...envNames: string[]): string | undefined {
  for (const name of envNames) {
    const v = process.env[name]?.trim();
    if (v) return v;
  }
  return undefined;
}

function apiKeyForScope(
  scopedNames: string[],
  fallback: () => string,
): string {
  return firstEnvApiKey(...scopedNames) ?? fallback();
}

function resolvePassedApiKey(auth?: AtPocketFetchAuth): string {
  const key = auth?.apiKey?.trim();
  if (!key) {
    throw new Error(
      "@pocket API 呼び出しに apiKey が未指定です。機能別の環境変数からキーを渡してください",
    );
  }
  return key;
}

/** スタッフ名簿用3キー（いずれも名簿権限のみ） */
function requireStaffApiKey(
  slot: "ATPOCKET_API_KEY" | "ATPOCKET_API_KEY_1" | "ATPOCKET_API_KEY_2",
  legacyEnvNames: string[],
): string {
  const key = firstEnvApiKey(...legacyEnvNames, slot);
  if (!key) {
    throw new Error(
      `スタッフ名簿用 ${slot} を設定してください（従来名: ${legacyEnvNames.join(" / ")}）`,
    );
  }
  return key;
}

/** 機能別3キー（読取① / 読取② / 更新③） */
function requireAppApiKey(
  prefix: string,
  slot: 0 | 1 | 2,
  legacyEnvNames: string[] = [],
): string {
  const envName =
    slot === 0
      ? `${prefix}_ATPOCKET_API_KEY`
      : `${prefix}_ATPOCKET_API_KEY_${slot}`;
  const key = firstEnvApiKey(...legacyEnvNames, envName);
  if (!key) {
    throw new Error(
      `${prefix} 用 ${envName} を設定してください${legacyEnvNames.length ? `（従来名: ${legacyEnvNames.join(" / ")}）` : ""}`,
    );
  }
  return key;
}

/** 工事カレンダー・読取①（月一覧など） */
export function apiKeyForCalendarPocket(): string {
  return requireAppApiKey("CALENDAR", 0, []);
}

/** 工事カレンダー・読取②（fields 取得など） */
export function apiKeyForCalendarPocket1(): string {
  return requireAppApiKey("CALENDAR", 1, []);
}

/** 工事カレンダー・更新③（空枠・新規登録など） */
export function apiKeyForCalendarWrite(): string {
  return requireAppApiKey("CALENDAR", 2, [
    "CALENDAR_WRITE_ATPOCKET_API_KEY",
    "CALENDAR_WRITE_ATPOCKET_API_KEY_2",
  ]);
}

/** 工事報告アプリ・読取①（一覧など） */
export function apiKeyForCalendarReportPocket(): string {
  const key = firstEnvApiKey(
    "CALENDAR_REPORT_ATPOCKET_API_KEY",
    "CALENDAR_REPORT_ATPOCKET_API_KEY_1",
    "CALENDAR_REPORT_ATPOCKET_API_KEY_2",
  );
  if (key) return key;
  return apiKeyForCalendarPocket1();
}

/** 工事報告アプリ・読取②（fields など・429 分散用） */
export function apiKeyForCalendarReportPocket1(): string {
  const key = firstEnvApiKey(
    "CALENDAR_REPORT_ATPOCKET_API_KEY_1",
    "CALENDAR_REPORT_ATPOCKET_API_KEY_2",
  );
  if (key) return key;
  return apiKeyForCalendarReportPocket();
}

/** スタッフ名簿・読取①（名簿一覧・勤務場所・PIN照会など） */
export function apiKeyForStaffPocketRead(): string {
  return requireStaffApiKey("ATPOCKET_API_KEY", [
    "STAFF_READ_ATPOCKET_API_KEY",
  ]);
}

/** スタッフ名簿・読取②（AP/CL担当者・工事対応者リストなど） */
export function apiKeyForStaffPocketRead1(): string {
  return requireStaffApiKey("ATPOCKET_API_KEY_1", [
    "STAFF_READ_ATPOCKET_API_KEY_1",
  ]);
}

/** AP/CL担当者リスト等（読取②→読取①へフォールバック） */
export function apiKeyForStaffPocketReadApClList(): string {
  const key = firstEnvApiKey(
    "ATPOCKET_API_KEY_1",
    "STAFF_READ_ATPOCKET_API_KEY_1",
    "ATPOCKET_API_KEY",
    "STAFF_READ_ATPOCKET_API_KEY",
  );
  if (key) return key;
  return requireStaffApiKey("ATPOCKET_API_KEY_1", [
    "STAFF_READ_ATPOCKET_API_KEY_1",
  ]);
}

/** AP/CL・工事対応者リスト用の読取キー（②と①を重複なく） */
export function staffPocketReadAuthsForStaffLists(): AtPocketFetchAuth[] {
  const keys: string[] = [];
  for (const k of [
    apiKeyForStaffPocketReadApClList(),
    apiKeyForStaffPocketRead(),
  ]) {
    if (!keys.includes(k)) keys.push(k);
  }
  return keys.map((apiKey) => ({ apiKey }));
}

/** スタッフ名簿・更新③（LINE紐付け・PIN設定など） */
export function apiKeyForStaffWrite(): string {
  return requireStaffApiKey("ATPOCKET_API_KEY_2", [
    "STAFF_WRITE_ATPOCKET_API_KEY",
    "STAFF_WRITE_ATPOCKET_API_KEY_1",
  ]);
}

/** お客様情報・読取①（CRM一覧・単票GETなど） */
export function apiKeyForCustomerInfoPocket(): string {
  return requireAppApiKey("CUSTOMER_INFO", 0, []);
}

/** お客様情報・読取②（検索・未入力一覧・キー照合など） */
export function apiKeyForCustomerInfoPocket1(): string {
  return requireAppApiKey("CUSTOMER_INFO", 1, []);
}

/** お客様情報・更新③（PUT・工事連携登録など） */
export function apiKeyForCustomerInfoWrite(): string {
  return requireAppApiKey("CUSTOMER_INFO", 2, []);
}

/** 取引先会社一覧・読取① */
export function apiKeyForTradingPartnerPocket(): string {
  return requireAppApiKey("TRADING_PARTNER", 0, []);
}

/** 取引先会社一覧・読取②（fields 再試行など） */
export function apiKeyForTradingPartnerPocket1(): string {
  return requireAppApiKey("TRADING_PARTNER", 1, []);
}

/** 商品一覧・読取① */
export function apiKeyForProductCatalogPocket(): string {
  return requireAppApiKey("PRODUCT_CATALOG", 0, []);
}

/** 商品一覧・読取② */
export function apiKeyForProductCatalogPocket1(): string {
  return requireAppApiKey("PRODUCT_CATALOG", 1, []);
}

/** 勤怠・読取①（当日ステータス・一覧） */
export function apiKeyForAttendancePocket(): string {
  return requireAppApiKey("ATTENDANCE", 0, []);
}

/** 勤怠・読取②（fields 等・429 分散） */
export function apiKeyForAttendancePocket1(): string {
  return requireAppApiKey("ATTENDANCE", 1, []);
}

/** 勤怠・更新③（出勤・退勤打刻） */
export function apiKeyForAttendanceWrite(): string {
  return requireAppApiKey("ATTENDANCE", 2, []);
}

/** 稼働終了報告・読取①（一覧など） */
export function apiKeyForWorkEndReportPocket(): string {
  return requireAppApiKey("WORK_END_REPORT", 0, []);
}

/** 稼働終了報告・読取②（fields など） */
export function apiKeyForWorkEndReportPocket1(): string {
  return requireAppApiKey("WORK_END_REPORT", 1, []);
}

/** 稼働終了報告・更新③（新規登録） */
export function apiKeyForWorkEndReportWrite(): string {
  return requireAppApiKey("WORK_END_REPORT", 2, []);
}

/** コミュニケーションブリッジカレンダー・読取①（fields） */
export function apiKeyForCommunicationBridgeCalendarPocket(): string {
  const key = firstEnvApiKey(
    "COMMUNICATION_BRIDGE_CALENDAR_1",
    "COMMUNICATION_BRIDGE_CALENDAR_ATPOCKET_API_KEY",
  );
  if (key) return key;
  return requireAppApiKey("COMMUNICATION_BRIDGE_CALENDAR", 0, []);
}

/** コミュニケーションブリッジカレンダー・読取② */
export function apiKeyForCommunicationBridgeCalendarPocket1(): string {
  return (
    firstEnvApiKey(
      "COMMUNICATION_BRIDGE_CALENDAR_2",
      "COMMUNICATION_BRIDGE_CALENDAR_ATPOCKET_API_KEY_1",
    ) ?? apiKeyForCommunicationBridgeCalendarPocket()
  );
}

/** コミュニケーションブリッジカレンダー・更新③ */
export function apiKeyForCommunicationBridgeCalendarWrite(): string {
  const key = firstEnvApiKey(
    "COMMUNICATION_BRIDGE_CALENDAR_3",
    "COMMUNICATION_BRIDGE_CALENDAR_ATPOCKET_API_KEY_2",
  );
  if (key) return key;
  return requireAppApiKey("COMMUNICATION_BRIDGE_CALENDAR", 2, []);
}

/** コミュニケーションブリッジカレンダー・読取フェイルオーバー（_1…_7） */
export function readAuthsForCommunicationBridgeCalendar(): AtPocketFetchAuth[] {
  const envNames: string[] = [];
  for (let i = 7; i >= 1; i--) {
    envNames.push(`COMMUNICATION_BRIDGE_CALENDAR_${i}`);
  }
  envNames.push(
    "COMMUNICATION_BRIDGE_CALENDAR_ATPOCKET_API_KEY_FIELDS",
    "COMMUNICATION_BRIDGE_CALENDAR_ATPOCKET_API_KEY_1",
    "COMMUNICATION_BRIDGE_CALENDAR_ATPOCKET_API_KEY",
  );
  const auths = collectDistinctApiKeys(envNames);
  if (auths.length > 0) return auths;
  return [{ apiKey: apiKeyForCommunicationBridgeCalendarPocket() }];
}

/** コミュニケーションブリッジカレンダー・一覧フェイルオーバー（_4…_7 → _3…_1） */
export function listAuthsForCommunicationBridgeCalendar(): AtPocketFetchAuth[] {
  const envNames: string[] = [];
  for (let i = 7; i >= 4; i--) {
    envNames.push(`COMMUNICATION_BRIDGE_CALENDAR_${i}`);
  }
  envNames.push(
    "COMMUNICATION_BRIDGE_CALENDAR_3",
    "COMMUNICATION_BRIDGE_CALENDAR_2",
    "COMMUNICATION_BRIDGE_CALENDAR_1",
    "COMMUNICATION_BRIDGE_CALENDAR_ATPOCKET_API_KEY_2",
    "COMMUNICATION_BRIDGE_CALENDAR_ATPOCKET_API_KEY_1",
    "COMMUNICATION_BRIDGE_CALENDAR_ATPOCKET_API_KEY",
  );
  const auths = collectDistinctApiKeys(envNames);
  if (auths.length > 0) return auths;
  return [{ apiKey: apiKeyForCommunicationBridgeCalendarPocket1() }];
}

/** ログアプリ・更新③ */
export function apiKeyForLogPocketWrite(): string {
  return requireAppApiKey("LOG", 2, ["LOG_ATPOCKET_API_KEY"]);
}

/** PT集計表・読取①（fields） */
export function apiKeyForSalesDashboardPtPocket(): string {
  return apiKeyForAppFields("SALES_DASHBOARD_PT");
}

/** PT集計表・読取②（list・後方互換） */
export function apiKeyForSalesDashboardPtPocket1(): string {
  const auths = listAuthsForAppList("SALES_DASHBOARD_PT");
  return auths[0]?.apiKey ?? requireAppApiKey("SALES_DASHBOARD_PT", 1, []);
}

/** アポ取得情報・読取①（fields） */
export function apiKeyForSalesDashboardApoPocket(): string {
  return apiKeyForAppFields("SALES_DASHBOARD_APO");
}

/** アポ取得情報・読取②（list・後方互換） */
export function apiKeyForSalesDashboardApoPocket1(): string {
  const auths = listAuthsForAppList("SALES_DASHBOARD_APO");
  return auths[0]?.apiKey ?? requireAppApiKey("SALES_DASHBOARD_APO", 1, []);
}

/** PT集計表・読取③（list ローテ用サブキー・未設定時は LIST_2 → 読取②） */
export function apiKeyForSalesDashboardPtPocket2(): string {
  return (
    firstEnvApiKey(
      "SALES_DASHBOARD_PT_ATPOCKET_API_KEY_LIST_2",
      "SALES_DASHBOARD_PT_ATPOCKET_API_KEY_2",
    ) ?? apiKeyForSalesDashboardPtPocket1()
  );
}

/** アポ取得情報・読取③（list ローテ用サブキー・未設定時は LIST_2 → 読取②） */
export function apiKeyForSalesDashboardApoPocket2(): string {
  return (
    firstEnvApiKey(
      "SALES_DASHBOARD_APO_ATPOCKET_API_KEY_LIST_2",
      "SALES_DASHBOARD_APO_ATPOCKET_API_KEY_2",
    ) ?? apiKeyForSalesDashboardApoPocket1()
  );
}

/** アポ取得情報・更新③（見積ステータス更新など） */
export function apiKeyForSalesDashboardApoWrite(): string {
  return requireAppApiKey("SALES_DASHBOARD_APO", 2, []);
}

export function salesDashboardApoWriteConfigured(): boolean {
  return Boolean(process.env.SALES_DASHBOARD_APO_ATPOCKET_API_KEY_2?.trim());
}

/** 一覧サブキー最大数（LIST_1 … LIST_N。429 分散用に既存3 + 追加10 = 13） */
export const POCKET_LIST_SUB_KEY_MAX = 13;

function listEnvNamesForApp(prefix: string): string[] {
  const names: string[] = [];
  for (let i = POCKET_LIST_SUB_KEY_MAX; i >= 1; i--) {
    names.push(`${prefix}_ATPOCKET_API_KEY_LIST_${i}`);
  }
  names.push(`${prefix}_ATPOCKET_API_KEY_LIST`);
  return names;
}

function collectDistinctApiKeys(envNames: string[]): AtPocketFetchAuth[] {
  const keys: string[] = [];
  for (const envName of envNames) {
    const k = process.env[envName]?.trim();
    if (k && !keys.includes(k)) keys.push(k);
  }
  return keys.map((apiKey) => ({ apiKey }));
}

/** 読取フェイルオーバー用（LIST サブキー → FIELDS → 読取②①。更新③は含めない） */
export function readAuthsForApp(
  prefix: string,
  extraEnvNames: string[] = [],
): AtPocketFetchAuth[] {
  const auths = collectDistinctApiKeys([
    ...extraEnvNames,
    ...listEnvNamesForApp(prefix),
    `${prefix}_ATPOCKET_API_KEY_FIELDS`,
    `${prefix}_ATPOCKET_API_KEY_1`,
    `${prefix}_ATPOCKET_API_KEY`,
  ]);
  if (auths.length > 0) return auths;
  return [{ apiKey: requireAppApiKey(prefix, 0, []) }];
}

/**
 * スタッフ名簿・読取サブキー（429 時に順次切替）。
 * 既存 ATPOCKET_API_KEY / _1 に加え _3 … _12（10本）を設定可能。_2 は更新用のため含めない。
 */
export function staffReadListAuths(): AtPocketFetchAuth[] {
  const subs: string[] = [
    "ATPOCKET_API_KEY",
    "ATPOCKET_API_KEY_1",
    "STAFF_READ_ATPOCKET_API_KEY_1",
    "STAFF_READ_ATPOCKET_API_KEY",
  ];
  for (let i = 3; i <= 12; i++) {
    subs.push(`ATPOCKET_API_KEY_${i}`);
  }
  return collectDistinctApiKeys(subs);
}

/** fields 用サブキー（未設定時は読取①） */
export function apiKeyForAppFields(
  prefix: string,
  extraEnvNames: string[] = [],
): string {
  const key = firstEnvApiKey(
    ...extraEnvNames,
    `${prefix}_ATPOCKET_API_KEY_FIELDS`,
    `${prefix}_ATPOCKET_API_KEY`,
  );
  if (key) return key;
  return requireAppApiKey(prefix, 0, []);
}

/** 一覧ページング用サブキー（LIST_1…13・429 時は次キーへフェイルオーバー） */
export function listAuthsForAppList(
  prefix: string,
  extraEnvNames: string[] = [],
): AtPocketFetchAuth[] {
  const auths = collectDistinctApiKeys([
    ...extraEnvNames,
    ...listEnvNamesForApp(prefix),
    `${prefix}_ATPOCKET_API_KEY_2`,
    `${prefix}_ATPOCKET_API_KEY_1`,
    `${prefix}_ATPOCKET_API_KEY`,
  ]);
  if (auths.length > 0) return auths;
  return [{ apiKey: requireAppApiKey(prefix, 1, []) }];
}

/** @deprecated listAuthsForAppList を使用 */
export function listAuthsForAppPrefix(prefix: string): AtPocketFetchAuth[] {
  return listAuthsForAppList(prefix);
}

export type AtPocketFetchAuth = {
  apiKey?: string;
};

/** ログ・障害調査用（どの環境変数のキーか） */
export type AtPocketRequestContext = {
  operation: string;
  appEnv?: string;
};

function dynamicApiKeyEnvCandidates(): Array<[string, string | undefined]> {
  const out: Array<[string, string | undefined]> = [];
  const prefixes = [
    "SALES_DASHBOARD_PT",
    "SALES_DASHBOARD_APO",
    "CUSTOMER_INFO",
    "CALENDAR",
    "CALENDAR_REPORT",
    "ATTENDANCE",
    "WORK_END_REPORT",
    "TRADING_PARTNER",
    "PRODUCT_CATALOG",
  ];
  for (const p of prefixes) {
    for (let i = POCKET_LIST_SUB_KEY_MAX; i >= 4; i--) {
      const name = `${p}_ATPOCKET_API_KEY_LIST_${i}`;
      out.push([name, process.env[name]?.trim()]);
    }
  }
  for (let i = POCKET_LIST_SUB_KEY_MAX; i >= 4; i--) {
    const name = `CUSTOMER_INFO_ATPOCKET_API_KEY_DASHBOARD_LIST_${i}`;
    out.push([name, process.env[name]?.trim()]);
  }
  for (let i = 12; i >= 3; i--) {
    const name = `ATPOCKET_API_KEY_${i}`;
    out.push([name, process.env[name]?.trim()]);
  }
  return out;
}

function authKeyEnvLabel(auth?: AtPocketFetchAuth): string {
  const key = auth?.apiKey?.trim();
  if (!key) return "unset";
  const candidates: Array<[string, string | undefined]> = [
    ...dynamicApiKeyEnvCandidates(),
    [
      "SALES_DASHBOARD_PT_ATPOCKET_API_KEY_LIST_3",
      process.env.SALES_DASHBOARD_PT_ATPOCKET_API_KEY_LIST_3?.trim(),
    ],
    [
      "SALES_DASHBOARD_PT_ATPOCKET_API_KEY_LIST_2",
      process.env.SALES_DASHBOARD_PT_ATPOCKET_API_KEY_LIST_2?.trim(),
    ],
    [
      "SALES_DASHBOARD_PT_ATPOCKET_API_KEY_LIST_1",
      process.env.SALES_DASHBOARD_PT_ATPOCKET_API_KEY_LIST_1?.trim(),
    ],
    [
      "SALES_DASHBOARD_PT_ATPOCKET_API_KEY_FIELDS",
      process.env.SALES_DASHBOARD_PT_ATPOCKET_API_KEY_FIELDS?.trim(),
    ],
    [
      "SALES_DASHBOARD_APO_ATPOCKET_API_KEY_LIST_3",
      process.env.SALES_DASHBOARD_APO_ATPOCKET_API_KEY_LIST_3?.trim(),
    ],
    [
      "SALES_DASHBOARD_APO_ATPOCKET_API_KEY_LIST_2",
      process.env.SALES_DASHBOARD_APO_ATPOCKET_API_KEY_LIST_2?.trim(),
    ],
    [
      "SALES_DASHBOARD_APO_ATPOCKET_API_KEY_LIST_1",
      process.env.SALES_DASHBOARD_APO_ATPOCKET_API_KEY_LIST_1?.trim(),
    ],
    [
      "SALES_DASHBOARD_APO_ATPOCKET_API_KEY_FIELDS",
      process.env.SALES_DASHBOARD_APO_ATPOCKET_API_KEY_FIELDS?.trim(),
    ],
    [
      "CUSTOMER_INFO_ATPOCKET_API_KEY_DASHBOARD_LIST_3",
      process.env.CUSTOMER_INFO_ATPOCKET_API_KEY_DASHBOARD_LIST_3?.trim(),
    ],
    [
      "CUSTOMER_INFO_ATPOCKET_API_KEY_DASHBOARD_LIST_2",
      process.env.CUSTOMER_INFO_ATPOCKET_API_KEY_DASHBOARD_LIST_2?.trim(),
    ],
    [
      "CUSTOMER_INFO_ATPOCKET_API_KEY_DASHBOARD_LIST_1",
      process.env.CUSTOMER_INFO_ATPOCKET_API_KEY_DASHBOARD_LIST_1?.trim(),
    ],
    [
      "CUSTOMER_INFO_ATPOCKET_API_KEY_DASHBOARD_FIELDS",
      process.env.CUSTOMER_INFO_ATPOCKET_API_KEY_DASHBOARD_FIELDS?.trim(),
    ],
    [
      "SALES_DASHBOARD_PT_ATPOCKET_API_KEY_2",
      process.env.SALES_DASHBOARD_PT_ATPOCKET_API_KEY_2?.trim(),
    ],
    [
      "SALES_DASHBOARD_PT_ATPOCKET_API_KEY_1",
      process.env.SALES_DASHBOARD_PT_ATPOCKET_API_KEY_1?.trim(),
    ],
    [
      "SALES_DASHBOARD_PT_ATPOCKET_API_KEY",
      process.env.SALES_DASHBOARD_PT_ATPOCKET_API_KEY?.trim(),
    ],
    [
      "SALES_DASHBOARD_APO_ATPOCKET_API_KEY_2",
      process.env.SALES_DASHBOARD_APO_ATPOCKET_API_KEY_2?.trim(),
    ],
    [
      "SALES_DASHBOARD_APO_ATPOCKET_API_KEY_1",
      process.env.SALES_DASHBOARD_APO_ATPOCKET_API_KEY_1?.trim(),
    ],
    [
      "SALES_DASHBOARD_APO_ATPOCKET_API_KEY",
      process.env.SALES_DASHBOARD_APO_ATPOCKET_API_KEY?.trim(),
    ],
    [
      "CUSTOMER_INFO_ATPOCKET_API_KEY_2",
      process.env.CUSTOMER_INFO_ATPOCKET_API_KEY_2?.trim(),
    ],
    [
      "CUSTOMER_INFO_ATPOCKET_API_KEY_1",
      process.env.CUSTOMER_INFO_ATPOCKET_API_KEY_1?.trim(),
    ],
    ["CUSTOMER_INFO_ATPOCKET_API_KEY", process.env.CUSTOMER_INFO_ATPOCKET_API_KEY?.trim()],
    [
      "STAFF_READ_ATPOCKET_API_KEY_1",
      process.env.STAFF_READ_ATPOCKET_API_KEY_1?.trim(),
    ],
    ["STAFF_READ_ATPOCKET_API_KEY", process.env.STAFF_READ_ATPOCKET_API_KEY?.trim()],
    [
      "STAFF_WRITE_ATPOCKET_API_KEY_1",
      process.env.STAFF_WRITE_ATPOCKET_API_KEY_1?.trim(),
    ],
    ["STAFF_WRITE_ATPOCKET_API_KEY", process.env.STAFF_WRITE_ATPOCKET_API_KEY?.trim()],
    [
      "CALENDAR_ATPOCKET_API_KEY_2",
      process.env.CALENDAR_ATPOCKET_API_KEY_2?.trim(),
    ],
    ["CALENDAR_ATPOCKET_API_KEY", process.env.CALENDAR_ATPOCKET_API_KEY?.trim()],
    [
      "CALENDAR_WRITE_ATPOCKET_API_KEY_2",
      process.env.CALENDAR_WRITE_ATPOCKET_API_KEY_2?.trim(),
    ],
    ["CALENDAR_WRITE_ATPOCKET_API_KEY", process.env.CALENDAR_WRITE_ATPOCKET_API_KEY?.trim()],
    [
      "CALENDAR_REPORT_ATPOCKET_API_KEY_2",
      process.env.CALENDAR_REPORT_ATPOCKET_API_KEY_2?.trim(),
    ],
    [
      "CALENDAR_REPORT_ATPOCKET_API_KEY",
      process.env.CALENDAR_REPORT_ATPOCKET_API_KEY?.trim(),
    ],
    [
      "TRADING_PARTNER_ATPOCKET_API_KEY_2",
      process.env.TRADING_PARTNER_ATPOCKET_API_KEY_2?.trim(),
    ],
    [
      "TRADING_PARTNER_ATPOCKET_API_KEY",
      process.env.TRADING_PARTNER_ATPOCKET_API_KEY?.trim(),
    ],
    [
      "PRODUCT_CATALOG_ATPOCKET_API_KEY_2",
      process.env.PRODUCT_CATALOG_ATPOCKET_API_KEY_2?.trim(),
    ],
    [
      "PRODUCT_CATALOG_ATPOCKET_API_KEY",
      process.env.PRODUCT_CATALOG_ATPOCKET_API_KEY?.trim(),
    ],
    ["LOG_ATPOCKET_API_KEY_2", process.env.LOG_ATPOCKET_API_KEY_2?.trim()],
    ["LOG_ATPOCKET_API_KEY", process.env.LOG_ATPOCKET_API_KEY?.trim()],
  ];
  for (const [name, envVal] of candidates) {
    if (envVal && key === envVal) return name;
  }
  return "custom(apiKey)";
}

function formatPocketHttpError(
  kind: string,
  status: number,
  text: string,
  appsId: string,
  auth?: AtPocketFetchAuth,
  ctx?: AtPocketRequestContext,
): string {
  const segments = [
    `@pocket ${kind} failed: ${status} ${text}`,
    `operation=${ctx?.operation ?? "unknown"}`,
    `appsId=${appsId}`,
    ctx?.appEnv ? `appsEnv=${ctx.appEnv}` : "",
    `apiKey=${authKeyEnvLabel(auth)}`,
  ].filter(Boolean);
  if (status === 401) {
    segments.push(
      "hint=この apiKey に上記 appsId の参照権限があるか @pocket 管理画面で確認",
    );
  } else if (status === 429) {
    segments.push("hint=100秒あたりのAPI上限。間隔を空けて再試行");
  }
  return segments.join(" | ");
}

/** ログアプリ・工事カレンダーアプリへのレコード登録用キー */
function apiKeyForCreateRecord(appsId: string): string {
  const logAppId = process.env.LOG_APP_ID?.trim();
  const logKey = firstEnvApiKey(
    "LOG_ATPOCKET_API_KEY_2",
    "LOG_ATPOCKET_API_KEY",
  );
  if (logAppId && appsId === logAppId && logKey) {
    return logKey;
  }
  const calAppId = process.env.CALENDAR_APP_ID?.trim();
  if (calAppId && appsId === calAppId) {
    return apiKeyForCalendarWrite();
  }
  const customerInfoAppId = process.env.CUSTOMER_INFO_APP_ID?.trim();
  if (customerInfoAppId && appsId === customerInfoAppId) {
    return apiKeyForCustomerInfoWrite();
  }
  const bridgeCalAppId = process.env.COMMUNICATION_BRIDGE_CALENDAR_APP_ID?.trim();
  if (bridgeCalAppId && appsId === bridgeCalAppId) {
    return apiKeyForCommunicationBridgeCalendarWrite();
  }
  const workEndAppId = process.env.WORK_END_REPORT_APP_ID?.trim();
  if (workEndAppId && appsId === workEndAppId) {
    return apiKeyForWorkEndReportWrite();
  }
  throw new Error(
    `@pocket レコード登録用の API キーが未設定です（appsId=${appsId}）。該当アプリ用の *_ATPOCKET_API_KEY を設定してください`,
  );
}

async function fetchWithMethodOverride(
  pathWithQuery: string,
  auth?: AtPocketFetchAuth,
): Promise<Response> {
  const url = `${baseUrl()}${pathWithQuery}`;
  const key = resolvePassedApiKey(auth);
  return fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      [authHeaderName()]: key,
      "X-HTTP-Method-Override": "GET",
    },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(headers: Headers): number | null {
  const ra = headers.get("retry-after");
  if (ra) {
    const sec = Number(ra);
    if (Number.isFinite(sec) && sec >= 0) {
      return Math.min(sec * 1000, 60_000);
    }
    const when = Date.parse(ra);
    if (!Number.isNaN(when)) {
      return Math.max(0, Math.min(when - Date.now(), 60_000));
    }
  }
  return null;
}

const POCKET_GET_RETRY_MAX = 5;
const POCKET_GET_RETRY_BASE_MS = 450;

/** @pocket の 100 秒ウィンドウ（同一 API キーでアプリ横断） */
const POCKET_RATE_LIMIT_WINDOW_MS = 100_000;
const pocketRateLimitedUntil = new Map<string, number>();

function pocketRateLimitKey(auth?: AtPocketFetchAuth): string {
  return resolvePassedApiKey(auth);
}

/** 直近の 429 を記録（工事カレンダー等の連打後にスタッフ名簿が巻き添えにならないよう） */
export function markPocketApiRateLimited(auth?: AtPocketFetchAuth): void {
  pocketRateLimitedUntil.set(
    pocketRateLimitKey(auth),
    Date.now() + POCKET_RATE_LIMIT_WINDOW_MS,
  );
}

export function isPocketApiRateLimited(auth?: AtPocketFetchAuth): boolean {
  return Date.now() < (pocketRateLimitedUntil.get(pocketRateLimitKey(auth)) ?? 0);
}

export function pocketApiRateLimitRemainingMs(
  auth?: AtPocketFetchAuth,
): number {
  const until = pocketRateLimitedUntil.get(pocketRateLimitKey(auth)) ?? 0;
  return Math.max(0, until - Date.now());
}

export function isPocketHttpRateLimitError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes("429") || msg.includes("Too Many Request");
}

export type PocketListFetchOptions = {
  /** 429 時の最大再試行回数（既定 5）。サブキー2本以上のときは同一キー再試行せず次キーへ */
  maxRetries?: number;
  /** 429 時に順次切り替える読取サブキー（2本以上でフェイルオーバー） */
  authKeys?: AtPocketFetchAuth[];
  /** authKeys のローテ開始インデックス（ページ番号連動用） */
  authStartIndex?: number;
};

function rotateAuthsFromStart(
  auths: AtPocketFetchAuth[],
  startIndex: number,
): AtPocketFetchAuth[] {
  const filtered = auths.filter((a) => a.apiKey?.trim());
  if (filtered.length <= 1) return filtered;
  const s =
    ((startIndex % filtered.length) + filtered.length) % filtered.length;
  return [...filtered.slice(s), ...filtered.slice(0, s)];
}

function syntheticPocket429Response(retrySec: number): Response {
  return new Response(
    JSON.stringify({
      errors: {
        code: 429,
        message: "Too Many Request",
        details: [{ message: "Request exhausted per 100 second" }],
      },
    }),
    {
      status: 429,
      headers: { "Retry-After": String(retrySec) },
    },
  );
}

/** サブキーを順に試し、429 なら次のキーへ（同一キーではリトライしない） */
async function fetchWithMethodOverrideFailover(
  pathWithQuery: string,
  auths: AtPocketFetchAuth[],
  startIndex: number,
): Promise<Response> {
  const ordered = rotateAuthsFromStart(auths, startIndex);
  let last429: Response | undefined;

  for (const auth of ordered) {
    if (isPocketApiRateLimited(auth)) continue;

    const res = await fetchWithMethodOverride(pathWithQuery, auth);
    if (res.status === 429) {
      markPocketApiRateLimited(auth);
      await res.text();
      last429 = res;
      continue;
    }
    return res;
  }

  if (last429) return last429;

  const retrySec = Math.max(
    1,
    Math.ceil(POCKET_RATE_LIMIT_WINDOW_MS / 1000),
  );
  return syntheticPocket429Response(retrySec);
}

/** 429 のとき指数バックオフで再試行（429 応答は本文を読み捨て済みであること） */
async function fetchWithMethodOverrideWithRetry(
  pathWithQuery: string,
  auth?: AtPocketFetchAuth,
  options?: PocketListFetchOptions,
): Promise<Response> {
  const failoverKeys =
    options?.authKeys?.filter((a) => a.apiKey?.trim()) ?? [];
  if (failoverKeys.length >= 2) {
    return fetchWithMethodOverrideFailover(
      pathWithQuery,
      failoverKeys,
      options?.authStartIndex ?? 0,
    );
  }

  const maxAttempts = Math.max(
    1,
    Math.min(POCKET_GET_RETRY_MAX, options?.maxRetries ?? POCKET_GET_RETRY_MAX),
  );
  if (isPocketApiRateLimited(auth)) {
    const retrySec = Math.max(
      1,
      Math.ceil(pocketApiRateLimitRemainingMs(auth) / 1000),
    );
    return syntheticPocket429Response(retrySec);
  }

  let last: Response | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetchWithMethodOverride(pathWithQuery, auth);
    last = res;
    if (res.status === 429) {
      markPocketApiRateLimited(auth);
    }
    if (res.status !== 429) return res;
    if (attempt === maxAttempts - 1) return res;
    await res.text();
    const wait =
      parseRetryAfterMs(res.headers) ??
      Math.min(14_000, POCKET_GET_RETRY_BASE_MS * 2 ** attempt);
    await sleep(wait + Math.floor(Math.random() * 220));
  }
  return last as Response;
}

/** @pocket docs: auth key header is tied to POST; use override for GET semantics */
export async function fetchRecordsList(
  appsId: string,
  searchParams?: {
    limit?: string;
    page?: string;
    fields?: string;
    query?: string;
  },
  auth?: AtPocketFetchAuth,
  ctx?: AtPocketRequestContext,
  options?: PocketListFetchOptions,
): Promise<AtPocketListResponse> {
  const params = new URLSearchParams();
  params.set("limit", searchParams?.limit ?? "1000");
  if (searchParams?.page) params.set("page", searchParams.page);
  if (searchParams?.fields) params.set("fields", searchParams.fields);
  if (searchParams?.query) params.set("query", searchParams.query);
  const qs = params.toString();
  const path = `/api/apps/${appsId}/records${qs ? `?${qs}` : ""}`;

  const res = await fetchWithMethodOverrideWithRetry(path, auth, options);

  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      formatPocketHttpError(
        "list records",
        res.status,
        text,
        appsId,
        auth,
        ctx,
      ),
    );
  }
  return text ? (JSON.parse(text) as AtPocketListResponse) : { records: [] };
}

/**
 * アプリのフィールド定義一覧 GET /api/apps/{appsId}/fields のキャッシュ TTL。
 *
 * @pocket の利用制限は **サイト単位で100秒あたり100回**（API キー単位ではない）。
 * キーを増やしても分散できないため、呼び出しの総量を減らすしかない。
 * 列定義は全アプリ・全画面の入口で呼ばれるうえ滅多に変わらないので、
 * 既定を30分にしている。
 *
 * ⚠ **@pocket 側で列を追加・変更しても、最大30分は反映されない。**
 *   列を触った直後に画面へ出したいときは、
 *   ATPOCKET_APP_FIELDS_CACHE_SECONDS を一時的に短くするか、
 *   invalidateAppFieldsCache(appsId) を呼ぶこと。
 */
const APP_FIELDS_DEFAULT_TTL_SECONDS = 30 * 60;

function appFieldsTtlMs(): number {
  const raw = process.env.ATPOCKET_APP_FIELDS_CACHE_SECONDS?.trim();
  const sec = raw ? Number(raw) : APP_FIELDS_DEFAULT_TTL_SECONDS;
  if (!Number.isFinite(sec)) return APP_FIELDS_DEFAULT_TTL_SECONDS * 1000;
  // 0 を許すと毎回取りに行って上限に当たるので下限を設ける
  return Math.min(6 * 60 * 60, Math.max(60, sec)) * 1000;
}
/** 429 時は期限切れでも返す猶予 */
const APP_FIELDS_STALE_SERVE_MS = 6 * 60 * 60 * 1000;
type FieldsCacheEntry = {
  expiresAt: number;
  staleUntil: number;
  fields: AtPocketFieldRow[];
};
const appFieldsStore = new Map<string, FieldsCacheEntry>();
const appFieldsInflight = new Map<string, Promise<AtPocketFieldRow[]>>();

async function fetchAppFieldsOnce(
  appsId: string,
  auth?: AtPocketFetchAuth,
  ctx?: AtPocketRequestContext,
  options?: PocketListFetchOptions,
): Promise<AtPocketFieldRow[]> {
  const params = new URLSearchParams();
  params.set("limit", "1000");
  params.set("page", "1");
  const path = `/api/apps/${appsId}/fields?${params.toString()}`;
  const res = await fetchWithMethodOverrideWithRetry(path, auth, options);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      formatPocketHttpError("list fields", res.status, text, appsId, auth, ctx),
    );
  }
  if (!text) return [];
  const json = JSON.parse(text) as { fields?: unknown[] };
  return (json.fields ?? []).map(normalizeAtPocketFieldRow);
}

/** 列定義キャッシュを破棄（@pocket で列追加直後の PUT 向け） */
export function invalidateAppFieldsCache(appsId: string): void {
  const key = appsId.trim();
  appFieldsStore.delete(key);
  appFieldsInflight.delete(key);
}

export async function fetchAppFields(
  appsId: string,
  auth?: AtPocketFetchAuth,
  ctx?: AtPocketRequestContext,
  options?: PocketListFetchOptions,
): Promise<AtPocketFieldRow[]> {
  const key = appsId.trim();
  const now = Date.now();
  const hit = appFieldsStore.get(key);
  if (hit && hit.expiresAt > now) return hit.fields;

  if (
    hit &&
    hit.staleUntil > now &&
    (isPocketApiRateLimited(auth) ||
      options?.authKeys?.some((a) => isPocketApiRateLimited(a)))
  ) {
    return hit.fields;
  }

  const pending = appFieldsInflight.get(key);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const fields = await fetchAppFieldsOnce(appsId, auth, ctx, options);
      const ttl = appFieldsTtlMs();
      appFieldsStore.set(key, {
        expiresAt: Date.now() + ttl,
        staleUntil: Date.now() + ttl + APP_FIELDS_STALE_SERVE_MS,
        fields,
      });
      return fields;
    } catch (e) {
      if (
        hit &&
        hit.staleUntil > Date.now() &&
        isPocketHttpRateLimitError(e)
      ) {
        console.warn(
          "[atpocket] serving stale app fields after 429",
          key,
          ctx?.operation ?? "",
        );
        return hit.fields;
      }
      throw e;
    } finally {
      appFieldsInflight.delete(key);
    }
  })();

  appFieldsInflight.set(key, promise);
  return promise;
}

/** アプリのフィールド定義にある uniqueId のみ残す。GET の record に混ざる無効キーで PUT が 400 になるのを防ぐ */
export function pickRecordFieldsForSchema(
  record: Record<string, unknown>,
  schemaUniqueIds: Set<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (schemaUniqueIds.has(k)) out[k] = v;
  }
  return out;
}

/**
 * GET の record に混ざる `field-123` 形式は、環境によっては PUT で拒否される。
 * ただし @pocket 管理画面のフィールド識別名そのものが `field-1` などである場合があり、そのキーは削除しない。
 */
export function stripLikelyInvalidPocketKeysFromRecord(
  record: Record<string, unknown>,
  preserveHyphenNumericFieldKeys?: Set<string>,
): Record<string, unknown> {
  const preserve = preserveHyphenNumericFieldKeys ?? new Set<string>();
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (/^field-\d+$/i.test(k)) {
      if (preserve.has(k)) out[k] = v;
      continue;
    }
    out[k] = v;
  }
  return out;
}

/** 複数 API キーを順に試し、フィールド定義一覧を返す。すべて失敗なら null（403 対策） */
export async function fetchAppFieldsTryKeys(
  appsId: string,
  apiKeysInOrder: string[],
): Promise<AtPocketFieldRow[] | null> {
  const dedup = new Set<string>();
  const keys = apiKeysInOrder
    .map((k) => k?.trim())
    .filter((k): k is string => Boolean(k))
    .filter((k) => {
      if (dedup.has(k)) return false;
      dedup.add(k);
      return true;
    });

  for (const apiKey of keys) {
    try {
      return await fetchAppFields(appsId, { apiKey });
    } catch {
      /* 次のキー */
    }
  }
  return null;
}

type AtPocketFormRow = {
  id?: number | string;
  name?: string;
};

/** アプリ名で appsId を検索 GET /api/apps/forms */
export async function fetchAppIdByName(
  appName: string,
  auth?: AtPocketFetchAuth,
): Promise<string | null> {
  const name = appName.trim();
  if (!name) return null;
  const params = new URLSearchParams({
    name,
    page: "1",
    limit: "1000",
  });
  const res = await fetchWithMethodOverrideWithRetry(
    `/api/apps/forms?${params.toString()}`,
    auth,
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      formatPocketHttpError("list forms", res.status, text, name, auth, {
        operation: "list forms by name",
      }),
    );
  }
  if (!text) return null;
  const json = JSON.parse(text) as { forms?: AtPocketFormRow[] };
  const forms = json.forms ?? [];
  const hit = forms.find((f) => f.name === name) ?? forms[0];
  if (hit?.id == null || String(hit.id).trim() === "") return null;
  return String(hit.id).trim();
}

/** 複数 API キーを順に試し、アプリ名から appsId を返す */
export async function fetchAppIdByNameTryKeys(
  appName: string,
  apiKeysInOrder: string[],
): Promise<string | null> {
  const dedup = new Set<string>();
  const keys = apiKeysInOrder
    .map((k) => k?.trim())
    .filter((k): k is string => Boolean(k))
    .filter((k) => {
      if (dedup.has(k)) return false;
      dedup.add(k);
      return true;
    });

  for (const apiKey of keys) {
    try {
      const id = await fetchAppIdByName(appName, { apiKey });
      if (id) return id;
    } catch {
      /* 次のキー */
    }
  }
  return null;
}

/** 複数 API キーを順に試し、フィールド一覧が取れたら uniqueId の集合を返す。すべて失敗なら null */
export async function fetchAppFieldUniqueIdsSetTryKeys(
  appsId: string,
  apiKeysInOrder: string[],
): Promise<Set<string> | null> {
  const defs = await fetchAppFieldsTryKeys(appsId, apiKeysInOrder);
  if (!defs) return null;
  return new Set(
    defs
      .map((f) => f.uniqueId?.trim())
      .filter((u): u is string => Boolean(u)),
  );
}

const CALENDAR_PAGE_LIMIT = 1000;
const CALENDAR_MAX_PAGES = 200;

export type FetchAllRecordsPagesOptions = PocketListFetchOptions & {
  /** 最大ページ数（未指定時は CALENDAR_MAX_PAGES） */
  maxPages?: number;
  /** ページごとにキーをローテーション（429 分散） */
  authKeys?: AtPocketFetchAuth[];
};

/** @pocket 一覧をページングで全件取得（工事カレンダーなど） */
export async function fetchAllRecordsPages(
  appsId: string,
  fieldsCsv: string,
  auth?: AtPocketFetchAuth,
  pocketQuery?: string | null,
  ctx?: AtPocketRequestContext,
  options?: FetchAllRecordsPagesOptions,
): Promise<AtPocketRecordRow[]> {
  const pageCap = Math.max(
    1,
    Math.min(
      CALENDAR_MAX_PAGES,
      options?.maxPages ?? CALENDAR_MAX_PAGES,
    ),
  );
  const listOptions: PocketListFetchOptions = {
    maxRetries: options?.maxRetries,
  };
  const authKeys =
    options?.authKeys?.filter((a) => a.apiKey?.trim()) ?? [];
  const all: AtPocketRecordRow[] = [];
  for (let page = 1; page <= pageCap; page++) {
    const pageStart =
      authKeys.length > 0 ? (page - 1) % authKeys.length : 0;
    const pageAuth =
      authKeys.length > 0 ? authKeys[pageStart] : auth;
    const data = await fetchRecordsList(
      appsId,
      {
        limit: String(CALENDAR_PAGE_LIMIT),
        page: String(page),
        fields: fieldsCsv,
        ...(pocketQuery?.trim() ? { query: pocketQuery.trim() } : {}),
      },
      pageAuth,
      ctx,
      {
        ...listOptions,
        authKeys: authKeys.length >= 2 ? authKeys : undefined,
        authStartIndex: authKeys.length >= 2 ? pageStart : undefined,
      },
    );
    const recs = data.records ?? [];
    all.push(...recs);
    if (recs.length < CALENDAR_PAGE_LIMIT) break;
  }
  return all;
}

/** 単一レコード GET /api/apps/{appsId}/records/{recordId}（fields は一覧APIと同様の CSV・任意） */
export async function fetchRecordById(
  appsId: string,
  recordId: string,
  auth?: AtPocketFetchAuth,
  fieldsCsv?: string,
  options?: PocketListFetchOptions,
): Promise<AtPocketRecordRow | null> {
  let path = `/api/apps/${appsId}/records/${encodeURIComponent(recordId)}`;
  const csv = fieldsCsv?.trim();
  if (csv) {
    path += `?fields=${encodeURIComponent(csv)}`;
  }
  const res = await fetchWithMethodOverrideWithRetry(path, auth, options);
  const text = await res.text();
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`@pocket get record failed: ${res.status} ${text}`);
  }
  if (!text) return null;
  return JSON.parse(text) as AtPocketRecordRow;
}

function recordIdFromHttpLocationHeader(value: string | null): string | null {
  const s = value?.trim();
  if (!s) return null;
  const m =
    s.match(/\/records\/(\d+)(?:\/|$|[?#])/i) ||
    s.match(/\/record\/(\d+)(?:\/|$|[?#])/i);
  return m?.[1]?.trim() || null;
}

export async function createRecord(
  appsId: string,
  record: Record<string, unknown>,
  auth?: AtPocketFetchAuth,
): Promise<AtPocketCreateRecordResult> {
  const url = `${baseUrl()}/api/apps/${appsId}/records`;
  const key = auth?.apiKey ?? apiKeyForCreateRecord(appsId);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      [authHeaderName()]: key,
    },
    body: JSON.stringify({ record }),
  });

  const text = await res.text();
  const location = res.headers.get("location") ?? res.headers.get("Location");
  const contentLocation =
    res.headers.get("content-location") ??
    res.headers.get("Content-Location");
  const recordIdHint =
    recordIdFromHttpLocationHeader(location) ??
    recordIdFromHttpLocationHeader(contentLocation);
  if (!res.ok) {
    throw new Error(`@pocket create record failed: ${res.status} ${text}`);
  }
  let row: AtPocketRecordRow = {};
  if (text) {
    try {
      row = JSON.parse(text) as AtPocketRecordRow;
    } catch {
      row = {};
    }
  }
  return { row, location, recordIdHint, rawBody: text || null };
}

/** レコード更新 PUT /api/apps/{appsId}/records/{recordId} */
export async function updateRecord(
  appsId: string,
  recordId: string,
  record: Record<string, unknown>,
  auth?: AtPocketFetchAuth,
): Promise<void> {
  const url = `${baseUrl()}/api/apps/${appsId}/records/${encodeURIComponent(recordId)}`;
  const key = resolvePassedApiKey(auth);
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      [authHeaderName()]: key,
    },
    body: JSON.stringify({ record }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`@pocket update record failed: ${res.status} ${text}`);
  }
}

/** レコード削除 DELETE /api/apps/{appsId}/records/{recordId} */
export async function deleteRecord(
  appsId: string,
  recordId: string,
  auth?: AtPocketFetchAuth,
): Promise<void> {
  const url = `${baseUrl()}/api/apps/${appsId}/records/${encodeURIComponent(recordId)}`;
  const key = resolvePassedApiKey(auth);
  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      Accept: "application/json",
      [authHeaderName()]: key,
    },
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`@pocket delete record failed: ${res.status} ${text}`);
  }
}
