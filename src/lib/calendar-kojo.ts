/**
 * 工事カレンダー（calendar_atpocket.js と同等のデータ抽出ロジックをサーバー側 TS で再現）
 */
import "server-only";

import type {
  CalendarApiPayload,
  CalendarAttachmentMeta,
  CalendarMonthApiItem,
  CalendarRecordMonthPatch,
  ConstructionHandlerHomeCase,
} from "@/lib/calendar-api-types";
import {
  atPocketFileHasPayload,
  isDisplayableImageFile,
  parseAtPocketFileField,
} from "@/lib/at-pocket-file-field";
import type { AtPocketFieldRow, AtPocketRecordRow } from "@/lib/atpocket";
import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";
import {
  readMapAddressesFromRecord,
  resolveConstructionMapAddressFieldIds,
  type MapAddressFieldIds,
} from "@/lib/map-address-fields";
import { pocketTableCellToPlainString } from "@/lib/staff-construction-availability";

export type {
  CalendarApiPayload,
  CalendarMonthApiItem,
  ConstructionHandlerHomeCase,
} from "@/lib/calendar-api-types";

export type ConstructionFieldIds = {
  title: string;
  contractor: string;
  startDate: string;
  endDate: string;
  memo: string;
  housingStatus: string;
  shigumi: string;
  panelWork: string;
  electricWork: string;
  appSettingsDay: string;
  tNumber: string;
  manufacturer: string;
  panelCapacity: string;
  batteryCapacity: string;
  inputStatus: string;
  zankoDay: string;
  constructionHandler: string;
};

export type ReportFieldIds = {
  tNumber: string;
  reportContent: string;
};

type CalendarEventInternal = {
  start: Date;
  end: Date | null;
  title: string;
  memo: string;
  category: "empty" | "list";
  contractorNameForColor: string;
  housingStatusKey: string;
  calendarSegments: Array<{ date: Date; label: string }> | null;
  zankoCalendarSegment: { date: Date; label: string } | null;
  inputStatusIsShinki: boolean;
  recordId: string | number | null;
  accessEditUrl: string;
  tNumberKey: string | null;
  _reportContentRaws: unknown[] | null;
  chipSpecLine2: string;
  constructionHandlerName: string;
  pinpointAddress: string;
  normalAddress: string;
  attachments: CalendarAttachmentMeta[];
};

type CalendarMonthRow = {
  dayKey: string;
  title: string;
  segmentLabel: string;
  memo: string;
  recordId: string | number | null;
  accessEditUrl: string;
  category: "empty" | "list";
  contractorNameForColor: string;
  housingStatusKey: string;
  reportKankoComplete: boolean;
  reportPostponed: boolean;
  chipSpecLine2: string;
  constructionHandlerName: string;
  inputStatusIsShinki: boolean;
  pinpointAddress: string;
  normalAddress: string;
  attachments: CalendarAttachmentMeta[];
};

const HOUSING_STATUS_EXACT = [
  "新築案件",
  "既築案件",
  "トラーチ倶楽部案件",
  "産業用案件",
] as const;
const HOUSING_STATUS_OTHER = "__HS_OTHER__";

function extractImageAttachmentMeta(
  recObj: Record<string, unknown>,
  attachmentFieldId: string | null | undefined,
  includeAllFiles = false,
): CalendarAttachmentMeta[] {
  const fieldId = attachmentFieldId?.trim();
  if (!fieldId) return [];
  const files = parseAtPocketFileField(recObj[fieldId]);
  const out: CalendarAttachmentMeta[] = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (!atPocketFileHasPayload(file)) continue;
    if (!includeAllFiles && !isDisplayableImageFile(file)) continue;
    out.push({
      index,
      name: file.name,
      mimeType: file.mimeType,
    });
  }
  return out;
}

const NFKC = (s: string) => s.normalize("NFKC");

/** calendar_atpocket.js FIELD_KEYWORDS 準拠 */
const KW = {
  title: ["お客様名", "顧客名", "顧客", "件名", "施主", "名"],
  contractor: [
    "施工業者",
    "施工会社",
    "施工者",
    "施工店",
    "工務店",
    "工務店名",
    "施工店名",
    "施工元",
    "業者",
  ],
  startDate: ["施工予定日", "予定日", "着工日", "工事日", "日付"],
  endDate: ["終了日", "完工日", "期日", "〆", "〆日"],
  memo: ["メモ", "内容", "備考", "詳細"],
  housingStatus: ["住宅ステータス", "住宅 ステータス", "住ステ"],
  shigumi: ["仕込日", "しごみ"],
  panelWork: ["パネル工事日", "パネル"],
  electricWork: ["電気工事日", "電気工事"],
  appSettingsDay: ["アプリ設定日", "アプリ設定"],
  manufacturer: ["メーカー"],
  panelCapacity: ["パネル容量"],
  batteryCapacity: ["蓄電池容量", "蓄電池"],
  inputStatus: ["入力ステータス"],
  zankoDay: ["残工日"],
};

function pickFieldUniqueId(
  fields: AtPocketFieldRow[],
  keywords: string[] | undefined,
): string {
  if (!keywords?.length) return "";
  const lowered = keywords.map((k) => NFKC(k).toLowerCase());
  for (const f of fields) {
    const cap = f.caption ? NFKC(String(f.caption)) : "";
    const capL = cap.toLowerCase();
    if (lowered.some((k) => k && capL.includes(k))) {
      return f.uniqueId ? String(f.uniqueId) : "";
    }
  }
  return "";
}

function pickFieldUniqueIdByExactCaption(
  fields: AtPocketFieldRow[],
  caption: string,
): string {
  const id = pocketFieldUniqueIdByCaption(fields, caption);
  return id ?? "";
}

/** 列見出し完全一致で uniqueId を返す（見つからなければ null） */
export function pocketFieldUniqueIdByCaption(
  fields: AtPocketFieldRow[],
  caption: string,
): string | null {
  const target = NFKC(String(caption)).trim().toLowerCase();
  for (const f of fields) {
    const cap = f.caption
      ? NFKC(String(f.caption)).trim().toLowerCase()
      : "";
    if (cap && cap === target) {
      const id = f.uniqueId?.trim();
      return id || null;
    }
  }
  return null;
}

/**
 * GET fields で返った集合に対して、field-N と field_N のどちらかだけでもマッチさせる。
 * 管理画面の識別名は hyphen が多く、PUT はそれと同一文字列であるべき環境がある。
 */
function pickBestNumericSchemaId(
  numPart: string,
  schemaIds: Set<string>,
): string | null {
  const n = numPart.trim();
  if (!n) return null;
  const hyphen = `field-${n}`;
  const under = `field_${n}`;
  if (schemaIds.has(hyphen)) return hyphen;
  if (schemaIds.has(under)) return under;
  for (const a of pocketNumericFieldIdVariants(n)) {
    if (schemaIds.has(a)) return a;
  }
  return null;
}

/**
 * .env のフィールド識別子を、工事アプリ GET fields の uniqueId に厳密に合わせる（無いものは PUT に載せない）。
 */
export function resolveConfiguredFieldToSchemaUniqueId(
  configuredId: string,
  fields: AtPocketFieldRow[],
): string | null {
  const id = configuredId.trim();
  if (!id) return null;
  const schemaIds = new Set(
    fields
      .map((f) => f.uniqueId?.trim())
      .filter((u): u is string => Boolean(u)),
  );

  if (schemaIds.has(id)) return id;

  const dm = /^field-(\d+)$/i.exec(id);
  if (dm) {
    const picked = pickBestNumericSchemaId(dm[1], schemaIds);
    if (picked) return picked;
  }
  const um = /^field_(\d+)$/i.exec(id);
  if (um) {
    const picked = pickBestNumericSchemaId(um[1], schemaIds);
    if (picked) return picked;
  }

  return null;
}

/** GET の record が hyphen / underscore のどちらのキーでも値を返せるようにする */
export function pickRecordValueByFieldAliases(
  recObj: Record<string, unknown>,
  configuredFieldId: string,
): unknown {
  const k = configuredFieldId.trim();
  if (!k) return undefined;
  const candidates = new Set<string>([k]);
  const dm = /^field-(\d+)$/i.exec(k);
  if (dm) {
    candidates.add(`field_${dm[1]}`);
    candidates.add(`field-${dm[1]}`);
  }
  const um = /^field_(\d+)$/i.exec(k);
  if (um) {
    candidates.add(`field-${um[1]}`);
    candidates.add(`field_${um[1]}`);
  }
  for (const key of candidates) {
    if (
      Object.prototype.hasOwnProperty.call(recObj, key) &&
      recObj[key] !== undefined &&
      recObj[key] !== null
    ) {
      return recObj[key];
    }
  }
  return undefined;
}

/** field-32 と field_32 のような表記ゆれを試す（数字部分で対応） */
function pocketNumericFieldIdVariants(numPart: string): string[] {
  const n = numPart.trim();
  if (!n) return [];
  const hyphen = `field-${n}`;
  const under = `field_${n}`;
  return [
    hyphen,
    under,
    hyphen.replace(/^field-/i, "Field-"),
    under.replace(/^field_/i, "Field_"),
  ];
}

/** @pocket の工事登録アプリからフィールド uniqueId を推定（見出し名／キーワード）。
 * 施工業者は CALENDAR_CONTRACTOR_FIELD_ID があれば GET fields の uniqueId に正規化して最優先する。
 */
export function resolveConstructionFieldIds(
  fields: AtPocketFieldRow[],
): ConstructionFieldIds {
  const base: ConstructionFieldIds = {
    title:
      pickFieldUniqueIdByExactCaption(fields, "お客様名") ||
      pickFieldUniqueId(fields, [...KW.title]),
    contractor:
      pickFieldUniqueIdByExactCaption(fields, "施工業者") ||
      pickFieldUniqueIdByExactCaption(fields, "施工会社") ||
      pickFieldUniqueIdByExactCaption(fields, "施工店") ||
      pickFieldUniqueIdByExactCaption(fields, "工務店") ||
      pickFieldUniqueId(fields, KW.contractor),
    startDate:
      pickFieldUniqueIdByExactCaption(fields, "施工予定日") ||
      pickFieldUniqueId(fields, KW.startDate),
    endDate: pickFieldUniqueId(fields, KW.endDate),
    memo: pickFieldUniqueId(fields, KW.memo),
    housingStatus:
      pickFieldUniqueIdByExactCaption(fields, "住宅ステータス") ||
      pickFieldUniqueId(fields, KW.housingStatus),
    shigumi:
      pickFieldUniqueIdByExactCaption(fields, "仕込日") ||
      pickFieldUniqueId(fields, KW.shigumi),
    panelWork:
      pickFieldUniqueIdByExactCaption(fields, "パネル工事日") ||
      pickFieldUniqueId(fields, KW.panelWork),
    electricWork:
      pickFieldUniqueIdByExactCaption(fields, "電気工事日") ||
      pickFieldUniqueId(fields, KW.electricWork),
    appSettingsDay:
      pickFieldUniqueIdByExactCaption(fields, "アプリ設定日") ||
      pickFieldUniqueId(fields, KW.appSettingsDay),
    tNumber:
      pickFieldUniqueIdByExactCaption(fields, "T番号") ||
      pickFieldUniqueId(fields, ["T番号", "T no", "T No"]),
    manufacturer:
      pickFieldUniqueIdByExactCaption(fields, "メーカー") ||
      pickFieldUniqueId(fields, KW.manufacturer),
    panelCapacity:
      pickFieldUniqueIdByExactCaption(fields, "パネル容量") ||
      pickFieldUniqueId(fields, KW.panelCapacity),
    batteryCapacity:
      pickFieldUniqueIdByExactCaption(fields, "蓄電池容量") ||
      pickFieldUniqueIdByExactCaption(fields, "蓄電池") ||
      pickFieldUniqueId(fields, KW.batteryCapacity),
    inputStatus:
      pickFieldUniqueIdByExactCaption(fields, "入力ステータス") ||
      pickFieldUniqueId(fields, KW.inputStatus),
    zankoDay:
      pickFieldUniqueIdByExactCaption(fields, "残工日") ||
      pickFieldUniqueId(fields, KW.zankoDay),
    constructionHandler:
      pickFieldUniqueIdByExactCaption(fields, "工事対応者") ||
      pickFieldUniqueIdByExactCaption(fields, "工事登録者") ||
      pickFieldUniqueId(fields, ["工事対応者", "工事登録者"]),
  };

  const envOverrides: Array<[keyof ConstructionFieldIds, string | undefined]> = [
    ["contractor", process.env.CALENDAR_CONTRACTOR_FIELD_ID?.trim()],
    ["startDate", process.env.CALENDAR_START_DATE_FIELD_ID?.trim()],
    ["shigumi", process.env.CALENDAR_SHIGUMI_DATE_FIELD_ID?.trim()],
    ["panelWork", process.env.CALENDAR_PANEL_WORK_DATE_FIELD_ID?.trim()],
    ["electricWork", process.env.CALENDAR_ELECTRIC_WORK_DATE_FIELD_ID?.trim()],
    ["appSettingsDay", process.env.CALENDAR_APP_SETTINGS_DATE_FIELD_ID?.trim()],
    [
      "constructionHandler",
      process.env.CALENDAR_EMPTY_FILL_CONSTRUCTION_HANDLER_FIELD_ID?.trim() ||
        process.env.CALENDAR_EMPTY_FILL_CONSTRUCTION_REGISTRANT_FIELD_ID?.trim(),
    ],
  ];
  for (const [key, envValue] of envOverrides) {
    if (!envValue) continue;
    const resolved = resolveConfiguredFieldToSchemaUniqueId(envValue, fields);
    if (resolved) base[key] = resolved;
  }

  return base;
}

/** 工事アプリの T番号（自動採番列）の uniqueId。環境変数 → 見出し「T番号」の順で解決 */
export function resolveConstructionTNumberFieldId(
  fields: AtPocketFieldRow[],
): string | null {
  const fromEnv =
    process.env.CALENDAR_CONSTRUCTION_UNIQUE_KEY_FIELD_ID?.trim() ||
    process.env.CALENDAR_EMPTY_FILL_TNUMBER_FIELD_ID?.trim();
  if (fromEnv) {
    return resolveConfiguredFieldToSchemaUniqueId(fromEnv, fields);
  }
  const fids = resolveConstructionFieldIds(fields);
  const t = fids.tNumber?.trim();
  if (!t) return null;
  return resolveConfiguredFieldToSchemaUniqueId(t, fields);
}

/**
 * 空枠入力の住宅ステータス書き込み先。
 * カレンダー表示と同じ「住宅ステータス」見出しを優先し、無いときだけ env を使う。
 * （env が別列を指していると @pocket 上の住宅ステータスが空のままになる）
 */
export function resolveEmptyFillHousingStatusFieldId(
  fields: AtPocketFieldRow[],
): string | null {
  const fids = resolveConstructionFieldIds(fields);
  const fromCaption = fids.housingStatus?.trim();
  if (fromCaption) {
    return (
      resolveConfiguredFieldToSchemaUniqueId(fromCaption, fields) ?? fromCaption
    );
  }
  const fromEnv =
    process.env.CALENDAR_EMPTY_FILL_HOUSING_STATUS_FIELD_ID?.trim();
  if (!fromEnv) return null;
  return resolveConfiguredFieldToSchemaUniqueId(fromEnv, fields);
}

export function resolveReportFieldIds(
  fields: AtPocketFieldRow[],
): ReportFieldIds {
  return {
    tNumber:
      pickFieldUniqueIdByExactCaption(fields, "T番号") ||
      pickFieldUniqueId(fields, ["T番号", "T no", "T No"]),
    reportContent:
      pickFieldUniqueIdByExactCaption(fields, "報告内容") ||
      pickFieldUniqueId(fields, ["報告内容"]),
  };
}

export function collectConstructionFieldsCsv(
  fids: ConstructionFieldIds,
  mapAddressIds?: MapAddressFieldIds,
  extraFieldIds?: Array<string | null | undefined>,
): string {
  const set = new Set<string>();
  for (const v of Object.values(fids)) {
    const t = String(v ?? "").trim();
    if (t) set.add(t);
  }
  if (mapAddressIds) {
    for (const id of [
      mapAddressIds.pinpointFieldId,
      mapAddressIds.normalAddressFieldId,
      mapAddressIds.prefectureFieldId,
      mapAddressIds.cityFieldId,
      mapAddressIds.streetFieldId,
    ]) {
      const t = id?.trim();
      if (t) set.add(t);
    }
  }
  for (const id of extraFieldIds ?? []) {
    const t = id?.trim();
    if (t) set.add(t);
  }
  return Array.from(set).join(",");
}

export function collectReportFieldsCsv(rf: ReportFieldIds): string {
  return [rf.tNumber, rf.reportContent].filter(Boolean).join(",");
}

function extractValue(raw: unknown): unknown {
  if (raw === null || raw === undefined) return null;
  if (
    typeof raw === "string" ||
    typeof raw === "number" ||
    typeof raw === "boolean"
  ) {
    return raw;
  }
  if (Array.isArray(raw)) {
    const parts = raw
      .map(extractValue)
      .filter((x) => x !== null && x !== undefined && String(x).trim() !== "");
    return parts.join(", ");
  }
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if ("value" in o) return o.value;
    if ("name" in o) return o.name;
    if ("label" in o) return o.label;
    if ("text" in o) return o.text;
    try {
      return JSON.stringify(raw);
    } catch {
      return String(raw);
    }
  }
  return String(raw);
}

function parseDate(raw: unknown): Date | null {
  const v = extractValue(raw);
  if (!v) return null;
  let s = String(v).trim();
  if (!s) return null;
  s = s.replace(/\//g, "-");
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s = `${s}T00:00:00`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function ymdKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * @pocket レコード一覧の `query` 用。表示月と期間が重なる工事だけに絞り、一覧APIのページ数を抑える。
 * 終了日が未推定のときは開始日が月内のレコードのみになりうる（境界データは CALENDAR_RECORDS_QUERY_FILTER をオフに）。
 */
export function buildConstructionRecordsMonthOverlapQuery(
  fids: ConstructionFieldIds,
  viewYear: number,
  viewMonth1To12: number,
): string | null {
  const startId = fids.startDate?.trim();
  if (!startId) return null;

  const month0 = viewMonth1To12 - 1;
  const ms = ymdKey(new Date(viewYear, month0, 1));
  const me = ymdKey(new Date(viewYear, month0 + 1, 0));

  const endId = fids.endDate?.trim();
  const zankoId = fids.zankoDay?.trim();

  const overlapCore = endId
    ? `(${startId} <= "${me}" and (${endId} >= "${ms}" or ${endId} is empty))`
    : `(${startId} <= "${me}" and ${startId} >= "${ms}")`;

  if (zankoId) {
    return `(${overlapCore} or (${zankoId} >= "${ms}" and ${zankoId} <= "${me}"))`;
  }
  return overlapCore;
}

/**
 * 本日以降に工事日が残る案件向けの @pocket query。
 * 施工予定日・終了日・残工日・新築4日程のいずれかが本日以降なら候補に含める。
 */
export function buildConstructionRecordsFromTodayQuery(
  fids: ConstructionFieldIds,
  todayYmd: string,
): string | null {
  const today = todayYmd.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;

  const clauses: string[] = [];
  const pushGte = (fieldId: string | null | undefined) => {
    const id = fieldId?.trim();
    if (id) clauses.push(`${id} >= "${today}"`);
  };

  pushGte(fids.startDate);
  pushGte(fids.endDate);
  pushGte(fids.zankoDay);
  pushGte(fids.shigumi);
  pushGte(fids.panelWork);
  pushGte(fids.electricWork);
  pushGte(fids.appSettingsDay);

  if (clauses.length === 0) return null;
  return `(${clauses.join(" or ")})`;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function parseRecordStartDate(
  recObj: Record<string, unknown>,
  fieldIds: string[],
): Date | null {
  for (const id of fieldIds) {
    const t = id.trim();
    if (!t) continue;
    const parsed = parseDate(recObj[t]);
    if (parsed) return startOfDay(parsed);
  }
  return null;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + n);
  return x;
}

function isBlankDisplayStr(raw: unknown): boolean {
  if (raw === null || raw === undefined) return true;
  return String(raw).replace(/\s/g, "").length === 0;
}

/** お客様名フィールド（uniqueId）が空か。工事空枠の判定と一致 */
export function constructionTitleFieldIsEmpty(
  recObj: Record<string, unknown>,
  titleFieldUniqueId: string,
): boolean {
  if (!titleFieldUniqueId) return false;
  const nameRaw = extractValue(
    pickRecordValueByFieldAliases(recObj, titleFieldUniqueId),
  );
  const nameTrim =
    nameRaw != null && !isBlankDisplayStr(nameRaw)
      ? String(nameRaw).trim()
      : "";
  return nameTrim.length === 0;
}

function normalizeTNumberKey(raw: unknown): string | null {
  if (raw == null || isBlankDisplayStr(String(raw))) return null;
  return String(raw).replace(/\s+/g, " ").trim();
}

function resolveHousingStatusKey(raw: unknown): string {
  if (raw == null || isBlankDisplayStr(String(raw))) return HOUSING_STATUS_OTHER;
  const t = String(raw).replace(/\s+/g, " ").trim();
  for (const ex of HOUSING_STATUS_EXACT) {
    if (t === ex) return ex;
  }
  for (const ex of HOUSING_STATUS_EXACT) {
    if (t.includes(ex)) return ex;
  }
  return HOUSING_STATUS_OTHER;
}

export function shortHousingStatusLabel(hk: string): string {
  if (hk == null || hk === HOUSING_STATUS_OTHER) return "その他";
  if (hk === "新築案件") return "新築";
  if (hk === "既築案件") return "既築";
  if (hk === "トラーチ倶楽部案件") return "トラーチ";
  if (hk === "産業用案件") return "産業用";
  return String(hk);
}

function buildCalendarSegmentsForQuadStatus(
  recObj: Record<string, unknown>,
  fids: ConstructionFieldIds,
): Array<{ date: Date; label: string }> | null {
  const out: Array<{ date: Date; label: string }> = [];
  const defs: Array<{ id: string; L: string }> = [
    { id: fids.shigumi, L: "仕込日" },
    { id: fids.panelWork, L: "パネル工事日" },
    { id: fids.electricWork, L: "電気工事日" },
    { id: fids.appSettingsDay, L: "アプリ設定日" },
  ];
  for (const def of defs) {
    if (!def.id) continue;
    const raw = extractValue(recObj[def.id]);
    const pd = parseDate(raw);
    if (pd) out.push({ date: startOfDay(pd), label: def.L });
  }
  return out.length > 0 ? out : null;
}

function parseNumberFromFieldRaw(raw: unknown): number | null {
  if (raw == null) return null;
  const v = extractValue(raw);
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s0 = String(v)
    .replace(/,/g, "")
    .replace(/，/g, "")
    .replace(/\r\n/g, "\n")
    .split("\n")[0]
    .trim();
  const m = s0.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isNaN(n) ? null : n;
}

function formatNumberOmitAllZeroDecimal(
  n: number,
  maxDecimalPlaces: number,
): string {
  if (!Number.isFinite(n)) return "";
  return String(parseFloat(n.toFixed(maxDecimalPlaces)));
}

function manufacturerFullFromRaw(raw: unknown): string {
  if (raw == null) return "";
  const v = extractValue(raw);
  if (v == null) return "";
  return String(v).split(/\r?\n/)[0].trim();
}

function formatPanelCapKwFromRaw(raw: unknown): string {
  const n = parseNumberFromFieldRaw(raw);
  if (n == null) return "";
  return `${formatNumberOmitAllZeroDecimal(n, 3)}kW`;
}

function formatBatteryKwhFromRaw(raw: unknown): string {
  const n = parseNumberFromFieldRaw(raw);
  if (n == null) return "";
  return `${formatNumberOmitAllZeroDecimal(n, 1)}kWh`;
}

function buildChipSpecLine2(
  recObj: Record<string, unknown>,
  fids: ConstructionFieldIds,
): string {
  const m = fids.manufacturer
    ? manufacturerFullFromRaw(recObj[fids.manufacturer])
    : "";
  const pStr = fids.panelCapacity
    ? formatPanelCapKwFromRaw(recObj[fids.panelCapacity])
    : "";
  const bStr = fids.batteryCapacity
    ? formatBatteryKwhFromRaw(recObj[fids.batteryCapacity])
    : "";
  if (!m && !pStr && !bStr) return "";
  let out = m ? `『${m}』` : "";
  if (pStr && bStr) {
    out += `${m ? " " : ""}${pStr} / ${bStr}`;
  } else if (pStr) {
    out += `${m ? " " : ""}${pStr}`;
  } else {
    out += `${m ? " " : ""}${bStr}`;
  }
  return out;
}

function getRecordIdFromListItem(rec: AtPocketRecordRow): string | number | null {
  if (rec.recordId != null) return rec.recordId;
  if (rec.id != null) return rec.id;
  return null;
}

function getAccessEditUrlFromListItem(rec: AtPocketRecordRow): string {
  if (!rec.accessEditUrl) return "";
  return String(rec.accessEditUrl).trim();
}

function recordToEvent(
  rec: AtPocketRecordRow,
  fids: ConstructionFieldIds,
  mapAddressIds: MapAddressFieldIds,
  attachmentFieldId?: string | null,
  attachmentIncludeAllFiles = false,
  startDateFieldCandidates: string[] = [],
): CalendarEventInternal | null {
  const recObj =
    rec && rec.record && typeof rec.record === "object"
      ? (rec.record as Record<string, unknown>)
      : {};

  const nameRaw = fids.title ? extractValue(recObj[fids.title]) : null;
  const nameTrim =
    nameRaw != null && !isBlankDisplayStr(nameRaw)
      ? String(nameRaw).trim()
      : "";
  const coColorRaw = fids.contractor
    ? extractValue(recObj[fids.contractor])
    : null;
  const coForColor =
    coColorRaw != null && !isBlankDisplayStr(coColorRaw)
      ? String(coColorRaw).trim()
      : "";

  let displayTitle: string;
  let category: "empty" | "list";
  if (nameTrim.length === 0) {
    category = "empty";
    displayTitle = "（空枠）";
  } else {
    category = "list";
    displayTitle = nameTrim;
  }

  const memo = fids.memo ? String(extractValue(recObj[fids.memo]) || "") : "";

  let housingStatusKey = HOUSING_STATUS_OTHER;
  if (category === "list" && fids.housingStatus) {
    housingStatusKey = resolveHousingStatusKey(
      extractValue(recObj[fids.housingStatus]),
    );
  }

  let calendarSegments: Array<{ date: Date; label: string }> | null = null;
  if (
    category === "list" &&
    (housingStatusKey === "新築案件" || housingStatusKey === "産業用案件")
  ) {
    calendarSegments = buildCalendarSegmentsForQuadStatus(recObj, fids);
  }

  let start: Date;
  let end: Date | null;

  const startFieldIds = [
    ...(fids.startDate?.trim() ? [fids.startDate.trim()] : []),
    ...startDateFieldCandidates.filter(
      (id) => id.trim() && id.trim() !== fids.startDate?.trim(),
    ),
  ];

  if (category === "empty") {
    const sEmpty = parseRecordStartDate(recObj, startFieldIds);
    if (!sEmpty) return null;
    start = sEmpty;
    end = fids.endDate ? parseDate(recObj[fids.endDate]) : null;
    if (end) end = startOfDay(end);
    if (end && end.getTime() < start.getTime()) end = null;
  } else if (calendarSegments && calendarSegments.length > 0) {
    const tms = calendarSegments.map((s) => s.date.getTime());
    start = startOfDay(new Date(Math.min(...tms)));
    end = startOfDay(new Date(Math.max(...tms)));
  } else {
    const s0 = parseRecordStartDate(recObj, startFieldIds);
    if (!s0) return null;
    start = s0;
    end = fids.endDate ? parseDate(recObj[fids.endDate]) : null;
    if (end) end = startOfDay(end);
    if (end && end.getTime() < start.getTime()) end = null;
  }

  let tNumberKey: string | null = null;
  if (fids.tNumber) {
    tNumberKey = normalizeTNumberKey(recObj[fids.tNumber]);
  }

  let chipSpecLine2 = "";
  if (category === "list") {
    chipSpecLine2 = buildChipSpecLine2(recObj, fids) || "";
  }

  let constructionHandlerName = "";
  if (category === "list" && fids.constructionHandler) {
    constructionHandlerName = pocketTableCellToPlainString(
      pickRecordValueByFieldAliases(recObj, fids.constructionHandler),
    );
  }

  let zankoCalendarSegment: { date: Date; label: string } | null = null;
  if (
    category === "list" &&
    fids.inputStatus &&
    fids.zankoDay &&
    isInputStatusZanko(recObj[fids.inputStatus])
  ) {
    const zankoParsed = parseDate(recObj[fids.zankoDay]);
    if (zankoParsed) {
      zankoCalendarSegment = { date: startOfDay(zankoParsed), label: "残工日" };
    }
  }

  let inputStatusIsShinki = false;
  if (category === "list" && fids.inputStatus) {
    inputStatusIsShinki = isInputStatusShinki(recObj[fids.inputStatus]);
  }

  const { pinpointAddress, normalAddress } = readMapAddressesFromRecord(
    recObj,
    mapAddressIds,
  );
  const attachments = extractImageAttachmentMeta(
    recObj,
    attachmentFieldId,
    attachmentIncludeAllFiles,
  );

  return {
    start,
    end,
    title: displayTitle,
    memo,
    category,
    contractorNameForColor: coForColor,
    housingStatusKey,
    calendarSegments,
    zankoCalendarSegment,
    inputStatusIsShinki,
    recordId: getRecordIdFromListItem(rec),
    accessEditUrl: getAccessEditUrlFromListItem(rec),
    tNumberKey,
    _reportContentRaws: null,
    chipSpecLine2,
    constructionHandlerName,
    pinpointAddress,
    normalAddress,
    attachments,
  };
}

function isReportContentExactMatch(raw: unknown, expected: string): boolean {
  if (!expected) return false;
  if (raw == null) return false;
  const v = extractValue(raw);
  if (v == null) return false;
  const t = String(v)
    .replace(/\r\n/g, "\n")
    .split("\n")[0]
    .replace(/\s+/g, " ")
    .trim();
  return t === String(expected);
}

function isInputStatusZanko(raw: unknown): boolean {
  return isReportContentExactMatch(raw, "残工");
}

function isInputStatusShinki(raw: unknown): boolean {
  return isReportContentExactMatch(raw, "新規");
}

function expectedReportStatusLabel(segmentLabel: string): string {
  const s =
    segmentLabel != null && String(segmentLabel) !== ""
      ? String(segmentLabel)
      : "";
  if (s === "仕込日") return "仕込完了";
  if (s === "パネル工事日") return "パネル工事完了";
  if (s === "電気工事日") return "電気工事完了";
  if (s === "アプリ設定日") return "アプリ設定完了";
  return "完工";
}

function evHasReportPostponed(ev: CalendarEventInternal): boolean {
  if (!ev || ev.category !== "list") return false;
  const list = ev._reportContentRaws;
  if (!list?.length) return false;
  for (const z of list) {
    if (isReportContentExactMatch(z, "残工")) return true;
  }
  return false;
}

function rowMatchesReportKanko(
  ev: CalendarEventInternal,
  segmentLabel: string,
): boolean {
  if (!ev || ev.category !== "list") return false;
  const expected = expectedReportStatusLabel(segmentLabel);
  const list = ev._reportContentRaws;
  if (!list?.length) return false;
  for (const ri of list) {
    if (isReportContentExactMatch(ri, expected)) return true;
  }
  return false;
}

export function buildTNumberToReportContentMap(
  records: AtPocketRecordRow[],
  rf: ReportFieldIds,
): Map<string, unknown[]> {
  const m = new Map<string, unknown[]>();
  if (!rf.tNumber || !rf.reportContent) return m;
  for (const rec of records) {
    const recObj =
      rec && rec.record && typeof rec.record === "object"
        ? (rec.record as Record<string, unknown>)
        : null;
    if (!recObj) continue;
    const tRaw = extractValue(recObj[rf.tNumber]);
    const k = normalizeTNumberKey(tRaw);
    if (!k) continue;
    const cRaw = recObj[rf.reportContent];
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(cRaw);
  }
  return m;
}

function attachReportContentFromTNumberMap(
  ev: CalendarEventInternal,
  tnumToContent: Map<string, unknown[]> | null,
): void {
  ev._reportContentRaws = null;
  if (
    ev.category !== "list" ||
    !tnumToContent ||
    typeof tnumToContent.get !== "function"
  ) {
    return;
  }
  if (!ev.tNumberKey) return;
  const v = tnumToContent.get(ev.tNumberKey);
  ev._reportContentRaws = v == null ? [] : Array.isArray(v) ? v.slice() : [v];
}

function shortScheduleSegmentLabel(longLabel: string): string {
  const s = String(longLabel || "");
  if (s === "残工日") return "残工";
  if (s === "仕込日") return "仕込";
  if (s === "パネル工事日") return "パネル";
  if (s === "電気工事日") return "電気";
  if (s === "アプリ設定日") return "アプリ";
  return s;
}

function bracketInnerKoujiSegment(segmentLabel: string): string {
  const s = String(segmentLabel || "");
  if (s === "残工日") return "残工";
  if (s === "仕込日") return "仕込工事";
  if (s === "パネル工事日") return "パネル工事";
  if (s === "電気工事日") return "電気工事";
  if (s === "アプリ設定日") return "アプリ設定";
  return `${shortScheduleSegmentLabel(s)}工事`;
}

function bracketKubunFromSegmentLabel(segmentLabel: string): string {
  const s = String(segmentLabel || "");
  if (s === "残工日") return "【残工】";
  return `【${bracketInnerKoujiSegment(s)}】`;
}

function displayNameLine1OnChip(row: CalendarMonthRow): string {
  if (row.attachments?.length) {
    const name = row.attachments[0]?.name?.trim();
    return name || "添付画像";
  }
  if (!row || row.category === "empty") {
    return "（空枠）";
  }
  const t = String(row.title != null ? row.title : "");
  const s = t.trim();
  if (s === "" || s === "（空枠）") return t;
  const nameLine = s.endsWith("様") ? t : `${t}様`;
  if (row.segmentLabel) {
    return bracketKubunFromSegmentLabel(row.segmentLabel) + nameLine;
  }
  return nameLine;
}

function displayNameLine1OnChipWithReport(row: CalendarMonthRow): string {
  const base = displayNameLine1OnChip(row);
  if (!row || row.category === "empty") return base;
  const seg = row.segmentLabel != null ? String(row.segmentLabel) : "";
  if (seg === "残工日") return base;
  const hk = row.housingStatusKey;
  if (hk === "新築案件" || hk === "産業用案件") return base;
  if (row.reportPostponed === true) return `【延期】${base}`;
  return base;
}

function displayNameLine2OnChip(row: CalendarMonthRow): string {
  const parts: string[] = [];
  if (row?.category === "list") {
    const handler = row.constructionHandlerName?.trim();
    if (handler) parts.push(`工事対応: ${handler}`);
    const spec =
      row.chipSpecLine2 != null && String(row.chipSpecLine2).trim() !== ""
        ? String(row.chipSpecLine2).trim()
        : "";
    if (spec) parts.push(spec);
  }
  const co = row?.contractorNameForColor?.trim();
  if (co) parts.push(`施工: ${co}`);
  return parts.join("｜");
}

function rowShowsPostponedPrefix(row: CalendarMonthRow): boolean {
  if (!row || row.category === "empty") return false;
  const seg = row.segmentLabel != null ? String(row.segmentLabel) : "";
  if (seg === "残工日") return false;
  const hk = row.housingStatusKey;
  if (hk === "新築案件" || hk === "産業用案件") return false;
  return row.reportPostponed === true;
}

function contractorKeyFromRow(row: CalendarMonthRow): string {
  if (!row.contractorNameForColor?.trim()) return "__UNSET__";
  return row.contractorNameForColor.trim();
}

function eventsForDisplayMonth(
  viewYear: number,
  viewMonth0: number,
  events: CalendarEventInternal[],
): CalendarMonthRow[] {
  const monthStart = new Date(viewYear, viewMonth0, 1, 0, 0, 0, 0);
  const monthEndEx = new Date(viewYear, viewMonth0 + 1, 1, 0, 0, 0, 0);
  function dayInViewMonth(d: Date): boolean {
    const d0 = startOfDay(d);
    return (
      d0.getTime() >= monthStart.getTime() && d0.getTime() < monthEndEx.getTime()
    );
  }

  const out: CalendarMonthRow[] = [];

  for (const ev of events) {
    if (!ev) continue;

    if (ev.calendarSegments && ev.calendarSegments.length > 0) {
      for (const seg of ev.calendarSegments) {
        const d0 = startOfDay(seg.date);
        if (d0.getTime() < monthStart.getTime() || d0.getTime() >= monthEndEx.getTime())
          continue;
        out.push({
          dayKey: ymdKey(d0),
          title: ev.title,
          segmentLabel: seg.label,
          memo: ev.memo,
          recordId: ev.recordId,
          accessEditUrl: ev.accessEditUrl,
          category: ev.category,
          contractorNameForColor: ev.contractorNameForColor,
          housingStatusKey: ev.housingStatusKey,
          reportKankoComplete: rowMatchesReportKanko(ev, seg.label),
          reportPostponed: evHasReportPostponed(ev),
          chipSpecLine2: ev.chipSpecLine2 ?? "",
          constructionHandlerName: ev.constructionHandlerName ?? "",
          inputStatusIsShinki: ev.inputStatusIsShinki === true,
          pinpointAddress: ev.pinpointAddress ?? "",
          normalAddress: ev.normalAddress ?? "",
          attachments: ev.attachments ?? [],
        });
      }
    } else {
      const s0 = startOfDay(ev.start);
      let e0 = ev.end ? startOfDay(ev.end) : s0;
      if (e0.getTime() < s0.getTime()) e0 = s0;
      if (
        !(
          e0.getTime() < monthStart.getTime() ||
          s0.getTime() >= monthEndEx.getTime()
        )
      ) {
        const segStart =
          s0.getTime() < monthStart.getTime() ? monthStart : s0;
        const segEnd =
          e0.getTime() >= monthEndEx.getTime()
            ? addDays(monthEndEx, -1)
            : e0;
        for (
          let d = new Date(segStart.getTime());
          d.getTime() <= segEnd.getTime();
          d = addDays(d, 1)
        ) {
          out.push({
            dayKey: ymdKey(d),
            title: ev.title,
            segmentLabel: "",
            memo: ev.memo,
            recordId: ev.recordId,
            accessEditUrl: ev.accessEditUrl,
            category: ev.category,
            contractorNameForColor: ev.contractorNameForColor,
            housingStatusKey: ev.housingStatusKey,
            reportKankoComplete: rowMatchesReportKanko(ev, ""),
            reportPostponed: evHasReportPostponed(ev),
            chipSpecLine2: ev.chipSpecLine2 ?? "",
            constructionHandlerName: ev.constructionHandlerName ?? "",
            inputStatusIsShinki: ev.inputStatusIsShinki === true,
            pinpointAddress: ev.pinpointAddress ?? "",
            normalAddress: ev.normalAddress ?? "",
            attachments: ev.attachments ?? [],
          });
        }
      }
    }

    if (ev.category === "list" && ev.zankoCalendarSegment) {
      const zx = ev.zankoCalendarSegment;
      const dZ = startOfDay(zx.date);
      if (dayInViewMonth(dZ)) {
        out.push({
          dayKey: ymdKey(dZ),
          title: ev.title,
          segmentLabel: zx.label,
          memo: ev.memo,
          recordId: ev.recordId,
          accessEditUrl: ev.accessEditUrl,
          category: ev.category,
          contractorNameForColor: ev.contractorNameForColor,
          housingStatusKey: ev.housingStatusKey,
          reportKankoComplete: rowMatchesReportKanko(ev, zx.label),
          reportPostponed: false,
          chipSpecLine2: ev.chipSpecLine2 ?? "",
          constructionHandlerName: ev.constructionHandlerName ?? "",
          inputStatusIsShinki: ev.inputStatusIsShinki === true,
          pinpointAddress: ev.pinpointAddress ?? "",
          normalAddress: ev.normalAddress ?? "",
          attachments: ev.attachments ?? [],
        });
      }
    }
  }

  return out;
}

function groupByDayKey(rows: CalendarMonthRow[]): Record<string, CalendarMonthRow[]> {
  const map: Record<string, CalendarMonthRow[]> = {};
  for (const r of rows) {
    if (!map[r.dayKey]) map[r.dayKey] = [];
    map[r.dayKey].push(r);
  }
  return map;
}

/* --- 祝日（calendar_atpocket.js と同様の固定表・振替処理） --- */

const SHUNBUN_DAY: Record<number, number> = {
  2010: 21, 2011: 20, 2012: 20, 2013: 20, 2014: 20, 2015: 20, 2016: 20,
  2017: 20, 2018: 20, 2019: 20, 2020: 20, 2021: 20, 2022: 21, 2023: 21,
  2024: 20, 2025: 20, 2026: 20, 2027: 20, 2028: 20, 2029: 20, 2030: 20,
  2031: 20, 2032: 20, 2033: 20, 2034: 20, 2035: 20, 2036: 20, 2037: 20,
  2038: 20, 2039: 20, 2040: 20, 2041: 20, 2042: 20, 2043: 20, 2044: 20,
  2045: 20, 2046: 20, 2047: 20, 2048: 20, 2049: 20, 2050: 20,
};

const SHUUBUN_DAY: Record<number, number> = {
  2010: 23, 2011: 23, 2012: 22, 2013: 23, 2014: 23, 2015: 23, 2016: 22,
  2017: 23, 2018: 23, 2019: 23, 2020: 22, 2021: 23, 2022: 23, 2023: 23,
  2024: 22, 2025: 23, 2026: 23, 2027: 23, 2028: 22, 2029: 23, 2030: 23,
  2031: 23, 2032: 22, 2033: 23, 2034: 23, 2035: 23, 2036: 22, 2037: 23,
  2038: 23, 2039: 23, 2040: 22, 2041: 23, 2042: 23, 2043: 23, 2044: 22,
  2045: 23, 2046: 23, 2047: 23, 2048: 22, 2049: 23, 2050: 23,
};

function getNthWeekdayInMonth(
  y: number,
  monthIndex: number,
  weekday: number,
  nth: number,
): number {
  const firstW = new Date(y, monthIndex, 1).getDay();
  const off = (weekday - firstW + 7) % 7;
  return 1 + off + (nth - 1) * 7;
}

function addKeysFromDate(set: Set<string>, y: number, m: number, d: number) {
  if (d < 1) return;
  const last = new Date(y, m + 1, 0).getDate();
  if (d > last) return;
  set.add(ymdKey(new Date(y, m, d, 0, 0, 0, 0)));
}

function applySubstituteHolidays(base: Set<string>): Set<string> {
  const h = new Set(base);
  const fixed = new Set(base);
  for (let i = 0; i < 2; i++) {
    const copy = Array.from(h);
    for (const key of copy) {
      const p = key.split("-");
      const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 0, 0, 0, 0);
      if (d.getDay() !== 0) continue;
      let t = addDays(d, 1);
      let guard = 0;
      while (fixed.has(ymdKey(t)) && guard < 10) {
        t = addDays(t, 1);
        guard += 1;
      }
      h.add(ymdKey(t));
    }
  }
  return h;
}

function applySandwichNationalHolidays(base: Set<string>, y: number): Set<string> {
  const h = new Set(base);
  for (let month = 1; month <= 12; month++) {
    const lastD = new Date(y, month, 0).getDate();
    for (let di = 1; di <= lastD; di++) {
      const cur = new Date(y, month - 1, di, 0, 0, 0, 0);
      if (cur.getDay() === 0 || cur.getDay() === 6) continue;
      const k = ymdKey(cur);
      if (h.has(k)) continue;
      if (h.has(ymdKey(addDays(cur, -1))) && h.has(ymdKey(addDays(cur, 1))))
        h.add(k);
    }
  }
  return h;
}

function buildJapanHolidayYmdSet(
  y: number,
  extraKeys: string[],
  includeSandwich: boolean,
): Set<string> {
  let h = new Set<string>();
  addKeysFromDate(h, y, 0, 1);
  addKeysFromDate(h, y, 0, getNthWeekdayInMonth(y, 0, 1, 2));
  addKeysFromDate(h, y, 1, 11);
  addKeysFromDate(h, y, 1, 23);
  const sp = SHUNBUN_DAY[y];
  if (sp) addKeysFromDate(h, y, 2, sp);
  addKeysFromDate(h, y, 3, 29);
  addKeysFromDate(h, y, 4, 3);
  addKeysFromDate(h, y, 4, 4);
  addKeysFromDate(h, y, 4, 5);
  addKeysFromDate(h, y, 6, getNthWeekdayInMonth(y, 6, 1, 3));
  addKeysFromDate(h, y, 7, 11);
  addKeysFromDate(h, y, 8, getNthWeekdayInMonth(y, 8, 1, 3));
  const au = SHUUBUN_DAY[y];
  if (au) addKeysFromDate(h, y, 8, au);
  addKeysFromDate(h, y, 9, getNthWeekdayInMonth(y, 9, 1, 2));
  addKeysFromDate(h, y, 10, 3);
  addKeysFromDate(h, y, 10, 23);
  for (const k of extraKeys) {
    if (k && String(k).slice(0, 4) === String(y)) h.add(String(k).trim());
  }
  h = applySubstituteHolidays(h);
  if (includeSandwich) h = applySandwichNationalHolidays(h, y);
  return h;
}

function getJapanHolidayKeysForYear(
  y: number,
  extraKeys: string[],
  includeSandwich: boolean,
): string[] {
  if (y < 2010 || y > 2050) return [...extraKeys];
  return Array.from(buildJapanHolidayYmdSet(y, extraKeys, includeSandwich));
}

function rowToApiItem(row: CalendarMonthRow): CalendarMonthApiItem {
  const line1 = displayNameLine1OnChipWithReport(row);
  const line2 = displayNameLine2OnChip(row);
  const memo = row.memo?.replace(/\r\n/g, "\n").trim() ?? "";
  return {
    line1,
    line2,
    memo,
    reportKankoComplete: row.reportKankoComplete,
    showKankoCheck: row.reportKankoComplete && row.category === "list",
    postponedBadge: rowShowsPostponedPrefix(row),
    segmentShort: shortScheduleSegmentLabel(row.segmentLabel),
    housingShort: shortHousingStatusLabel(row.housingStatusKey),
    category: row.category,
    contractorKey: contractorKeyFromRow(row),
    recordId: row.recordId != null ? String(row.recordId) : null,
    accessEditUrl: row.accessEditUrl || "",
    pinpointAddress: row.pinpointAddress ?? "",
    normalAddress: row.normalAddress ?? "",
    attachments: row.attachments?.length ? row.attachments : undefined,
    constructionHandlerName: row.constructionHandlerName?.trim() || undefined,
  };
}

export type BuildCalendarPayloadOptions = {
  extraHolidayKeys?: string[];
  includeSandwichNationalHoliday?: boolean;
  attachmentFieldId?: string | null;
  /** 画像以外の添付もメタデータに含める（ブリッジカレンダー向け） */
  attachmentIncludeAllFiles?: boolean;
  /** フィールド推定の上書き（コミュニケーションブリッジ等） */
  constructionFieldIdsOverride?: ConstructionFieldIds;
  /** startDate 以外に試す日付列（ブリッジカレンダー等） */
  startDateFieldCandidates?: string[];
};

export function buildCalendarPayload(
  viewYear: number,
  viewMonth1To12: number,
  constructionRecords: AtPocketRecordRow[],
  reportRecords: AtPocketRecordRow[] | null,
  constructionFields: AtPocketFieldRow[],
  reportFields: AtPocketFieldRow[] | null,
  opts?: BuildCalendarPayloadOptions,
): CalendarApiPayload {
  const viewMonth0 = viewMonth1To12 - 1;
  const fids =
    opts?.constructionFieldIdsOverride ??
    resolveConstructionFieldIds(constructionFields);
  const mapAddressIds = resolveConstructionMapAddressFieldIds(
    constructionFields,
  );
  const attachmentFieldId = opts?.attachmentFieldId?.trim() || null;
  const attachmentIncludeAllFiles = opts?.attachmentIncludeAllFiles === true;
  const startDateFieldCandidates = opts?.startDateFieldCandidates ?? [];

  const events: CalendarEventInternal[] = [];
  for (const rec of constructionRecords) {
    const ev = recordToEvent(
      rec,
      fids,
      mapAddressIds,
      attachmentFieldId,
      attachmentIncludeAllFiles,
      startDateFieldCandidates,
    );
    if (ev) events.push(ev);
  }

  let tmap: Map<string, unknown[]> | null = null;
  if (reportRecords && reportFields) {
    const rf = resolveReportFieldIds(reportFields);
    if (rf.tNumber && rf.reportContent) {
      tmap = buildTNumberToReportContentMap(reportRecords, rf);
    }
  }
  for (const ev of events) {
    attachReportContentFromTNumberMap(ev, tmap);
  }

  const rows = eventsForDisplayMonth(viewYear, viewMonth0, events);
  const grouped = groupByDayKey(rows);

  const extra = opts?.extraHolidayKeys ?? [];
  const sandwich = opts?.includeSandwichNationalHoliday ?? false;
  const holidayKeys = getJapanHolidayKeysForYear(viewYear, extra, sandwich);

  const byDay: Record<string, CalendarMonthApiItem[]> = {};
  for (const [k, list] of Object.entries(grouped)) {
    byDay[k] = list.map(rowToApiItem);
  }

  return {
    year: viewYear,
    month: viewMonth1To12,
    holidayKeys,
    byDay,
  };
}

function housingShortLabel(housingStatusKey: string): string {
  if (
    housingStatusKey === "新築案件" ||
    housingStatusKey === "既築案件" ||
    housingStatusKey === "トラーチ倶楽部案件" ||
    housingStatusKey === "産業用案件"
  ) {
    return housingStatusKey.replace(/案件$/, "");
  }
  return "";
}

function dateLabelFromDayKey(dayKey: string): string {
  const m = dayKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return dayKey;
  return `${Number(m[2])}/${Number(m[3])}`;
}

/** イベントから本日以降の工事日（区分付き）を収集 */
function upcomingWorkDaysFromEvent(
  ev: CalendarEventInternal,
  todayYmd: string,
): Array<{ dayKey: string; segmentLabel: string }> {
  const out: Array<{ dayKey: string; segmentLabel: string }> = [];
  const seen = new Set<string>();

  const push = (d: Date, segmentLabel: string) => {
    const key = ymdKey(startOfDay(d));
    if (key < todayYmd) return;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ dayKey: key, segmentLabel });
  };

  if (ev.calendarSegments && ev.calendarSegments.length > 0) {
    for (const seg of ev.calendarSegments) {
      push(seg.date, seg.label);
    }
  } else {
    const s0 = startOfDay(ev.start);
    let e0 = ev.end ? startOfDay(ev.end) : s0;
    if (e0.getTime() < s0.getTime()) e0 = s0;
    for (
      let d = new Date(s0.getTime());
      d.getTime() <= e0.getTime();
      d = addDays(d, 1)
    ) {
      push(d, "");
    }
  }

  if (ev.zankoCalendarSegment) {
    push(ev.zankoCalendarSegment.date, ev.zankoCalendarSegment.label);
  }

  out.sort((a, b) => a.dayKey.localeCompare(b.dayKey));
  return out;
}

/**
 * 工事対応者が自分の案件のうち、本日以降に工事日が残るものを一覧化。
 * 1レコード1件（直近の工事日を表示）。todayYmd は JST の YYYY-MM-DD。
 */
export function buildConstructionHandlerHomeCases(
  constructionRecords: AtPocketRecordRow[],
  constructionFields: AtPocketFieldRow[],
  handlerStaffName: string,
  todayYmd: string,
): ConstructionHandlerHomeCase[] {
  const want = normApClStaffName(handlerStaffName);
  if (!want) return [];
  const today = todayYmd.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return [];

  const fids = resolveConstructionFieldIds(constructionFields);
  const mapAddressIds = resolveConstructionMapAddressFieldIds(constructionFields);

  const byRecord = new Map<string, ConstructionHandlerHomeCase>();

  for (const rec of constructionRecords) {
    const ev = recordToEvent(rec, fids, mapAddressIds);
    if (!ev || ev.category !== "list") continue;
    if (normApClStaffName(ev.constructionHandlerName) !== want) continue;

    const upcoming = upcomingWorkDaysFromEvent(ev, today);
    if (upcoming.length === 0) continue;

    const recordId =
      ev.recordId != null ? String(ev.recordId).trim() : "";
    if (!recordId) continue;

    const next = upcoming[0]!;
    const item: ConstructionHandlerHomeCase = {
      recordId,
      customerName: ev.title.trim() || "（無名）",
      nextDayKey: next.dayKey,
      nextDateLabel: dateLabelFromDayKey(next.dayKey),
      segmentLabel: next.segmentLabel,
      housingShort: housingShortLabel(ev.housingStatusKey),
      contractorName: ev.contractorNameForColor.trim(),
      pinpointAddress: ev.pinpointAddress,
      normalAddress: ev.normalAddress,
      accessEditUrl: ev.accessEditUrl,
      upcomingDayCount: upcoming.length,
    };

    const prev = byRecord.get(recordId);
    if (!prev || item.nextDayKey < prev.nextDayKey) {
      byRecord.set(recordId, item);
    }
  }

  return [...byRecord.values()].sort((a, b) => {
    const byDay = a.nextDayKey.localeCompare(b.nextDayKey);
    if (byDay !== 0) return byDay;
    return a.customerName.localeCompare(b.customerName, "ja");
  });
}

export type { CalendarRecordMonthPatch } from "@/lib/calendar-api-types";

/** 表示中の月向けに1件の工事レコードをカレンダー行へ変換（保存直後の即時反映用） */
export function buildCalendarMonthPatchForConstructionRecord(
  viewYear: number,
  viewMonth1To12: number,
  rec: AtPocketRecordRow,
  constructionFields: AtPocketFieldRow[],
  reportRecords: AtPocketRecordRow[] | null,
  reportFields: AtPocketFieldRow[] | null,
): CalendarRecordMonthPatch | null {
  const fids = resolveConstructionFieldIds(constructionFields);
  const mapAddressIds = resolveConstructionMapAddressFieldIds(
    constructionFields,
  );
  const ev = recordToEvent(rec, fids, mapAddressIds);
  if (!ev) return null;

  const recordId =
    rec.recordId != null
      ? String(rec.recordId)
      : rec.uniqueId != null
        ? String(rec.uniqueId)
        : "";
  if (!recordId) return null;

  let tmap: Map<string, unknown[]> | null = null;
  if (reportRecords && reportFields) {
    const rf = resolveReportFieldIds(reportFields);
    if (rf.tNumber && rf.reportContent) {
      tmap = buildTNumberToReportContentMap(reportRecords, rf);
    }
  }
  attachReportContentFromTNumberMap(ev, tmap);

  const rows = eventsForDisplayMonth(viewYear, viewMonth1To12 - 1, [ev]);
  const grouped = groupByDayKey(rows);
  const byDay: Record<string, CalendarMonthApiItem[]> = {};
  const dayKeys: string[] = [];
  for (const [k, list] of Object.entries(grouped)) {
    dayKeys.push(k);
    byDay[k] = list.map(rowToApiItem);
  }
  if (dayKeys.length === 0) return null;

  return { recordId, dayKeys, byDay };
}
