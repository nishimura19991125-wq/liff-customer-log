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

/** 別の月を取りにいったときの結果。**途中状態は持たない** */
export type LoadedMonthByDay = {
  /** 取りにいった月（YYYY-MM） */
  key: string;
  byDay: Record<string, CalendarMonthApiItem[]>;
  /** 失敗した理由。空なら成功 */
  error: string;
};

export type MoveTargetMonthState = {
  /** 表示中の月の外なので、その月を取りにいく必要がある */
  needsFetch: boolean;
  /** 欲しい月がまだ手元に無い */
  loading: boolean;
  /** 取得に失敗した理由。空なら失敗していない */
  error: string;
  /** 空き枠を組み立てる元。undefined なら組み立てられない */
  byDay: Record<string, CalendarMonthApiItem[]> | undefined;
};

/**
 * 移動先の日付から、空き枠を組み立てられる状態かを導く。
 *
 * ⚠ **「読み込み中」を state に持たないこと。**
 *    M-3 の実装は loading/ok/err を state に入れ、それをエフェクトの依存にも
 *    入れていた。エフェクトが自分の書いた state で再実行され、走っている
 *    fetch を自分でキャンセルするため、別の月を選ぶと**永久に読み込み中**に
 *    なっていた（空き枠の一覧も新規作成の選択肢も出ず、実行ボタンも押せず、
 *    どこにもエラーが出ない）。
 *
 *    ここでは「欲しい月」と「取れた月」の**キー比較だけ**で導く。
 *    状態を持たないので、自分で自分を止めることが起こらない。
 */
export function resolveMoveTargetMonthState(input: {
  /** 移動先に選んだ日（YYYY-MM-DD）。未選択なら空文字 */
  targetDayKey: string;
  /** 表示中の月 */
  viewYear: number;
  viewMonth: number;
  /** 表示中の月の byDay（月次ペイロード） */
  viewByDay: Record<string, CalendarMonthApiItem[]> | undefined;
  /** 別の月を取りにいった結果。まだなら null */
  loadedMonth: LoadedMonthByDay | null;
}): MoveTargetMonthState {
  const targetDayKey = input.targetDayKey.trim();
  if (!targetDayKey) {
    return { needsFetch: false, loading: false, error: "", byDay: undefined };
  }

  if (dayKeyInMonth(targetDayKey, input.viewYear, input.viewMonth)) {
    // 同じ月。月次ペイロードでそのまま組み立てられる（@pocket は叩かない）
    return {
      needsFetch: false,
      loading: false,
      error: "",
      byDay: input.viewByDay,
    };
  }

  const wantKey = monthKeyOf(targetDayKey);
  const ready = Boolean(wantKey) && input.loadedMonth?.key === wantKey;
  if (!ready) {
    return { needsFetch: true, loading: true, error: "", byDay: undefined };
  }

  const error = input.loadedMonth?.error ?? "";
  return {
    needsFetch: true,
    loading: false,
    error,
    // 失敗したときは組み立てさせない（枠の有無が分からないまま進ませない）
    byDay: error ? undefined : input.loadedMonth?.byDay,
  };
}

/** YYYY-MM-DD → YYYY-MM。読めない値は空文字 */
export function monthKeyOf(dayKey: string): string {
  const m = dayKey.trim().match(/^(\d{4})-(\d{2})-\d{2}$/);
  return m ? `${m[1]}-${m[2]}` : "";
}
