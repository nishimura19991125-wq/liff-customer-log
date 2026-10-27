import "server-only";

import type { ZankoSourceStatus } from "@/lib/calendar-api-types";
import type { ContractSourceItem } from "@/lib/contract-records";
import {
  readContractRecords,
  type ContractReadResult,
} from "@/lib/contract-records-server";
import { emptyZankoIndex } from "@/lib/zanko-index";
import {
  readZankoIndexCached,
  type ZankoReadResult,
} from "@/lib/zanko-records-cache";

/**
 * 残工の材料を読む部品（残工 段階1）。**取得の入口はここ1つ。**
 *
 *   zanko    残工案件アプリ（186）の T番号 → 残工日[]
 *   contract 契約情報入力（お客様情報）の T番号 → 契約レコード
 *
 * 段階1では工事カレンダー（/api/calendar）だけがつないでいる。
 * 施工管理タブも段階2以降でこれを呼ぶ。どちらもモジュール内の同じ
 * キャッシュを使うので、両タブで呼んでも @pocket への呼び出しは増えない。
 *
 * 2つを並べて読む。どちらが失敗しても投げない（それぞれ「無し」になる）。
 */

export type ZankoCalendarSources = {
  zanko: ZankoReadResult;
  contract: ContractReadResult;
};

/** 想定外に投げられたとき用。両方「失敗・無し」 */
export function failedZankoCalendarSources(): ZankoCalendarSources {
  return {
    zanko: { status: "error", reason: "fetch_failed", index: emptyZankoIndex() },
    contract: { status: "error", reason: "fetch_failed", byT: new Map() },
  };
}

/**
 * customerSnapshot: 呼び出し側が既に読んだお客様情報の全件キャッシュ（任意）。
 * 施工管理タブはルートで読んでいるので、それを渡して二重に読まない。
 */
export async function readZankoCalendarSources(opts?: {
  customerSnapshot?: Promise<{ items: readonly ContractSourceItem[] }>;
}): Promise<ZankoCalendarSources> {
  const [zanko, contract] = await Promise.all([
    readZankoIndexCached(),
    readContractRecords(opts?.customerSnapshot),
  ]);
  return { zanko, contract };
}

/** 月データに載せる状態（画面には出さない。失敗が分かる情報） */
export function summarizeZankoSources(
  sources: ZankoCalendarSources,
): ZankoSourceStatus {
  const { zanko, contract } = sources;
  return {
    zanko: zanko.status,
    ...(zanko.status === "error" ? { zankoReason: zanko.reason } : {}),
    ...(zanko.status === "ok" && zanko.stale ? { zankoStale: true } : {}),
    contract: contract.status,
    ...(contract.status === "error" ? { contractReason: contract.reason } : {}),
  };
}
