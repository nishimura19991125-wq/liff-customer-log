import type { MoveTargetSlot } from "@/lib/calendar-move-target-slots";
import { formatDisplayYmd } from "@/lib/format-display-ymd";

/**
 * 工事日変更（M-3）の移動先選択。空き枠か新規作成かを**ラジオで選ばせる**。
 *
 * ■ 「未選択」を「新規作成」と別の値にする
 * 以前は selectedSlotId の空文字が「新規作成」を兼ねていた。日付を選んだ
 * 時点で新規作成が選ばれている状態になり、
 *   ・利用者が枠の有無を見ないまま実行できる
 *   ・新規作成のときだけ出したい施工業者の欄が常に出る
 * の2つが避けられない。工事日の移動は元に戻せないので、枠を使うのか
 * 作るのかは**1回選ばせる**。
 *
 * ■ 施工業者を必須にするのは、一覧を引けているときだけ
 * 取引先会社一覧の環境変数が未設定だと選択肢が1つも出ない。そこで必須に
 * すると新規作成での移動が一切できなくなる（今はできる）。引けないときは
 * 従来どおり API 側の引き継ぎ（枠 → 画面の指定 → 移動元）に任せる。
 */

/** まだ選んでいない。実行させない */
export const MOVE_SLOT_CHOICE_NONE = "";
/** 空き枠を使わず新しいレコードを作る */
export const MOVE_SLOT_CHOICE_NEW = "__new__";

/**
 * 施工会社が入っていない空き枠の2行目。
 *
 * 「未設定」だけだと、移動したあと施工会社がどうなるか読めない。この枠を
 * 選ぶと API は `slotContractor || body.contractor || sourceContractor` で
 * 決めるので、枠の値が空なら**移動元の施工会社がそのまま残る**
 * （route.ts の move-construction-case）。そこまで書いておく。
 */
export const MOVE_SLOT_CONTRACTOR_UNSET_LABEL = "施工会社: 未設定（移動元のまま）";

/** ラジオの選択肢1つぶん。空き枠は日付と施工会社の2行で出す */
export type MoveSlotChoice = {
  /** ラジオの value。空き枠なら recordId、新規作成なら __new__ */
  value: string;
  /** 1行目。空き枠なら移動先の日付、新規作成なら「新しく作成する」 */
  label: string;
  /** 2行目。新規作成では出さないので null */
  detail: string | null;
  isNew: boolean;
};

export function moveSlotChoiceIsNew(value: string): boolean {
  return value.trim() === MOVE_SLOT_CHOICE_NEW;
}

/** 選んだ値から API へ送る slotRecordId を取り出す。新規作成・未選択は空文字 */
export function slotRecordIdFromChoice(value: string): string {
  const t = value.trim();
  if (!t || t === MOVE_SLOT_CHOICE_NEW) return "";
  return t;
}

/**
 * その日の空き枠を並べ、**末尾に「新しく作成する」**を置く。
 * 空き枠が無い日は「新しく作成する」だけになる。
 *
 * 空き枠は日付と施工会社を分けて返す。1行に詰めると、どの枠も同じ
 * 書き出しで始まり、**選ぶ材料である施工会社が行末に埋もれる**。
 * 日付は全部同じ値だが、いま何日へ移そうとしているのかを枠のそばで
 * 確かめられるように出す。
 */
export function buildMoveSlotChoices(
  slots: readonly MoveTargetSlot[],
  targetDayKey: string,
): MoveSlotChoice[] {
  // 確認画面と同じ形式（yyyy/mm/dd）。読めない値でも枠は隠さない
  const ymd = formatDisplayYmd(targetDayKey) || targetDayKey.trim() || "空き枠";
  const out: MoveSlotChoice[] = slots.map((slot) => ({
    value: slot.recordId,
    label: ymd,
    // 施工会社が選ぶ材料になる。空の枠も隠さず、そのあとどうなるかまで出す
    detail: slot.contractorName.trim()
      ? `施工会社: ${slot.contractorName.trim()}`
      : MOVE_SLOT_CONTRACTOR_UNSET_LABEL,
    isNew: false,
  }));
  out.push({
    value: MOVE_SLOT_CHOICE_NEW,
    label: "新しく作成する",
    // 新規作成は1行のまま（施工業者は下の欄で選ばせる）
    detail: null,
    isNew: true,
  });
  return out;
}

/** 施工業者の選択欄をどう扱うか */
export type MoveContractorInputState = {
  /** 欄を出すか。空き枠を選んだときは出さない（枠の施工会社が使われる） */
  show: boolean;
  /** 選択を必須にするか。一覧を引けていないときは必須にしない */
  required: boolean;
};

export function resolveMoveContractorInput(input: {
  slotChoice: string;
  optionsLoading: boolean;
  optionsConfigured: boolean;
  optionCount: number;
}): MoveContractorInputState {
  const show = moveSlotChoiceIsNew(input.slotChoice);
  if (!show) return { show: false, required: false };

  // 読み込み中は「引けない」と決めつけない。出揃うまでは必須のまま止める
  const usable = input.optionsConfigured && input.optionCount > 0;
  return { show: true, required: input.optionsLoading || usable };
}

/** 移動元と同じ日か（押し間違いとして弾く） */
export function moveTargetIsSameDay(
  targetDayKey: string,
  sourceDayKey: string,
): boolean {
  const t = targetDayKey.trim();
  return Boolean(t) && t === sourceDayKey.trim();
}

/**
 * 確認へ進めるか。
 * 枠の読み込み中・読み込み失敗は呼び出し側で別に弾く（理由を出し分けるため）。
 */
export function canConfirmMoveCase(input: {
  /** 案件と移動元の日付が揃っていて、ログインできている */
  canOpen: boolean;
  targetDayKey: string;
  sourceDayKey: string;
  slotChoice: string;
  /** 工事対応者をスタッフ名簿から選ぶ環境か */
  handlerRequired: boolean;
  handlerStaffId: string;
  contractorRequired: boolean;
  contractor: string;
}): boolean {
  if (!input.canOpen) return false;
  if (!input.targetDayKey.trim()) return false;
  if (moveTargetIsSameDay(input.targetDayKey, input.sourceDayKey)) return false;
  // 枠を使うのか作るのかを選んでいない
  if (!input.slotChoice.trim()) return false;
  if (input.handlerRequired && !input.handlerStaffId.trim()) return false;
  if (input.contractorRequired && !input.contractor.trim()) return false;
  return true;
}
