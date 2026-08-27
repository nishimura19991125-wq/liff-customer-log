import "server-only";

import { shortHousingStatusLabel } from "@/lib/calendar-kojo";
import type { UndatedConstructionCase } from "@/lib/calendar-api-types";
import type {
  CrmSnapshot,
  CustomerCrmCandidate,
} from "@/lib/customer-crm-list";
import { filterCrmCandidatesForStaff } from "@/lib/customer-crm-list";

/**
 * 工事日未定の案件を**お客様情報アプリ**から取り出す（第3段階 3-3）。
 *
 * これまでは工事登録アプリの全件から「お客様名あり・日付が全部空」を
 * 拾っていた（calendar-undated-cases.ts）。第1段階（b7f4169）で
 * 施工予定日が未定の新規登録を工事登録アプリに作らなくなったため、
 * その経路で生まれた案件は工事登録アプリに存在せず、拾えなくなっていた。
 *
 * ■ 抽出条件
 *   施工予定日が空 かつ 顧客ステータスがキャンセル以外 かつ T番号 あり
 *
 * T番号 が無いものを外すのは、工事レコードと突合できないから。
 * そのまま割り当てると連携が既存のお客様情報を引き当てられず、
 * 同じ顧客のレコードをもう1件作ってしまう。
 * 割り当て API（assign-customer-case）も 400 で弾くが、
 * **選べてしまう時点で事故なので一覧にも出さない**。
 *
 * ■ @pocket は叩かない
 * 受け取るのは 3-1 で共有した担当顧客スナップショット。
 * 追加の全件走査を作らないために、ここは純粋な絞り込みに徹する。
 */

/** 住宅ステータスの生の値 → カレンダーと同じ略称 */
export function customerHousingStatusToShort(raw: string): string {
  const t = raw.replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (t.includes("新築案件")) return shortHousingStatusLabel("新築案件");
  if (t.includes("既築案件")) return shortHousingStatusLabel("既築案件");
  if (t.includes("トラーチ")) {
    return shortHousingStatusLabel("トラーチ倶楽部案件");
  }
  if (t.includes("産業用")) return shortHousingStatusLabel("産業用案件");
  return shortHousingStatusLabel(t);
}

/** 一覧に出す1件か。施工予定日が空・キャンセル以外・T番号あり */
export function isUndatedCustomerCase(item: CustomerCrmCandidate): boolean {
  if (!item.isConstructionDateUnset) return false;
  if (item.isCancelled) return false;
  if (!item.tNumber.trim()) return false;
  if (!item.customerName.trim()) return false;
  return true;
}

function toUndatedCase(item: CustomerCrmCandidate): UndatedConstructionCase {
  return {
    customerInfoRecordId: item.recordId,
    customerName: item.customerName.trim(),
    housingShort: customerHousingStatusToShort(item.housingStatus),
    contractorName: item.contractorName.trim(),
    tNumber: item.tNumber.trim(),
  };
}

/**
 * スナップショットから未定案件の一覧を組み立てる。
 *
 * boundStaffName を渡すと、その担当（AP/CL/案件作成者）の案件に
 * isMyApCl を立てる。判定は担当顧客一覧と同じ
 * filterCrmCandidatesForStaff で、別のロジックを持たせない。
 */
export function buildUndatedCustomerCases(
  snapshot: CrmSnapshot,
  boundStaffName: string,
): {
  items: UndatedConstructionCase[];
  myItems: UndatedConstructionCase[];
} {
  const mineIds = boundStaffName.trim()
    ? new Set(
        filterCrmCandidatesForStaff(snapshot, boundStaffName).map(
          (c) => c.recordId,
        ),
      )
    : new Set<string>();

  const items: UndatedConstructionCase[] = [];
  for (const candidate of snapshot.items) {
    if (!isUndatedCustomerCase(candidate)) continue;
    const base = toUndatedCase(candidate);
    items.push(
      mineIds.has(candidate.recordId) ? { ...base, isMyApCl: true } : base,
    );
  }

  items.sort((a, b) => a.customerName.localeCompare(b.customerName, "ja"));
  return { items, myItems: items.filter((item) => item.isMyApCl) };
}
