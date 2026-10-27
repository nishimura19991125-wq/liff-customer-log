import "server-only";

import {
  fetchAppFieldsTryKeys,
  fetchRecordById,
  readAuthsForApp,
} from "@/lib/atpocket";
import {
  isCrmConstructionDateUnset,
  resolveCrmConstructionDateFieldId,
} from "@/lib/customer-crm-documents";
import {
  customerInfoAppId,
  customerInfoPocketAuth,
} from "@/lib/customer-info-config";

/**
 * お客様情報の「施工予定日」を @pocket から読み直す。
 *
 * 未定案件の割り当て（assign-customer-case）が書き込む前に呼ぶ。
 * 画面の一覧は施工予定日が空の案件だけを出すが、一覧はキャッシュ
 * （最大10分）から作っている。古い一覧から選ばれたときや、API を
 * 直接呼ばれたときに、工事日が決まった案件へ書けてしまわないよう、
 * ここで確かめ直す。1つの案件に工事日を入れるのは1回だけという前提。
 *
 * ■ 一覧と同じ列・同じ判定
 *   列：resolveCrmConstructionDateFieldId（CUSTOMER_INFO_CONSTRUCTION_DATE_FIELD_ID、
 *       無ければ見出し「施工予定日」など）
 *   判定：isCrmConstructionDateUnset
 * 一覧（customer-crm-list → customer-undated-cases）もこの2つで決めている。
 *
 * ■ @pocket の呼び出しは単票 GET の1回だけ
 * 列定義は fetchAppFields のキャッシュに載っている（一覧と共用）。
 * 列は絞らずに読む。絞ると空の列が返らないことがあり、
 * 「入っているのに空」と読み違えるおそれがある。
 *
 * ■ 読めなかったときは "error"
 * 「空」とは扱わない。呼び出し側は書き込まずに断る。
 */

export type ConstructionDateRecheck =
  | { kind: "unset" }
  | { kind: "set" }
  | {
      kind: "error";
      reason: "config" | "field_unresolved" | "not_found" | "fetch_failed";
    };

export async function recheckCustomerInfoConstructionDate(
  customerInfoRecordId: string,
): Promise<ConstructionDateRecheck> {
  const recordId = customerInfoRecordId.trim();
  const appId = customerInfoAppId();
  if (!recordId || !appId) return { kind: "error", reason: "config" };

  try {
    const readAuths = readAuthsForApp("CUSTOMER_INFO");
    const appFields = await fetchAppFieldsTryKeys(
      appId,
      readAuths.map((a) => a.apiKey ?? ""),
    );
    if (!appFields) return { kind: "error", reason: "fetch_failed" };

    const dateFieldId = resolveCrmConstructionDateFieldId(appFields);
    if (!dateFieldId) return { kind: "error", reason: "field_unresolved" };

    const row = await fetchRecordById(
      appId,
      recordId,
      customerInfoPocketAuth(),
    );
    if (!row?.record || typeof row.record !== "object") {
      return { kind: "error", reason: "not_found" };
    }

    const unset = isCrmConstructionDateUnset(
      row.record as Record<string, unknown>,
      dateFieldId,
    );
    return unset ? { kind: "unset" } : { kind: "set" };
  } catch (e) {
    console.error(
      "[customer-info-construction-date-recheck] 施工予定日を読み直せませんでした",
      e,
    );
    return { kind: "error", reason: "fetch_failed" };
  }
}
