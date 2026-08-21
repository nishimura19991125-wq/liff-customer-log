import { japanHolidayKeysForRange } from "@/lib/japan-holidays";

/**
 * 顧客ステータスを「キャンセル」にしたときに何が起きるかを決める（タスクV）。
 *
 * **元に戻せない操作**なので、確認画面（クライアント）とサーバの実処理が
 * 同じ判断を使えるよう、純粋関数としてここに寄せている。
 * 画面が「空き枠を作ります」と言ったのにサーバが作らない（逆も）を防ぐ。
 */

/** 空き枠を作るかどうかの境目。これを**超える**ときだけ作る */
export const EMPTY_SLOT_MIN_BUSINESS_DAYS = 7;

const DAY_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseDayKey(dayKey: string | null | undefined): Date | null {
  const m = DAY_KEY_RE.exec((dayKey ?? "").trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d, 0, 0, 0, 0);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) {
    return null;
  }
  return dt;
}

/**
 * 操作日（JST）の YYYY-MM-DD。
 *
 * 端末のタイムゾーンに左右されると、確認画面とサーバで営業日数が
 * ずれて「作ります」と言ったのに作らない事故になる。既存箇所と同じく
 * en-CA + Asia/Tokyo で固定する。
 */
export function todayJstDayKey(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(
    now,
  );
}

function toDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 土日祝でなければ営業日 */
export function isBusinessDay(
  dayKey: string,
  holidayKeys: ReadonlySet<string>,
): boolean {
  const d = parseDayKey(dayKey);
  if (!d) return false;
  const w = d.getDay();
  if (w === 0 || w === 6) return false;
  return !holidayKeys.has(dayKey);
}

/**
 * from の**翌日**から to まで（to を含む）の営業日数。
 *
 * 仕様の例で検算している。
 *   9/1(月) → 9/5(金)  = 4営業日（9/2,3,4,5）
 *   9/1(月) → 9/20     = 13営業日（9/2〜9/18 の平日）
 *
 * to が from 以前なら 0。日数が離れすぎている場合は打ち切る（暴走防止）。
 */
export function countBusinessDaysBetween(
  fromDayKey: string,
  toDayKey_: string,
  holidayKeys: ReadonlySet<string>,
): number {
  const from = parseDayKey(fromDayKey);
  const to = parseDayKey(toDayKey_);
  if (!from || !to) return 0;
  if (to.getTime() <= from.getTime()) return 0;

  let count = 0;
  const cursor = new Date(from.getTime());
  // 1日ずつ進める。10年を超える差は数えない
  for (let guard = 0; guard < 4000; guard++) {
    cursor.setDate(cursor.getDate() + 1);
    if (cursor.getTime() > to.getTime()) break;
    if (isBusinessDay(toDayKey(cursor), holidayKeys)) count += 1;
  }
  return count;
}

/** 2つの日付をまたぐ年の祝日を集める */
export function holidayKeysForDayKeys(
  fromDayKey: string,
  toDayKey_: string,
  extraHolidayKeys: string[] = [],
  includeSandwich = false,
): Set<string> {
  const from = parseDayKey(fromDayKey);
  const to = parseDayKey(toDayKey_);
  if (!from || !to) return new Set<string>();
  return japanHolidayKeysForRange(
    from.getFullYear(),
    to.getFullYear(),
    extraHolidayKeys,
    includeSandwich,
  );
}

/** 空き枠を作らない理由 */
export type EmptySlotSkipReason =
  /** 施工予定日が入っていない */
  | "no-date"
  /** 施工予定日が今日以前 */
  | "past"
  /** 7営業日以内。直前すぎて他の案件を入れられない */
  | "too-soon"
  /** 施工会社が空。どの施工店の枠か分からない */
  | "no-contractor";

export type CustomerCancelPlan = {
  /** 空き枠を作るか */
  createsEmptySlot: boolean;
  /** 作る場合の日付（YYYY-MM-DD） */
  emptySlotDayKey: string;
  /** 作る場合の施工会社 */
  emptySlotContractor: string;
  /** 作らない場合の理由 */
  skipReason: EmptySlotSkipReason | null;
  /** 今日から施工予定日までの営業日数（表示・ログ用） */
  businessDays: number;
};

/**
 * キャンセル時に空き枠を作るかを決める。
 *
 * 判定の順序は「日付が無い → 過去 → 施工会社が無い → 営業日数」。
 * 施工会社を営業日より先に見るのは、日数に関係なく作れないため。
 */
export function buildCustomerCancelPlan(input: {
  /** 操作した日（YYYY-MM-DD） */
  todayDayKey: string;
  /** キャンセルする案件の施工予定日 */
  constructionDate: string | null | undefined;
  /** キャンセルする案件の施工会社 */
  contractor: string | null | undefined;
  extraHolidayKeys?: string[];
  includeSandwichNationalHoliday?: boolean;
}): CustomerCancelPlan {
  const dayKey = (input.constructionDate ?? "").trim();
  const contractor = (input.contractor ?? "").trim();
  const none = (skipReason: EmptySlotSkipReason, businessDays = 0) => ({
    createsEmptySlot: false,
    emptySlotDayKey: "",
    emptySlotContractor: "",
    skipReason,
    businessDays,
  });

  const target = parseDayKey(dayKey);
  const today = parseDayKey(input.todayDayKey);
  if (!target || !today) return none("no-date");
  // 「-」等で日付として読めない値も no-date に落ちる

  if (target.getTime() <= today.getTime()) return none("past");
  if (!contractor || contractor === "-") return none("no-contractor");

  const holidays = holidayKeysForDayKeys(
    input.todayDayKey,
    dayKey,
    input.extraHolidayKeys ?? [],
    input.includeSandwichNationalHoliday ?? false,
  );
  const businessDays = countBusinessDaysBetween(
    input.todayDayKey,
    dayKey,
    holidays,
  );
  if (businessDays <= EMPTY_SLOT_MIN_BUSINESS_DAYS) {
    return none("too-soon", businessDays);
  }

  return {
    createsEmptySlot: true,
    emptySlotDayKey: dayKey,
    emptySlotContractor: contractor,
    skipReason: null,
    businessDays,
  };
}
