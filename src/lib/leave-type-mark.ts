import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";

/**
 * 休暇種別（休暇アプリの field-2）→ 印、の対応表と、同じ日に複数あるときの選び方。
 *
 * 勤怠カレンダーと休暇登録画面の**両方がここを使う**。判定をほかに書かないこと。
 *
 * 休暇アプリには LIFF からの「休み」のほか、別システムから「有給」「忌引き」
 * 「欠勤」が入る。別システムが新しい種別を増やしても壊れないよう、
 * 知らない種別は1文字目を印にし、順位は有給と休みの間に置く。
 */

/** LIFF が書く種別。週2日の制限で数えるのはこれだけ */
export const LEAVE_TYPE_REST = "休み";

const MARKS: Readonly<Record<string, string>> = {
  休み: "休",
  有給: "有",
  忌引き: "忌",
  欠勤: "欠",
};

/**
 * 同じ日に複数あるときの順位（大きいほうを選ぶ）。
 *   忌引き > 欠勤 > 有給 > 知らない種別 > 休み（空も休みと同じ）
 * 知らない種別は別システムからの登録なので休みより上、意味が分からないので
 * 知っている種別より下。
 */
const PRIORITY: Readonly<Record<string, number>> = {
  忌引き: 50,
  欠勤: 40,
  有給: 30,
  休み: 10,
};
const UNKNOWN_PRIORITY = 20;

/** 前後の空白・全角半角の違いをならす（氏名の突き合わせと同じ正規化） */
export function normalizeLeaveType(raw: string | null | undefined): string {
  return normApClStaffName(raw ?? undefined);
}

/** 印（1文字）。空（ならしたあとに空になったときも）は「休」 */
export function leaveTypeMark(raw: string | null | undefined): string {
  const t = normalizeLeaveType(raw);
  if (!t) return MARKS[LEAVE_TYPE_REST]!;
  return MARKS[t] ?? Array.from(t)[0]!;
}

/** 画面に出す種別の名前。空は「休み」 */
export function leaveTypeLabel(raw: string | null | undefined): string {
  return normalizeLeaveType(raw) || LEAVE_TYPE_REST;
}

/** 「休み」として扱うか（空も休み）。週2日の制限で数えるのはこれだけ */
export function isRestLeaveType(raw: string | null | undefined): boolean {
  const t = normalizeLeaveType(raw);
  return !t || t === LEAVE_TYPE_REST;
}

function priorityOf(type: string): number {
  if (!type) return PRIORITY[LEAVE_TYPE_REST]!;
  return PRIORITY[type] ?? UNKNOWN_PRIORITY;
}

function recordOrder(id: string | null | undefined): number {
  const n = Number(id);
  return id != null && id !== "" && Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

/**
 * 同じ日の休暇から1つ選ぶ。順位が同じなら先に登録されたほう（レコードIDの小さいほう）。
 * 返すのは正規化した種別（空なら空文字）。
 */
export function pickLeaveTypeForDay(
  entries: ReadonlyArray<{ type: string | null | undefined; recordId: string | null | undefined }>,
): string {
  let best: { type: string; p: number; order: number } | null = null;
  for (const e of entries) {
    const type = normalizeLeaveType(e.type);
    const p = priorityOf(type);
    const order = recordOrder(e.recordId);
    if (!best || p > best.p || (p === best.p && order < best.order)) {
      best = { type, p, order };
    }
  }
  return best?.type ?? "";
}

/**
 * 本人の休暇の一覧を、日付ごとに1つの種別へまとめる（{ "YYYY-MM-DD": 種別 }）。
 * 本人の分に絞ってから渡すこと（ここでは氏名を見ない）。
 */
export function leaveTypesByDate(
  entries: ReadonlyArray<{ date: string; type: string | null | undefined; recordId: string | null | undefined }>,
): Record<string, string> {
  const byDate = new Map<string, Array<{ type: string | null | undefined; recordId: string | null | undefined }>>();
  for (const e of entries) {
    const list = byDate.get(e.date) ?? [];
    list.push({ type: e.type, recordId: e.recordId });
    byDate.set(e.date, list);
  }
  const out: Record<string, string> = {};
  for (const date of [...byDate.keys()].sort()) {
    out[date] = pickLeaveTypeForDay(byDate.get(date)!);
  }
  return out;
}
