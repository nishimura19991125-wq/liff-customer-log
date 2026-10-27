import type { ZankoIndex } from "@/lib/zanko-index";

/**
 * 【延期】の印とグレー表示の判定（残工 段階3）。**両タブがこの部品を使う。**
 *
 * @pocket の calendar_atpocket.js の設定のうち、次の2つが true の動きに
 * 固定している（LIFF では切り替えの環境変数を作らない）。
 *   POSTPONED_ALWAYS_GRAY        【延期】が付くカードは最新日も含めて全部グレー
 *   POSTPONED_GRAY_SKIP_REPORTED 新築・産業用で完了報告がある工程はグレーにしない
 *
 * ■ 【延期】
 * 残工案件アプリ（186）に同じ T番号 があれば付ける。残工日が空でも付ける。
 * 新築案件・産業用案件・【残工】カードには付けない。
 *
 * ■ グレー
 *   【延期】が付くカード   全部グレー
 *   新築・産業用のカード   最新日より前ならグレー。完了報告がある工程は除く
 *                         （報告の判定は ✅ と同じ。工事報告を読めていなければ
 *                          「報告なし」としてグレー）
 *   【残工】カード         同じ T番号 の最新の残工日でなければグレー
 *                         （zanko-cards の buildZankoCaseEntries で決める）
 *
 * ■ 最新日
 * 186 の残工日のうち一番新しい日。186 は全件を読んでいるので、
 * 表示月・フィルターを切り替えても結果は変わらない。
 * 工事登録アプリの日付は使わない（表示月の分しか読んでいないため）。
 *
 * T番号 は tNumberJoinKey（NFKC）でそろえたものを渡すこと。
 */

/** 【延期】を付けない住宅ステータス（calendar-kojo の housingStatusKey） */
const NOT_POSTPONE_TARGET = new Set(["新築案件", "産業用案件"]);

/** 186 の残工日のうち一番新しい日。残工日が無ければ null */
export function zankoLatestDay(index: ZankoIndex, tKey: string): string | null {
  const days = index.datesByT.get(tKey);
  if (!days || days.length === 0) return null;
  // buildZankoIndex で昇順に並べてある
  return days[days.length - 1] ?? null;
}

export type CaseCardZankoMarks = {
  /** 1行目の先頭に【延期】を付けるか */
  postponed: boolean;
  /** グレーにするか */
  gray: boolean;
};

/**
 * 工事カード（【残工】カード以外）1枚の判定。
 *
 * lastDayKey: そのカードの最終日（JST の YYYY-MM-DD）。
 *   新築・産業用は工程の日。それ以外は終了日があれば終了日、なければ開始日。
 * reported: その工程に完了報告があるか（✅ と同じ判定）。
 */
export function decideCaseCardZankoMarks(
  index: ZankoIndex,
  card: {
    tKey: string;
    housingStatusKey: string;
    lastDayKey: string;
    reported: boolean;
  },
): CaseCardZankoMarks {
  if (!card.tKey || !index.datesByT.has(card.tKey)) {
    return { postponed: false, gray: false };
  }
  if (!NOT_POSTPONE_TARGET.has(card.housingStatusKey)) {
    // POSTPONED_ALWAYS_GRAY: 【延期】が付くカードは最新日も含めて全部グレー
    return { postponed: true, gray: true };
  }
  // 新築・産業用: 【延期】は付けない。最新日より前ならグレー
  const latest = zankoLatestDay(index, card.tKey);
  if (!latest || card.lastDayKey >= latest) {
    return { postponed: false, gray: false };
  }
  // POSTPONED_GRAY_SKIP_REPORTED: 完了報告がある工程はグレーにしない
  return { postponed: false, gray: !card.reported };
}
