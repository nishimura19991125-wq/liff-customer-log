import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";

/**
 * AP担当者・CL担当者が両方ともトラーチ倶楽部の案件で、工事対応者が空なら
 * 「トラーチ倶楽部」を自動で入れる（契約情報入力の保存時・サーバ側）。
 *
 * ここは判定だけを持つ。@pocket の読み書きは保存処理
 * （api/customer-info/records/[recordId] の PUT）が行う。
 *
 * ■ 書くのはお客様情報アプリだけ
 * 契約情報入力の保存時点では、工事登録アプリにまだレコードが無い案件がある。
 * 工事登録アプリ側の工事対応者は、これまでどおり工事カレンダーから入れる。
 */

/**
 * 工事対応者に自動で入れる値。AP/CL担当者との比較にも使う。
 *
 * ⚠ 同じ文字列が sales-dashboard-ranking-exclude.ts の EXCLUDED_STAFF_MARKERS
 *   （営業ランキングから外す担当者名）にもある。あちらは部分一致の除外語で
 *   用途が違うので、定数は共有しない。片方を変えても、もう片方は変わらない。
 */
export const CLUB_CONSTRUCTION_HANDLER_NAME = "トラーチ倶楽部";

/**
 * AP担当者・CL担当者が両方ともトラーチ倶楽部か。
 *
 * 比較は isSameApClStaff と同じく normApClStaffName（NFKC・空白の畳み込み・
 * 前後の空白除去）を通した完全一致。片方でも空・別の人なら false。
 */
export function isClubApClPair(
  apStaff: string | null | undefined,
  clStaff: string | null | undefined,
): boolean {
  const club = normApClStaffName(CLUB_CONSTRUCTION_HANDLER_NAME);
  const ap = normApClStaffName(apStaff ?? undefined);
  const cl = normApClStaffName(clStaff ?? undefined);
  return ap === club && cl === club;
}

/**
 * 保存後のレコードに入る AP/CL担当者。
 *
 * payload に載っていればその値、載っていなければ保存前の値のまま残る。
 * AP/CL担当者は「変わっていなければ送らない」（decideApClStaffPut）ので、
 * 載っていないのは普通のこと。保存前の値を読めていなければ null（不明）。
 */
export function apClStaffAfterSave(input: {
  payload: Record<string, unknown>;
  fieldId: string | null | undefined;
  /** 保存前の値。保存前レコードを読めなかったときは null */
  loaded: string | null | undefined;
}): string | null {
  const { payload, fieldId } = input;
  if (fieldId && Object.prototype.hasOwnProperty.call(payload, fieldId)) {
    return String(payload[fieldId] ?? "");
  }
  return input.loaded ?? null;
}

/**
 * 工事対応者を自動で入れるか。
 *
 * 既に値があれば入れない（手で選んだ値を上書きしない）。
 * 現在の値を読めていなければ入れない（空か判定できないときは触らない）。
 */
export function shouldAutoFillClubConstructionHandler(input: {
  apStaff: string | null;
  clStaff: string | null;
  /** 保存前の工事対応者。読めなかったときは null */
  currentHandler: string | null;
}): boolean {
  if (input.currentHandler === null) return false;
  if (normApClStaffName(input.currentHandler)) return false;
  return isClubApClPair(input.apStaff, input.clStaff);
}
