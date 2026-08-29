import "server-only";

import {
  constructionTitleFieldIsEmpty,
  pickRecordValueByFieldAliases,
} from "@/lib/calendar-kojo";
import { optionalCalendarYmd } from "@/lib/calendar-optional-ymd";
import { normalizeDateForInput } from "@/lib/customer-info-form/resolve-fields";

/**
 * 未定案件の割り当てで、**選ばれた空き枠を削除してよいか**の判定（案B）。
 *
 * ── 何のための削除か ────────────────────────────────────────
 * 割り当ての経路1（工事登録アプリに同じ T番号 のレコードが既にある）は、
 * 空き枠を使わず既存レコードへ日付を書く。同じ T番号 が2件になると
 * findConstructionRecordByTNumber が「複数一致」で止まり、その顧客の
 * 自動照合が二度と通らなくなるからで、この判定は外せない。
 *
 * ところが空き枠がそのまま残るため、同じ日に「案件」と「空き枠」が
 * 並んで枠の数が合わなくなる。枠を超えて登録できてしまう。
 * そこで**既存レコードへ書いたあと、選ばれた空き枠のほうを削除する**。
 *
 * ── なぜ空き枠を消すのか（案A' を採らなかった理由）────────────
 * 逆向き（空き枠を案件に変えて既存レコードを消す）も考えたが採らない。
 * buildConstructionFillPatch が書くのは7〜11列だけで、終了日・メモ・
 * メーカー・パネル容量・蓄電池容量・APPT/CLPT登録番号などは転記されない。
 * このリポジトリが把握していない列が @pocket にある可能性もあり、
 * 案件レコードを消すと**黙って列が失われる**。
 * 消すのが中身の無い空き枠なら、失うものが無い。
 *
 * ── 判定をここに切り出した理由 ──────────────────────────────
 * 物理削除の可否を IO の途中に埋めると、条件が後から確認できなくなる。
 * 純粋関数にしてテストで固定し、ルート側は「この関数が ok を返したときだけ
 * 消す」という1行の約束に落とす。
 *
 * ⚠ この関数は**判定しかしない**。全項目 GET・監査ログ・deleteRecord の
 *    順序（A-4）は呼び出し側の責任。
 */

/** 削除を見送った理由。レスポンス文言と調査ログの両方で使う */
export type EmptySlotDeleteRefusal =
  /** CALENDAR_ASSIGN_DELETE_EMPTY_SLOT=false で止められている */
  | "disabled"
  /** 空き枠が指定されていない（枠が無い日への割り当て）。従来どおり */
  | "no_slot"
  /** 既存レコードへの書き込み先が分からない。証明できないなら消さない */
  | "unknown_existing"
  /** 空き枠と既存レコードが同一。消すと今書いたレコードが消える */
  | "same_record"
  /** 削除直前の取得に失敗した。中身が分からないものは消さない */
  | "not_found"
  /** もう空き枠ではない（別の案件が入った） */
  | "occupied"
  /** 施工予定日が読めない。空き枠として成立していない */
  | "no_start_date";

/**
 * @pocket のセル値を素の文字列にする。
 *
 * 日付列は環境によって文字列でも `{ value: "2026-12-01" }` の形でも返る。
 * String() で潰すと後者が "[object Object]" になり、施工予定日が読めない
 * ＝削除しない側へ倒れる。安全側ではあるが、消すべき枠が消えなくなる。
 *
 * 同じ形の変換がルート側にもあるが（assign-customer-case /
 * move-construction-case の coercePlainString）、この判定を他所の
 * 都合で動かしたくないので、ここでは持ち込まず自前で閉じる。
 */
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

export type EmptySlotDeleteDecision =
  | { ok: true }
  | { ok: false; reason: EmptySlotDeleteRefusal };

/**
 * 空き枠の削除を有効にするか。
 *
 * **既定は有効。** 仕様が「空き枠を削除する」である以上、既定を無効にすると
 * デプロイしても枠の数が合わないままになる。使われない経路は腐りもする。
 *
 * それでも切れる形にしてあるのは、物理削除が取り返しのつかない操作で、
 * かつ @pocket 側の運用（枠の Aki番号 を他アプリが見ている等）を
 * コードから確認できないため。想定外が起きたときに**再デプロイなしで
 * 止められる**ことに価値がある。
 *
 * 止めるときは CALENDAR_ASSIGN_DELETE_EMPTY_SLOT=false（または 0）。
 */
export function assignDeletesEmptySlotEnabled(): boolean {
  const raw = process.env.CALENDAR_ASSIGN_DELETE_EMPTY_SLOT?.trim();
  if (!raw) return true;
  return raw !== "false" && raw !== "0";
}

/**
 * 空き枠を削除してよいか。**すべての条件を満たしたときだけ ok を返す。**
 *
 * @param freshSlotRecord 削除直前に **CSV 指定なし**で取り直した全項目。
 *   絞った列で判定すると「読めていないだけ」を「空だ」と取り違える。
 *   同じレコードが監査ログ（formatDeletionContent）の材料にもなる。
 */
export function decideEmptySlotDeletion(input: {
  enabled: boolean;
  /** 利用者が選んだ空き枠のレコードID */
  slotRecordId: string;
  /** 施工予定日を書き込んだ既存レコードのID（linked.recordId） */
  existingRecordId: string;
  freshSlotRecord: Record<string, unknown> | null;
  /** 工事アプリのお客様名フィールド（空き枠判定の軸） */
  customerNameFieldId: string;
  /** 工事アプリの施工予定日フィールド */
  startDateFieldId: string;
}): EmptySlotDeleteDecision {
  if (!input.enabled) return { ok: false, reason: "disabled" };

  const slotId = input.slotRecordId.trim();
  if (!slotId) return { ok: false, reason: "no_slot" };

  const existingId = input.existingRecordId.trim();
  // 「書けた」ことを ID で確かめられないなら消さない。順序（書く→消す）の
  // 前提が崩れており、消せたが書けていない状態になりうる
  if (!existingId) return { ok: false, reason: "unknown_existing" };
  if (existingId === slotId) return { ok: false, reason: "same_record" };

  const rec = input.freshSlotRecord;
  if (!rec || typeof rec !== "object") {
    return { ok: false, reason: "not_found" };
  }

  // 空き枠の判定は readFreshConstructionEmptySlotState と同じ述語を使う。
  // 別の書き方をすると、片方を直したときにもう片方がずれる
  if (!constructionTitleFieldIsEmpty(rec, input.customerNameFieldId)) {
    return { ok: false, reason: "occupied" };
  }

  const startYmd = optionalCalendarYmd(
    normalizeDateForInput(
      coerceCellToPlainString(
        pickRecordValueByFieldAliases(rec, input.startDateFieldId),
      ),
    ),
  );
  if (!startYmd) return { ok: false, reason: "no_start_date" };

  return { ok: true };
}

/** 削除を見送ったことを利用者に伝えるかどうか（伝えないものは通常運転） */
export function emptySlotDeleteRefusalIsNotable(
  reason: EmptySlotDeleteRefusal,
): boolean {
  // no_slot は「枠が無い日への割り当て」で、削除しないのが正しい動作。
  // disabled は運用者が意図して止めている。どちらも利用者に言うことは無い
  return reason !== "no_slot" && reason !== "disabled";
}

/** 削除を見送った理由の日本語。画面にそのまま出す */
export function emptySlotDeleteRefusalMessage(
  reason: EmptySlotDeleteRefusal,
): string {
  switch (reason) {
    case "same_record":
      return "空き枠と案件が同じレコードだったため";
    case "not_found":
      return "空き枠を取得できなかったため";
    case "occupied":
      return "先に別の案件が入っていたため";
    case "no_start_date":
      return "空き枠の施工予定日を読み取れなかったため";
    case "unknown_existing":
      return "書き込み先のレコードを特定できなかったため";
    default:
      return "";
  }
}
