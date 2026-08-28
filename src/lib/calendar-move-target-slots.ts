import type { CalendarMonthApiItem } from "@/lib/calendar-api-types";

/**
 * 工事日の移動先に選べる空き枠を、月次ペイロードから取り出す（M-3）。
 *
 * ■ @pocket を叩かない
 * data.byDay には、その月の全日ぶんの category:"empty" と contractorKey が
 * 既に入っている。同じ月の中を移すだけなら**追加の呼び出しは 0 回**。
 * 別の月を選んだときだけ、呼び出し側がその月のカレンダーを1回取りにいく。
 *
 * ■ pickEmptySlotForDay は使わない
 * あちらは施工会社の一致を必須にし、1件しか返さない（同条件の枠は
 * 利用者に選ぶ材料が無いという前提）。移動は施工会社をまたぐので、
 * **施工会社こそが選ぶ材料**になる。その日の枠を全部返して選ばせる。
 * 3-3 の割り当てはあちらに依存しているので、そちらは変えない。
 */

/** 施工会社が入っていない枠の contractorKey（calendar-kojo の既定値） */
export const CALENDAR_CONTRACTOR_UNSET_KEY = "__UNSET__";

export type MoveTargetSlot = {
  recordId: string;
  /** 施工会社。未設定の枠では空文字 */
  contractorName: string;
};

/** contractorKey（未設定は __UNSET__）を表示用の施工会社名に直す */
export function contractorNameFromKey(key: string | undefined): string {
  const t = key?.trim() ?? "";
  if (!t || t === CALENDAR_CONTRACTOR_UNSET_KEY) return "";
  return t;
}

/**
 * byDay の1日ぶんから、移動先に選べる空き枠だけを取り出す。
 * 同じレコードが複数の行として出ることがあるので重複は畳む。
 */
export function emptySlotsFromDayItems(
  items: readonly CalendarMonthApiItem[] | undefined,
): MoveTargetSlot[] {
  const out: MoveTargetSlot[] = [];
  const seen = new Set<string>();
  for (const item of items ?? []) {
    if (item.category !== "empty") continue;
    const recordId = item.recordId?.trim();
    if (!recordId || seen.has(recordId)) continue;
    seen.add(recordId);
    out.push({
      recordId,
      contractorName: contractorNameFromKey(item.contractorKey),
    });
  }
  return out;
}

/** YYYY-MM-DD が表示中の月か（違えばその月を取りにいく） */
export function dayKeyInMonth(
  dayKey: string,
  year: number,
  month: number,
): boolean {
  const m = dayKey.trim().match(/^(\d{4})-(\d{2})-/);
  if (!m) return false;
  return Number(m[1]) === year && Number(m[2]) === month;
}
