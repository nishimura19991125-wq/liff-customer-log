import "server-only";

import { apiKeyForSalesDashboardApoPocket, fetchAppFields } from "@/lib/atpocket";
import { atPocketRecordIdFromRow } from "@/lib/atpocket-record-id";
import {
  coerceCustomerInfoDisplayString,
  readCustomerInfoFieldValue,
} from "@/lib/customer-info-record";
import { resolveApoMapAddressFieldIds } from "@/lib/map-address-fields";
import {
  apoTypeDisplayLabel,
  formatCityLabel,
  formatMeetingDateLabel,
  meetingScheduleWantedFieldCsv,
  parseScheduledParts,
  recordMatchesStaff,
} from "@/lib/meeting-schedule";
import {
  resolveMeetingScheduleFieldMap,
  type MeetingScheduleFieldMap,
} from "@/lib/meeting-schedule-fields";
import { fetchMeetingScheduleRecordsCached } from "@/lib/meeting-schedule-records-cache";
import { salesDashboardApoAppId } from "@/lib/sales-dashboard-fields";
import { salesDashboardApoListAuths } from "@/lib/sales-dashboard-list-fetch";
import type { ApoListPayload, ApoListRow } from "@/lib/apo-list-types";

/**
 * アポ情報一覧（アポ取得情報連携アプリ）。
 *
 * ■ キャッシュに相乗りする
 * fetchMeetingScheduleRecordsCached のキーは「アプリID＋要求フィールドCSV」で、
 * 担当者名も scope も含まない。**同じ CSV** を渡す限り商談進捗の一覧と
 * 1エントリを共有し、@pocket へのリクエストは増えない。
 * @pocket はサイト単位で100秒あたり100回の制限があり、過去に複数人の
 * 同時アクセスで 429 が出ているため、CSV は必ず
 * meetingScheduleWantedFieldCsv から作ること（独自に組み立てないこと）。
 *
 * ■ 見積ステータスでは絞り込まない（意図的）
 * 商談進捗の一覧（buildMeetingItemFromRecord）は
 * matchesMeetingScheduleStatus で見積ステータスを絞っているが、
 * **この一覧では意図的に掛けていない**。「すべて」を選んだときに
 * 成約・失注も含めた真の全件が見えることが要件のため。
 * buildMeetingItemFromRecord を使い回さず、ここで軽量な行を組み立てて
 * いるのもこの絞り込みを避けるため。
 *
 * 担当者での絞り込み（recordMatchesStaff）は商談進捗と同じ判定を使う。
 */
export async function buildApoListForStaff(
  boundStaffName: string,
): Promise<ApoListPayload> {
  const apoAppId = salesDashboardApoAppId();
  if (!apoAppId) {
    return {
      configured: false,
      staffName: boundStaffName,
      rows: [],
      error: "SALES_DASHBOARD_APO_APP_ID が未設定です",
    };
  }

  try {
    const fieldAuth = { apiKey: apiKeyForSalesDashboardApoPocket() };
    const apoFields = await fetchAppFields(apoAppId, fieldAuth, {
      operation: "meeting-schedule:fields",
      appEnv: "SALES_DASHBOARD_APO_APP_ID",
    });
    const fieldMap = resolveMeetingScheduleFieldMap(apoFields);
    if (!fieldMap) {
      return {
        configured: false,
        staffName: boundStaffName,
        rows: [],
        error:
          "アポ情報の必須フィールド（CL担当者・商談日）を特定できません。MEETING_SCHEDULE_*_FIELD_ID を設定してください。",
      };
    }

    const mapAddressIds = resolveApoMapAddressFieldIds(apoFields);
    // ★ 商談進捗と同じ CSV。変えるとキャッシュキーが割れて 429 の原因になる
    const wanted = meetingScheduleWantedFieldCsv(fieldMap, mapAddressIds);

    const records = await fetchMeetingScheduleRecordsCached(
      apoAppId,
      wanted,
      salesDashboardApoListAuths(),
      {
        operation: "meeting-schedule:records-list",
        appEnv: "SALES_DASHBOARD_APO_APP_ID",
      },
    );

    const rows: ApoListRow[] = [];
    for (const row of records) {
      const rec = row.record;
      if (!rec || typeof rec !== "object") continue;
      const recordId = atPocketRecordIdFromRow(row);
      if (!recordId) continue;
      const recObj = rec as Record<string, unknown>;
      if (!recordMatchesStaff(recObj, fieldMap, boundStaffName)) continue;
      rows.push(buildApoListRow(recObj, fieldMap, recordId));
    }

    sortApoListRows(rows);

    return { configured: true, staffName: boundStaffName, rows };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[apo-list]", e);
    return {
      configured: true,
      staffName: boundStaffName,
      rows: [],
      error: msg || "アポ情報一覧の取得に失敗しました",
    };
  }
}

function readField(
  recObj: Record<string, unknown>,
  fieldId: string | null,
): string {
  if (!fieldId) return "";
  return coerceCustomerInfoDisplayString(
    readCustomerInfoFieldValue(recObj, fieldId),
  ).trim();
}

/** 表示に要る分だけを組み立てる。見積ステータスでの絞り込みは行わない */
function buildApoListRow(
  recObj: Record<string, unknown>,
  fieldMap: MeetingScheduleFieldMap,
  recordId: string,
): ApoListRow {
  const scheduled = parseScheduledParts(
    readCustomerInfoFieldValue(recObj, fieldMap.scheduledDate),
  );
  const timeFromField = readField(recObj, fieldMap.meetingTime);
  const timeMatch = /(\d{1,2}:\d{2})/.exec(timeFromField || scheduled?.time || "");

  // 初回商談実施日で埋めない。商談・資料送付予定日時そのものの日付
  const scheduledYmd = scheduled?.ymd ?? "";

  return {
    recordId,
    scheduledYmd,
    scheduledTime: timeMatch?.[1]?.slice(0, 5) ?? "",
    scheduledDateLabel: scheduledYmd
      ? formatMeetingDateLabel(scheduledYmd)
      : "日付未定",
    customerName: readField(recObj, fieldMap.customerName),
    city: formatCityLabel(readField(recObj, fieldMap.city)),
    apoTypeLabel: apoTypeDisplayLabel(readField(recObj, fieldMap.apoType)),
    estimateStatus: readField(recObj, fieldMap.estimateStatus),
    giftCoupon: readField(recObj, fieldMap.giftCoupon),
    negotiationStatus: readField(recObj, fieldMap.negotiationStatus),
  };
}

/** 日付・時刻の昇順。どちらも無いものは後ろに回し、同時刻は顧客名順 */
function sortApoListRows(rows: ApoListRow[]): void {
  rows.sort((a, b) => {
    // 日付未定は末尾。グルーピングの並びと合わせる
    const dateA = a.scheduledYmd || "9999-12-31";
    const dateB = b.scheduledYmd || "9999-12-31";
    if (dateA !== dateB) return dateA.localeCompare(dateB);
    const timeA = a.scheduledTime || "99:99";
    const timeB = b.scheduledTime || "99:99";
    if (timeA !== timeB) return timeA.localeCompare(timeB);
    return a.customerName.localeCompare(b.customerName, "ja");
  });
}
