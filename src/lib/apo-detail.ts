import "server-only";

import {
  apiKeyForSalesDashboardApoPocket,
  fetchAppFields,
  fetchRecordById,
} from "@/lib/atpocket";
import {
  coerceCustomerInfoDisplayString,
  readCustomerInfoFieldValue,
} from "@/lib/customer-info-record";
import { recordMatchesStaff } from "@/lib/meeting-schedule";
import { resolveMeetingScheduleFieldMap } from "@/lib/meeting-schedule-fields";
import { salesDashboardApoAppId } from "@/lib/sales-dashboard-fields";
import { fetchApoDetailRecordCached } from "@/lib/apo-detail-cache";
import {
  apoDetailFieldLabel,
  resolveApoDetailFieldIds,
  APO_DETAIL_GROUPS,
} from "@/lib/apo-detail-fields";
import type { ApoDetailPayload } from "@/lib/apo-detail-types";

/**
 * アポ情報の詳細（1件）。
 *
 * ■ 既存 CSV は触らない
 * 一覧は全件キャッシュ（meeting-schedule-records-cache）に相乗りしており、
 * その要求フィールド CSV を変えるとキャッシュキーが割れて @pocket への
 * リクエストが倍になる。詳細に要る列は違うので、**この画面専用の CSV** で
 * recordId を指定して1件だけ取る。既存 CSV には一切影響しない。
 *
 * ■ 回数を抑える
 * 詳細は開くたびに1リクエスト増えるため、recordId 単位の短時間
 * キャッシュを通す（apo-detail-cache）。戻る/進むや連打で増えない。
 *
 * ■ 担当者の制限
 * 一覧と同じ recordMatchesStaff を通す。他人の案件の recordId を
 * 直接指定しても見えない。
 */
export async function buildApoDetailForStaff(
  boundStaffName: string,
  recordIdRaw: string,
): Promise<
  | { ok: true; payload: ApoDetailPayload }
  | { ok: false; status: number; error: string }
> {
  const recordId = recordIdRaw.trim();
  if (!recordId) {
    return { ok: false, status: 400, error: "recordId が必要です" };
  }

  const apoAppId = salesDashboardApoAppId();
  if (!apoAppId) {
    return {
      ok: true,
      payload: {
        configured: false,
        recordId,
        customerName: "",
        groups: [],
        error: "SALES_DASHBOARD_APO_APP_ID が未設定です",
      },
    };
  }

  const auth = { apiKey: apiKeyForSalesDashboardApoPocket() };
  const apoFields = await fetchAppFields(apoAppId, auth, {
    operation: "apo-detail:fields",
    appEnv: "SALES_DASHBOARD_APO_APP_ID",
  });

  const fieldMap = resolveMeetingScheduleFieldMap(apoFields);
  if (!fieldMap) {
    return {
      ok: true,
      payload: {
        configured: false,
        recordId,
        customerName: "",
        groups: [],
        error:
          "アポ情報の必須フィールド（CL担当者・商談日）を特定できません。MEETING_SCHEDULE_*_FIELD_ID を設定してください。",
      },
    };
  }

  const detailIds = resolveApoDetailFieldIds(apoFields);

  /**
   * この画面専用の CSV。担当者判定に要る列とお客様名も含める。
   * 既存の meetingScheduleWantedFieldCsv とは別物で、あちらは変えない
   */
  const wanted = [
    fieldMap.clPerson,
    fieldMap.salesperson,
    fieldMap.customerName,
    ...Object.values(detailIds),
  ]
    .filter((id): id is string => Boolean(id?.trim()))
    .join(",");

  const row = await fetchApoDetailRecordCached(
    apoAppId,
    recordId,
    wanted,
    async () => {
      const found = await fetchRecordById(apoAppId, recordId, auth, wanted);
      // 列指定で取れないことがあるので、全列でもう一度だけ試す
      if (found?.record) return found;
      return fetchRecordById(apoAppId, recordId, auth);
    },
  );

  if (!row?.record || typeof row.record !== "object") {
    return { ok: false, status: 404, error: "案件が見つかりません" };
  }

  const recObj = row.record as Record<string, unknown>;
  if (!recordMatchesStaff(recObj, fieldMap, boundStaffName)) {
    // 存在の有無を伝えないよう、担当外は 404 と同じ文言にする
    return { ok: false, status: 403, error: "この案件は表示できません" };
  }

  const read = (fieldId: string | null): string =>
    fieldId
      ? coerceCustomerInfoDisplayString(
          readCustomerInfoFieldValue(recObj, fieldId),
        ).trim()
      : "";

  return {
    ok: true,
    payload: {
      configured: true,
      recordId,
      customerName: read(fieldMap.customerName),
      groups: APO_DETAIL_GROUPS.map((group) => ({
        title: group.title,
        items: group.keys.map((key) => ({
          label: apoDetailFieldLabel(key),
          // 値は加工しない。希望メーカーはテキスト型で
          // 「SHARP,XSOL,Panasonic」のような値が入るため、
          // 区切りの変換・スペースの追加・並べ替えを一切しない
          value: read(detailIds[key]),
        })),
      })),
    },
  };
}
