import "server-only";

import { pickRecordValueByFieldAliases } from "@/lib/calendar-kojo";
import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";

/**
 * 顧客ステータスをキャンセルにしたとき、**工事レコードを削除してよいか**の判定。
 *
 * 以前は工事レコードの3項目（施工予定日・施工会社・工事対応者）を空にして
 * レコードは残していた。お客様名と T番号 が残るので空き枠にもならず、
 * 宙に浮いたレコードになっていた。レコードごと削除する。
 *
 * ── 判定をここに切り出した理由 ──────────────────────────────
 * 物理削除は元に戻せない。可否を IO の途中に埋めると、条件が後から
 * 確認できなくなる。純粋関数にしてテストで固定し、呼び出し側は
 * 「この関数が ok を返したときだけ消す」という1行の約束に落とす
 * （assign-customer-case の decideEmptySlotDeletion・
 * move-construction-case の decideMoveSourceDeletion と同じ作法）。
 *
 * ⚠ この関数は**判定しかしない**。全項目 GET・監査ログ・deleteRecord の
 *    順序（A-4）は呼び出し側の責任。
 */

/** 削除を見送った理由。警告の文言と調査ログの両方で使う */
export type CancelConstructionDeleteRefusal =
  /** CUSTOMER_CANCEL_DELETE_CONSTRUCTION_RECORD=false で止められている */
  | "disabled"
  /** 削除する相手が分からない */
  | "unknown_record"
  /**
   * 同じ案件に一致する工事レコードが複数ある。
   * どれを消すか制御できない状態では消さない（片方だけ消えて片方が残る）
   */
  | "ambiguous"
  /** 削除直前の取得に失敗した。中身が分からないものは消さない */
  | "not_found"
  /**
   * 取り直したレコードが、もうこの案件のものではない。
   * 照合は一覧のキャッシュで行うので、その間に書き換わった可能性がある
   */
  | "mismatch";

export type CancelConstructionDeleteDecision =
  | { ok: true }
  | { ok: false; reason: CancelConstructionDeleteRefusal };

/**
 * キャンセル時に工事レコードを削除するか。
 *
 * **既定は有効。** 仕様が「削除する」である以上、既定を無効にすると
 * デプロイしても宙に浮いたレコードが残り続ける。
 *
 * それでも切れる形にしてあるのは、物理削除が取り返しのつかない操作で、
 * 想定外が起きたときに**再デプロイなしで止められる**ことに価値があるため
 * （CALENDAR_ASSIGN_DELETE_EMPTY_SLOT・CALENDAR_MOVE_DELETE_SOURCE_RECORD と
 * 同じ形）。
 *
 * 止めるときは CUSTOMER_CANCEL_DELETE_CONSTRUCTION_RECORD=false（または 0）。
 * 止めている間は従来どおり3項目を空にする更新に戻り、お客様情報の
 * Aki番号 も消さない（工事レコードが残るので、番号の指す先がある）。
 */
export function customerCancelDeletesConstructionRecordEnabled(): boolean {
  const raw = process.env.CUSTOMER_CANCEL_DELETE_CONSTRUCTION_RECORD?.trim();
  if (!raw) return true;
  return raw !== "false" && raw !== "0";
}

/** @pocket のセル値を素の文字列にする（判定を他所の都合で動かさないよう自前で閉じる） */
function coerceCellToPlainString(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "string") return raw.trim();
  if (typeof raw === "number" || typeof raw === "boolean") {
    return String(raw).trim();
  }
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    for (const k of ["value", "displayValue", "label", "name", "text"]) {
      const v = o[k];
      if (v != null && (typeof v === "string" || typeof v === "number")) {
        return String(v).trim();
      }
    }
  }
  return String(raw).trim();
}

/**
 * 工事レコードを削除してよいか。**すべての条件を満たしたときだけ ok を返す。**
 *
 * @param matchedRecordCount 照合に使う列（Aki番号・T番号）の**どちらか**で
 *   一致した、別々のレコードの数。1件のときだけ削除してよい。
 * @param freshRecord 削除直前に **CSV 指定なし**で取り直した全項目。
 *   同じレコードが監査ログ（formatDeletionContent）の材料にもなる。
 * @param keys 照合に使った列と値。取り直したレコードが今もこの案件のもので
 *   あることを、少なくとも1つの列で確かめる。
 */
export function decideCancelConstructionDeletion(input: {
  enabled: boolean;
  constructionRecordId: string;
  matchedRecordCount: number;
  freshRecord: Record<string, unknown> | null;
  keys: ReadonlyArray<{ fieldId: string | null; value: string }>;
}): CancelConstructionDeleteDecision {
  if (!input.enabled) return { ok: false, reason: "disabled" };
  if (!input.constructionRecordId.trim()) {
    return { ok: false, reason: "unknown_record" };
  }
  // 0件は「相手が分からない」、2件以上は「どれを消すか決められない」
  if (input.matchedRecordCount < 1) {
    return { ok: false, reason: "unknown_record" };
  }
  if (input.matchedRecordCount > 1) return { ok: false, reason: "ambiguous" };
  if (!input.freshRecord) return { ok: false, reason: "not_found" };

  const fresh = input.freshRecord;
  const stillMatches = input.keys.some((k) => {
    const fieldId = k.fieldId?.trim() ?? "";
    const want = normApClStaffName(k.value);
    if (!fieldId || !want) return false;
    const cell = coerceCellToPlainString(
      pickRecordValueByFieldAliases(fresh, fieldId),
    );
    return normApClStaffName(cell) === want;
  });
  if (!stillMatches) return { ok: false, reason: "mismatch" };

  return { ok: true };
}
