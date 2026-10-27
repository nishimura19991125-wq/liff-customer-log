import { tNumberJoinKey } from "@/lib/t-number-join-key";

/**
 * 契約情報入力（お客様情報アプリ）の T番号 → 契約レコード（残工 段階1）。
 *
 * お客様情報の全件キャッシュ（customer-crm-list.ts の getCachedCustomerCrmSnapshot）
 * の行から作る。施工管理タブと同じキャッシュなので、@pocket を二重に呼ばない。
 *
 * 同じ T番号 が複数あれば、レコードIDが最も大きいもの（最後に登録されたもの）。
 * T番号 は tNumberJoinKey（NFKC）でそろえる。
 */

/** 全件キャッシュに載せている契約情報入力の5列 */
export type CrmContractInfo = {
  /** メーカー */
  manufacturer: string;
  /** 太陽光パネル容量(kw) */
  panelCapacity: string;
  /** 蓄電池容量(kWh)① */
  batteryCapacity1: string;
  /** 蓄電池容量(kWh)② */
  batteryCapacity2: string;
  /** 市区郡 */
  city: string;
};

/**
 * 残工カードの2行目・色・件数に使う、お客様情報の列（残工 段階2）。
 * 全件キャッシュの行には必ずある（工事対応者は列が見つかったときだけ）。
 * 省略可能にしているのは、段階1のテスト用データ（この項目を持たない）の
 * 形を変えずに済ませるため。読む側は undefined を空として扱うこと。
 */
type ContractCardExtras = {
  /** 工事対応者 */
  constructionHandler?: string;
  /** 施工業者 */
  contractorName?: string;
  /** 住宅ステータス（生の値） */
  housingStatus?: string;
  /** 顧客ステータスがキャンセル */
  isCancelled?: boolean;
};

export type ContractRecord = CrmContractInfo &
  ContractCardExtras & {
    recordId: string;
    /** お客様情報に入っている T番号（そろえる前の値） */
    tNumber: string;
    customerName: string;
  };

export type ContractSourceItem = ContractCardExtras & {
  recordId: string;
  tNumber: string;
  customerName: string;
  contract?: CrmContractInfo;
};

const EXTRA_KEYS = [
  "constructionHandler",
  "contractorName",
  "housingStatus",
  "isCancelled",
] as const;

function pickExtras(item: ContractSourceItem): ContractCardExtras {
  const out: ContractCardExtras = {};
  for (const k of EXTRA_KEYS) {
    if (item[k] !== undefined) (out as Record<string, unknown>)[k] = item[k];
  }
  return out;
}

const EMPTY_CONTRACT: CrmContractInfo = {
  manufacturer: "",
  panelCapacity: "",
  batteryCapacity1: "",
  batteryCapacity2: "",
  city: "",
};

/** レコードIDの大小。数字どうしなら数値で比べる（"9" < "120"） */
function recordIdIsNewer(a: string, b: string): boolean {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && a.trim() && b.trim()) {
    return na > nb;
  }
  return a.localeCompare(b) > 0;
}

export function buildContractRecordMap(
  items: readonly ContractSourceItem[],
): Map<string, ContractRecord> {
  const byT = new Map<string, ContractRecord>();
  for (const item of items) {
    const key = tNumberJoinKey(item.tNumber);
    if (!key) continue;
    const current = byT.get(key);
    if (current && !recordIdIsNewer(item.recordId, current.recordId)) continue;
    byT.set(key, {
      recordId: item.recordId,
      tNumber: item.tNumber,
      customerName: item.customerName,
      ...EMPTY_CONTRACT,
      ...(item.contract ?? {}),
      ...pickExtras(item),
    });
  }
  return byT;
}
