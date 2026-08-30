import "server-only";

import { readConstructionTNumberFromRecord } from "@/lib/calendar-construction-pocket-common";
import { constructionTitleFieldIsEmpty } from "@/lib/calendar-kojo";

/**
 * 工事日の移動で、**移動元のレコードを削除してよいか**の判定（M-4）。
 *
 * ── これまでの方針を変える判断であること ──────────────────────
 * M-2 は「削除しない。移動元は列を空にして空き枠へ戻す」で作った。
 * 変えた理由は、移動元がその日の枠として残り続けるため、案件を別の日へ
 * 移しても**元の日の枠数が減らない**こと。枠を減らしたい運用がある。
 *
 * ⚠ 失うものがある。buildConstructionFillPatch が移動先へ書くのは
 *    最大11列（お客様名・住宅ステータス・Aki番号・T番号・工事対応者・
 *    施工予定日・施工会社・新築の4日付）だけで、終了日・メモなど
 *    それ以外の列は**転記されない**。空き枠として残していたときは
 *    レコード上に残っていたが、削除すると唯一の写しが消える。
 *    だから既定は「残す」で、明示的に選ばれたときだけ消す。
 *    確認画面にもそのことを書く（calendar-move-case-messages）。
 *
 * ── 判定をここに切り出した理由 ──────────────────────────────
 * assign-customer-case の calendar-assign-slot-delete-guard と同じ理屈。
 * 物理削除の可否を IO の途中に埋めると条件が後から確認できなくなる。
 * 純粋関数にしてテストで固定し、ルート側は「ok を返したときだけ消す」
 * という1行の約束に落とす。
 *
 * ⚠ あちらの decideEmptySlotDeletion は**流用できない**。
 *    あちらは「お客様名が空であること」を必須にする（空き枠しか消さない）。
 *    こちらが消すのは**お客様名が入っている案件レコード**で、条件が
 *    正反対になる。形だけ揃えて別物として置く。
 *
 * ⚠ この関数は**判定しかしない**。全項目 GET・監査ログ・deleteRecord の
 *    順序（A-4）は呼び出し側の責任。
 */

/** 移動元のレコードをどうするか。省略時は keep（従来どおり空き枠へ戻す） */
export type MoveSourceDisposition = "keep" | "delete";

/**
 * body の値を読む。**知らない値はすべて keep に倒す。**
 *
 * 送らなかった古いクライアントが消す側へ倒れてはいけない。移動 API は
 * 既に稼働しており、デプロイ中は画面のキャッシュが古いままになる。
 */
export function moveSourceDispositionFromBody(
  raw: unknown,
): MoveSourceDisposition {
  return typeof raw === "string" && raw.trim() === "delete" ? "delete" : "keep";
}

/**
 * 移動元の削除を有効にするか。
 *
 * **既定は有効。** 止めるときは CALENDAR_MOVE_DELETE_SOURCE_RECORD=false
 * （または 0）。false のときは、画面が「削除する」を選んでいても
 * 空き枠へ戻す動作へ強制的に倒す。
 *
 * 既定を有効にしてあるのは、CALENDAR_ASSIGN_DELETE_EMPTY_SLOT と
 * 同型にするため。物理削除が取り返しのつかない操作で、@pocket 側の運用を
 * コードから確認できない以上、**再デプロイなしで止められる**ことに
 * 価値がある。既定で消えるわけではない（そちらは disposition が決める）。
 */
export function moveDeletesSourceRecordEnabled(): boolean {
  const raw = process.env.CALENDAR_MOVE_DELETE_SOURCE_RECORD?.trim();
  if (!raw) return true;
  return raw !== "false" && raw !== "0";
}

/** 削除を見送った理由。フォールバックの案内と調査ログの両方で使う */
export type MoveSourceDeleteRefusal =
  /** CALENDAR_MOVE_DELETE_SOURCE_RECORD=false で止められている */
  | "disabled"
  /** 画面が「空き枠として残す」を選んだ。既定の動作 */
  | "keep_requested"
  /** 移動元と移動先が同じレコード。消すと今書いたレコードが消える */
  | "same_record"
  /** 移動先のレコードIDが分からない。書けたことを証明できないなら消さない */
  | "unknown_target"
  /** W1 を書いていない。順序（書く→消す）の前提が崩れている */
  | "not_written"
  /** 削除直前の取得に失敗した。中身が分からないものは消さない */
  | "not_found"
  /** もう空き枠になっている。案件ではないものを消さない */
  | "already_empty"
  /** 別の案件に差し替わっている */
  | "changed"
  /** T番号 が読めない。同じ案件だと確かめられない */
  | "no_t_number"
  /** お客様名・T番号 の列を特定できていない。判定そのものが成り立たない */
  | "unresolved_field"
  /**
   * 削除ログを残せなかった（A-4）。
   *
   * ⚠ decideMoveSourceDeletion はこれを返さない。監査ログの結果は判定の
   *    あとに分かるため、**ルート側が立てる**。文言をここに置くのは、
   *    見送った理由の出し方を1箇所にまとめるため。
   */
  | "log_failed";

export type MoveSourceDeleteDecision =
  | { ok: true }
  | { ok: false; reason: MoveSourceDeleteRefusal };

/**
 * 移動元を削除してよいか。**すべての条件を満たしたときだけ ok を返す。**
 *
 * 1つでも外れたら呼び出し側は削除せず、空き枠へ戻す動作へフォールバックする。
 *
 * @param freshSourceRecord W2 の直前に **CSV 指定なし**で取り直した全項目。
 *   事前検証で読んだレコードは8列に絞ってあるので使えない。絞った列で
 *   判定すると「読めていないだけ」を「空だ」と取り違える。同じレコードが
 *   監査ログ（formatDeletionContent）の材料にもなるので、取得は1回で足りる。
 */
export function decideMoveSourceDeletion(input: {
  enabled: boolean;
  disposition: MoveSourceDisposition;
  /** 移動元（消す候補）のレコードID */
  sourceRecordId: string;
  /** 移動先に書いたレコードID。空なら消さない */
  movedRecordId: string;
  /** W1 を書き終えているか */
  movedWritten: boolean;
  freshSourceRecord: Record<string, unknown> | null;
  /** 工事アプリのお客様名フィールド（案件かどうかの軸） */
  customerNameFieldId: string;
  /** 工事アプリの T番号 フィールド */
  tNumberFieldId: string;
  /** 事前検証で読んだ移動元の T番号 */
  expectedTNumber: string;
}): MoveSourceDeleteDecision {
  if (!input.enabled) return { ok: false, reason: "disabled" };
  if (input.disposition !== "delete") {
    return { ok: false, reason: "keep_requested" };
  }

  // 「書けた」ことを ID で確かめられないなら消さない。順序の前提が崩れており、
  // 消せたが書けていない状態になりうる（案件が消えて復旧手段が無い）
  if (!input.movedWritten) return { ok: false, reason: "not_written" };

  const sourceId = input.sourceRecordId.trim();
  const movedId = input.movedRecordId.trim();
  if (!movedId) return { ok: false, reason: "unknown_target" };
  if (!sourceId || sourceId === movedId) {
    return { ok: false, reason: "same_record" };
  }

  const rec = input.freshSourceRecord;
  if (!rec || typeof rec !== "object") {
    return { ok: false, reason: "not_found" };
  }

  /**
   * 列を特定できていないなら判定が成り立たない。
   * constructionTitleFieldIsEmpty は列 ID が空だと false（＝案件扱い）を
   * 返すので、ここで止めないと「読めていないだけ」で削除まで通ってしまう
   */
  if (!input.customerNameFieldId.trim() || !input.tNumberFieldId.trim()) {
    return { ok: false, reason: "unresolved_field" };
  }

  // 案件かどうかの述語は resetSourceToEmptySlot の再確認と同じものを使う。
  // 別の書き方をすると、片方を直したときにもう片方がずれる
  if (constructionTitleFieldIsEmpty(rec, input.customerNameFieldId)) {
    return { ok: false, reason: "already_empty" };
  }

  /**
   * T番号 の一致。
   *
   * ⚠ **空は不一致として扱う。** 移行前の案件は T番号 が無いことがあり、
   *    空き枠へ戻す側は「空なら進む」で通している（更新は取り返しがつく）。
   *    削除はつかないので、同じ案件だと確かめられないものは消さない。
   */
  const currentT =
    readConstructionTNumberFromRecord(rec, input.tNumberFieldId) ?? "";
  const expected = input.expectedTNumber.trim();
  if (!currentT.trim() || !expected) {
    return { ok: false, reason: "no_t_number" };
  }
  if (currentT.trim() !== expected) return { ok: false, reason: "changed" };

  return { ok: true };
}

/** 削除を見送ったことを利用者に伝えるか（伝えないものは通常運転） */
export function moveSourceDeleteRefusalIsNotable(
  reason: MoveSourceDeleteRefusal,
): boolean {
  // keep_requested は既定の動作そのもの。disabled は運用者が意図して
  // 止めている。どちらも「移動できた」以上に言うことは無い
  return reason !== "keep_requested" && reason !== "disabled";
}

/**
 * 削除を見送った理由の日本語。
 * 移動そのものは成功しているので、成功レスポンスに添える形で出す。
 */
export function moveSourceDeleteRefusalMessage(
  reason: MoveSourceDeleteRefusal,
): string {
  switch (reason) {
    case "same_record":
      return "移動元と移動先が同じレコードだったため";
    case "unknown_target":
      return "移動先のレコードを特定できなかったため";
    case "not_written":
      return "移動先への書き込みを確認できなかったため";
    case "not_found":
      return "移動元を取得できなかったため";
    case "already_empty":
      return "移動元が既に空き枠になっていたため";
    case "changed":
      return "移動元が別の案件に変わっていたため";
    case "no_t_number":
      return "移動元の T番号 を確認できなかったため";
    case "unresolved_field":
      return "工事アプリの列を特定できなかったため";
    case "log_failed":
      return "削除の記録を残せなかったため";
    default:
      return "";
  }
}

/** 見送ったときに画面へ出す一文。空き枠として残したことまで言い切る */
export function moveSourceKeptInsteadOfDeleteMessage(
  reason: MoveSourceDeleteRefusal,
): string {
  const why = moveSourceDeleteRefusalMessage(reason);
  if (!why) return "";
  return `${why}、移動元は削除せず空き枠として残しました。`;
}
