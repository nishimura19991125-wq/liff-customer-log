import "server-only";

import {
  apiKeyForSalesDashboardApoPocket,
  apiKeyForSalesDashboardApoWrite,
  fetchAppFields,
  fetchRecordById,
  salesDashboardApoWriteConfigured,
  updateRecord,
} from "@/lib/atpocket";
import { atPocketRecordIdFromRow } from "@/lib/atpocket-record-id";
import {
  coerceCustomerInfoDisplayString,
  readCustomerInfoFieldValue,
  readCustomerInfoImportKeyFromRecord,
} from "@/lib/customer-info-record";
import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";
import { jstDateKey } from "@/lib/missing-documents-cache";
import {
  collectMapAddressFieldsCsv,
  readMapAddressesFromRecord,
  resolveApoMapAddressFieldIds,
  type MapAddressFieldIds,
} from "@/lib/map-address-fields";
import {
  meetingScheduleAllowedStatuses,
  meetingScheduleCloseTypeOptions,
  meetingScheduleEditableStatuses,
  meetingScheduleExcludedStatuses,
  meetingScheduleImportKeySourceFieldIds,
  meetingScheduleMeetingPlaceOptions,
  resolveMeetingScheduleFieldMap,
  resolveMeetingScheduleImportKeyFieldId,
  type MeetingScheduleFieldMap,
} from "@/lib/meeting-schedule-fields";
import {
  isMeetingScheduleFieldLocked,
  stripLockedMeetingScheduleFieldsFromPayload,
  MEETING_SCHEDULE_LOCKED_FIELD_LABELS,
} from "@/lib/meeting-schedule-locked-fields";
import {
  canTransitionMeetingScheduleNegotiationStatus,
  findMissingMeetingScheduleRequiredInput,
  isMeetingScheduleInputLocked,
  normalizeMeetingScheduleNegotiationStatus,
  MEETING_SCHEDULE_INPUT_FIELD_LABELS,
  MEETING_SCHEDULE_INPUT_REQUIRED_ERRORS,
  type MeetingScheduleInputFieldKey,
  type MeetingScheduleInputValues,
} from "@/lib/meeting-schedule-negotiation-status";
import { isWritableAtPocketField } from "@/lib/customer-info-form/pocket-writable-fields";
import type { MeetingScheduleScheduledUpdateInput } from "@/lib/meeting-schedule-scheduled-update";
import { validateMeetingScheduleScheduledUpdate } from "@/lib/meeting-schedule-scheduled-update";
import type { MeetingScheduleStatusUpdateInput } from "@/lib/meeting-schedule-status-update";
import { validateMeetingScheduleStatusUpdate } from "@/lib/meeting-schedule-status-update";
import {
  isMeetingScheduleSetCreatedStatus,
  MEETING_SCHEDULE_ESTIMATE_REQUESTED_STATUS,
} from "@/lib/meeting-schedule-shared";
import {
  fetchMeetingScheduleRecordsCached,
  invalidateMeetingScheduleRecordsCache,
} from "@/lib/meeting-schedule-records-cache";
import { salesDashboardApoAppId } from "@/lib/sales-dashboard-fields";
import { salesDashboardApoListAuths } from "@/lib/sales-dashboard-list-fetch";
import type {
  MeetingScheduleItem,
  MeetingSchedulePayload,
} from "@/lib/meeting-schedule-types";

export type { MeetingScheduleItem, MeetingSchedulePayload } from "@/lib/meeting-schedule-types";

function normalizeStatus(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .replace(/\(/g, "（")
    .replace(/\)/g, "）")
    .trim();
}

function matchesMeetingScheduleStatus(statusRaw: string): boolean {
  const status = normalizeStatus(statusRaw);
  if (!status) return meetingScheduleAllowedStatuses().length === 0;

  for (const ex of meetingScheduleExcludedStatuses()) {
    if (status.includes(normalizeStatus(ex))) return false;
  }

  const allowed = meetingScheduleAllowedStatuses();
  if (!allowed.length) return true;
  return allowed.some((a) => status.includes(normalizeStatus(a)));
}

export function apoTypeDisplayLabel(typeVal: string): string {
  const tv = typeVal.trim();
  if (!tv) return "";
  if (tv.includes("ソーラーパートナーズ")) return "SP案件";
  if (tv.includes("ダイレクト")) return "DC案件";
  return tv;
}

export function formatCityLabel(raw: string): string {
  const s = raw.replace(/\s+/g, " ").trim();
  if (!s) return "";
  const cityMatch = /(.+?[市区町村郡])/.exec(s);
  if (cityMatch?.[1]) return cityMatch[1]!.trim();
  return s.length > 24 ? `${s.slice(0, 24)}…` : s;
}

export function parseScheduledParts(raw: unknown): { ymd: string; time: string } | null {
  const s = coerceCustomerInfoDisplayString(raw);
  if (!s) return null;

  const normalized = s.replace(/\//g, "-").replace("T", " ");
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}:\d{2}(?::\d{2})?))?/.exec(
    normalized,
  );
  if (iso) {
    const ymd = `${iso[1]}-${String(iso[2]).padStart(2, "0")}-${String(iso[3]).padStart(2, "0")}`;
    const time = iso[4]?.slice(0, 5) ?? "";
    return { ymd, time };
  }

  const jp = /^(\d{4})年(\d{1,2})月(\d{1,2})日(?:[ T　]?(\d{1,2}:\d{2}))?/.exec(s);
  if (jp) {
    const ymd = `${jp[1]}-${String(jp[2]).padStart(2, "0")}-${String(jp[3]).padStart(2, "0")}`;
    return { ymd, time: jp[4]?.slice(0, 5) ?? "" };
  }

  const digits = s.replace(/[^\d]/g, "");
  if (digits.length >= 8) {
    const ymd = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
    const hm = /(\d{1,2}:\d{2})/.exec(s);
    return { ymd, time: hm?.[1]?.slice(0, 5) ?? "" };
  }

  return null;
}

function parseTimeToMinutes(time: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return 24 * 60;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function formatMeetingDateLabel(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const d = new Date(`${ymd}T12:00:00+09:00`);
  const w = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    weekday: "short",
  }).format(d);
  return `${Number(m[2])}月${Number(m[3])}日（${w}）`;
}

function resolveTargetYmd(dateParam: string | null | undefined): string {
  const raw = dateParam?.trim();
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return jstDateKey();
}

export function recordMatchesStaff(
  recObj: Record<string, unknown>,
  fieldMap: MeetingScheduleFieldMap,
  boundStaffName: string,
): boolean {
  const bound = normApClStaffName(boundStaffName);
  const cl = normApClStaffName(
    readCustomerInfoFieldValue(recObj, fieldMap.clPerson),
  );
  if (cl && cl === bound) return true;
  if (fieldMap.salesperson) {
    const ap = normApClStaffName(
      readCustomerInfoFieldValue(recObj, fieldMap.salesperson),
    );
    if (ap && ap === bound) return true;
  }
  return false;
}

function isActiveProgressStatus(statusRaw: string): boolean {
  const status = normalizeStatus(statusRaw);
  if (!status) return false;
  for (const ex of meetingScheduleExcludedStatuses()) {
    if (status.includes(normalizeStatus(ex))) return false;
  }
  return status.includes("返待ち") || status.includes("再商談");
}

function recordDateMatchesTarget(
  recObj: Record<string, unknown>,
  fieldMap: MeetingScheduleFieldMap,
  targetYmd: string,
  estimateStatusStr: string,
): boolean {
  const scheduled = parseScheduledParts(
    readCustomerInfoFieldValue(recObj, fieldMap.scheduledDate),
  );
  if (scheduled?.ymd === targetYmd) return true;

  if (fieldMap.meetingDate) {
    const meetingDate = parseScheduledParts(
      readCustomerInfoFieldValue(recObj, fieldMap.meetingDate),
    );
    if (meetingDate?.ymd === targetYmd) return true;
  }

  if (
    targetYmd === jstDateKey() &&
    estimateStatusStr &&
    isActiveProgressStatus(estimateStatusStr)
  ) {
    return true;
  }

  return false;
}

function resolveRecordScheduleYmd(
  recObj: Record<string, unknown>,
  fieldMap: MeetingScheduleFieldMap,
): { ymd: string; time: string } {
  const scheduled = parseScheduledParts(
    readCustomerInfoFieldValue(recObj, fieldMap.scheduledDate),
  );
  if (scheduled?.ymd) return scheduled;

  if (fieldMap.meetingDate) {
    const meetingDate = parseScheduledParts(
      readCustomerInfoFieldValue(recObj, fieldMap.meetingDate),
    );
    if (meetingDate?.ymd) return meetingDate;
  }

  return { ymd: "", time: "" };
}

/**
 * 商談・資料送付予定日時の日付だけ。
 *
 * resolveRecordScheduleYmd は未設定のとき初回商談実施日で埋めるが、
 * ここは埋めない。出勤後アラートの日付判定が
 * 初回商談実施日で誤発火しないようにするため
 */
function resolveScheduledDateTimeYmd(
  recObj: Record<string, unknown>,
  fieldMap: MeetingScheduleFieldMap,
): string {
  const parsed = parseScheduledParts(
    readCustomerInfoFieldValue(recObj, fieldMap.scheduledDate),
  );
  return parsed?.ymd ?? "";
}

function scheduleDateLabel(ymd: string): string {
  if (!ymd) return "日付未定";
  return formatMeetingDateLabel(ymd);
}

function sortMeetingItems(items: MeetingScheduleItem[]): void {
  items.sort((a, b) => {
    const dateA = a.scheduledYmd || "9999-12-31";
    const dateB = b.scheduledYmd || "9999-12-31";
    if (dateA !== dateB) return dateA.localeCompare(dateB);
    return (
      a.sortMinutes - b.sortMinutes ||
      a.customerName.localeCompare(b.customerName, "ja")
    );
  });
}

function meetingScheduleMetaExtras(): Pick<
  MeetingSchedulePayload,
  | "statusOptions"
  | "statusEditable"
  | "scheduleEditable"
  | "closeTypeOptions"
  | "meetingPlaceOptions"
> {
  const editable = salesDashboardApoWriteConfigured();
  return {
    statusOptions: meetingScheduleEditableStatuses(),
    statusEditable: editable,
    scheduleEditable: editable,
    closeTypeOptions: meetingScheduleCloseTypeOptions(),
    meetingPlaceOptions: meetingScheduleMeetingPlaceOptions(),
  };
}

function resolveFirstMeetingDateYmd(
  recObj: Record<string, unknown>,
  fieldMap: MeetingScheduleFieldMap,
): string {
  if (!fieldMap.meetingDate) return "";
  const parsed = parseScheduledParts(
    readCustomerInfoFieldValue(recObj, fieldMap.meetingDate),
  );
  return parsed?.ymd ?? "";
}

function resolveResponseDateYmd(
  recObj: Record<string, unknown>,
  fieldMap: MeetingScheduleFieldMap,
): string {
  if (!fieldMap.responseDate) return "";
  const parsed = parseScheduledParts(
    readCustomerInfoFieldValue(recObj, fieldMap.responseDate),
  );
  return parsed?.ymd ?? "";
}

function responseDateLabel(ymd: string): string {
  if (!ymd) return "未設定";
  return formatMeetingDateLabel(ymd);
}

function resolveRecordScheduledParts(
  recObj: Record<string, unknown>,
  fieldMap: MeetingScheduleFieldMap,
): { ymd: string; time: string } {
  const schedule = resolveRecordScheduleYmd(recObj, fieldMap);
  const timeFromField = fieldMap.meetingTime
    ? coerceCustomerInfoDisplayString(
        readCustomerInfoFieldValue(recObj, fieldMap.meetingTime),
      )
    : "";
  const meetingTimeRaw = (timeFromField || schedule.time || "").trim();
  const timeMatch = /(\d{1,2}:\d{2})/.exec(meetingTimeRaw);
  return {
    ymd: schedule.ymd,
    time: timeMatch?.[1]?.slice(0, 5) ?? "",
  };
}

function hasMeetingScheduleDateChanged(
  existingYmd: string,
  nextYmd: string,
): boolean {
  return existingYmd !== nextYmd;
}

function normalizeEditableStatus(statusRaw: string): string | null {
  const status = normalizeStatus(statusRaw);
  if (!status) return null;
  const options = meetingScheduleEditableStatuses();
  const exact = options.find((o) => normalizeStatus(o) === status);
  if (exact) return exact;
  const partial = options.find((o) => status.includes(normalizeStatus(o)));
  return partial ?? null;
}

export function meetingScheduleWantedFieldCsv(
  fieldMap: MeetingScheduleFieldMap,
  mapAddressIds: MapAddressFieldIds,
): string {
  const ids = new Set<string>();
  for (const id of [
    fieldMap.clPerson,
    fieldMap.scheduledDate,
    fieldMap.salesperson,
    fieldMap.customerName,
    fieldMap.city,
    fieldMap.meetingTime,
    fieldMap.estimateStatus,
    fieldMap.apoType,
    fieldMap.meetingPlace,
    fieldMap.meetingDate,
    fieldMap.closeType,
    fieldMap.responseDate,
    fieldMap.negotiationStatus,
    // アポ情報一覧のバッジ表示にだけ使う。ここに足すことで全経路が
    // 同じ CSV を要求し続け、キャッシュキーが割れない（429 の再発防止）。
    // 列が見つからないときは null で、CSV も従来どおりになる
    fieldMap.giftCoupon,
    // アポ情報一覧の Dropbox リンクにだけ使う。ギフト券と同じ理由で
    // ここに足す（全経路が同じ CSV を要求し続ける）
    fieldMap.dropboxUrl,
    ...collectMapAddressFieldsCsv(mapAddressIds),
  ]) {
    if (id?.trim()) ids.add(id.trim());
  }
  return [...ids].join(",");
}

function buildMeetingItemFromRecord(
  recObj: Record<string, unknown>,
  fieldMap: MeetingScheduleFieldMap,
  recordId: string,
  mapAddressIds: MapAddressFieldIds,
): MeetingScheduleItem | null {
  const estimateStatus = fieldMap.estimateStatus
    ? coerceCustomerInfoDisplayString(
        readCustomerInfoFieldValue(recObj, fieldMap.estimateStatus),
      )
    : "";
  const estimateStatusStr = estimateStatus.trim();

  if (estimateStatusStr && !matchesMeetingScheduleStatus(estimateStatusStr)) {
    return null;
  }

  const schedule = resolveRecordScheduleYmd(recObj, fieldMap);
  const timeFromField = fieldMap.meetingTime
    ? coerceCustomerInfoDisplayString(
        readCustomerInfoFieldValue(recObj, fieldMap.meetingTime),
      )
    : "";
  const meetingTimeRaw = (timeFromField || schedule.time || "").trim();
  const timeMatch = /(\d{1,2}:\d{2})/.exec(meetingTimeRaw);
  const scheduledTime = timeMatch?.[1]?.slice(0, 5) ?? "";

  const customerName = fieldMap.customerName
    ? coerceCustomerInfoDisplayString(
        readCustomerInfoFieldValue(recObj, fieldMap.customerName),
      )
    : "";
  const cityRaw = fieldMap.city
    ? coerceCustomerInfoDisplayString(
        readCustomerInfoFieldValue(recObj, fieldMap.city),
      )
    : "";
  const apoType = fieldMap.apoType
    ? coerceCustomerInfoDisplayString(
        readCustomerInfoFieldValue(recObj, fieldMap.apoType),
      )
    : "";
  const meetingPlace = fieldMap.meetingPlace
    ? coerceCustomerInfoDisplayString(
        readCustomerInfoFieldValue(recObj, fieldMap.meetingPlace),
      )
    : "";
  const closeType = fieldMap.closeType
    ? coerceCustomerInfoDisplayString(
        readCustomerInfoFieldValue(recObj, fieldMap.closeType),
      )
    : "";
  const negotiationStatus = fieldMap.negotiationStatus
    ? coerceCustomerInfoDisplayString(
        readCustomerInfoFieldValue(recObj, fieldMap.negotiationStatus),
      )
    : "";
  const firstMeetingDateYmd = resolveFirstMeetingDateYmd(recObj, fieldMap);
  const responseDateYmd = resolveResponseDateYmd(recObj, fieldMap);
  const apPerson = fieldMap.salesperson
    ? normApClStaffName(
        readCustomerInfoFieldValue(recObj, fieldMap.salesperson),
      )
    : "";
  const clPerson = normApClStaffName(
    readCustomerInfoFieldValue(recObj, fieldMap.clPerson),
  );

  if (!customerName.trim()) return null;

  const { pinpointAddress, normalAddress } = readMapAddressesFromRecord(
    recObj,
    mapAddressIds,
  );

  return {
    recordId,
    customerName: customerName.trim(),
    city: formatCityLabel(cityRaw),
    meetingTime: scheduledTime || "—",
    scheduledTime,
    apoTypeLabel: apoTypeDisplayLabel(apoType),
    estimateStatus: estimateStatusStr,
    negotiationStatus: negotiationStatus.trim(),
    meetingPlace: meetingPlace.trim(),
    firstMeetingDateYmd,
    closeType: closeType.trim(),
    apPerson,
    clPerson,
    sortMinutes: timeMatch ? parseTimeToMinutes(timeMatch[1]!) : 24 * 60,
    scheduledYmd: schedule.ymd,
    // 初回商談実施日で埋めない、商談・資料送付予定日時そのものの日付
    scheduledDateTimeYmd: resolveScheduledDateTimeYmd(recObj, fieldMap),
    scheduledDateLabel: scheduleDateLabel(schedule.ymd),
    pinpointAddress,
    normalAddress,
    responseDateYmd,
    responseDateLabel: responseDateLabel(responseDateYmd),
  };
}

function buildMeetingItem(
  recObj: Record<string, unknown>,
  fieldMap: MeetingScheduleFieldMap,
  targetYmd: string,
  recordId: string,
  mapAddressIds: MapAddressFieldIds,
): MeetingScheduleItem | null {
  const estimateStatus = fieldMap.estimateStatus
    ? coerceCustomerInfoDisplayString(
        readCustomerInfoFieldValue(recObj, fieldMap.estimateStatus),
      )
    : "";
  const estimateStatusStr = estimateStatus.trim();

  if (!recordDateMatchesTarget(recObj, fieldMap, targetYmd, estimateStatusStr)) {
    return null;
  }

  return buildMeetingItemFromRecord(
    recObj,
    fieldMap,
    recordId,
    mapAddressIds,
  );
}

function formatMeetingScheduleStatusUpdateError(msg: string): string {
  if (msg.includes("アポ通番") && msg.includes("取込設定")) {
    return (
      "@pocket: 取込キー「アポ通番(仮)」を認識できませんでした。アポ取得情報連携の取込設定に「アポ通番(仮)」がキー項目として含まれているか、MEETING_SCHEDULE_IMPORT_KEY_FIELD_ID が管理画面の列識別名と一致しているか確認してください。"
    );
  }
  return msg;
}

export async function updateMeetingScheduleStatusForStaff(
  boundStaffName: string,
  recordIdRaw: string,
  updateInput: MeetingScheduleStatusUpdateInput,
): Promise<
  | { ok: true; estimateStatus: string }
  | { ok: false; status: number; error: string }
> {
  const recordId = recordIdRaw.trim();
  const validated = validateMeetingScheduleStatusUpdate(updateInput);
  if (!validated.ok) {
    return { ok: false, status: 400, error: validated.error };
  }
  const {
    status: nextStatus,
    meetingDate,
    closeType,
    meetingPlace,
    responseDate,
    negotiationStatus,
  } = validated.normalized;
  if (!recordId) {
    return { ok: false, status: 400, error: "recordId が必要です" };
  }
  /**
   * normalizeEditableStatus は「LIFF から変更してよいステータスか」の門番。
   * 見積ステータスが編集不可のあいだは、そもそも @pocket へ書き込まないので
   * 門番の意味が無い。ここで 400 を返すと、同じルートに同居している付随項目
   * （初回商談実施日・片クロor両クロ・商談場所・返待ち回答日）の保存まで
   * 巻き込んで止めてしまうため、素通しにする。
   */
  const estimateStatusLocked = isMeetingScheduleFieldLocked("estimateStatus");
  const normalizedStatus = estimateStatusLocked
    ? nextStatus
    : normalizeEditableStatus(nextStatus);
  if (!normalizedStatus) {
    return { ok: false, status: 400, error: "変更できないステータスです" };
  }
  if (!salesDashboardApoWriteConfigured()) {
    return {
      ok: false,
      status: 503,
      error:
        "見積ステータスの更新用 API キー（SALES_DASHBOARD_APO_ATPOCKET_API_KEY_2）が未設定です",
    };
  }

  const apoAppId = salesDashboardApoAppId();
  if (!apoAppId) {
    return {
      ok: false,
      status: 503,
      error: "SALES_DASHBOARD_APO_APP_ID が未設定です",
    };
  }

  try {
    const readAuth = { apiKey: apiKeyForSalesDashboardApoPocket() };
    const writeAuth = { apiKey: apiKeyForSalesDashboardApoWrite() };
    const apoFields = await fetchAppFields(apoAppId, readAuth, {
      operation: "meeting-schedule:status-fields",
      appEnv: "SALES_DASHBOARD_APO_APP_ID",
    });
    const fieldMap = resolveMeetingScheduleFieldMap(apoFields);
    if (!fieldMap?.estimateStatus) {
      return {
        ok: false,
        status: 503,
        error: "見積ステータス列を特定できません",
      };
    }

    const importKeyFieldId = resolveMeetingScheduleImportKeyFieldId(apoFields);
    if (!importKeyFieldId) {
      return {
        ok: false,
        status: 503,
        error:
          "取込キー列（アポ通番(仮)）を特定できません。MEETING_SCHEDULE_IMPORT_KEY_FIELD_ID を設定してください。",
      };
    }

    const importKeySources = meetingScheduleImportKeySourceFieldIds();
    const wanted = [
      fieldMap.clPerson,
      fieldMap.salesperson,
      fieldMap.estimateStatus,
      fieldMap.meetingDate,
      fieldMap.closeType,
      fieldMap.meetingPlace,
      fieldMap.responseDate,
      // 商談ステータスは現在値との突き合わせに使う（変更時のみ書き込む）
      fieldMap.negotiationStatus,
      importKeyFieldId,
      ...importKeySources,
    ]
      .filter(Boolean)
      .join(",");

    let recRow = await fetchRecordById(apoAppId, recordId, readAuth, wanted);
    if (!recRow?.record) {
      recRow = await fetchRecordById(apoAppId, recordId, readAuth);
    }
    if (!recRow?.record || typeof recRow.record !== "object") {
      return { ok: false, status: 404, error: "レコードが見つかりません" };
    }
    const recObj = recRow.record as Record<string, unknown>;
    if (!recordMatchesStaff(recObj, fieldMap, boundStaffName)) {
      return {
        ok: false,
        status: 403,
        error: "この案件を更新する権限がありません",
      };
    }

    const importKeyValue = readCustomerInfoImportKeyFromRecord(
      recObj,
      importKeyFieldId,
      importKeySources,
    );
    if (!importKeyValue) {
      return {
        ok: false,
        status: 400,
        error:
          "この案件のアポ通番(仮)（取込キー）を取得できませんでした。@pocket に値が入っているか、MEETING_SCHEDULE_IMPORT_KEY_FIELD_ID を確認してください。",
      };
    }

    const payload: Record<string, unknown> = {
      [importKeyFieldId]: importKeyValue,
      [fieldMap.estimateStatus]: normalizedStatus,
    };

    const currentNegotiationStatusForInput = fieldMap.negotiationStatus
      ? coerceCustomerInfoDisplayString(
          readCustomerInfoFieldValue(recObj, fieldMap.negotiationStatus),
        ).trim()
      : "";

    /** @pocket 側の現在値。日付は YMD に揃えてから突き合わせる */
    const currentInputs: MeetingScheduleInputValues = {
      meetingDate: resolveFirstMeetingDateYmd(recObj, fieldMap),
      closeType: fieldMap.closeType
        ? coerceCustomerInfoDisplayString(
            readCustomerInfoFieldValue(recObj, fieldMap.closeType),
          ).trim()
        : "",
      meetingPlace: fieldMap.meetingPlace
        ? coerceCustomerInfoDisplayString(
            readCustomerInfoFieldValue(recObj, fieldMap.meetingPlace),
          ).trim()
        : "",
      responseDate: resolveResponseDateYmd(recObj, fieldMap),
    };

    const incomingInputs: MeetingScheduleInputValues = {
      meetingDate: (meetingDate ?? "").trim(),
      closeType: (closeType ?? "").trim(),
      meetingPlace: (meetingPlace ?? "").trim(),
      responseDate: (responseDate ?? "").trim(),
    };

    /**
     * 必須の検証。基準は商談ステータス。
     *
     * 「@pocket の既存値 または 今回の新規入力」で埋まっているかを見るため、
     * レコードを読んだこの場所で行う。触っていない空欄では止めない
     * （対象項目が空のまま残っている既存案件を編集不能にしないため）。
     */
    const missingRequired = findMissingMeetingScheduleRequiredInput({
      server: currentInputs,
      draft: incomingInputs,
      serverNegotiationStatus: currentNegotiationStatusForInput,
      // 商談ステータスが送られてこない経路（返待ちの入力枠だけ出ている画面など）
      // では現在値を使う。空を「変更あり」と誤判定しないため
      draftNegotiationStatus:
        (negotiationStatus ?? "").trim() || currentNegotiationStatusForInput,
    });
    if (missingRequired) {
      return {
        ok: false,
        status: 400,
        error: MEETING_SCHEDULE_INPUT_REQUIRED_ERRORS[missingRequired],
      };
    }

    /**
     * 一度入力した項目は変更できない。判定は項目ごとに個別で、
     * 正は @pocket 側の現在値。画面から入力欄を消しても API を直接
     * 呼べば書けてしまうため、ここで確実に塞ぐ。
     *
     * 現在値と同じ値が送られてくるのは通常の保存（画面は入力済みの項目も
     * そのまま送り返す）なので、拒否せず黙って書き込み対象から外す。
     */
    const inputFieldIds: Record<MeetingScheduleInputFieldKey, string | null> = {
      meetingDate: fieldMap.meetingDate,
      closeType: fieldMap.closeType,
      meetingPlace: fieldMap.meetingPlace,
      responseDate: fieldMap.responseDate,
    };

    for (const key of [
      "meetingDate",
      "closeType",
      "meetingPlace",
      "responseDate",
    ] as const) {
      const incoming = incomingInputs[key];
      if (!incoming) continue;

      const current = currentInputs[key];
      if (incoming === current) continue;

      if (isMeetingScheduleInputLocked(current)) {
        return {
          ok: false,
          status: 400,
          error: `${MEETING_SCHEDULE_INPUT_FIELD_LABELS[key]}は入力済みのため変更できません`,
        };
      }

      const fieldId = inputFieldIds[key];
      if (!fieldId) {
        return {
          ok: false,
          status: 503,
          error: `${MEETING_SCHEDULE_INPUT_FIELD_LABELS[key]}列を特定できません`,
        };
      }
      payload[fieldId] = incoming;
    }

    /**
     * 商談ステータス。**現在値から変わったときだけ**検証し、書き込む。
     *
     * これが付随項目（初回商談実施日・片クロor両クロ・商談場所・
     * 返待ち回答日）の保存を巻き込まないための要。
     * 変更不可の9件（遷移先が空）や遷移表に無い値の案件では、画面は
     * 選択欄を出さず現在値をそのまま送り返してくる。この if を通らないので
     * 検証そのものが走らず、付随項目だけの保存は素通りする。
     */
    const currentNegotiationStatus = currentNegotiationStatusForInput;

    if (negotiationStatus && negotiationStatus !== currentNegotiationStatus) {
      if (!fieldMap.negotiationStatus) {
        return {
          ok: false,
          status: 503,
          error: "商談ステータスを変更できない状態です。管理者にご連絡ください",
        };
      }

      /**
       * 遷移ルールの検証。現在値から到達できない値は受け付けない。
       *
       * ここまで来るのは「実際に商談ステータスを変更しようとしている」
       * 場合だけ。画面は遷移先しか出さないので、通常の操作では起きない。
       * 古いキャッシュの画面や API の直叩きが該当する
       */
      const nextNegotiationStatus =
        normalizeMeetingScheduleNegotiationStatus(negotiationStatus);
      if (
        !nextNegotiationStatus ||
        !canTransitionMeetingScheduleNegotiationStatus(
          currentNegotiationStatus,
          nextNegotiationStatus,
        )
      ) {
        return {
          ok: false,
          status: 400,
          error: "この商談ステータスには変更できません",
        };
      }

      /**
       * @pocket 側が更新を受け付けない列タイプ（計算列・関連レコードなど）
       * だと、PUT がそのまま失敗して 502 になる。手元に列定義があるので
       * 事前に見て、利用者に伝わる文言で止める。
       * エラー文には列名・列ID・アプリ名・環境変数名を出さない
       */
      const negotiationField = apoFields.find(
        (f) => f.uniqueId?.trim() === fieldMap.negotiationStatus,
      );
      if (negotiationField && !isWritableAtPocketField(negotiationField)) {
        return {
          ok: false,
          status: 503,
          error: "商談ステータスはこの画面から変更できない設定になっています",
        };
      }

      payload[fieldMap.negotiationStatus] = nextNegotiationStatus;
    }

    /**
     * 編集不可な項目を @pocket へ送る直前に payload から落とす。
     * 画面から欄を消しても、古いキャッシュの画面や API の直叩きで
     * 書き込めてしまうため、ここで確実に塞ぐ。
     * お客様情報の decideApClStaffPut と同じ考え方。
     *
     * なお、どの付随項目を必須とするかは
     * validateMeetingScheduleStatusUpdate が**クライアントの申告した
     * status** を基準に判定している。見積ステータスを書き込まなくなった今、
     * 本来はレコードの実ステータス（下の currentEstimateStatus）を基準に
     * すべきだが、今回のスコープ外。実ステータス基準への変更は別タスク。
     */
    const droppedFields = stripLockedMeetingScheduleFieldsFromPayload(payload, {
      estimateStatus: fieldMap.estimateStatus,
    });
    if (droppedFields.length > 0) {
      console.info(
        `[meeting-schedule:status] ${droppedFields
          .map((f) => MEETING_SCHEDULE_LOCKED_FIELD_LABELS[f])
          .join("・")}は送信しません（LIFF から変更不可）`,
      );
    }

    // 見積ステータスは書き換えていないので、レコードの現在値をそのまま返す
    const currentEstimateStatus = coerceCustomerInfoDisplayString(
      readCustomerInfoFieldValue(recObj, fieldMap.estimateStatus),
    ).trim();

    // 落とした結果、取込キーしか残らなかった＝書くものが無い。
    // 古い画面からステータスだけ送られてきた場合がこれにあたる。
    // 無駄な PUT を @pocket に投げず、成功として返す
    if (Object.keys(payload).length <= 1) {
      return { ok: true, estimateStatus: currentEstimateStatus };
    }

    await updateRecord(apoAppId, recordId, payload, writeAuth);
    // 一覧のキャッシュを捨てる。保存直後に古い値を出さないため
    invalidateMeetingScheduleRecordsCache();

    return {
      ok: true,
      estimateStatus: estimateStatusLocked
        ? currentEstimateStatus
        : normalizedStatus,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[meeting-schedule:status]", e);
    return {
      ok: false,
      status: 502,
      error: formatMeetingScheduleStatusUpdateError(
        msg || "見積ステータスの更新に失敗しました",
      ),
    };
  }
}

function scheduledDateTimeValueForPocket(
  ymd: string,
  time: string,
  existingRaw: unknown,
): string {
  const existing = coerceCustomerInfoDisplayString(existingRaw);
  const [y, mo, d] = ymd.split("-");
  const hm = time || "00:00";
  if (existing.includes("/")) {
    const slashDate = `${y}/${mo}/${d}`;
    return time ? `${slashDate} ${hm}` : slashDate;
  }
  return time ? `${ymd} ${hm}:00` : ymd;
}

export async function updateMeetingScheduleScheduledForStaff(
  boundStaffName: string,
  recordIdRaw: string,
  updateInput: MeetingScheduleScheduledUpdateInput,
): Promise<
  | {
      ok: true;
      scheduledYmd: string;
      scheduledTime: string;
      estimateStatus?: string;
    }
  | { ok: false; status: number; error: string }
> {
  const recordId = recordIdRaw.trim();
  const validated = validateMeetingScheduleScheduledUpdate(updateInput);
  if (!validated.ok) {
    return { ok: false, status: 400, error: validated.error };
  }
  const { scheduledYmd, scheduledTime } = validated.normalized;
  if (!recordId) {
    return { ok: false, status: 400, error: "recordId が必要です" };
  }
  if (!salesDashboardApoWriteConfigured()) {
    return {
      ok: false,
      status: 503,
      error:
        "商談・資料送付予定日時の更新用 API キー（SALES_DASHBOARD_APO_ATPOCKET_API_KEY_2）が未設定です",
    };
  }

  const apoAppId = salesDashboardApoAppId();
  if (!apoAppId) {
    return {
      ok: false,
      status: 503,
      error: "SALES_DASHBOARD_APO_APP_ID が未設定です",
    };
  }

  try {
    const readAuth = { apiKey: apiKeyForSalesDashboardApoPocket() };
    const writeAuth = { apiKey: apiKeyForSalesDashboardApoWrite() };
    const apoFields = await fetchAppFields(apoAppId, readAuth, {
      operation: "meeting-schedule:schedule-fields",
      appEnv: "SALES_DASHBOARD_APO_APP_ID",
    });
    const fieldMap = resolveMeetingScheduleFieldMap(apoFields);
    if (!fieldMap?.scheduledDate) {
      return {
        ok: false,
        status: 503,
        error: "商談・資料送付予定日時列を特定できません",
      };
    }

    const importKeyFieldId = resolveMeetingScheduleImportKeyFieldId(apoFields);
    if (!importKeyFieldId) {
      return {
        ok: false,
        status: 503,
        error:
          "取込キー列（アポ通番(仮)）を特定できません。MEETING_SCHEDULE_IMPORT_KEY_FIELD_ID を設定してください。",
      };
    }

    const importKeySources = meetingScheduleImportKeySourceFieldIds();
    const wanted = [
      fieldMap.clPerson,
      fieldMap.salesperson,
      fieldMap.scheduledDate,
      fieldMap.meetingTime,
      fieldMap.estimateStatus,
      importKeyFieldId,
      ...importKeySources,
    ]
      .filter(Boolean)
      .join(",");

    let recRow = await fetchRecordById(apoAppId, recordId, readAuth, wanted);
    if (!recRow?.record) {
      recRow = await fetchRecordById(apoAppId, recordId, readAuth);
    }
    if (!recRow?.record || typeof recRow.record !== "object") {
      return { ok: false, status: 404, error: "レコードが見つかりません" };
    }
    const recObj = recRow.record as Record<string, unknown>;
    if (!recordMatchesStaff(recObj, fieldMap, boundStaffName)) {
      return {
        ok: false,
        status: 403,
        error: "この案件を更新する権限がありません",
      };
    }

    const importKeyValue = readCustomerInfoImportKeyFromRecord(
      recObj,
      importKeyFieldId,
      importKeySources,
    );
    if (!importKeyValue) {
      return {
        ok: false,
        status: 400,
        error:
          "この案件のアポ通番(仮)（取込キー）を取得できませんでした。@pocket に値が入っているか、MEETING_SCHEDULE_IMPORT_KEY_FIELD_ID を確認してください。",
      };
    }

    const existingScheduledRaw = readCustomerInfoFieldValue(
      recObj,
      fieldMap.scheduledDate,
    );
    const existingSchedule = resolveRecordScheduledParts(recObj, fieldMap);
    const scheduleDateChanged = hasMeetingScheduleDateChanged(
      existingSchedule.ymd,
      scheduledYmd,
    );
    const currentEstimateStatus = fieldMap.estimateStatus
      ? coerceCustomerInfoDisplayString(
          readCustomerInfoFieldValue(recObj, fieldMap.estimateStatus),
        ).trim()
      : "";
    let nextEstimateStatus: string | undefined;

    const payload: Record<string, unknown> = {
      [importKeyFieldId]: importKeyValue,
      [fieldMap.scheduledDate]: scheduledDateTimeValueForPocket(
        scheduledYmd,
        scheduledTime,
        existingScheduledRaw,
      ),
    };

    if (scheduledTime && fieldMap.meetingTime) {
      payload[fieldMap.meetingTime] = scheduledTime;
    }

    /**
     * 予定日を動かしたら「商談セット作成済み」を「見積依頼済み」へ戻す。
     *
     * 【現在は到達不能】商談・資料送付予定日時が LIFF から編集不可になり、
     * この関数を呼ぶ唯一の入口（PATCH .../schedule）が 403 で塞がっているため、
     * ここには到達しない。ロジックは復活に備えて残してある。
     * 日時編集を復活させる場合は、meeting-schedule-locked-fields.ts の
     * MEETING_SCHEDULE_LOCKED_FIELDS から "scheduledDateTime" を外すのと同時に、
     * この自動リセットと、その通知（MeetingScheduleCardSaveResult の
     * autoEstimateStatus / page.tsx の handleSave）も同時に有効化すること。
     */
    if (
      scheduleDateChanged &&
      isMeetingScheduleSetCreatedStatus(currentEstimateStatus) &&
      fieldMap.estimateStatus
    ) {
      const resetStatus = normalizeEditableStatus(
        MEETING_SCHEDULE_ESTIMATE_REQUESTED_STATUS,
      );
      if (!resetStatus) {
        return {
          ok: false,
          status: 503,
          error: "見積依頼済みステータスを特定できません",
        };
      }
      payload[fieldMap.estimateStatus] = resetStatus;
      nextEstimateStatus = resetStatus;
    }

    await updateRecord(apoAppId, recordId, payload, writeAuth);
    // 一覧のキャッシュを捨てる。保存直後に古い値を出さないため
    invalidateMeetingScheduleRecordsCache();

    return {
      ok: true,
      scheduledYmd,
      scheduledTime,
      ...(nextEstimateStatus ? { estimateStatus: nextEstimateStatus } : {}),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[meeting-schedule:schedule]", e);
    return {
      ok: false,
      status: 502,
      error: formatMeetingScheduleStatusUpdateError(
        msg || "商談・資料送付予定日時の更新に失敗しました",
      ),
    };
  }
}

export async function buildMeetingScheduleForStaff(
  boundStaffName: string,
  dateParam?: string | null,
): Promise<MeetingSchedulePayload> {
  const apoAppId = salesDashboardApoAppId();
  const targetYmd = resolveTargetYmd(dateParam);

  if (!apoAppId) {
    return {
      configured: false,
      scope: "day",
      date: targetYmd,
      dateLabel: formatMeetingDateLabel(targetYmd),
      staffName: boundStaffName,
      items: [],
      error: "SALES_DASHBOARD_APO_APP_ID が未設定です",
    };
  }

  try {
    const fieldAuth = { apiKey: apiKeyForSalesDashboardApoPocket() };
    const listAuths = salesDashboardApoListAuths();
    const apoFields = await fetchAppFields(apoAppId, fieldAuth, {
      operation: "meeting-schedule:fields",
      appEnv: "SALES_DASHBOARD_APO_APP_ID",
    });
    const fieldMap = resolveMeetingScheduleFieldMap(apoFields);
    if (!fieldMap) {
      return {
        configured: false,
        scope: "day",
        date: targetYmd,
        dateLabel: formatMeetingDateLabel(targetYmd),
        staffName: boundStaffName,
        items: [],
        error:
          "商談進捗情報の必須フィールド（CL担当者・商談日）を特定できません。MEETING_SCHEDULE_*_FIELD_ID を設定してください。",
      };
    }
    const mapAddressIds = resolveApoMapAddressFieldIds(apoFields);

    const wanted = meetingScheduleWantedFieldCsv(fieldMap, mapAddressIds);

    // 絞り込み前の全件。担当者での絞り込みは下のループで行う（Phase 0 §6）
    const records = await fetchMeetingScheduleRecordsCached(
      apoAppId,
      wanted,
      listAuths,
      {
        operation: "meeting-schedule:records",
        appEnv: "SALES_DASHBOARD_APO_APP_ID",
      },
    );
    const items: MeetingScheduleItem[] = [];

    for (const row of records) {
      const rec = row.record;
      if (!rec || typeof rec !== "object") continue;
      const recordId = atPocketRecordIdFromRow(row);
      if (!recordId) continue;
      const recObj = rec as Record<string, unknown>;
      if (!recordMatchesStaff(recObj, fieldMap, boundStaffName)) continue;
      const item = buildMeetingItem(
        recObj,
        fieldMap,
        targetYmd,
        recordId,
        mapAddressIds,
      );
      if (item) items.push(item);
    }

    items.sort(
      (a, b) =>
        a.sortMinutes - b.sortMinutes ||
        a.customerName.localeCompare(b.customerName, "ja"),
    );

    return {
      configured: true,
      scope: "day",
      date: targetYmd,
      dateLabel: formatMeetingDateLabel(targetYmd),
      staffName: boundStaffName,
      items,
      ...meetingScheduleMetaExtras(),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[meeting-schedule]", e);
    return {
      configured: true,
      scope: "day",
      date: targetYmd,
      dateLabel: formatMeetingDateLabel(targetYmd),
      staffName: boundStaffName,
      items: [],
      error: msg || "商談進捗情報の取得に失敗しました",
    };
  }
}

export async function buildMeetingScheduleListForStaff(
  boundStaffName: string,
): Promise<MeetingSchedulePayload> {
  const apoAppId = salesDashboardApoAppId();

  if (!apoAppId) {
    return {
      configured: false,
      scope: "list",
      staffName: boundStaffName,
      items: [],
      error: "SALES_DASHBOARD_APO_APP_ID が未設定です",
    };
  }

  try {
    const fieldAuth = { apiKey: apiKeyForSalesDashboardApoPocket() };
    const listAuths = salesDashboardApoListAuths();
    const apoFields = await fetchAppFields(apoAppId, fieldAuth, {
      operation: "meeting-schedule:fields",
      appEnv: "SALES_DASHBOARD_APO_APP_ID",
    });
    const fieldMap = resolveMeetingScheduleFieldMap(apoFields);
    if (!fieldMap) {
      return {
        configured: false,
        scope: "list",
        staffName: boundStaffName,
        items: [],
        error:
          "商談進捗情報の必須フィールド（CL担当者・商談日）を特定できません。MEETING_SCHEDULE_*_FIELD_ID を設定してください。",
      };
    }
    const mapAddressIds = resolveApoMapAddressFieldIds(apoFields);

    const wanted = meetingScheduleWantedFieldCsv(fieldMap, mapAddressIds);

    // 絞り込み前の全件。担当者での絞り込みは下のループで行う（Phase 0 §6）
    const records = await fetchMeetingScheduleRecordsCached(
      apoAppId,
      wanted,
      listAuths,
      {
        operation: "meeting-schedule:records-list",
        appEnv: "SALES_DASHBOARD_APO_APP_ID",
      },
    );
    const items: MeetingScheduleItem[] = [];

    for (const row of records) {
      const rec = row.record;
      if (!rec || typeof rec !== "object") continue;
      const recordId = atPocketRecordIdFromRow(row);
      if (!recordId) continue;
      const recObj = rec as Record<string, unknown>;
      if (!recordMatchesStaff(recObj, fieldMap, boundStaffName)) continue;
      const item = buildMeetingItemFromRecord(
        recObj,
        fieldMap,
        recordId,
        mapAddressIds,
      );
      if (item) items.push(item);
    }

    sortMeetingItems(items);

    return {
      configured: true,
      scope: "list",
      staffName: boundStaffName,
      items,
      ...meetingScheduleMetaExtras(),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[meeting-schedule:list]", e);
    return {
      configured: true,
      scope: "list",
      staffName: boundStaffName,
      items: [],
      error: msg || "商談進捗情報の取得に失敗しました",
    };
  }
}
