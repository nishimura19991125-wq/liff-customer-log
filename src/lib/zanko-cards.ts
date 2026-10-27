import type { ContractRecord } from "@/lib/contract-records";
import type { ZankoIndex } from "@/lib/zanko-index";
import {
  decideZankoCardMarks,
  type ZankoCardMarks,
} from "@/lib/zanko-postpone";
import type { ZankoReportFacts } from "@/lib/zanko-report";

/**
 * 表示月の【残工】を決める（残工 段階2）。**両タブがこの部品を使う。**
 *
 * 工事カレンダー（calendar-kojo の buildCalendarPayload）と
 * 施工管理（construction-management の buildConstructionManagementPayload）は、
 * どちらもここで作った一覧からカード・予定を作る。同じ材料なら同じ残工が出る。
 *
 * ■ 決め方
 *   - 186 の残工日が表示月にあるものだけ。工事登録アプリの施工予定日は
 *     見ないので、施工予定日が過去の月の案件でも出る
 *   - 中身は契約情報入力（お客様情報）から T番号（NFKC）で引く。
 *     該当が無ければ contract は null（カードは出し、項目は空欄）
 *   - 顧客ステータスがキャンセルなら出さない
 *   - 日付 → T番号 の順に並べる
 */

export type ZankoCaseEntry = {
  /** 残工日（JST の YYYY-MM-DD） */
  dayKey: string;
  /** T番号（NFKC でそろえたもの） */
  tKey: string;
  /** 契約情報入力の1件。T番号 で該当が無ければ null */
  contract: ContractRecord | null;
  /**
   * グレーにするか（残工 段階3）。同じ T番号 の最新の残工日でなければ true。
   * 段階4-b から、解除した案件・【残工→延期】は全部 true。
   * 186・工事報告の全件から決めるので、表示月によらない。
   */
  gray: boolean;
  /** 1行目の先頭（残工 段階4-b。【残工】か【残工→延期】） */
  prefix: ZankoCardMarks["prefix"];
  /** 【残工→延期】として扱う（残工 段階4-b） */
  emptyPostponed: boolean;
  /** ⚠️ と赤枠（残工 段階4-b。【残工→延期】のとき） */
  warn: boolean;
  /** 完工の ✅（残工 段階4-b） */
  kankoCheck: boolean;
};

export function buildZankoCaseEntries(
  index: ZankoIndex,
  contractByT: ReadonlyMap<string, ContractRecord>,
  year: number,
  month: number,
  /** 工事報告の材料（残工 段階4-b）。null・省略は「報告なし」 */
  reportFacts?: ZankoReportFacts | null,
): ZankoCaseEntry[] {
  const prefix = `${year}-${String(month).padStart(2, "0")}-`;
  const out: ZankoCaseEntry[] = [];
  for (const [tKey, days] of index.datesByT) {
    const contract = contractByT.get(tKey) ?? null;
    if (contract?.isCancelled) continue;
    for (const dayKey of days) {
      if (!dayKey.startsWith(prefix)) continue;
      const m = decideZankoCardMarks(index, reportFacts, tKey, dayKey);
      out.push({
        dayKey,
        tKey,
        contract,
        gray: m.gray,
        prefix: m.prefix,
        emptyPostponed: m.emptyPostponed,
        warn: m.warn,
        kankoCheck: m.kankoCheck,
      });
    }
  }
  out.sort(
    (a, b) => a.dayKey.localeCompare(b.dayKey) || a.tKey.localeCompare(b.tKey),
  );
  return out;
}
