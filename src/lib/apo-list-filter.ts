import { isMeetingScheduleNegotiationOpen } from "@/lib/meeting-schedule-negotiation-status";
import type { ApoListRow } from "@/lib/apo-list-types";

/** 画面で切り替える絞り込み */
export type ApoListScope = "open" | "all";

export const APO_LIST_SCOPES: readonly ApoListScope[] = ["open", "all"];

export const APO_LIST_SCOPE_LABELS: Record<ApoListScope, string> = {
  open: "進行中",
  all: "すべて",
};

export function isApoListScope(raw: string): raw is ApoListScope {
  return (APO_LIST_SCOPES as readonly string[]).includes(raw);
}

/**
 * 一覧の絞り込み（純粋関数）。
 *
 * 「進行中」の判定は既存の isMeetingScheduleNegotiationOpen をそのまま使う。
 * 対象は 商談待ち / 返待ち / 資料送付回答待ち / 再商談 / 再商談日調整中 の5件で、
 * 値のリストをこちらに書き写さないので、遷移表を直せば自動で追従する。
 *
 * 「すべて」は文字どおり絞り込みなし。
 */
export function filterApoListRows(
  rows: readonly ApoListRow[],
  scope: ApoListScope,
): ApoListRow[] {
  if (scope === "all") return [...rows];
  return rows.filter((row) => isMeetingScheduleNegotiationOpen(row.negotiationStatus));
}
