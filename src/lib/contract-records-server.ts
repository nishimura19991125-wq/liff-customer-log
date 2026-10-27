import "server-only";

import { isPocketHttpRateLimitError } from "@/lib/atpocket";
import {
  buildContractRecordMap,
  type ContractRecord,
} from "@/lib/contract-records";
import { getCachedCustomerCrmSnapshot } from "@/lib/customer-crm-list";
import { customerInfoConfigReady } from "@/lib/customer-info-config";

/**
 * 契約情報入力（お客様情報アプリ・CUSTOMER_INFO_APP_ID）の
 * T番号 → 契約レコード（残工 段階1）。
 *
 * ■ 新しく取りに行かない
 * お客様情報の全件キャッシュ（getCachedCustomerCrmSnapshot）から作る。
 * 施工管理タブ・担当顧客一覧・未定案件の一覧と同じキャッシュで、
 * 契約情報入力の5列もそこに載せてある。二重に取らない。
 * TTL は全件キャッシュのもの（既定600秒）をそのまま使う。
 *
 * ■ 失敗しても投げない
 * 全件キャッシュは 429 のとき古い値を返さず、そのまま投げる。ここで
 * つかまえて「契約情報なし」（status: "error"）にし、カレンダー全体は
 * 表示させる。設定が無ければ「無し」（disabled）。
 *
 * ■ 保存時には破棄しない
 * カレンダーの保存で、この5列（お客様名・メーカー・容量・市区郡）は変わらない。
 */

export type ContractReadErrorReason = "rate_limited" | "fetch_failed";

export type ContractReadResult =
  | { status: "disabled"; byT: Map<string, ContractRecord> }
  | { status: "ok"; byT: Map<string, ContractRecord> }
  | {
      status: "error";
      reason: ContractReadErrorReason;
      byT: Map<string, ContractRecord>;
    };

export async function readContractRecords(): Promise<ContractReadResult> {
  if (!customerInfoConfigReady().ok) {
    return { status: "disabled", byT: new Map() };
  }
  try {
    const snapshot = await getCachedCustomerCrmSnapshot();
    return { status: "ok", byT: buildContractRecordMap(snapshot.items) };
  } catch (e) {
    const rateLimited = isPocketHttpRateLimitError(e);
    console.error(
      "[contract-records-server] 契約情報入力を読めませんでした",
      e,
    );
    return {
      status: "error",
      reason: rateLimited ? "rate_limited" : "fetch_failed",
      byT: new Map(),
    };
  }
}
