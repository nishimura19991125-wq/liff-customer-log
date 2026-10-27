import type { AtPocketFieldRow, AtPocketRecordRow } from "@/lib/atpocket";

import {
  isReportContentKanko,
  pickRecordValueByFieldAliases,
  resolveReportFieldIds,
} from "@/lib/calendar-kojo";
import { readZankoDate } from "@/lib/zanko-index";
import { tNumberJoinKey } from "@/lib/t-number-join-key";

/**
 * 工事報告アプリから、残工の判定に使う材料を取り出す（残工 段階4-b）。
 *
 *   kankoReportedT  報告内容が「完工」の行がある T番号（✅ と同じ判定）
 *   kankoDatesByT   報告内容が「完工」の行の完工日（YYYY-MM-DD）
 *
 * 工事カレンダー・施工管理が読んでいる工事報告の一覧（同じキャッシュ）から
 * 作る。新しく取りに行かない。T番号 は残工と同じ NFKC でそろえる。
 *
 * 工事報告を読めていない・T番号 か報告内容の列が分からないときは null。
 * null は「報告なし」として扱う（解除しない・✅ を出さない。安全側）。
 * 完工日の列が見つからなければ kankoDatesByT は空（解除しない）。
 */

export type ZankoReportFacts = {
  kankoReportedT: Set<string>;
  kankoDatesByT: Map<string, string[]>;
};

export function buildZankoReportFacts(
  records: readonly AtPocketRecordRow[] | null | undefined,
  fields: AtPocketFieldRow[] | null | undefined,
): ZankoReportFacts | null {
  if (!records || !fields) return null;
  const rf = resolveReportFieldIds(fields);
  if (!rf.tNumber || !rf.reportContent) return null;

  const facts: ZankoReportFacts = {
    kankoReportedT: new Set(),
    kankoDatesByT: new Map(),
  };
  for (const rec of records) {
    const recObj =
      rec && rec.record && typeof rec.record === "object"
        ? (rec.record as Record<string, unknown>)
        : null;
    if (!recObj) continue;
    const t = tNumberJoinKey(pickRecordValueByFieldAliases(recObj, rf.tNumber));
    if (!t) continue;
    if (!isReportContentKanko(recObj[rf.reportContent])) continue;
    facts.kankoReportedT.add(t);
    if (!rf.kankoDate) continue;
    const day = readZankoDate(pickRecordValueByFieldAliases(recObj, rf.kankoDate));
    if (!day) continue;
    const list = facts.kankoDatesByT.get(t);
    if (list) list.push(day);
    else facts.kankoDatesByT.set(t, [day]);
  }
  return facts;
}
